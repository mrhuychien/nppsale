import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/10/2026: "danh sách khách hàng sao lọc theo nhân viên ra danh sách không đúng, bị thiếu — nhân
 *   viên 60 khách mà có 3 khách hiện". Bản cũ lọc NV trong 20 khách của trang đang tải. Nay lọc trên máy chủ
 *   (nhúng customer_assignments, NV chính) — `src/lib/customers/loc-nhan-vien.ts`.
 * Dữ liệu: NV Sáu phụ trách 25 khách tên "ZZ…" (xếp CUỐI theo tên — bản cũ trang 1 không có ai), 3 khách "AA…"
 *   của NV khác.
 */
test.use({ viewport: { width: 1280, height: 900 } })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const NV = { id: "00000000-0000-4000-8000-0000000000e9", org_id: ORG, full_name: "Lê Thị Sáu", role: "sales", is_active: true }
const KHAC = { id: "00000000-0000-4000-8000-0000000000ea", org_id: ORG, full_name: "Trần Văn Bảy", role: "sales", is_active: true }
const pc = (u: string) => [{ user_id: u, role: "primary", status: "active" }]
const KH = [
  ...Array.from({ length: 25 }, (_, i) => ({ id: `kh-sau-${i}`, org_id: ORG, store_name: `ZZ Khách Sáu ${String(i + 1).padStart(2, "0")}`, status: "active", nv_chinh: pc(NV.id) })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `kh-bay-${i}`, org_id: ORG, store_name: `AA Khách Bảy ${i + 1}`, status: "active", nv_chinh: pc(KHAC.id) })),
]
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async ({ page }) => {
  await api("users", { method: "POST", body: JSON.stringify([NV, KHAC]) })
  await api("customers", { method: "POST", body: JSON.stringify(KH) })
  await page.addInitScript(() => window.localStorage.setItem("list-view:customers", JSON.stringify({ filters: ["search", "sales"] })))
})
test.afterEach(async () => {
  for (const u of [NV, KHAC]) await api(`users?id=eq.${u.id}`, { method: "DELETE" })
  for (const k of KH) await api(`customers?id=eq.${k.id}`, { method: "DELETE" })
})

test("lọc NV: đủ khách của NV (qua nhiều trang), không lẫn khách NV khác; Chưa phân công", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  const nhan = (t: string) => page.getByText(t, { exact: true }).filter({ visible: true })
  await expect(nhan("AA Khách Bảy 1")).toBeVisible()

  await page.getByRole("combobox", { name: "Nhân viên" }).click()
  await page.getByRole("option", { name: "Lê Thị Sáu" }).click()
  // Trang 1 đủ 20 khách của Sáu (bản cũ: 0 — 20 khách đầu theo tên không phải của Sáu).
  await expect(nhan("ZZ Khách Sáu 01")).toBeVisible()
  await expect(nhan("ZZ Khách Sáu 20")).toBeVisible()
  await expect(nhan("AA Khách Bảy 1")).toHaveCount(0)
  await expect(page.getByText(/25 khách|\/ 25|của 25|25 kết quả/).first()).toBeVisible()

  // Chưa phân công: khách mẫu (không phụ trách chính) có, khách của Sáu / Bảy không.
  await page.getByRole("combobox", { name: "Nhân viên" }).click()
  await page.getByRole("option", { name: "Chưa phân công" }).click()
  await expect(nhan("Tạp hoá Cô Ba")).toBeVisible()
  await expect(nhan("ZZ Khách Sáu 01")).toHaveCount(0)
  await expect(nhan("AA Khách Bảy 1")).toHaveCount(0)
})
