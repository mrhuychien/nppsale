import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 04/10/2026: "Sao danh sách khách hàng mất 1 số bộ lọc tuyến, phường, Phụ trách rồi".
 *   Bản cũ: ba ô là bộ lọc TUỲ CHỌN (mặc định chỉ có ô tìm), không có ô Phường; điện thoại chỉ có Trạng thái + Tuyến.
 *   Nay Tuyến · Phường · Phụ trách luôn hiện ở cả hai màn, lọc trên máy chủ — kể cả khi lựa chọn đã lưu trên máy
 *   chỉ có ô tìm (người dùng cũ).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KH = [
  { id: "kh-ward-1", org_id: ORG, store_name: "BL Khách Phường Ái Quốc", status: "active", ward: "Phường Ái Quốc" },
  { id: "kh-ward-2", org_id: ORG, store_name: "BL Khách Phường An Biên", status: "active", ward: "Phường An Biên" },
]
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async ({ page }) => {
  await api("customers", { method: "POST", body: JSON.stringify(KH) })
  // Người dùng cũ: lựa chọn đã lưu chỉ có ô tìm.
  await page.addInitScript(() => window.localStorage.setItem("list-view:customers", JSON.stringify({ filters: ["search"] })))
})
test.afterEach(async () => {
  for (const k of KH) await api(`customers?id=eq.${k.id}`, { method: "DELETE" })
})

const nhan = (page: import("@playwright/test").Page, t: string) => page.getByText(t, { exact: true }).filter({ visible: true })

test("máy tính: Tuyến · Phường · Phụ trách luôn hiện; lọc phường trên máy chủ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto("/customers")
  await expect(nhan(page, "BL Khách Phường An Biên")).toBeVisible()
  for (const ten of ["Tuyến", "Phường/xã", "Nhân viên"]) {
    await expect(page.getByRole("combobox", { name: ten }).filter({ visible: true })).toBeVisible()
  }
  await page.getByRole("combobox", { name: "Phường/xã" }).filter({ visible: true }).click()
  await page.getByRole("option", { name: "Phường Ái Quốc" }).click()
  await expect(nhan(page, "BL Khách Phường Ái Quốc")).toBeVisible()
  await expect(nhan(page, "BL Khách Phường An Biên")).toHaveCount(0)
  const log = await (await fetch(`${FAKE}/__log`)).json()
  expect(JSON.stringify(log)).toContain("ward=eq.")
})

test("điện thoại: có ô Phường và Phụ trách; lọc phường", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await dangNhap(page)
  await page.goto("/customers")
  const man = page.getByTestId("kh-mobile")
  await expect(man.getByText("BL Khách Phường An Biên", { exact: true })).toBeVisible()
  await expect(man.getByRole("combobox", { name: "Phụ trách" })).toBeVisible()
  await man.getByRole("combobox", { name: "Phường/xã" }).click()
  await page.getByRole("option", { name: "Phường An Biên" }).click()
  await expect(man.getByText("BL Khách Phường An Biên", { exact: true })).toBeVisible()
  await expect(man.getByText("BL Khách Phường Ái Quốc", { exact: true })).toHaveCount(0)
})
