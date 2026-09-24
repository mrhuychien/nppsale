/**
 * DỮ LIỆU MẪU CHO CHỐT BẤM MÀN HÌNH. Một NPP, một chủ, một khách, một mặt
 * hàng hai đơn vị — đủ để bắt lỗi đổi đơn vị:
 *   Sữa hộp: hộp 20.000 · thùng 24 hộp, BẢNG GIÁ thùng 450.000 (rẻ hơn
 *   24 × 20.000 = 480.000 — nếu ra 480.000 là màn đã nhân hệ số thay vì
 *   tra bảng giá).
 */
export const ORG = "00000000-0000-4000-8000-0000000000a1"
export const OWNER = "00000000-0000-4000-8000-0000000000b1"
export const KHACH = "00000000-0000-4000-8000-0000000000c1"
/** Khách thuộc nhóm giá G1: hộp 19.000 (khác `sell_price` 20.000). */
export const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
export const NHOM = "00000000-0000-4000-8000-0000000000a9"
export const SUA = "00000000-0000-4000-8000-0000000000d1"
export const MI = "00000000-0000-4000-8000-0000000000d2"
export const NCC = "00000000-0000-4000-8000-0000000000e1"
export const HOA_DON = "00000000-0000-4000-8000-0000000000f1"

export const users = [{ id: OWNER, email: "chu@npp.test", password: "matkhau-e2e" }]

const homNay = () => new Date().toISOString().slice(0, 10)
function donMau(id, code, status, total, ngay) {
  return {
    id, org_id: ORG, order_code: code, customer_id: KHACH, sales_user_id: OWNER, status,
    subtotal: total, vat: 0, total, order_date: ngay, created_at: `${ngay}T08:00:00Z`,
    payment_terms: "COD", current_workflow_stage: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi", route_code: null },
    sales_user: { full_name: "Chủ NPP" },
  }
}

