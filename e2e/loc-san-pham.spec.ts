import { test, expect, type Page, type Locator } from "@playwright/test"
import { dangNhap, chonKy, nhatKy, FAKE } from "./helpers"

/**
 * CHỦ NHÀ 15/11/2026: "Thêm cho tao bộ lọc sản phẩm trong Đơn hàng/Hóa đơn/Trả hàng/Nhập NCC/Trả NCC".
 * Chọn một mặt hàng → chỉ còn chứng từ có dòng mặt hàng ấy; số đếm + tổng tiền của CẢ bộ lọc đi theo (lọc trên máy chủ
 * bằng bảng dòng nhúng `!inner` — `@/lib/list/loc-san-pham`). Sổ giả nối thật bảng dòng và trả 400 PGRST108 khi một câu
 * mang điều kiện lọc mà quên nhúng — như PostgREST thật — nên câu nào quên `kemLocSp` là số ở đó hỏng ("—" / lỗi).
 *
 * Dữ liệu mẫu (e2e/fixture.mjs): DH-0001 Sữa (tháng này, 1tr) · DH-0002 Mì (tháng này, 2tr) · DH-0003 Sữa + Mì (2025, 5tr) ·
 * DH-0004 huỷ, không dòng (9tr). HD-E2E-1 Sữa + Mì đổi (900k) · HD-E2E-2 không dòng HĐ (300k). Phiếu trả r-e2e-0/1 có Mì,
 * r-e2e-2 có Sữa (60 phiếu × 10k).
 */

const khoi = (page: Page, nhan: string) =>
  page.locator("div", { has: page.getByText(nhan, { exact: true }) }).filter({ visible: true }).last()

/** Chọn mặt hàng trong ô lọc sản phẩm (gõ rồi bấm mục). */
async function chonHang(o: Locator, ten: string) {
  await o.click()
  await o.fill(ten)
  await o.page().getByTestId("search-select-xo").getByRole("button", { name: new RegExp(ten) }).first().click()
  await expect(o).toHaveValue(ten)
}

const SUA = "00000000-0000-4000-8000-0000000000d1"
const MI = "00000000-0000-4000-8000-0000000000d2"
const ORG = "00000000-0000-4000-8000-0000000000a1"

const ghi = (bang: string, dong: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dong) })
const xoa = (bang: string, ids: string[]) =>
  Promise.all(ids.map((id) => fetch(`${FAKE}/rest/v1/${bang}?id=eq.${id}`, { method: "DELETE" })))

/**
 * MỌI câu mang điều kiện lọc sản phẩm phải nhúng bảng dòng `loc_sp:…!inner(product_id)` — kể cả câu gộp tổng tiền / số đếm:
 * câu gộp hỏng thì màn LÙI về cách cũ và con số vẫn đúng, nên chỉ nhìn số trên màn là không thấy câu quên nhúng.
 */
async function kiemNhungLocSp(bang: string) {
  const cau = (await nhatKy()).filter((r) => r.path === `/rest/v1/${bang}` && decodeURIComponent(r.query ?? "").includes("loc_sp.product_id"))
  expect(cau.length, `không câu đọc ${bang} nào mang bộ lọc sản phẩm`).toBeGreaterThan(0)
  for (const r of cau) {
    expect(decodeURIComponent(r.query ?? ""), `câu ${bang} lọc sản phẩm mà select thiếu bảng dòng nhúng`).toMatch(/[?&]select=[^&]*loc_sp:\w+!inner\(product_id\)/)
  }
}

/** Câu đọc danh mục hàng của ô lọc (`useHangLoc`). */
const cauDanhMucHang = async () =>
  (await nhatKy()).filter((r) => r.path === "/rest/v1/products" && decodeURIComponent(r.query ?? "").includes("barcode,status"))

