import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ĐỘI TEST LIÊN MÔ-ĐUN — màn chi tiết HOÁ ĐƠN phải nói ĐÚNG số của sổ công nợ sau chuỗi nghiệp vụ dài.
 *
 * Dữ liệu dựng lại đúng trạng thái sổ mà kịch bản SQL thật (scripts/sql/doi-test/lien-module-chuoi.sql) đo được:
 *   · A8: Sửa HĐ (PB 20 → 15) — tờ mới 1.110.000, phiếu trả tự lập GẮN HĐ đã hoàn thành 240.000, phiếu trả
 *     của tờ trước đã huỷ → sổ công nợ HĐ = 870.000.
 *   · H2b: HĐ 360.000, hai phiếu trả gắn HĐ hoàn thành 120.000 + 480.000 → sổ công nợ HĐ = −240.000 (ÂM, không
 *     kẹp 0 — CLAUDE.md §1 "Công nợ ÂM").
 *   · C1: phiếu TỰ SINH 'Chờ xử lý' đã trừ ngay lúc xuất (không được báo "chưa trừ"); phiếu tự lập NHÁP thì chưa trừ.
 * Luật: CLAUDE.md §1 — "Tiền của một hóa đơn trong danh sách là số còn lại sau hàng trả"; công nợ theo HĐ =
 * tổng − hàng trả (tự sinh: Chờ xử lý / Hoàn thành; tự lập: Hoàn thành).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KH = { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" }
const HD = {
  A8: "00000000-0000-4000-8000-0000000a8a08",
  H2b: "00000000-0000-4000-8000-0000000b2b02",
  C1: "00000000-0000-4000-8000-0000000c1c01",
}
const hoaDon = (id: string, ma: string, total: number) => ({
  id, org_id: ORG, invoice_code: ma, order_id: null, customer_id: KHACH, status: "posted",
  subtotal: total, vat: 0, total, payment_terms: "NET30", due_date: "2026-10-29", notes: null,
  invoice_date: "2026-09-29", stock_entry_id: null, created_at: "2026-09-29T08:00:00Z",
  customer: KH, order: { order_code: "DH-LM" }, sales_user: { full_name: "Chủ NPP" }, creator: { full_name: "Chủ NPP" },
})
const phieuTra = (id: string, hd: string, status: string, credit: number, tuSinh: boolean, t: string) => ({
  id, org_id: ORG, invoice_id: hd, customer_id: KHACH, status, credit_note_amount: credit,
  credit_with_invoice: tuSinh, created_at: `2026-09-29T0${t}:00:00Z`, reason: "damaged",
})
const HOA_DON = [hoaDon(HD.A8, "HD-LM-A8", 1110000), hoaDon(HD.H2b, "HD-LM-H2B", 360000), hoaDon(HD.C1, "HD-LM-C1", 480000)]
const PHIEU = [
  phieuTra("lm-ra1", HD.A8, "completed", 240000, false, "1"),
  phieuTra("lm-ra-huy", HD.A8, "cancelled", 999000, true, "2"),
  phieuTra("lm-rh1", HD.H2b, "completed", 120000, false, "1"),
  phieuTra("lm-rh2", HD.H2b, "completed", 480000, false, "2"),
  phieuTra("lm-rc-tu-sinh", HD.C1, "submitted", 60000, true, "1"),
  phieuTra("lm-rc-nhap", HD.C1, "draft", 50000, false, "2"),
]

const gui = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })

test.beforeEach(async () => {
  await gui("sales_invoices", HOA_DON)
  await gui("returns", PHIEU)
})
test.afterEach(async () => {
  for (const r of PHIEU) await fetch(`${FAKE}/rest/v1/returns?id=eq.${r.id}`, { method: "DELETE" })
  for (const h of HOA_DON) await fetch(`${FAKE}/rest/v1/sales_invoices?id=eq.${h.id}`, { method: "DELETE" })
})

/** Giá trị của một dòng trong khối Cộng tiền (nhãn → ô số cùng hàng). */
const dong = (page: Page, nhan: string) => page.getByText(nhan, { exact: true }).first().locator("xpath=..")

test("sau Sửa HĐ: Tổng 1.110.000 − trả 240.000 = còn phải thu 870.000 (phiếu đã huỷ không trừ)", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/sales-invoices/${HD.A8}`)
  await expect(dong(page, "Tổng hóa đơn")).toContainText("1.110.000")
  await expect(dong(page, "Trừ hàng trả")).toContainText("240.000")
  await expect(dong(page, "Trừ hàng trả")).not.toContainText("999")
  await expect(dong(page, "Còn phải thu")).toContainText("870.000")
  await expect(page.getByText(/phiếu trả chưa trừ vào công nợ/)).toHaveCount(0)
})

test("hàng trả vượt HĐ: còn phải thu ÂM −240.000, không kẹp 0", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/sales-invoices/${HD.H2b}`)
  await expect(dong(page, "Trừ hàng trả")).toContainText("600.000")
  await expect(dong(page, "Còn phải thu")).toContainText(/[-−]\s?240\.000/)
})

test("phiếu tự sinh Chờ xử lý đã trừ ngay (420.000); chỉ phiếu tự lập NHÁP mới báo chưa trừ", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/sales-invoices/${HD.C1}`)
  await expect(dong(page, "Trừ hàng trả")).toContainText("60.000")
  await expect(dong(page, "Còn phải thu")).toContainText("420.000")
  await expect(page.getByText(/Còn 1 phiếu trả chưa trừ vào công nợ/)).toBeVisible()
})