export function tables() {
  return {
    organizations: [{ id: ORG, name: "NPP Thử", setup_completed: true, settings: {} }],
    users: [{
      id: OWNER, org_id: ORG, full_name: "Chủ NPP", role: "owner", phone: "0900000000",
      is_active: true, created_at: "2026-01-01T00:00:00Z", allow_price_edit: true,
      price_edit_max_increase_pct: 100,
    }],
    customers: [{
      id: KHACH, org_id: ORG, customer_code: "KH001", store_name: "Tạp hoá Cô Ba", owner_name: "Cô Ba",
      phone: "0911111111", address: "1 Lê Lợi", status: "active", group_id: null, debt: 0, credit_limit: 0,
      payment_terms: "COD", sales_user_id: OWNER,
    }, {
      id: KHACH_NHOM, org_id: ORG, customer_code: "KH002", store_name: "Đại lý Minh", owner_name: "Minh",
      phone: "0922222222", address: "2 Trần Phú", status: "active", group_id: NHOM, debt: 0, credit_limit: 0,
      payment_terms: "COD", sales_user_id: OWNER,
    }],
    products: [{
      id: SUA, org_id: ORG, sku: "SUA1", barcode: "8930000000011", name: "Sữa hộp", base_unit: "hộp",
      sell_price: 20000, cost_price: 15000, vat_rate: 0, status: "active", category: "Sữa",
      units: [{ id: "u1", product_id: SUA, unit_name: "thùng", conversion: 24 }],
      price_lists: [
        { id: "pl1", product_id: SUA, unit_name: "hộp", group_id: null, price: 20000 },
        { id: "pl2", product_id: SUA, unit_name: "thùng", group_id: null, price: 450000 },
        { id: "pl3", product_id: SUA, unit_name: "hộp", group_id: NHOM, price: 19000 },
      ],
    }, {
      id: MI, org_id: ORG, sku: "MI1", barcode: "8930000000028", name: "Mì tôm", base_unit: "gói",
      sell_price: 5000, cost_price: 4000, vat_rate: 0, status: "active", category: "Mì",
      units: [{ id: "u2", product_id: MI, unit_name: "thùng", conversion: 30 }],
      price_lists: [
        { id: "pl4", product_id: MI, unit_name: "gói", group_id: null, price: 5000 },
        { id: "pl5", product_id: MI, unit_name: "thùng", group_id: null, price: 140000 },
      ],
    }],
    product_units: [
      { id: "u1", product_id: SUA, unit_name: "thùng", conversion: 24 },
      { id: "u2", product_id: MI, unit_name: "thùng", conversion: 30 },
    ],
    batches: [
      { id: "b1", org_id: ORG, product_id: SUA, qty_on_hand: 1000, warehouse_zone: "sale", batch_code: "L1", expiry_date: "2027-12-31" },
      { id: "b2", org_id: ORG, product_id: MI, qty_on_hand: 900, warehouse_zone: "sale", batch_code: "L2", expiry_date: "2027-12-31" },
    ],
    suppliers: [{ id: NCC, org_id: ORG, code: "NCC1", name: "Vinamilk", status: "active" }],
    role_permissions: [],
    /* Ba đơn: hai đơn tháng này, một đơn NĂM NGOÁI — máy tính chọn "Tất cả"
       phải thấy cả ba (lỗi cũ: lọc ngầm còn tháng này). */
    sales_orders: [
      donMau("o-e2e-1", "DH-0001", "submitted", 1_000_000, homNay()),
      donMau("o-e2e-2", "DH-0002", "completed", 2_000_000, homNay()),
      donMau("o-e2e-3", "DH-0003", "completed", 5_000_000, "2025-06-15"),
      // Đơn ĐÃ HUỶ: đếm vào "Tất cả" nhưng KHÔNG vào tổng tiền.
      donMau("o-e2e-4", "DH-0004", "cancelled", 9_000_000, "2025-01-10"),
    ],
    // DH-0001 có Sữa, DH-0002 có Mì, DH-0003 có cả hai.
    sales_order_lines: [
      { id: "sol1", order_id: "o-e2e-1", product_id: SUA, unit_name: "hộp", quantity: 50, line_total: 1000000, product: { name: "Sữa hộp" } },
      { id: "sol2", order_id: "o-e2e-2", product_id: MI, unit_name: "thùng", quantity: 14, line_total: 2000000, product: { name: "Mì tôm" } },
      { id: "sol3", order_id: "o-e2e-3", product_id: SUA, unit_name: "thùng", quantity: 5, line_total: 2500000, product: { name: "Sữa hộp" } },
      { id: "sol4", order_id: "o-e2e-3", product_id: MI, unit_name: "thùng", quantity: 18, line_total: 2500000, product: { name: "Mì tôm" } },
    ],
    /* 60 phiếu trả × 10.000 — danh sách hiện 50 dòng/trang; tổng phải là
       600.000 của CẢ bộ lọc (lỗi cũ: cộng trang đang hiện → 500.000). */
    returns: Array.from({ length: 60 }, (_, i) => ({
      id: `r-e2e-${i}`, org_id: ORG, customer_id: KHACH, status: "submitted", reason: "damaged",
      credit_note_amount: 10000, created_at: `2026-09-${String(1 + (i % 20)).padStart(2, "0")}T08:00:00Z`,
      customer: { store_name: "Tạp hoá Cô Ba" }, requester: { full_name: "Chủ NPP" }, order: null, invoice: null,
      /* Người được tính khoản trừ ≠ người lập — cột "Tính cho NV". */
      seller: { full_name: i % 2 ? "NV Bán Hai" : "NV Bán Một" },
    })),
    // Chỉ hai phiếu trả đầu có dòng Mì.
    return_lines: [
      { id: "rl1", return_id: "r-e2e-0", product_id: MI, unit_name: "gói", quantity: 2 },
      { id: "rl2", return_id: "r-e2e-1", product_id: MI, unit_name: "gói", quantity: 1 },
      { id: "rl3", return_id: "r-e2e-2", product_id: SUA, unit_name: "hộp", quantity: 1 },
    ],
    /* Hóa đơn có một dòng "2 thùng" (hệ số 24) — để chốt màn Sửa hóa đơn
       giữ đúng hệ số khi lập lại (lỗi cũ: nạp lại thành hệ số 1). */
    sales_invoices: [{
      id: HOA_DON, org_id: ORG, invoice_code: "HD-E2E-1", order_id: "00000000-0000-4000-8000-0000000000f9",
      customer_id: KHACH, status: "posted", subtotal: 900000, vat: 0, total: 900000,
      payment_terms: "COD", due_date: "2026-09-30", notes: null, invoice_date: "2026-09-23",
      stock_entry_id: "se1", created_at: "2026-09-23T08:00:00Z",
      customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
      order: { order_code: "DH-0002" }, sales_user: { full_name: "Chủ NPP" },
      posted_by: OWNER, sales_user_id: OWNER,
    }, {
      id: "00000000-0000-4000-8000-0000000000f2", org_id: ORG, invoice_code: "HD-E2E-2", order_id: "o-e2e-1",
      customer_id: KHACH, status: "posted", subtotal: 300000, vat: 0, total: 300000,
      payment_terms: "COD", due_date: "2026-09-30", notes: null, invoice_date: "2026-09-22",
      stock_entry_id: "se2", created_at: "2026-09-22T08:00:00Z",
      customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
      order: { order_code: "DH-0001" }, sales_user: { full_name: "Chủ NPP" },
    }],
    /* HD-E2E-1 xuất từ lô L1 (Sữa), HD-E2E-2 từ lô L2 (Mì). */
    stock_entry_lines: [
      { id: "sel1", entry_id: "se1", product_id: SUA, batch_id: "b1", quantity: 48 },
      { id: "sel2", entry_id: "se2", product_id: MI, batch_id: "b2", quantity: 60 },
    ],
    sales_invoice_lines: [{
      id: "sil1", invoice_id: HOA_DON, product_id: SUA, quantity: 2, unit_name: "thùng", conversion_factor: 24,
      unit_price: 450000, line_discount: 0, vat_rate: 0, line_total: 900000, is_exchange: false, sort_order: 0,
      order_line_id: "sol9", note: null,
      product: { name: "Sữa hộp", sku: "SUA1" },
    }, {
      /* Dòng HÀNG ĐỔI — lỗi cũ: lập lại là thành dòng bán (is_exchange mất). */
      id: "sil2", invoice_id: HOA_DON, product_id: MI, quantity: 1, unit_name: "gói", conversion_factor: 1,
      unit_price: 0, line_discount: 0, vat_rate: 0, line_total: 0, is_exchange: true, sort_order: 1,
      order_line_id: null, note: null,
      product: { name: "Mì tôm", sku: "MI1" },
    }],
    receivables: [], payables: [],
    /* Phiếu nhập: 300.000 + 700.000 hoàn thành, 9.000.000 ĐÃ HUỶ — tổng 1.000.000. */
    purchase_invoices: [
      { id: "pi1", org_id: ORG, receipt_code: "PN-1", invoice_number: "HD1", invoice_date: "2026-09-20", status: "completed", total: 300000, warehouse_zone: "sale", created_at: "2026-09-20T08:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" } },
      { id: "pi2", org_id: ORG, receipt_code: "PN-2", invoice_number: "HD2", invoice_date: "2026-09-21", status: "draft", total: 700000, warehouse_zone: "sale", created_at: "2026-09-21T08:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" } },
      { id: "pi3", org_id: ORG, receipt_code: "PN-3", invoice_number: "HD3", invoice_date: "2026-09-22", status: "cancelled", total: 9000000, warehouse_zone: "sale", created_at: "2026-09-22T08:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" } },
    ],
    purchase_invoice_lines: [], approval_rules: [],
  }
}

