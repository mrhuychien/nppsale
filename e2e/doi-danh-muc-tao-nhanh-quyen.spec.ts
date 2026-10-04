import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ĐỘI TEST "Danh mục, Quyền & Tạo nhanh" — màn hình.
 *
 * · Tạo nhanh theo QUYỀN (chủ nhà 03/10/2026, `duocTaoNhanh`): "Không có quyền thì … dòng ấy không hiện, chứ
 *   không hiện rồi báo lỗi". Tuyến → chủ / quản lý; sản phẩm → products.create (chủ / quản lý); NCC →
 *   inventory.create (chủ / thủ kho). Khớp RLS đo ở scripts/sql/doi-test/danh-muc-quyen-rls.sql.
 * · Chữ đang tìm đi vào đúng ô của bản ghi mới (`chuBanDauTuyen`: "t9" → MÃ "T9").
 * · Người đã nghỉ (mig 223) không hiện trong ô chọn nhân viên.
 * Tài khoản e2e tạm đổi vai bằng PATCH users (như e2e/phan-quyen-nvbh.spec.ts).
 */
test.use({ viewport: { width: 1280, height: 900 } })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, { method: "PATCH", body: JSON.stringify({ role }) })
const xo = (page: Page) => page.getByTestId("search-select-xo").filter({ visible: true })

const DANG_LAM = { id: "00000000-0000-4000-8000-0000000000f1", org_id: ORG, full_name: "Đỗ Đang Làm", role: "sales", phone: "0911000071", is_active: true, left_at: null }
const DA_NGHI = { id: "00000000-0000-4000-8000-0000000000f2", org_id: ORG, full_name: "Ngô Đã Nghỉ", role: "sales", phone: "0911000072", is_active: false, left_at: "2026-09-20T03:00:00Z" }
const TAM_KHOA = { id: "00000000-0000-4000-8000-0000000000f3", org_id: ORG, full_name: "Lý Tạm Khoá", role: "sales", phone: "0911000073", is_active: false, left_at: null }

test.beforeEach(async () => {
  await api("sales_routes", { method: "POST", body: JSON.stringify([{ id: "tuyen-dm", org_id: ORG, code: "DM", name: "Danh Mục", is_active: true, sort_order: 1 }]) })
})
test.afterEach(async () => {
  await doiVai("owner")
  await api("sales_routes?code=eq.T9", { method: "DELETE" })
  await api("sales_routes?id=eq.tuyen-dm", { method: "DELETE" })
  for (const u of [DANG_LAM, DA_NGHI, TAM_KHOA]) await api(`users?id=eq.${u.id}`, { method: "DELETE" })
})

test("khách mới: chủ NPP gõ 't9' ở ô tuyến → '+ Tạo tuyến mới' → mã T9 điền sẵn, tạo xong tự chọn, form giữ nguyên", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/new?sdt=0911222333")
  await page.locator("#cf-store").fill("Tạp hoá Thử Quyền")
  const o = page.locator("#customer-route")
  await o.click()
  await o.fill("t9")
  await expect(xo(page).getByTestId("search-select-tao-moi")).toHaveText("Tạo tuyến mới “t9”")
  await xo(page).getByTestId("search-select-tao-moi").click()

  const khung = page.getByTestId("tao-nhanh-tuyen")
  await expect(khung.locator("#route-code")).toHaveValue("T9")
  await expect(khung.locator("#route-name")).toHaveValue("")
  await khung.locator("#route-name").fill("Thứ Chín")
  await khung.getByRole("button", { name: "Tạo tuyến" }).click()
  await expect(khung).toHaveCount(0)

  await expect(page).toHaveURL(/\/customers\/new\?sdt=0911222333$/)
  await expect(page.locator("#cf-store")).toHaveValue("Tạp hoá Thử Quyền")
  // Bỏ qua bước dò trùng bằng ?sdt= — SĐT tìm được gán sẵn (chủ nhà 01/10/2026).
  await expect(page.locator("#cf-phone")).toHaveValue("0911222333")
  await expect(o).toHaveValue(/T9/)
  const ds = await (await api("sales_routes?code=eq.T9&select=*")).json()
  expect(ds).toHaveLength(1)
  expect(ds[0]).toMatchObject({ code: "T9", name: "Thứ Chín", org_id: ORG })
})

test("khách mới: gõ tên tuyến có dấu 'Thứ Chín' → tên điền sẵn, mã để trống", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/new?sdt=0911222333")
  const o = page.locator("#customer-route")
  await o.click()
  await o.fill("Thứ Chín")
  await xo(page).getByTestId("search-select-tao-moi").click()
  const khung = page.getByTestId("tao-nhanh-tuyen")
  await expect(khung.locator("#route-code")).toHaveValue("")
  await expect(khung.locator("#route-name")).toHaveValue("Thứ Chín")
  await khung.getByRole("button", { name: "Hủy" }).click()
  await expect(khung).toHaveCount(0)
  expect(await (await api("sales_routes?name=eq.Th%E1%BB%A9%20Ch%C3%ADn&select=id")).json()).toHaveLength(0)
})

test("NVBH: vào được form khách mới nhưng KHÔNG có dòng '+ Tạo tuyến mới' (RLS sales_routes chỉ chủ / quản lý)", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/customers/new?sdt=0911222333")
  await expect(page.locator("#cf-store")).toBeVisible()
  const o = page.locator("#customer-route")
  await o.click()
  await o.fill("t9")
  await expect(xo(page)).toBeVisible()
  await expect(xo(page).getByTestId("search-select-tao-moi")).toHaveCount(0)
  // Tuyến có sẵn vẫn tìm + chọn được (NVBH đọc được tuyến), không dấu / chữ thường.
  await o.fill("danh muc")
  await xo(page).getByRole("button", { name: /DM — Danh Mục/ }).click()
  await expect(o).toHaveValue(/DM/)
})

test("thủ kho ở phiếu nhập kho: có '+ Tạo nhà cung cấp mới', KHÔNG có '+ Tạo sản phẩm mới'", async ({ page }) => {
  await dangNhap(page)
  await doiVai("warehouse")
  await page.goto("/inventory/stock-in")
  const ncc = page.locator("#stockin-supplier")
  await ncc.click()
  await ncc.fill("NCC Thủ Kho Mới")
  await expect(xo(page).getByRole("button", { name: "Tạo nhà cung cấp mới “NCC Thủ Kho Mới”" })).toBeVisible()
  await ncc.press("Escape")

  const sp = page.locator("#si-add-product")
  await sp.click()
  await sp.fill("Hàng chưa có xyz")
  await expect(page.getByText(/Không (tìm thấy|có)/).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByTestId("product-picker-tao-moi").filter({ visible: true })).toHaveCount(0)
})

test("người đã nghỉ / tạm khoá không hiện trong ô chọn NV (lọc khách theo NV)", async ({ page }) => {
  await api("users", { method: "POST", body: JSON.stringify([DANG_LAM, DA_NGHI, TAM_KHOA]) })
  await page.addInitScript(() => window.localStorage.setItem("list-view:customers", JSON.stringify({ filters: ["search", "sales"] })))
  await dangNhap(page)
  await page.goto("/customers")
  await page.getByRole("combobox", { name: "Nhân viên" }).click()
  await expect(page.getByRole("option", { name: DANG_LAM.full_name })).toBeVisible()
  await expect(page.getByRole("option", { name: DA_NGHI.full_name })).toHaveCount(0)
  await expect(page.getByRole("option", { name: TAM_KHOA.full_name })).toHaveCount(0)
})
