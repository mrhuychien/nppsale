import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ RÀ SOÁT 03/10/2026: thẻ lọc nhanh ("Nợ quá hạn") + bộ lọc NV. Bản cũ cắt 20 mã / trang từ danh sách nợ quá hạn
 *   (xếp nợ giảm dần) rồi MỚI lọc NV trên 20 mã ấy — trang đầu trống, tổng vẫn ghi cả danh sách. Nay lọc toàn bộ danh
 *   sách mã trước rồi mới cắt trang (`src/lib/customers/loc-nhanh.ts`).
 * Dữ liệu: 25 khách "AA…" của NV Bảy nợ quá hạn NHIỀU (đứng đầu danh sách mã), 25 khách "ZZ…" của NV Sáu nợ quá hạn ÍT.
 */
test.use({ viewport: { width: 1280, height: 900 } })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const NV = { id: "00000000-0000-4000-8000-0000000000f1", org_id: ORG, full_name: "Lê Thị Sáu", role: "sales", is_active: true }
const KHAC = { id: "00000000-0000-4000-8000-0000000000f2", org_id: ORG, full_name: "Trần Văn Bảy", role: "sales", is_active: true }
const pc = (u: string) => [{ user_id: u, role: "primary", status: "active" }]
const KH = [
  ...Array.from({ length: 25 }, (_, i) => ({ id: `lnk-sau-${i}`, org_id: ORG, store_name: `ZZ Khách Sáu ${String(i + 1).padStart(2, "0")}`, status: "active", nv_chinh: pc(NV.id) })),
  ...Array.from({ length: 25 }, (_, i) => ({ id: `lnk-bay-${i}`, org_id: ORG, store_name: `AA Khách Bảy ${String(i + 1).padStart(2, "0")}`, status: "active", nv_chinh: pc(KHAC.id) })),
]
const NO = KH.map((k, i) => ({
  id: `lnk-no-${i}`, org_id: ORG, customer_id: k.id, status: "open", paid: 0, due_date: "2026-06-01", invoice_id: null,
  // Khách của Bảy nợ nhiều hơn → đứng đầu danh sách "Nợ quá hạn" (xếp nợ giảm dần).
  amount: k.id.startsWith("lnk-bay") ? 9_000_000 - i * 1000 : 1_000_000 - i * 1000,
}))
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async ({ page }) => {
  await api("users", { method: "POST", body: JSON.stringify([NV, KHAC]) })
  await api("customers", { method: "POST", body: JSON.stringify(KH) })
  await api("receivables", { method: "POST", body: JSON.stringify(NO) })
  await page.addInitScript(() => window.localStorage.setItem("list-view:customers", JSON.stringify({ filters: ["search", "sales"] })))
})
test.afterEach(async () => {
  for (const u of [NV, KHAC]) await api(`users?id=eq.${u.id}`, { method: "DELETE" })
  for (const k of KH) await api(`customers?id=eq.${k.id}`, { method: "DELETE" })
  for (const n of NO) await api(`receivables?id=eq.${n.id}`, { method: "DELETE" })
})

test("Nợ quá hạn + lọc NV: trang 1 đủ 20 khách của NV, tổng 25, thứ tự nợ giảm dần", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  const nhan = (t: string) => page.getByText(t, { exact: true }).filter({ visible: true })
  await expect(nhan("AA Khách Bảy 01")).toBeVisible()

  await page.getByRole("tab", { name: /Nợ quá hạn/ }).filter({ visible: true }).click()
  await page.getByRole("combobox", { name: "Nhân viên" }).click()
  await page.getByRole("option", { name: "Lê Thị Sáu" }).click()

  // Bản cũ: 20 mã đầu đều của Bảy → lọc NV còn 0 khách ở trang 1.
  await expect(nhan("ZZ Khách Sáu 01")).toBeVisible()
  await expect(nhan("ZZ Khách Sáu 20")).toBeVisible()
  await expect(nhan("ZZ Khách Sáu 21")).toHaveCount(0) // trang 2
  await expect(nhan("AA Khách Bảy 01")).toHaveCount(0)
  await expect(page.getByText(/25 khách|\/ 25|của 25|25 kết quả/).filter({ visible: true }).first()).toBeVisible()
})
