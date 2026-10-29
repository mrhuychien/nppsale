import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 29/10/2026 (ảnh Báo cáo nhân viên, tháng 9): "Chưa dựng được báo cáo — số liệu không hiển thị để tránh đọc
 *   nhầm · đọc dòng phiếu nhập hàng trả: current transaction is aborted, commands ignored until end of transaction block".
 *   25P02 = kết nối PostgREST hỏng từ một lệnh trước; giao dịch ấy bị huỷ trọn → app gửi lại (`thuLaiKhiGiaoDichHong`).
 *   Sổ giả tiêm 25P02 (POST /__loi_25p02) vào đúng câu ấy: `stock_entry_lines` của phiếu "Nhập lại từ phiếu trả".
 *   Dữ liệu RIÊNG của spec này. Logic: tests/thu-lai-giao-dich-hong.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SP = "00000000-0000-4000-8000-0000000000d9"
const NV = "00000000-0000-4000-8000-0000000000b8"
const HD = "hd-25p02-1"
const TR = "tr-25p02-1"
const NHAP = "se-nhap-25p02-1"
const DUONG = "/rest/v1/stock_entry_lines"

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const tiem = (lan: number) =>
  fetch(`${FAKE}/__loi_25p02`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: DUONG, chua: NHAP, lan }) })
const daTiem = async () => ((await (await fetch(`${FAKE}/__loi_25p02`)).json()) as Array<{ chua: string; con: number; daDung: number }>).filter((t) => t.chua === NHAP)

test.beforeAll(async () => {
  await api("products", "POST", [{
    id: SP, org_id: ORG, sku: "GD1", name: "Sữa thử giao dịch", base_unit: "hộp", sell_price: 20000, status: "active", primary_supplier_id: null,
    units: [], price_lists: [{ id: "pl-gd-h", product_id: SP, unit_name: "hộp", group_id: null, price: 20000 }],
  }])
  await api("users", "POST", [{ id: NV, org_id: ORG, full_name: "NV Giao Dịch Thử", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await api("sales_invoices", "POST", [{
    id: HD, org_id: ORG, invoice_code: "HD-GD-1", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 200000, vat: 0, total: 200000, payment_terms: "COD", due_date: "2026-09-18", invoice_date: "2026-09-18",
    created_at: "2026-09-18T03:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await api("sales_invoice_lines", "POST", [{
    id: "sil-gd-1", invoice_id: HD, product_id: SP, quantity: 10, unit_name: "hộp", conversion_factor: 1, unit_price: 20000,
    line_discount: 0, vat_rate: 0, line_total: 200000, is_exchange: false, sort_order: 0, order_line_id: null,
  }])
  await api("returns", "POST", [{
    id: TR, org_id: ORG, customer_id: KHACH, invoice_id: HD, credit_note_amount: 40000, created_at: "2026-09-19T04:00:00Z",
    revenue_date: "2026-09-19", sales_user_id: NV, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await api("return_lines", "POST", [{ id: "rl-gd-1", return_id: TR, product_id: SP, unit_name: "hộp", quantity: 2, unit_price: 20000, line_total: 40000, is_exchange: false }])
  // Phiếu nhập lại kho do `complete_return` ghi — giá vốn hàng trả đọc qua dòng của phiếu này (câu bị lỗi trong ảnh).
  await api("stock_entries", "POST", [{
    id: NHAP, org_id: ORG, type: "import", status: "posted", posted_at: "2026-09-19T05:00:00Z", entry_code: "NK-GD-1",
    supplier_id: null, notes: `Nhập lại từ phiếu trả ${TR}`, created_at: "2026-09-19T05:00:00Z",
  }])
  await api("stock_entry_lines", "POST", [{
    id: "sel-gd-1", entry_id: NHAP, product_id: SP, quantity: 2, qty_in_base_uom: 2, conversion_factor_snapshot: 1, unit_cost: 15000,
  }])
})
test.afterEach(async () => {
  await fetch(`${FAKE}/__loi_25p02`, { method: "DELETE" })
})
test.afterAll(async () => {
  await api(`stock_entry_lines?entry_id=eq.${NHAP}`, "DELETE")
  await api(`stock_entries?id=eq.${NHAP}`, "DELETE")
  await api(`return_lines?return_id=eq.${TR}`, "DELETE")
  await api(`returns?id=eq.${TR}`, "DELETE")
  await api(`sales_invoice_lines?invoice_id=eq.${HD}`, "DELETE")
  await api(`sales_invoices?id=eq.${HD}`, "DELETE")
  await api(`users?id=eq.${NV}`, "DELETE")
  await api(`products?id=eq.${SP}`, "DELETE")
})

async function moHangBanTheoNv(page: import("@playwright/test").Page) {
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()
}

test("câu đọc dòng phiếu nhập hàng trả gặp 25P02 một lần → app gửi lại, báo cáo vẫn dựng đủ", async ({ page }) => {
  await dangNhap(page)
  await tiem(1)
  await moHangBanTheoNv(page)
  await expect(page.locator("tr", { hasText: "NV Giao Dịch Thử" }).first()).toBeVisible()
  await expect(page.getByText("Chưa dựng được báo cáo")).toHaveCount(0)
  // Lỗi tiêm ĐÃ trúng đúng câu ấy (bài không trống), và sau đó có lượt đọc lại thành công.
  expect((await daTiem())[0]).toMatchObject({ con: 0, daDung: 1 })
  const cau = (await nhatKy()).filter((r) => r.path === DUONG && decodeURIComponent(r.query ?? "").includes(NHAP))
  expect(cau.length).toBeGreaterThanOrEqual(2)
  expect((cau[0] as { loi?: string }).loi).toBe("25P02")
  expect((cau[cau.length - 1] as { loi?: string }).loi).toBeUndefined()
})

test("gửi lại vẫn 25P02 (máy chủ hỏng thật) → báo cáo không hiện số, câu lỗi tiếng Việt kèm nguyên văn", async ({ page }) => {
  await dangNhap(page)
  await tiem(3)
  await moHangBanTheoNv(page)
  const loi = page.getByText(/Máy chủ dữ liệu vừa trục trặc một kết nối/).first()
  await expect(loi).toBeVisible()
  await expect(loi).toContainText("đọc dòng phiếu nhập hàng trả: current transaction is aborted")
  await expect(page.locator("tr", { hasText: "NV Giao Dịch Thử" })).toHaveCount(0)
  // Một lần gốc + hai lần gửi lại, không hơn.
  expect((await daTiem())[0]).toMatchObject({ con: 0, daDung: 3 })
})