test("đơn hàng — máy tính: lọc theo sản phẩm (danh sách, số trên tab, tổng tiền); danh mục hàng chỉ tải khi chạm ô", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("DH-0004").first()).toBeVisible()
  // Mở danh sách KHÔNG kéo danh mục hàng về (chủ nhà 23/10/2026 "load trang chậm lắm").
  expect(await cauDanhMucHang(), "mở danh sách đã tải danh mục hàng cho một ô chưa ai bấm").toHaveLength(0)

  await chonHang(page.locator("#ord-product"), "Mì tôm")
  expect((await cauDanhMucHang()).length).toBeGreaterThan(0)
  await expect(page.getByText("DH-0002").first()).toBeVisible()
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  await expect(page.getByText("DH-0001")).toHaveCount(0)
  await expect(page.getByText("DH-0004")).toHaveCount(0)
  const k = khoi(page, "Tổng tiền hàng")
  await expect(k).toContainText("2 đơn hàng")
  await expect(k, "tổng tiền phải cộng trên máy chủ theo bộ lọc sản phẩm (2tr + 5tr)").toContainText("7.000.000")
  await expect(page.locator('[data-status-chip="all"]').first()).toContainText(/Tất cả\s*2/)

  // Bỏ chọn (✕) → về mọi hàng.
  await page.locator('[data-loc-san-pham] button[aria-label="Bỏ chọn"]').first().click()
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await expect(k).toContainText("4 đơn hàng")
})

test("đơn hàng — máy tính: lọc tháng này + mọi câu mang điều kiện lọc đều nhúng bảng dòng (không câu nào bị PGRST108)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonHang(page.locator("#ord-product"), "Sữa hộp")
  await expect(khoi(page, "Tổng tiền hàng")).toContainText("1 đơn hàng")
  await expect(khoi(page, "Tổng tiền hàng")).toContainText("1.000.000")
  await kiemNhungLocSp("sales_orders")
})

test("hoá đơn bán — máy tính: lọc theo sản phẩm, tổng tiền (còn lại) đi theo", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  await expect(page.getByText("HD-E2E-2").first()).toBeVisible()
  await chonHang(page.locator("#inv-product"), "Sữa hộp")
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
  await expect(page.getByText("HD-E2E-2")).toHaveCount(0)
  const k = khoi(page, "Tổng tiền (đã trừ hàng trả)")
  await expect(k).toContainText("1 hóa đơn")
  await expect(k).toContainText("900.000")
  // Dòng hàng ĐỔI cũng là "có mặt hàng": HD-E2E-1 đổi Mì cho khách.
  await chonHang(page.locator("#inv-product"), "Mì tôm")
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
  await expect(k).toContainText("1 hóa đơn")
  await kiemNhungLocSp("sales_invoices")
  await kiemNhungLocSp("v_hoa_don_con_lai")
})

test("trả hàng — máy tính: lọc theo sản phẩm, tổng khoản có đi theo", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const k = khoi(page, "Tổng tiền trả hàng")
  await expect(k).toContainText("60 phiếu trả")
  await chonHang(page.locator("#ret-product"), "Mì tôm")
  await expect(k).toContainText("2 phiếu trả")
  await expect(k).toContainText("20.000")
  await kiemNhungLocSp("returns")
  await page.getByRole("button", { name: "Xoá lọc" }).click()
  await expect(k).toContainText("60 phiếu trả")
})

test("phiếu nhập NCC — máy tính: lọc theo sản phẩm (phiếu huỷ vẫn không vào tổng)", async ({ page }) => {
  const ids = ["pil-e2e-ls1", "pil-e2e-ls2", "pil-e2e-ls3"]
  await ghi("purchase_invoice_lines", [
    { id: ids[0], invoice_id: "pi1", product_id: SUA, unit_name: "hộp", quantity: 10 },
    { id: ids[1], invoice_id: "pi2", product_id: MI, unit_name: "gói", quantity: 5 },
    { id: ids[2], invoice_id: "pi3", product_id: SUA, unit_name: "hộp", quantity: 1 },
  ])
  try {
    await dangNhap(page)
    await page.goto("/purchasing/receipts")
    const k = khoi(page, "Tổng tiền phiếu nhập")
    await expect(k).toContainText("3 phiếu nhập")
    await chonHang(page.locator("#pn-product"), "Sữa hộp")
    await expect(k).toContainText("2 phiếu nhập")
    await expect(k).toContainText("300.000")
    await expect(page.getByText("PN-2")).toHaveCount(0)
    await chonHang(page.locator("#pn-product"), "Mì tôm")
    await expect(k).toContainText("1 phiếu nhập")
    await expect(k).toContainText("700.000")
    await kiemNhungLocSp("purchase_invoices")
  } finally {
    await xoa("purchase_invoice_lines", ids)
  }
})

