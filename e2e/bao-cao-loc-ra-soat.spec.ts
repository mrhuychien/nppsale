import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "rà soát lại phần báo cáo xem các bộ lọc có hoạt động không?" — Báo cáo tổng hợp.
 *   Dữ liệu RIÊNG của spec này (khách "Khách Rà Lọc", hàng A / B của hai NCC), hàm máy chủ `bao_cao_so_ban` do bộ giả
 *   tính đúng theo cửa sổ ngày (giá vốn bình quân của các phiếu xuất TRONG cửa sổ) như sổ thật.
 *
 *   Tháng 9:  HD-RL-1 (10/09) A 10 × 100.000 + B 5 × 100.000, giảm cả đơn 150.000 → 1.350.000 (A 900.000, B 450.000;
 *                    giảm A 100.000, B 50.000).
 *             HD-RL-2 (15/09) A 2 × 100.000 = 200.000.
 *             TR-RL-1 (15/09, gắn HD-RL-1, người lập NV khác) B 1 hộp 90.000 · TR-RL-2 (16/09, không gắn HĐ) A 1 hộp 80.000.
 *             Xuất: A 12 hộp × 50.000, B 5 hộp × 40.000.
 *   Tháng 8:  HD-RL-0 (10/08) A 10 × 100.000; xuất A 10 hộp × 80.000.
 *   → Tháng 9: thuần 1.380.000, giá vốn 12 × 50.000 + 5 × 40.000 = 800.000, lãi gộp 580.000. Bản cũ (một cửa sổ từ đầu
 *     kỳ trước) lấy bình quân A của CẢ tháng 8 + 9 = 63.636 → lãi gộp 416.364, tắt so sánh thì ra 580.000.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const NV = "00000000-0000-4000-8000-0000000000ba"
const KH = "00000000-0000-4000-8000-0000000000ca"
const NCC_A = "00000000-0000-4000-8000-0000000000ea"
const NCC_B = "00000000-0000-4000-8000-0000000000eb"
const SP_A = "00000000-0000-4000-8000-0000000000da"
const SP_B = "00000000-0000-4000-8000-0000000000db"
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

const hd = (id: string, ma: string, ngay: string, subtotal: number, total: number) => ({
  id, org_id: ORG, invoice_code: ma, order_id: null, customer_id: KH, status: "posted", subtotal, vat: 0, total,
  payment_terms: "COD", due_date: ngay, invoice_date: ngay, created_at: `${ngay}T03:00:00Z`, sales_user_id: OWNER, posted_by: OWNER,
})
const dhd = (id: string, inv: string, sp: string, q: number, i: number) => ({
  id, invoice_id: inv, product_id: sp, quantity: q, unit_name: "hộp", conversion_factor: 1, unit_price: 100000, line_discount: 0,
  vat_rate: 0, line_total: q * 100000, is_exchange: false, sort_order: i, order_line_id: null,
})
const xuat = (id: string, ngay: string) => ({ id, org_id: ORG, entry_code: id, type: "export", status: "posted", posted_at: `${ngay}T03:00:00Z`, notes: "" })
const dxuat = (id: string, entry: string, sp: string, q: number, gia: number) => ({
  id, entry_id: entry, product_id: sp, quantity: q, qty_in_base_uom: q, conversion_factor_snapshot: 1, unit_cost: gia,
})
const don = (id: string, ma: string, status: string, ngay: string, total: number) => ({
  id, org_id: ORG, order_code: ma, order_date: ngay, status, total, subtotal: total, discount: 0, vat: 0, customer_id: KH,
  sales_user_id: OWNER, created_by: OWNER, payment_terms: "COD", created_at: `${ngay}T02:00:00Z`,
})

