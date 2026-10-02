/**
 * DỮ LIỆU MẪU CHO CHỐT BẤM MÀN HÌNH. Một NPP, một chủ, một khách, một mặt
 * hàng hai đơn vị — đủ để bắt lỗi đổi đơn vị:
 *   Sữa hộp: hộp 20.000 · thùng 24 hộp, BẢNG GIÁ thùng 450.000 (rẻ hơn
 *   24 × 20.000 = 480.000 — nếu ra 480.000 là màn đã nhân hệ số thay vì
 *   tra bảng giá).
 */
export const ORG = "00000000-0000-4000-8000-0000000000a1"
export const OWNER = "00000000-0000-4000-8000-0000000000b1"
/* Hai NV chỉ để đứng tên phiếu trả mẫu — KHÔNG có trong bảng `users` mẫu
   (thêm vào là mọi ô chọn NV của các chốt khác đổi số dòng); chốt nào cần
   thì tự chèn rồi gỡ. */
export const NV_MOT = "00000000-0000-4000-8000-0000000000b7"
export const NV_HAI = "00000000-0000-4000-8000-0000000000b8"
export const KHACH = "00000000-0000-4000-8000-0000000000c1"
/** Khách thuộc nhóm giá G1: hộp 19.000 (khác `sell_price` 20.000). */
export const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
export const NHOM = "00000000-0000-4000-8000-0000000000a9"
export const SUA = "00000000-0000-4000-8000-0000000000d1"
export const MI = "00000000-0000-4000-8000-0000000000d2"
export const NCC = "00000000-0000-4000-8000-0000000000e1"
export const HOA_DON = "00000000-0000-4000-8000-0000000000f1"

export const users = [{ id: OWNER, email: "chu@npp.test", password: "matkhau-e2e" }]

/* Cùng ngày với đồng hồ trình duyệt ghim ở e2e/helpers.ts (HOM_NAY_E2E) — không theo ngày chạy. */
const homNay = () => "2026-09-30"
function donMau(id, code, status, total, ngay) {
  return {
    id, org_id: ORG, order_code: code, customer_id: KHACH, sales_user_id: OWNER, status,
    subtotal: total, vat: 0, total, order_date: ngay, created_at: `${ngay}T08:00:00Z`,
    payment_terms: "COD", current_workflow_stage: null,
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi", route_code: null },
    sales_user: { full_name: "Chủ NPP" },
    /* Người tạo ≠ người được tính — cột tuỳ chọn "Người tạo" (24/09/2026). */
    created_by: "00000000-0000-4000-8000-0000000000b9", creator: { full_name: "Kế toán Lan" },
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
      { id: "b1", org_id: ORG, product_id: SUA, qty_on_hand: 1000, warehouse_zone: "sale", batch_code: "L1", expires_at: "2027-12-31" },
      { id: "b2", org_id: ORG, product_id: MI, qty_on_hand: 900, warehouse_zone: "sale", batch_code: "L2", expires_at: "2027-12-31" },
    ],
    suppliers: [{ id: NCC, org_id: ORG, code: "NCC1", name: "Vinamilk", status: "active", is_active: true }],
    role_permissions: [],
    /* Số phiên danh mục bán hàng (mig 209) — bài e2e tăng tay (máy chủ giả không có trigger). */
    danh_muc_ban_phien: [{ id: 1, phien: 1, luc: "2026-09-28T00:00:00Z" }],
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
      /* Người được tính khoản trừ ≠ người lập — cột + bộ lọc "Tính cho NV".
         Cứ ba phiếu có một phiếu chưa gán. */
      sales_user_id: i % 3 === 0 ? null : i % 2 ? NV_HAI : NV_MOT,
      seller: i % 3 === 0 ? null : { full_name: i % 2 ? "NV Bán Hai" : "NV Bán Một" },
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
      posted_by: OWNER, sales_user_id: OWNER, creator: { full_name: "Kế toán Lan" },
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
        /* Như mig 183: thuế DÒNG ĐƠN trước, thuế mặt hàng sau; ghi chú dòng đơn đi theo. */
        unit_price: gia, list_price: gia, line_discount: 0,
        vat_rate: l.vat_rate ?? sp[l.product_id]?.vat_rate ?? 0,
        available_base: 1000, is_exchange: false, note: l.note ?? null,
      }
    })
}