test("trả hàng NCC — máy tính: lọc theo sản phẩm", async ({ page }) => {
  const phieu = ["sr-e2e-ls1", "sr-e2e-ls2"]
  const dong = ["srl-e2e-ls1", "srl-e2e-ls2"]
  const ncc = { id: "00000000-0000-4000-8000-0000000000e1", name: "Vinamilk", code: "NCC1" }
  await ghi("supplier_returns", [
    { id: phieu[0], org_id: ORG, return_code: "PTNCC-LS1", return_date: "2026-09-20", warehouse_zone: "sale", total: 100000, status: "completed", created_at: "2026-09-20T08:00:00Z", supplier: ncc },
    { id: phieu[1], org_id: ORG, return_code: "PTNCC-LS2", return_date: "2026-09-21", warehouse_zone: "sale", total: 250000, status: "completed", created_at: "2026-09-21T08:00:00Z", supplier: ncc },
  ])
  await ghi("supplier_return_lines", [
    { id: dong[0], return_id: phieu[0], product_id: SUA, unit_name: "hộp", quantity: 2 },
    { id: dong[1], return_id: phieu[1], product_id: MI, unit_name: "gói", quantity: 3 },
  ])
  try {
    await dangNhap(page)
    await page.goto("/purchase-returns")
    await expect(page.getByText("PTNCC-LS1").first()).toBeVisible()
    await chonHang(page.locator("#tncc-product"), "Mì tôm")
    await expect(page.getByText("PTNCC-LS2").first()).toBeVisible()
    await expect(page.getByText("PTNCC-LS1")).toHaveCount(0)
    await expect(khoi(page, "Tổng tiền trả NCC")).toContainText("250.000")
    await kiemNhungLocSp("supplier_returns")
  } finally {
    await xoa("supplier_return_lines", dong)
    await xoa("supplier_returns", phieu)
  }
})

test("điện thoại — đơn hàng (tấm lọc) và trả hàng (dưới ô tìm) có ô lọc sản phẩm", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await page.goto("/orders")
  const man = page.getByTestId("don-mobile")
  await expect(man.getByText("Đã hiển thị 2 / 2 đơn")).toBeVisible()
  await man.getByRole("button", { name: "Bộ lọc" }).click()
  const tam = page.getByRole("dialog")
  await chonHang(tam.getByPlaceholder("Tất cả sản phẩm — gõ để lọc…"), "Mì tôm")
  await page.keyboard.press("Escape")
  await expect(man.getByText("Đã hiển thị 1 / 1 đơn")).toBeVisible()
  await expect(man.getByText("DH-0002").first()).toBeVisible()

  await page.goto("/returns")
  const tra = page.getByTestId("tra-mobile")
  await expect(tra.locator('[data-tab-tra="submitted"]')).toHaveText(/xử lý\s*60$/)
  await chonHang(tra.getByTestId("tra-loc-san-pham").getByPlaceholder("Tất cả sản phẩm — gõ để lọc…"), "Mì tôm")
  await expect(tra.locator('[data-tab-tra="submitted"]')).toHaveText(/xử lý\s*2$/)
  // Số trên tab: câu gộp `status, count()` cũng phải nhúng — hỏng thì màn lùi về đếm từng tab, số vẫn đúng mà câu sai.
  await kiemNhungLocSp("returns")
  await ctx.close()
})