test.beforeAll(async () => {
  await them("suppliers", [
    { id: NCC_A, org_id: ORG, code: "RLA", name: "NCC Rà Lọc A", status: "active", is_active: true },
    { id: NCC_B, org_id: ORG, code: "RLB", name: "NCC Rà Lọc B", status: "active", is_active: true },
  ])
  await them("products", [
    { id: SP_A, org_id: ORG, sku: "RLA", name: "Hàng rà A", base_unit: "hộp", sell_price: 100000, status: "active", primary_supplier_id: NCC_A, units: [], price_lists: [] },
    { id: SP_B, org_id: ORG, sku: "RLB", name: "Hàng rà B", base_unit: "hộp", sell_price: 100000, status: "active", primary_supplier_id: NCC_B, units: [], price_lists: [] },
  ])
  await them("users", [{ id: NV, org_id: ORG, full_name: "NV Lập Phiếu Trả", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await them("customers", [{ id: KH, org_id: ORG, store_name: "Khách Rà Lọc", channel: null, payment_terms: "COD", credit_limit: 0, status: "active" }])
  await them("sales_invoices", [
    hd("hd-rl-0", "HD-RL-0", "2026-08-10", 1000000, 1000000),
    hd("hd-rl-1", "HD-RL-1", "2026-09-10", 1350000, 1350000),
    hd("hd-rl-2", "HD-RL-2", "2026-09-15", 200000, 200000),
  ])
  await them("sales_invoice_lines", [
    dhd("sil-rl-0", "hd-rl-0", SP_A, 10, 0),
    dhd("sil-rl-1a", "hd-rl-1", SP_A, 10, 0),
    dhd("sil-rl-1b", "hd-rl-1", SP_B, 5, 1),
    dhd("sil-rl-2", "hd-rl-2", SP_A, 2, 0),
  ])
  await them("returns", [
    { id: "tr-rl-1", org_id: ORG, return_code: "TR-RL-1", customer_id: KH, invoice_id: "hd-rl-1", credit_note_amount: 90000, created_at: "2026-09-15T04:00:00Z", revenue_date: "2026-09-15", sales_user_id: OWNER, requested_by: NV, reason: "damaged", credit_with_invoice: false, status: "completed" },
    { id: "tr-rl-2", org_id: ORG, return_code: "TR-RL-2", customer_id: KH, invoice_id: null, credit_note_amount: 80000, created_at: "2026-09-16T04:00:00Z", revenue_date: "2026-09-16", sales_user_id: OWNER, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed" },
  ])
  await them("return_lines", [
    { id: "rl-rl-1", return_id: "tr-rl-1", product_id: SP_B, unit_name: "hộp", quantity: 1, unit_price: 90000, line_total: 90000, is_exchange: false },
    { id: "rl-rl-2", return_id: "tr-rl-2", product_id: SP_A, unit_name: "hộp", quantity: 1, unit_price: 80000, line_total: 80000, is_exchange: false },
  ])
  await them("stock_entries", [xuat("se-rl-8", "2026-08-10"), xuat("se-rl-9", "2026-09-10")])
  await them("stock_entry_lines", [
    dxuat("sel-rl-8", "se-rl-8", SP_A, 10, 80000),
    dxuat("sel-rl-9a", "se-rl-9", SP_A, 12, 50000),
    dxuat("sel-rl-9b", "se-rl-9", SP_B, 5, 40000),
  ])
  await them("sales_orders", [
    don("so-rl-1", "ĐH-RL-1", "completed", "2026-09-05", 1000000),
    don("so-rl-2", "ĐH-RL-2", "submitted", "2026-09-06", 500000),
    don("so-rl-3", "ĐH-RL-3", "draft", "2026-09-07", 300000),
  ])
  await them("sales_order_lines", [
    { id: "sol-rl-1", order_id: "so-rl-1", product_id: SP_A, quantity: 10, invoiced_qty: 8, unit_name: "hộp", unit_price: 100000, line_discount: 0, line_total: 1000000 },
    { id: "sol-rl-2", order_id: "so-rl-2", product_id: SP_A, quantity: 5, invoiced_qty: 0, unit_name: "hộp", unit_price: 100000, line_discount: 0, line_total: 500000 },
    { id: "sol-rl-3", order_id: "so-rl-3", product_id: SP_B, quantity: 3, invoiced_qty: 0, unit_name: "hộp", unit_price: 100000, line_discount: 0, line_total: 300000 },
  ])
})
test.afterAll(async () => {
  for (const id of ["so-rl-1", "so-rl-2", "so-rl-3"]) await xoa("sales_order_lines", "order_id", id)
  for (const id of ["so-rl-1", "so-rl-2", "so-rl-3"]) await xoa("sales_orders", "id", id)
  for (const id of ["se-rl-8", "se-rl-9"]) await xoa("stock_entry_lines", "entry_id", id)
  for (const id of ["se-rl-8", "se-rl-9"]) await xoa("stock_entries", "id", id)
  for (const id of ["tr-rl-1", "tr-rl-2"]) await xoa("return_lines", "return_id", id)
  for (const id of ["tr-rl-1", "tr-rl-2"]) await xoa("returns", "id", id)
  for (const id of ["hd-rl-0", "hd-rl-1", "hd-rl-2"]) await xoa("sales_invoice_lines", "invoice_id", id)
  for (const id of ["hd-rl-0", "hd-rl-1", "hd-rl-2"]) await xoa("sales_invoices", "id", id)
  await xoa("customers", "id", KH)
  await xoa("users", "id", NV)
  for (const id of [SP_A, SP_B]) await xoa("products", "id", id)
  for (const id of [NCC_A, NCC_B]) await xoa("suppliers", "id", id)
})

const banHang = (page: Page, them = "") => page.goto(`/bao-cao/ban-hang?${KY}&l_cust=${KH}${them}`)

test("Lãi gộp kỳ này không đổi theo công tắc So với kỳ trước (giá vốn bình quân không trộn kỳ trước)", async ({ page }) => {
  await dangNhap(page)
  await banHang(page)
  await expect(page.getByTestId("bc-kpi-net")).toContainText("1,4 tr")
  await expect(page.getByTestId("bc-kpi-gp")).toContainText("580.000")
  await page.getByRole("switch", { name: "So với kỳ trước" }).first().click()
  await expect(page).toHaveURL(/ss=0/)
  await expect(page.getByTestId("bc-kpi-gp")).toContainText("580.000")
})

test("lọc mặt hàng: thẻ Hàng trả, khối Hàng trả, khối Giảm giá và danh sách Hoá đơn cùng một bộ số", async ({ page }) => {
  await dangNhap(page)
  await banHang(page, `&l_prod=${SP_B}`)
  await expect(page.getByTestId("bc-kpi-ret")).toContainText("90.000")
  const tra = page.getByTestId("bc-khoi-tra")
  await expect(tra).toContainText("1 phiếu · 90.000")
  await tra.getByRole("button", { name: /Hàng trả trong kỳ/ }).click()
  await expect(tra).toContainText("TR-RL-1")
  await expect(tra).not.toContainText("TR-RL-2")
  // Giảm giá cả đơn 150.000 của HD-RL-1 chia theo dòng: phần của B là 50.000 (bản cũ: 150.000).
  await expect(page.getByTestId("bc-khoi-giam")).toContainText("50.000")
  await expect(page.getByTestId("bc-khoi-giam")).not.toContainText("150.000")
  // Danh sách hoá đơn: HD-RL-1 = 450.000 (phần B) − 90.000 trả = 360.000.
  await page.getByTestId("bc-kpi-nInv").click()
  const bang = page.getByTestId("bc-bang")
  await expect(bang.getByRole("row", { name: /HD-RL-1/ })).toContainText("360.000")
  await expect(bang.getByTestId("bc-dong-tong")).toContainText("360.000")
  await expect(bang).not.toContainText("1.350.000")
})

test("danh sách Hoá đơn: DT thuần trừ hàng trả gắn HĐ, phiếu trả không gắn là dòng riêng — Σ = thẻ DT thuần", async ({ page }) => {
  await dangNhap(page)
  await banHang(page)
  await page.getByTestId("bc-kpi-nInv").click()
  const bang = page.getByTestId("bc-bang")
  await expect(bang.getByRole("row", { name: /HD-RL-1/ })).toContainText("1.260.000")
  await expect(bang.getByRole("row", { name: /TR-RL-2/ })).toContainText("-80.000")
  await expect(bang.getByTestId("bc-dong-tong")).toContainText("1.380.000")
})

test("Xuất Excel khi màn đang 'chưa có số' không ra bảng của lần lọc trước", async ({ page }) => {
  await dangNhap(page)
  await banHang(page)
  await expect(page.getByTestId("bc-bang")).toBeVisible()
  await page.getByTestId("bc-nut-ky").first().click()
  await page.getByTestId("bc-chon-ky").getByRole("button", { name: /^Hôm nay/ }).click()
  await expect(page.getByTestId("bc-khong-co-so")).toBeVisible()
  let taiVe = 0
  page.on("download", () => (taiVe += 1))
  await page.getByTestId("bc-xuat").first().click()
  await page.waitForTimeout(1500)
  expect(taiVe).toBe(0)
})

test("Đơn đặt: Chưa xuất chỉ của đơn Phiếu tạm — Hoàn thành giao thiếu là xong, Nháp chưa tới lượt", async ({ page }) => {
  await dangNhap(page)
  await banHang(page, "&nguon=ord")
  await expect(page.getByTestId("bc-kpi-ov")).toContainText("1,8 tr")
  await expect(page.getByTestId("bc-kpi-od")).toContainText("800.000")
  await expect(page.getByTestId("bc-kpi-onx")).toContainText("500.000")
  await page.getByTestId("bc-kpi-onx").click()
  const bang = page.getByTestId("bc-bang")
  await expect(bang.getByRole("row", { name: /ĐH-RL-2/ })).toBeVisible()
  await expect(bang.getByRole("row", { name: /ĐH-RL-1/ })).toHaveCount(0)
  await expect(bang.getByRole("row", { name: /ĐH-RL-3/ })).toHaveCount(0)
})

test("Cuối ngày: lọc Người tạo áp cả phiếu trả (người lập phiếu trả)", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/bao-cao/cuoi-ngay?ngay=2026-09-15&l_cust=${KH}&l_creator=${OWNER}`)
  await expect(page.getByTestId("bc-kpi-rev")).toContainText("200.000")
  // TR-RL-1 do NV khác lập → không thuộc lọc Người tạo = chủ NPP (bản cũ: dòng trả luôn qua lọc → 90.000).
  await expect(page.getByTestId("bc-kpi-ret")).toContainText("0")
  await expect(page.getByTestId("bc-kpi-ret")).not.toContainText("90.000")
  await page.goto(`/bao-cao/cuoi-ngay?ngay=2026-09-15&l_cust=${KH}&l_creator=${NV}`)
  await expect(page.getByTestId("bc-kpi-ret")).toContainText("90.000")
  await expect(page.getByTestId("bc-kpi-rev")).not.toContainText("200.000")
})