/** RPC mà các màn POS gọi. Hàm lưu ghi lại tải trọng để chốt đọc. */

/**
 * `get_invoiceable_lines` giả — dựng từ `sales_order_lines` của đơn, đủ cột
 * `loadInvoiceableLines` đọc. Còn lại = đặt − đã xuất.
 */
function invoiceableLines({ p_order_id }, { db }) {
  const sp = Object.fromEntries((db.products ?? []).map((p) => [p.id, p]))
  return (db.sales_order_lines ?? [])
    .filter((l) => l.order_id === p_order_id)
    .map((l) => {
      const qty = Number(l.quantity) || 0
      const inv = Number(l.invoiced_qty) || 0
      const gia = Number(l.unit_price ?? (qty ? l.line_total / qty : 0))
      return {
        order_line_id: l.id, return_line_id: null, product_id: l.product_id,
        product_name: sp[l.product_id]?.name ?? "—", sku: sp[l.product_id]?.sku ?? null,
        unit_name: l.unit_name, conversion_factor: Number(l.conversion_factor) || 1,
        ordered_qty: qty, invoiced_qty: inv, remaining_qty: Math.max(0, qty - inv),
        unit_price: gia, list_price: gia, line_discount: 0, vat_rate: 0,
        available_base: 1000, is_exchange: false, note: null,
      }
    })
}

export const rpc = {
  get_invoiceable_lines: invoiceableLines,
  post_invoice: () => [{ invoice_id: "00000000-0000-4000-8000-00000000f004", invoice_code: "HD-E2E-3", entry_id: null, receivable_id: null, short_qty: 0, near_expiry_skipped: 0, order_status: "partially_invoiced" }],
  assign_doc_seller: () => null,
  user_has_permission: () => true,
  lookup_email_by_identifier: () => "chu@npp.test",
  create_order_with_lines: (_a) => [{ order_id: "00000000-0000-4000-8000-00000000f001", order_code: "DH-E2E-1", already_existed: false }],
  create_return_with_lines: () => "00000000-0000-4000-8000-00000000f002",
  reissue_invoice: () => [{ invoice_id: "00000000-0000-4000-8000-00000000f003", invoice_code: "HD-E2E-1-1", entry_id: null, receivable_id: null, short_qty: 0, near_expiry_skipped: 0, order_status: "completed" }],
}
