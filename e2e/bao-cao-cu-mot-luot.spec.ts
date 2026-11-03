import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "chuyển nốt các báo cáo cũ đi em" — các báo cáo cũ (/reports/sales, customers, products, finance;
 *   /analytics/business/overview, cost-profit; /analytics/products/overview, categories) đọc số bán MỘT LƯỢT qua
 *   `bao_cao_so_ban` (như Báo cáo tổng hợp / Báo cáo › Nhân viên). SỐ PHẢI Y HỆT đường đọc từng bảng: mỗi màn / tab chụp chữ
 *   trong <main> hai lần — có hàm, rồi tắt hàm (`/__tat_rpc`: sổ chưa có hàm → đọc từng bảng) — và so bằng nhau.
 *
 *   Dữ liệu RIÊNG, ngày 29/09 (trong cả "Tháng này" lẫn "Tuần này" của đồng hồ e2e 30/09):
 *   "Khách Một Lượt": HD-ML-B (NV "NV Một Lượt B") chèn vào sổ TRƯỚC HD-ML-A ("NV Một Lượt A"), cùng ngày. Phiếu trả cũ TR-ML-1
 *   không ghi NV, không gắn HĐ → đoán theo HĐ gần nhất của khách; hai HĐ cùng ngày thì HĐ đứng trước theo thứ tự của cách cũ
 *   (ngày giảm dần, rồi id) — HD-ML-A. Hàm máy chủ không xếp: chưa xếp lại thì phiếu trả rơi sang NV B ở tab Nhân viên.
 *   HD-ML-A có dòng HÀNG ĐỔI (không phải hàng bán). Phiếu xuất: SE-ML-1 (hàng bán) · SE-ML-HUY (của HĐ đã huỷ) · SE-ML-DAO
 *   ("Đảo phiếu trả …") — hai phiếu sau không vào giá vốn.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KH = "00000000-0000-4000-8000-0000000000c7"
