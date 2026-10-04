import { test, expect, type Page } from "@playwright/test"
import * as XLSX from "xlsx"
import { dangNhap } from "./helpers"

/**
 * ĐỘI TEST "BÁO CÁO" — Báo cáo tổng hợp › Bán hàng, đường MỚI (rpc bao_cao_so_ban, mig 204/218) tới màn +
 * Excel chi tiết dòng. Dòng thô của rpc được chặn bằng page.route (không đụng fixture dùng chung).
 *
 * Luật (CLAUDE.md): doanh thu theo HĐ đã ghi sổ (total gồm VAT, sau giảm cả đơn); doanh số thuần = đi − trả
 * (credit_note_amount); chênh lệch giá = SL × (đơn giá chứng từ − giá bảng ĐÚNG đơn vị), TRƯỚC thuế, trả cùng
 * luật; giảm giá cả đơn là cột riêng; lãi gộp = thuần − (giá vốn − giá vốn hàng trả đã nhập kho).
 *
 * Sữa hộp (fixture): giá bảng chung hộp 20.000, THÙNG 450.000 (≠ 24 × 20.000).
 *   HĐ HD-BC-1: 2 thùng × 470.000 (line 940.000), giảm cả đơn 40.000, VAT 10% trên dòng 94.000 → total 994.000.
 *   Phiếu trả TH-BC-1: 1 thùng × 470.000 + VAT 10% = 517.000 (credit).
 *   → thuần 477.000; chênh bán 2 × 20.000 = 40.000; chênh trả 1 × 20.000 = 20.000 (KHÔNG phải 67.000 gồm VAT).
 *   Giá vốn: xuất 48 hộp × 15.000 = 720.000; hàng trả đã nhập 24 hộp = 360.000 → lãi gộp 477.000 − 360.000 = 117.000.
 */
const SUA = "00000000-0000-4000-8000-0000000000d1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"

const SO_BAN = {
  hd: [{ id: "hd-bc-1", invoice_code: "HD-BC-1", invoice_date: "2026-09-10", order_id: "o-bc-1", status: "posted", total: 994000, subtotal: 900000, vat: 94000, customer_id: KHACH, sales_user_id: OWNER, posted_by: OWNER, payment_terms: "COD" }],
  dong_hd: [{ id: "l-bc-1", invoice_id: "hd-bc-1", product_id: SUA, unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 470000, line_total: 940000, is_exchange: false, line_discount: 0, order_line_id: null }],
  tra: [{ id: "r-bc-1", status: "completed", customer_id: KHACH, invoice_id: "hd-bc-1", credit_note_amount: 517000, created_at: "2026-09-15T05:00:00Z", revenue_date: "2026-09-15", sales_user_id: OWNER, reason: "damaged", credit_with_invoice: false, ma: "TH-BC-1" }],
  dong_tra: [{ return_id: "r-bc-1", product_id: SUA, unit_name: "thùng", quantity: 1, line_total: 517000, unit_price: 470000 }],
  gv: [{ product_id: SUA, sl: 48, tien: 720000 }],
  gv_tra: [{ return_id: "r-bc-1", product_id: SUA, tien: 360000 }],
}

async function chan(page: Page) {
  await page.route(/\/rest\/v1\/rpc\/bao_cao_so_ban/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SO_BAN) }))
}

test("Bán hàng theo NV: Excel chi tiết dòng — thuần 477.000, chênh trước thuế, giảm đơn riêng, lãi gộp trừ giá vốn hàng trả", async ({ page }) => {
  await dangNhap(page)
  await chan(page)
  await page.goto(`/bao-cao/ban-hang?${KY}&xem=staff`)
  await expect(page.getByTestId("bc-bang").getByTestId("bc-dong-tong")).toContainText("477.000")
  const [tai] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bc-xuat").first().click()])
  const wb = XLSX.read(await (await tai.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[])))
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets["Chi tiết dòng"])
  expect(rows).toHaveLength(2)
  const ban = rows.find((r) => r["Loại"] === "Bán")!
  const tra = rows.find((r) => r["Loại"] === "Trả")!
  expect(ban).toMatchObject({
    "Số chứng từ": "HD-BC-1", ĐVT: "thùng", SL: 2, "Đơn giá": 470000, "Giá bảng": 450000, "Chênh lệch giá": 40000,
    "Giảm giá đơn": 40000, "SL quy đổi": 48, "DT thuần (phân bổ)": 994000, "Giá vốn": 720000,
  })
  expect(tra).toMatchObject({
    "Số chứng từ": "TH-BC-1", "Hoá đơn gốc": "HD-BC-1", ĐVT: "thùng", SL: -1, "Đơn giá": 470000, "Giá bảng": 450000,
    "Chênh lệch giá": -20000, "Thành tiền dòng": -517000, "SL quy đổi": -24, "DT thuần (phân bổ)": -517000, "Giá vốn": -360000,
  })
  expect(rows.reduce((s, r) => s + Number(r["DT thuần (phân bổ)"] || 0), 0)).toBe(477000)
  expect(rows.reduce((s, r) => s + Number(r["Lãi gộp"] || 0), 0)).toBe(117000)
})

test("Bán hàng: kỳ không có số (rpc trả rỗng) → thuần 0, không nổ", async ({ page }) => {
  await dangNhap(page)
  await page.route(/\/rest\/v1\/rpc\/bao_cao_so_ban/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hd: [], dong_hd: [], tra: [], dong_tra: [], gv: [], gv_tra: [] }) }))
  await page.goto(`/bao-cao/ban-hang?${KY}&xem=cust`)
  await expect(page.getByTestId("bc-loi")).toHaveCount(0)
  await expect(page.getByTestId("bc-kpi-net").or(page.getByTestId("bc-khong-co-so")).first()).toBeVisible()
})
