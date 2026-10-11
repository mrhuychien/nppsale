import { test, expect, type Page } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap, FAKE } from "./helpers"
import { KHACH, ORG, OWNER } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 11/10/2026: "phần danh sách khách hàng thêm cho tao phần xuất excel chi tiết thông tin". Nút "Xuất Excel"
 *   ở danh sách khách xuất MỌI khách khớp bộ lọc / thẻ lọc (không chỉ 20 dòng đang xem) — sheet "Khách hàng", mỗi khách
 *   một dòng, đủ thông tin. Logic: tests/khach-xuat-excel.test.ts.
 */
test.use({ viewport: { width: 1280, height: 900 } })

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

/* 23 khách thêm + 2 khách mẫu = 25 — danh sách 20 dòng/trang; tệp phải có ĐỦ 25. */
const THEM = Array.from({ length: 23 }, (_, i) => ({
  id: `kx-${String(i).padStart(2, "0")}`, org_id: ORG, store_name: `Khách xuất ${String(i).padStart(2, "0")}`, owner_name: "Chủ thử",
  phone: `09330000${String(i).padStart(2, "0")}`, address: `${i} Trần Phú`, status: "active", group_id: null, credit_limit: 0,
  payment_terms: "COD", created_at: "2026-09-10T03:00:00Z",
}))

test.beforeAll(async () => {
  await api("customers", "POST", THEM)
  // Tạp hoá Cô Ba: nợ 250.000 đã trả 50.000, hạn 01/09 (đồng hồ e2e 30/09) → còn 200.000, quá hạn 200.000.
  await api("receivables", "POST", [{ id: "rc-kx", org_id: ORG, customer_id: KHACH, amount: 250000, paid: 50000, status: "open", due_date: "2026-09-01", created_at: "2026-08-25T03:00:00Z" }])
  await api("customer_assignments", "POST", [{ id: "as-kx", customer_id: KHACH, user_id: OWNER, role: "primary", status: "active", user: { id: OWNER, full_name: "Chủ NPP", is_active: true } }])
})
test.afterEach(async () => {
  await doiVai("owner")
})
test.afterAll(async () => {
  await api("customers?id=like.kx-*", "DELETE")
  await api("receivables?id=eq.rc-kx", "DELETE")
  await api("customer_assignments?id=eq.as-kx", "DELETE")
})

async function xuat(page: Page) {
  const nut = page.locator('[data-testid="xuat-excel"]:visible').first()
  await expect(nut).toBeEnabled()
  const [tai] = await Promise.all([page.waitForEvent("download"), nut.click()])
  const wb = XLSX.read(Buffer.concat((await (await tai.createReadStream()).toArray()) as Buffer[]))
  return { ten: tai.suggestedFilename(), sheets: wb.SheetNames, dong: XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Khách hàng"]) }
}

test("Xuất Excel: ĐỦ 25 khách (không chỉ trang 20), đủ thông tin — SĐT giữ số 0, công nợ / quá hạn là số, NV phụ trách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  // Xếp theo tên: trang 1 là "Khách xuất 00…19"; Tạp hoá Cô Ba / Đại lý Minh ở trang 2 — tệp vẫn phải có.
  await expect(page.getByRole("link", { name: "Khách xuất 00" }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Tạp hoá Cô Ba" })).toHaveCount(0)
  const x = await xuat(page)
  expect(x.ten).toBe("khach-hang_2026-09-30.xlsx")
  expect(x.sheets).toEqual(["Khách hàng"])
  expect(x.dong).toHaveLength(25)
  expect(x.dong.find((r) => r["Tên cửa hàng"] === "Tạp hoá Cô Ba")).toMatchObject({
    "Chủ cửa hàng": "Cô Ba", SĐT: "0911111111", "Địa chỉ": "1 Lê Lợi", "NV phụ trách chính": "Chủ NPP",
    "Công nợ hiện tại": 200000, "Nợ quá hạn": 200000, "Hạn mức công nợ": 0, "Điều khoản thanh toán": "COD", "Trạng thái": "Đang hoạt động",
  })
  expect(x.dong.find((r) => r["Tên cửa hàng"] === "Khách xuất 22")).toMatchObject({ SĐT: "0933000022", "Công nợ hiện tại": 0 })
  await expect(page.getByText("Đã xuất 25 khách hàng ra Excel").first()).toBeVisible()
})

test("Xuất đúng cái đang xem: ô tìm 'Minh' → chỉ Đại lý Minh; thẻ 'Nợ quá hạn' → chỉ khách nợ quá hạn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  await expect(page.getByRole("link", { name: "Khách xuất 00" }).first()).toBeVisible()
  await page.getByPlaceholder("Tên cửa hàng, chủ quán, SĐT, địa chỉ…").fill("Minh")
  await expect(page.getByRole("link", { name: "Đại lý Minh" }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Khách xuất 00" })).toHaveCount(0)
  const tim = await xuat(page)
  expect(tim.dong.map((r) => r["Tên cửa hàng"])).toEqual(["Đại lý Minh"])

  await page.getByPlaceholder("Tên cửa hàng, chủ quán, SĐT, địa chỉ…").fill("")
  await expect(page.getByRole("link", { name: "Khách xuất 00" }).first()).toBeVisible()
  await page.getByRole("tab", { name: /Nợ quá hạn/ }).filter({ visible: true }).click()
  await expect(page.getByRole("link", { name: "Tạp hoá Cô Ba" }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Khách xuất 00" })).toHaveCount(0)
  const qh = await xuat(page)
  expect(qh.dong.map((r) => [r["Tên cửa hàng"], r["Nợ quá hạn"]])).toEqual([["Tạp hoá Cô Ba", 200000]])
})

test("NVBH không có ô 'Xuất file' khách hàng → không thấy nút", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/customers")
  await expect(page.getByRole("heading", { name: "Khách hàng của tôi" }).first()).toBeVisible()
  await expect(page.locator('[data-testid="xuat-excel"]')).toHaveCount(0)
})
