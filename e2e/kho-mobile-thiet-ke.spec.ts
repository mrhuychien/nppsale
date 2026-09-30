import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, HOM_NAY_E2E } from "./helpers"

/* Cùng mã với e2e/fixture.mjs (NPP thử, chủ NPP, Sữa hộp, Mì tôm). */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const MI = "00000000-0000-4000-8000-0000000000d2"

/**
 * Chủ nhà 30/09/2026: "Làm lại các màn … Danh sách phiếu kho, Quản lý kho, Chi tiết phiếu" theo bản
 * thiết kế điện thoại — Kho hàng (đầu xanh + thẻ giá trị + thao tác kho + tồn kho), Phiếu kho (đầu
 * trắng, chip loại, nhóm theo ngày, SL quy về đơn vị cơ sở), Chi tiết phiếu (băng trạng thái, 3 ô số,
 * thông tin phiếu, Huỷ, thanh đáy In).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, loc: string) => fetch(`${FAKE}/rest/v1/${bang}?${loc}`, { method: "DELETE" })

const bayGio = new Date(HOM_NAY_E2E).toISOString()
const creator = { full_name: "Chủ NPP" }
const PHIEU = [
  { id: "se-m-nk", org_id: ORG, entry_code: "NK-M-1", type: "import", status: "draft", notes: null, created_at: bayGio, created_by: OWNER, creator, ref_order_ids: [], warehouse_zone: "sale" },
  { id: "se-m-xk", org_id: ORG, entry_code: "XK-M-1", type: "export", status: "posted", notes: "Xuất theo đơn DH-0002", created_at: bayGio, posted_at: bayGio, created_by: OWNER, creator, ref_order_ids: [], warehouse_zone: "sale" },
  { id: "se-m-kk", org_id: ORG, entry_code: "KK-M-1", type: "stocktake", status: "draft", notes: null, created_at: bayGio, created_by: OWNER, creator, ref_order_ids: [], warehouse_zone: "sale" },
]
const DONG = [
  // 2 thùng Sữa (× 24) + 12 gói Mì → xuất 60 đơn vị cơ sở
  { id: "sel-m-1", entry_id: "se-m-xk", product_id: SUA, unit_name: "thùng", quantity: 2, qty_in_base_uom: 48, conversion_factor_snapshot: 24, notes: null, product: { name: "Sữa hộp", sku: "SUA1", base_unit: "hộp" } },
  { id: "sel-m-2", entry_id: "se-m-xk", product_id: MI, unit_name: "gói", quantity: 12, qty_in_base_uom: 12, conversion_factor_snapshot: 1, notes: null, product: { name: "Mì tôm", sku: "MI1", base_unit: "gói" } },
  { id: "sel-m-3", entry_id: "se-m-kk", product_id: MI, unit_name: "gói", quantity: 12, notes: null, product: { name: "Mì tôm", sku: "MI1", base_unit: "gói" } },
]

test.beforeAll(async () => {
  await them("stock_entries", PHIEU)
  await them("stock_entry_lines", DONG)
  await them("v_stock_balance_by_zone", [
    { org_id: ORG, product_id: SUA, warehouse_zone: "sale", qty_in_base_uom: 1000, value: 15_000_000 },
    { org_id: ORG, product_id: MI, warehouse_zone: "sale", qty_in_base_uom: 900, value: 3_600_000 },
  ])
})
test.afterAll(async () => {
  await xoa("stock_entry_lines", "id=in.(sel-m-1,sel-m-2,sel-m-3)")
  await xoa("stock_entries", "id=in.(se-m-nk,se-m-xk,se-m-kk)")
  await xoa("v_stock_balance_by_zone", `org_id=eq.${ORG}`)
})

test("Kho hàng: đầu xanh, thẻ giá trị, thao tác kho trỏ đúng màn, tồn kho theo đơn vị cơ sở", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory")
  const man = page.getByTestId("kho-dien-thoai")
  await expect(man.getByRole("heading", { name: "Kho hàng" })).toBeVisible()
  await expect(page.getByTestId("the-gia-tri-kho")).toContainText("Giá trị tồn kho")
  await expect(page.getByTestId("the-gia-tri-kho")).toContainText("SKU")
  await expect(man.getByRole("link", { name: /Nhập kho/ })).toHaveAttribute("href", "/inventory/stock-in")
  await expect(man.getByRole("link", { name: /Kiểm kê/ })).toHaveAttribute("href", "/inventory/stocktake-adjust")
  await expect(man.getByRole("link", { name: /Duyệt phiếu/ })).toHaveAttribute("href", "/inventory/adjustments")
  await expect(man.getByRole("link", { name: /Tra soát/ })).toHaveAttribute("href", "/inventory/audit")
  await expect(man.getByRole("link", { name: /Duyệt phiếu/ })).toContainText("1 chờ duyệt")

  const sua = page.getByTestId("dong-ton").filter({ hasText: "Sữa hộp" })
  await expect(sua).toContainText("1.000")
  await expect(sua).toContainText("hộp")
  await expect(sua).toContainText("15.000.000đ")
  await expect(page.getByTestId("ton-dem-sku")).toHaveText("2 SKU")
  await expect(man.getByRole("button", { name: /Xuất Excel/ })).toBeVisible()
  // Tìm lọc danh sách
  await man.getByPlaceholder("Tìm theo tên hoặc mã SKU").fill("mì")
  await expect(page.getByTestId("ton-dem-sku")).toHaveText("1 SKU")

  await man.getByRole("tab", { name: "Theo lô (FEFO)" }).click()
  await expect(page.getByTestId("fefo-dien-thoai")).toBeVisible()
  // App bar chuẩn không chồng lên đầu xanh
  await expect(page.locator("header").filter({ has: page.getByRole("button", { name: "Mở menu" }) })).toBeHidden()
})

test("Phiếu kho: đầu trắng, băng kiểm kê chờ duyệt, nhóm Hôm nay, SL ± quy về đơn vị cơ sở", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/entries")
  const man = page.getByTestId("phieu-kho-dien-thoai")
  await expect(man.getByRole("heading", { name: "Phiếu kho" })).toBeVisible()
  await expect(page.getByTestId("ds-dau-xanh")).toHaveCount(0)

  await man.getByRole("button", { name: /Tạo phiếu/ }).click()
  await expect(page.getByTestId("tao-phieu").getByRole("link", { name: /Phiếu nhập/ })).toHaveAttribute("href", "/inventory/stock-in")
  await expect(page.getByTestId("tao-phieu").getByRole("link", { name: /Kiểm kê/ })).toHaveAttribute("href", "/inventory/stocktake-adjust")

  await expect(page.getByTestId("bang-cho-duyet")).toContainText("1 phiếu kiểm kê chờ duyệt")
  await expect(page.getByTestId("bang-cho-duyet")).toHaveAttribute("href", "/inventory/adjustments")
  await expect(man.getByText("Hôm nay")).toBeVisible()

  const xk = page.getByTestId("dong-phieu-kho").filter({ hasText: "XK-M-1" })
  await expect(xk.getByTestId("sl-phieu")).toHaveText("−60")
  await expect(xk).toContainText("Đã ghi sổ")
  const kk = page.getByTestId("dong-phieu-kho").filter({ hasText: "KK-M-1" })
  await expect(kk.getByTestId("sl-phieu")).toHaveText("+12")
  await expect(kk).toContainText("Chờ duyệt")
  await expect(page.getByTestId("dong-phieu-kho").filter({ hasText: "NK-M-1" })).toContainText("Nháp")

  // Chip loại lọc danh sách
  await man.getByRole("group", { name: "Loại phiếu" }).getByRole("button", { name: /Kiểm kê/ }).click()
  await expect(page.getByTestId("dong-phieu-kho")).toHaveCount(1)
  await expect(page.locator("header").filter({ has: page.getByRole("button", { name: "Mở menu" }) })).toBeHidden()
})

test("Chi tiết phiếu xuất: băng trạng thái, 3 ô số, thông tin phiếu, Huỷ phiếu, thanh đáy In", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/entries/se-m-xk")
  const man = page.getByTestId("chi-tiet-phieu-dien-thoai")
  await expect(man.getByRole("heading", { name: "XK-M-1" })).toBeVisible()
  await expect(page.getByTestId("bang-trang-thai")).toHaveText(/Đã bàn giao cho lái xe · tồn kho đã trừ/)
  await expect(man).toContainText("2 SKU")
  // hộp + gói khác đơn vị cơ sở → "đơn vị", không ghi bừa "hộp"
  await expect(page.getByTestId("o-tong-sl")).toHaveText(/60\s*đơn vị/)
  await expect(man).toContainText("Thông tin phiếu")
  await expect(man).toContainText("Xuất theo đơn DH-0002")
  await expect(man.getByRole("button", { name: "In phiếu xuất" })).toBeVisible()
  await man.getByRole("button", { name: /Huỷ phiếu/ }).click()
  await expect(page.getByRole("dialog")).toContainText("Huỷ phiếu XK-M-1?")
})