/* ---- Báo cáo đọc một lượt (mig 204) — làm y như ba hàm SQL, để e2e chạy ĐƯỜNG MỚI. ---- */
const vnMoc = (d, cuoi) => Date.parse(`${d}T${cuoi ? "23:59:59.999" : "00:00:00"}+07:00`)
const trongNgay = (v, a, b) => typeof v === "string" && v.slice(0, 10) >= a && v.slice(0, 10) <= b
const slKho = (l) => (l.qty_in_base_uom != null ? Math.abs(Number(l.qty_in_base_uom)) : Math.abs(Number(l.quantity || 0)) * (Number(l.conversion_factor_snapshot) > 0 ? Number(l.conversion_factor_snapshot) : 1))
const COT_HD = ["id", "invoice_code", "invoice_date", "order_id", "status", "total", "subtotal", "vat", "customer_id", "sales_user_id", "posted_by", "payment_terms"]
const chon = (r, cot) => Object.fromEntries(cot.map((k) => [k, r[k] ?? null]))
function baoCaoSoBan({ p_tu, p_den }, { db }) {
  const hd = (db.sales_invoices || []).filter((i) => i.status === "posted" && trongNgay(i.invoice_date, p_tu, p_den)).map((i) => chon(i, COT_HD))
  const idHd = new Set(hd.map((h) => h.id))
  const tra = (db.returns || []).filter((r) => trongNgay(r.revenue_date, p_tu, p_den)).map((r) => ({
    ...chon(r, ["id", "status", "customer_id", "invoice_id", "credit_note_amount", "created_at", "revenue_date", "sales_user_id", "reason", "credit_with_invoice"]),
    ma: r.return_code ?? null,
  }))
  const idTra = new Set(tra.map((t) => t.id))
  const xuat = new Set((db.stock_entries || []).filter((e) => e.status === "posted" && e.type === "export" && Date.parse(e.posted_at) >= vnMoc(p_tu) && Date.parse(e.posted_at) <= vnMoc(p_den, true)).map((e) => e.id))
  const gv = new Map()
  for (const l of db.stock_entry_lines || []) {
    if (!xuat.has(l.entry_id)) continue
    const g = gv.get(l.product_id) || { product_id: l.product_id, sl: 0, tien: 0 }
    g.sl += slKho(l)
    g.tien += slKho(l) * Number(l.unit_cost || 0)
    gv.set(l.product_id, g)
  }
  const gvTra = []
  for (const t of tra) {
    const e = (db.stock_entries || []).filter((x) => x.type === "import" && x.status === "posted" && x.notes === `Nhập lại từ phiếu trả ${t.id}`).map((x) => x.id)
    const m = new Map()
    for (const l of db.stock_entry_lines || []) {
      if (!e.includes(l.entry_id)) continue
      const base = Math.abs(l.qty_in_base_uom ?? Number(l.quantity || 0) * (Number(l.conversion_factor_snapshot) || 1))
      m.set(l.product_id, (m.get(l.product_id) || 0) + base * Number(l.unit_cost || 0))
    }
    for (const [product_id, tien] of m) gvTra.push({ return_id: t.id, product_id, tien })
  }
  return {
    hd,
    dong_hd: (db.sales_invoice_lines || []).filter((l) => idHd.has(l.invoice_id)).map((l) => chon(l, ["id", "invoice_id", "product_id", "unit_name", "conversion_factor", "quantity", "unit_price", "line_total", "is_exchange"])),
    tra,
    dong_tra: (db.return_lines || []).filter((l) => idTra.has(l.return_id) && l.is_exchange === false).map((l) => chon(l, ["return_id", "product_id", "unit_name", "quantity", "line_total"])),
    gv: Array.from(gv.values()),
    gv_tra: gvTra,
  }
}
function baoCaoCongNo({ p_tu_thu, p_tu_90 }, { db }) {
  const phieu = (db.receivables || []).map((r) => {
    const i = (db.sales_invoices || []).find((x) => x.id === r.invoice_id)
    return { ...chon(r, ["id", "customer_id", "sales_user_id", "invoice_id", "return_id", "amount", "paid", "due_date", "status", "created_at"]), invoice: i ? { invoice_code: i.invoice_code, invoice_date: i.invoice_date } : r.invoice ?? null }
  })
  return {
    mo: phieu.filter((p) => p.status != null && p.status !== "paid"),
    gan90: phieu.filter((p) => Date.parse(p.created_at) >= vnMoc(p_tu_90)),
    thu: (db.payments || []).filter((t) => Date.parse(t.collected_at) >= vnMoc(p_tu_thu)).map((t) => ({ ...chon(t, ["id", "amount", "method", "collected_at", "receivable_id"]), receivable: phieu.find((p) => p.id === t.receivable_id) ?? null })),
  }
}
function baoCaoTonKho({ p_tu, p_den }, { db }) {
  const hd = new Map((db.sales_invoices || []).filter((i) => i.status === "posted" && trongNgay(i.invoice_date, p_tu, p_den)).map((i) => [i.id, i.invoice_date]))
  return {
    lo: (db.batches || []).filter((b) => Number(b.qty_on_hand) > 0).map((b) => chon(b, ["id", "product_id", "batch_code", "qty_on_hand", "unit_cost", "expires_at", "created_at"])),
    dong: (db.sales_invoice_lines || []).filter((l) => hd.has(l.invoice_id)).map((l) => ({ ngay: hd.get(l.invoice_id), ...chon(l, ["invoice_id", "product_id", "unit_name", "conversion_factor", "quantity", "is_exchange"]) })),
  }
}