const SP = "00000000-0000-4000-8000-0000000000d6"
const NV_A = "00000000-0000-4000-8000-0000000000b6"
const NV_B = "00000000-0000-4000-8000-0000000000b7"
const NGAY = "2026-09-29"
const IDS = {
  hd: ["hd-ml-b", "hd-ml-a", "hd-ml-huy"],
  tra: ["tr-ml-1"],
  phieu: ["se-ml-1", "se-ml-huy", "se-ml-dao", "se-ml-nhap"],
}

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })
const tatRpc = (fn: string[]) =>
  fetch(`${FAKE}/__tat_rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn }) })

const hd = (id: string, ma: string, nv: string, status: string, total: number, entry: string | null) => ({
  id, org_id: ORG, invoice_code: ma, order_id: null, customer_id: KH, status, subtotal: total, vat: 0, total, payment_terms: "COD",
  due_date: NGAY, invoice_date: NGAY, created_at: `${NGAY}T03:00:00Z`, sales_user_id: nv, posted_by: OWNER, stock_entry_id: entry,
})
const phieu = (id: string, type: string, notes = "") => ({
  id, org_id: ORG, entry_code: id.toUpperCase(), type, status: "posted", posted_at: `${NGAY}T04:00:00Z`, notes,
})
const dongKho = (id: string, entry: string, q: number, gia: number) => ({
  id, entry_id: entry, product_id: SP, quantity: q, qty_in_base_uom: q, conversion_factor_snapshot: 1, unit_cost: gia,
})

test.beforeAll(async () => {
  await them("products", [{
    id: SP, org_id: ORG, sku: "ML1", name: "Sữa một lượt", brand: "Hiệu Một Lượt", base_unit: "hộp", sell_price: 20000, status: "active",
    primary_supplier_id: null, units: [{ unit_name: "thùng", conversion: 24 }],
    price_lists: [
      { id: "pl-ml-t", product_id: SP, unit_name: "thùng", group_id: null, price: 450000 },
      { id: "pl-ml-h", product_id: SP, unit_name: "hộp", group_id: null, price: 20000 },
    ],
  }])
  await them("customers", [{ id: KH, org_id: ORG, store_name: "Khách Một Lượt", group_id: null, channel: null, payment_terms: "COD", credit_limit: 0, status: "active" }])
  await them("users", [
    { id: NV_A, org_id: ORG, full_name: "NV Một Lượt A", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" },
    { id: NV_B, org_id: ORG, full_name: "NV Một Lượt B", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" },
  ])
  // B chèn TRƯỚC A — thứ tự "tự nhiên" của sổ không phải thứ tự cách cũ xếp.
  await them("sales_invoices", [
    hd("hd-ml-b", "HD-ML-B", NV_B, "posted", 210000, "se-ml-1"),
    hd("hd-ml-a", "HD-ML-A", NV_A, "posted", 920000, "se-ml-1"),
    hd("hd-ml-huy", "HD-ML-HUY", NV_A, "cancelled", 100000, "se-ml-huy"),
  ])
  await them("sales_invoice_lines", [
    { id: "sil-ml-b", invoice_id: "hd-ml-b", product_id: SP, quantity: 10, unit_name: "hộp", conversion_factor: 1, unit_price: 21000, line_discount: 0, vat_rate: 0, line_total: 210000, is_exchange: false, sort_order: 0, order_line_id: null },
    // 2 thùng × 470.000 = 940.000, giảm cả đơn 20.000 → tổng 920.000.
    { id: "sil-ml-a", invoice_id: "hd-ml-a", product_id: SP, quantity: 2, unit_name: "thùng", conversion_factor: 24, unit_price: 470000, line_discount: 0, vat_rate: 0, line_total: 940000, is_exchange: false, sort_order: 0, order_line_id: null },
    { id: "sil-ml-doi", invoice_id: "hd-ml-a", product_id: SP, quantity: 3, unit_name: "hộp", conversion_factor: 1, unit_price: 0, line_discount: 0, vat_rate: 0, line_total: 0, is_exchange: true, sort_order: 1, order_line_id: null },
    { id: "sil-ml-huy", invoice_id: "hd-ml-huy", product_id: SP, quantity: 5, unit_name: "hộp", conversion_factor: 1, unit_price: 20000, line_discount: 0, vat_rate: 0, line_total: 100000, is_exchange: false, sort_order: 0, order_line_id: null },
  ])
  await them("returns", [{
    id: "tr-ml-1", org_id: ORG, customer_id: KH, invoice_id: null, credit_note_amount: 42000, created_at: `${NGAY}T06:00:00Z`,
    revenue_date: NGAY, sales_user_id: null, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await them("return_lines", [{ id: "rl-ml-1", return_id: "tr-ml-1", product_id: SP, unit_name: "hộp", quantity: 2, unit_price: 21000, line_total: 42000, is_exchange: false }])
  await them("stock_entries", [
    phieu("se-ml-1", "export"),
    phieu("se-ml-huy", "export"),
    phieu("se-ml-dao", "export", "Đảo phiếu trả 00000000-0000-4000-8000-000000000999"),
    phieu("se-ml-nhap", "import", "Nhập lại từ phiếu trả tr-ml-1"),
  ])
  await them("stock_entry_lines", [
    dongKho("sel-ml-1", "se-ml-1", 58, 15000),
    dongKho("sel-ml-huy", "se-ml-huy", 5, 15000),
    dongKho("sel-ml-dao", "se-ml-dao", 7, 0),
    dongKho("sel-ml-nhap", "se-ml-nhap", 2, 15000),
  ])
})
test.afterEach(async () => {
  await tatRpc([])
})
test.afterAll(async () => {
  for (const id of IDS.phieu) await xoa("stock_entry_lines", "entry_id", id)
  for (const id of IDS.phieu) await xoa("stock_entries", "id", id)
  for (const id of IDS.tra) await xoa("return_lines", "return_id", id)
  for (const id of IDS.tra) await xoa("returns", "id", id)
  for (const id of IDS.hd) await xoa("sales_invoice_lines", "invoice_id", id)
  for (const id of IDS.hd) await xoa("sales_invoices", "id", id)
  for (const id of [NV_A, NV_B]) await xoa("users", "id", id)
  await xoa("customers", "id", KH)
  await xoa("products", "id", SP)
})

async function chonTab(page: Page, ten: string) {
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: ten, exact: true }).click()
}

/** Chữ trong <main> khi màn đã vẽ xong (hết khung xám đang tải, có chữ chờ). */
async function chup(page: Page, cho: string | RegExp) {
  await expect(page.locator("main [class*='animate-pulse']")).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator("main")).toContainText(cho, { timeout: 30_000 })
  await expect(page.locator("main [class*='animate-pulse']")).toHaveCount(0)
  return (await page.locator("main").innerText()).replace(/\s+/g, " ").trim()
}

/** Bảng cần mở / tab cần chọn + chữ chờ của từng tab. */
type Buoc = { tab?: string; cho: string | RegExp; mo?: string }
const MAN: Array<{ duong: string; buoc: Buoc[] }> = [
  {
    duong: "/reports/sales",
    buoc: [
      { cho: "29/09/2026" },
      { tab: "Lợi nhuận", cho: "29/09/2026" },
      { tab: "Giảm giá HĐ", cho: "HD-ML-A" },
      { tab: "Trả hàng", cho: "Khách Một Lượt" },
      { tab: "Nhân viên", cho: "NV Một Lượt A" },
    ],
  },
  {
    duong: "/reports/customers",
    buoc: [
      { cho: "Khách Một Lượt" },
      { tab: "Lợi nhuận", cho: "Khách Một Lượt" },
      { tab: "Hàng bán theo khách", cho: "Khách Một Lượt", mo: "Khách Một Lượt" },
    ],
  },
  {
    duong: "/reports/products",
    buoc: [
      { cho: "Sữa một lượt" },
      { tab: "Lợi nhuận", cho: "Sữa một lượt" },
      { tab: "Xuất nhập tồn", cho: "Sữa một lượt" },
    ],
  },
  { duong: "/reports/finance", buoc: [{ cho: "Doanh thu thuần" }] },
  { duong: "/analytics/business/overview", buoc: [{ cho: "NV Một Lượt" }] },
  { duong: "/analytics/business/cost-profit", buoc: [{ cho: /Lợi nhuận/ }] },
  { duong: "/analytics/products/overview", buoc: [{ cho: "Sữa một lượt" }] },
  { duong: "/analytics/products/categories", buoc: [{ cho: "Hiệu Một Lượt" }] },
]

async function chupMan(page: Page, duong: string, buoc: Buoc[]) {
  await page.goto(duong)
  const ra: string[] = []
  for (const b of buoc) {
    if (b.tab) await chonTab(page, b.tab)
    await chup(page, b.cho)
    if (b.mo) await page.locator("tr", { hasText: b.mo }).first().click()
    ra.push(await chup(page, b.cho))
  }
  return ra
}

/** Câu đọc từng bảng của số bán — đường một lượt không được gọi tới. (Câu `sales_invoices` lọc theo `stock_entry_id` là câu
 *  soát HĐ huỷ của phiếu xuất — thuộc giá vốn theo NGÀY, tab Bán hàng › Lợi nhuận đọc khi mở tab — không phải số bán.) */
const BANG_SO_BAN = ["/rest/v1/sales_invoice_lines", "/rest/v1/return_lines", "/rest/v1/sales_invoices"]
const laCauSoBan = (c: { path: string; method: string; query?: string }) =>
  c.method === "GET" && BANG_SO_BAN.includes(c.path) && !(c.path === "/rest/v1/sales_invoices" && (c.query ?? "").includes("stock_entry_id"))

for (const { duong, buoc } of MAN) {
  test(`${duong}: một lượt ra Y HỆT đường đọc từng bảng (${buoc.map((b) => b.tab ?? "mặc định").join(", ")})`, async ({ page }) => {
    test.setTimeout(180_000)
    await dangNhap(page)
    await tatRpc([])
    const truoc = (await nhatKy()).length
    const motLuot = await chupMan(page, duong, buoc)
    const cau = (await nhatKy()).slice(truoc)
    // Đường một lượt: hàm GET đúng một / hai lượt (kỳ này + kỳ trước); không đọc dòng HĐ / dòng trả / hoá đơn từng bảng.
    expect(cau.filter((c) => c.path === "/rest/v1/rpc/bao_cao_so_ban").every((c) => c.method === "GET")).toBe(true)
    expect(cau.filter((c) => c.path === "/rest/v1/rpc/bao_cao_so_ban").length).toBeGreaterThan(0)
    expect(cau.filter(laCauSoBan).map((c) => `${c.path}?${c.query ?? ""}`)).toEqual([])

    await tatRpc(["bao_cao_so_ban"])
    const tungBang = await chupMan(page, duong, buoc)
    expect(tungBang).toEqual(motLuot)
  })
}

test("Bán hàng › Nhân viên: phiếu trả cũ (không ghi NV, không gắn HĐ) theo HĐ đứng trước khi hai HĐ cùng ngày — NV A", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/sales")
  await chonTab(page, "Nhân viên")
  // NV A: 920.000 − 42.000 = 878.000 doanh thu thuần; NV B giữ nguyên 210.000.
  await expect(page.locator("tr", { hasText: "NV Một Lượt A" })).toContainText("878.000")
  await expect(page.locator("tr", { hasText: "NV Một Lượt B" })).toContainText("210.000")
  await expect(page.locator("tr", { hasText: "NV Một Lượt B" })).not.toContainText("168.000")
})

test("Bán hàng › Lợi nhuận (không lọc): giá vốn theo ngày đọc khi MỞ tab, không gồm phiếu của HĐ huỷ / phiếu đảo", async ({ page }) => {
  await dangNhap(page)
  const truoc = (await nhatKy()).length
  await page.goto("/reports/sales")
  await chup(page, "29/09/2026")
  // Tab mặc định (Thời gian) không cần dòng phiếu xuất.
  expect((await nhatKy()).slice(truoc).filter((c) => c.path === "/rest/v1/stock_entry_lines")).toEqual([])
  await chonTab(page, "Lợi nhuận")
  await chup(page, "29/09/2026")
  expect((await nhatKy()).slice(truoc).filter((c) => c.path === "/rest/v1/stock_entry_lines").length).toBeGreaterThan(0)
})