export const rpc = {
  /* Lượt soạn hàng (mig 225): tạo / gộp tiến độ (null = xoá khoá) / hoàn tất (đánh dấu HĐ đã soạn) / huỷ. */
  tao_luot_soan: ({ p_invoice_ids }, { db, newId }) => {
    db.luot_soan = db.luot_soan || []
    const id = newId()
    db.luot_soan.push({
      id, org_id: ORG, ma: `SH-02/10-${String(db.luot_soan.length + 1).padStart(2, "0")}`, invoice_ids: [...new Set(p_invoice_ids || [])],
      trang_thai: "dang_soan", tien_do: { nhat: {}, chia: {} }, created_at: new Date().toISOString(), updated_at: String(Date.now()),
    })
    return id
  },
  cap_nhat_luot_soan: ({ p_id, p_invoice_ids, p_nhat, p_chia }, { db }) => {
    const l = (db.luot_soan || []).find((x) => x.id === p_id)
    if (!l) throw Object.assign(new Error("KHONG_TIM_THAY_LUOT"), { code: "P0001" })
    if (l.trang_thai !== "dang_soan") throw Object.assign(new Error("LUOT_DA_DONG"), { code: "P0001" })
    if (p_invoice_ids) l.invoice_ids = [...new Set(p_invoice_ids)]
    const gop = (cu, moi) => Object.fromEntries(Object.entries({ ...cu, ...moi }).filter(([, v]) => v !== null))
    l.tien_do = { nhat: p_nhat ? gop(l.tien_do.nhat, p_nhat) : l.tien_do.nhat, chia: p_chia ? gop(l.tien_do.chia, p_chia) : l.tien_do.chia }
    l.updated_at = String(Date.now() + Math.random())
    return { ...l }
  },
  hoan_tat_luot_soan: ({ p_id }, { db, user }) => {
    const l = (db.luot_soan || []).find((x) => x.id === p_id)
    if (!l || l.trang_thai !== "dang_soan") throw Object.assign(new Error("LUOT_DA_DONG"), { code: "P0001" })
    l.trang_thai = "xong"
    let n = 0
    for (const h of db.sales_invoices || []) if (l.invoice_ids.includes(h.id) && h.status === "posted" && !h.soan_luc) { h.soan_luc = new Date().toISOString(); h.soan_boi = user?.id ?? null; n++ }
    return n
  },
  huy_luot_soan: ({ p_id }, { db }) => {
    const l = (db.luot_soan || []).find((x) => x.id === p_id)
    if (l) l.trang_thai = "huy"
    return null
  },
  /* Đánh dấu đã soạn hàng (mig 224): chỉ HĐ đã ghi sổ; đánh dấu lại không ghi đè giờ / người. */
  danh_dau_soan_hang: ({ p_ids, p_da }, { db, user }) => {
    let n = 0
    for (const h of db.sales_invoices || []) {
      if (!(p_ids || []).includes(h.id) || h.status !== "posted" || !h.soan_luc === !p_da) continue
      h.soan_luc = p_da ? new Date().toISOString() : null
      h.soan_boi = p_da ? user?.id ?? null : null
      n++
    }
    return n
  },
  /* Nhân viên nghỉ việc (mig 223): đếm chứng từ chặn xoá theo vài bảng chính; cho nghỉ = khoá + nợ mở về NPP. */
  so_chung_tu_nhan_vien: ({ p_user_id }, { db }) => {
    const dem = (bang, cot) => (db[bang] || []).filter((r) => r[cot] === p_user_id).length
    const chi_tiet = [["sales_orders", "sales_user_id"], ["sales_invoices", "sales_user_id"], ["receivables", "sales_user_id"]]
      .map(([bang, cot]) => ({ bang, cot, so: dem(bang, cot) })).filter((d) => d.so > 0)
    const no = (db.receivables || []).filter((r) => r.sales_user_id === p_user_id && r.status !== "paid")
    return {
      tong: chi_tiet.reduce((t, d) => t + d.so, 0), chi_tiet,
      khach: new Set((db.customer_assignments || []).filter((a) => a.user_id === p_user_id).map((a) => a.customer_id)).size,
      lich_tuyen: dem("pjp_routes", "sales_user_id"),
      so_khoan_no: no.length, tien_no: no.reduce((t, r) => t + (r.amount || 0) - (r.paid || 0), 0),
    }
  },
  giao_cong_no_npp: ({ p_customer_id, p_user_id }, { db }) => {
    const no = (db.receivables || []).filter((r) => r.customer_id === p_customer_id && r.ve_npp_luc && r.status !== "paid")
    for (const r of no) { r.sales_user_id = p_user_id; r.ve_npp_luc = null }
    return { so_khoan_no: no.length, tien_no: no.reduce((t, r) => t + (r.amount || 0) - (r.paid || 0), 0) }
  },
  cho_nhan_vien_nghi: ({ p_user_id }, { db }) => {
    const u = (db.users || []).find((x) => x.id === p_user_id)
    if (!u) throw Object.assign(new Error("KHONG_TIM_THAY_NV"), { code: "P0001" })
    u.is_active = false
    u.left_at = new Date().toISOString()
    const khach = (db.customer_assignments || []).filter((a) => a.user_id === p_user_id).length
    db.customer_assignments = (db.customer_assignments || []).filter((a) => a.user_id !== p_user_id)
    const no = (db.receivables || []).filter((r) => r.sales_user_id === p_user_id && r.status !== "paid")
    for (const r of no) { r.sales_user_id = null; r.ve_npp_luc = u.left_at }
    return { khach, lich_tuyen: 0, so_khoan_no: no.length, tien_no: no.reduce((t, r) => t + (r.amount || 0) - (r.paid || 0), 0) }
  },
  /* Tra trùng khách (mig 082/205): khớp SĐT (chỉ chữ số) hoặc tên — màn thêm khách chặn tạo trùng số. */
  search_customer_dupes: ({ p_q }, { db }) => {
    const so = String(p_q ?? "").replace(/\D/g, "")
    const q = String(p_q ?? "").toLowerCase().trim()
    if (q.length < 2) return []
    return (db.customers || [])
      .filter((c) => (so.length >= 3 && String(c.phone ?? "").replace(/\D/g, "").includes(so)) || String(c.store_name ?? "").toLowerCase().includes(q))
      .map((c) => ({ id: c.id, store_name: c.store_name, owner_name: c.owner_name, phone: c.phone, address: c.address ?? null, ward: c.ward ?? null, primary_user_name: null, has_my_assignment: true }))
  },
  bao_cao_so_ban: baoCaoSoBan,
  bao_cao_cong_no: baoCaoCongNo,
  bao_cao_ton_kho: baoCaoTonKho,
  get_invoiceable_lines: invoiceableLines,
  post_invoice: () => [{ invoice_id: "00000000-0000-4000-8000-00000000f004", invoice_code: "HD-E2E-3", entry_id: null, receivable_id: null, short_qty: 0, near_expiry_skipped: 0, order_status: "partially_invoiced" }],
  assign_doc_seller: () => null,
  user_has_permission: () => true,
  /* Mức doanh số chung A / tháng (cài đặt lương, mig 196) — cột Chỉ tiêu của Báo cáo tổng hợp. */
  my_sales_target: () => 3000000,
  /* Hoàn thành / huỷ phiếu trả (mig 120) — chỉ đổi trạng thái để màn danh sách thấy phiếu chuyển tab. */
  complete_return: ({ p_return_id, p_zone, p_ngay }, { db }) => {
    const r = (db.returns || []).find((x) => x.id === p_return_id)
    if (!r) throw new Error("RETURN_NOT_FOUND")
    /* Ngày nhập kho phiếu tự sinh (mig 211). */
    Object.assign(r, { status: "completed", destination_zone: p_zone, completed_at: p_ngay ? `${p_ngay}T05:00:00Z` : "2026-09-27T08:00:00Z" })
    return [{ entry_id: null }]
  },
  cancel_return: ({ p_return_id, p_reason }, { db }) => {
    const r = (db.returns || []).find((x) => x.id === p_return_id)
    if (!r) throw new Error("RETURN_NOT_FOUND")
    Object.assign(r, { status: "cancelled", cancel_reason: p_reason })
    return null
  },
  /* Phiếu lương của tôi (mig 201) — một kỳ đã chốt. */
  my_payslips: () => [{
    payroll_run_id: "00000000-0000-4000-8000-00000000a701", month: "2026-08-01", locked_at: "2026-09-02T03:00:00Z",
    base_salary: 8000000, standard_workdays: 26, actual_workdays: 26, prorated_base: 8000000, allowances: 500000,
    kpi_bonus: 1000000, order_count_bonus: 0, activity_bonus: 0, overtime: 0, deductions: 0, social_insurance: 840000,
    manual_adjustment: 0, net_salary: 8660000, computed_breakdown: { revenue: 150000000 }, notes: null,
  }],
  lookup_email_by_identifier: () => "chu@npp.test",
  create_order_with_lines: (_a) => [{ order_id: "00000000-0000-4000-8000-00000000f001", order_code: "DH-E2E-1", already_existed: false }],
  create_return_with_lines: () => "00000000-0000-4000-8000-00000000f002",
  /* Lập phiếu thu (mig 119/215) — trả id phiếu; chốt chỉ đọc tải trọng. */
  create_cash_receipt: () => "00000000-0000-4000-8000-00000000f0c1",
  /* Hoàn thành phiếu nhập / gửi phiếu trả NCC (mig 142 / 146) — chốt chỉ đọc tải trọng. */
  complete_purchase_invoice: () => null,
  complete_supplier_return: () => null,
  /* Huỷ hóa đơn (mig 217) — máy chủ huỷ luôn đơn, trả trạng thái đơn 'cancelled'. */
  cancel_invoice: () => [{ import_entry_id: null, order_status: "cancelled" }],
  reissue_invoice: () => [{ invoice_id: "00000000-0000-4000-8000-00000000f003", invoice_code: "HD-E2E-1-1", entry_id: null, receivable_id: null, short_qty: 0, near_expiry_skipped: 0, order_status: "completed" }],
}
