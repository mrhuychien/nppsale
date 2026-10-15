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

/* ---- Bàn giao khách + hàng khách đã lấy (mig 246) — cùng luật hàm thật ở mức màn cần. ---- */
const loiP = (m) => Object.assign(new Error(m), { code: "P0001" })
const pcCon = (db, cid) => (db.customer_assignments || []).filter((a) => a.customer_id === cid && (a.status ?? "active") === "active")
const nvConLam = (db, uid) => { const u = (db.users || []).find((x) => x.id === uid); return !!u && u.is_active !== false && !u.left_at }
const tuyenCua = (c) => (c.channel || "").trim() || "__chua_co_tuyen"
/** Hệ số về đơn vị cơ sở như heSoQuyDoi: số chụp trên dòng trước, rồi danh mục `product_units`. */
const heSoE2e = (db, pid, unit, chup) => {
  if (Number(chup) > 0) return Number(chup)
  const sp = (db.products || []).find((p) => p.id === pid)
  if (!unit || unit === sp?.base_unit) return 1
  const u = (db.product_units || []).find((x) => x.product_id === pid && x.unit_name === unit)
  return Number(u?.conversion) > 0 ? Number(u.conversion) : 1
}
function banGiaoKhach(p, { db, newId, user }) {
  const toi = (db.users || []).find((u) => u.id === user?.id)
  if (!["owner", "manager"].includes(toi?.role)) throw loiP("KHONG_DU_QUYEN: chỉ Chủ NPP / Quản lý được bàn giao khách")
  if (p.p_kieu === "chuyen" && p.p_nguon !== "nv") throw loiP("CHUYEN_CAN_NV_GIAO: chuyển hẳn chỉ làm được với khách của một nhân viên")
  if (p.p_nguon === "nv" && !p.p_tu_nv) throw loiP("CHON_NV_GIAO: chọn nhân viên giao khách")
  if (p.p_nguon === "nv" && p.p_tu_nv === p.p_den_nv) throw loiP("CUNG_MOT_NV: nhân viên giao và nhân viên nhận là một người")
  const nhan = (db.users || []).find((u) => u.id === p.p_den_nv && u.role === "sales" && nvConLam(db, u.id))
  if (!nhan) throw loiP("NV_NHAN_KHONG_HOP_LE: người nhận phải là nhân viên bán hàng đang làm")
  const tuyen = p.p_tuyen || [], ncc = p.p_ncc || []
  const daLayNcc = (cid) => (db.sales_invoices || []).some((i) => i.customer_id === cid && i.status === "posted"
    && (!p.p_tu_ngay || i.invoice_date >= p.p_tu_ngay)
    && (db.sales_invoice_lines || []).some((l) => l.invoice_id === i.id && !l.is_exchange
      && ncc.includes((db.products || []).find((x) => x.id === l.product_id)?.primary_supplier_id)))
  const khach = (db.customers || []).filter((c) => {
    if (p.p_khach && !p.p_khach.includes(c.id)) return false
    if (tuyen.length && !tuyen.includes(tuyenCua(c))) return false
    if (ncc.length && !daLayNcc(c.id)) return false
    if (p.p_nguon === "nv") return pcCon(db, c.id).some((a) => a.user_id === p.p_tu_nv)
    if (p.p_nguon === "chua_ai") return !pcCon(db, c.id).some((a) => nvConLam(db, a.user_id))
    return true
  }).sort((a, b) => String(a.store_name).localeCompare(String(b.store_name)))
  const tienNo = (ds) => ({ so: ds.length, tien: ds.reduce((t, r) => t + (Number(r.amount) || 0) - (Number(r.paid) || 0), 0) })
  const rows = khach.map((c) => {
    const pc = pcCon(db, c.id)
    const vai_giao = pc.find((a) => a.user_id === p.p_tu_nv)?.role ?? null
    const vai_nhan = pc.find((a) => a.user_id === p.p_den_nv)?.role ?? null
    const coChinh = pc.some((a) => a.role === "primary" && a.user_id !== p.p_den_nv && nvConLam(db, a.user_id))
    const se_la = p.p_kieu === "chuyen"
      ? (vai_giao === "primary" || vai_nhan === "primary" ? "primary" : "secondary")
      : vai_nhan ?? (coChinh ? "secondary" : "primary")
    const no = db.receivables || []
    return {
      id: c.id, store_name: c.store_name, owner_name: c.owner_name ?? null, phone: c.phone ?? null, address: c.address ?? null,
      ward: c.ward ?? null, channel: c.channel ?? null, status: c.status ?? null, vai_giao, vai_nhan, se_la,
      nv_chinh: pc.filter((a) => a.role === "primary").map((a) => (db.users || []).find((u) => u.id === a.user_id)?.full_name).filter(Boolean).join(", ") || null,
      no_chuyen: p.p_kieu === "chuyen" ? tienNo(no.filter((r) => r.customer_id === c.id && r.sales_user_id === p.p_tu_nv && r.status !== "paid")) : null,
      no_npp: p.p_giao_no_npp !== false && se_la === "primary" ? tienNo(no.filter((r) => r.customer_id === c.id && r.ve_npp_luc && r.status !== "paid")) : null,
      lich: p.p_nguon === "nv" && !vai_nhan
        ? [...new Set((db.pjp_routes || []).filter((r) => r.sales_user_id === p.p_tu_nv && r.customer_id === c.id).map((r) => r.day_of_week))].sort()
        : null,
    }
  })
  const cong = (f) => rows.reduce((t, r) => ({ so: t.so + (f(r)?.so ?? 0), tien: t.tien + (f(r)?.tien ?? 0) }), { so: 0, tien: 0 })
  const tong = {
    so_khach: rows.length, them_moi: rows.filter((r) => !r.vai_nhan).length, da_co: rows.filter((r) => r.vai_nhan).length,
    len_chinh: rows.filter((r) => r.se_la === "primary" && r.vai_nhan !== "primary").length,
    no_chuyen: cong((r) => r.no_chuyen), no_npp: cong((r) => r.no_npp),
    lich: rows.reduce((t, r) => t + (r.lich?.length ?? 0), 0),
    bo_qua: p.p_khach ? new Set(p.p_khach).size - rows.length : 0,
  }
  if (!p.p_thuc_hien) return { khach: rows, tong }
  if (rows.length === 0) throw loiP("KHONG_CO_KHACH: không còn khách nào khớp để bàn giao")
  const ds = db.customer_assignments ?? (db.customer_assignments = [])
  for (const r of rows) {
    if (r.vai_nhan === r.se_la) continue
    const co = ds.find((a) => a.customer_id === r.id && a.user_id === p.p_den_nv)
    if (co) Object.assign(co, { role: r.se_la, status: "active" })
    else ds.push({ id: newId(), customer_id: r.id, user_id: p.p_den_nv, role: r.se_la, status: "active", assigned_at: "2026-09-30" })
  }
  const ids = new Set(rows.map((r) => r.id))
  let bo = 0, noSo = 0, noTien = 0, nppSo = 0, nppTien = 0
  if (p.p_kieu === "chuyen") {
    bo = ds.filter((a) => a.user_id === p.p_tu_nv && ids.has(a.customer_id)).length
    db.customer_assignments = ds.filter((a) => !(a.user_id === p.p_tu_nv && ids.has(a.customer_id)))
    for (const r of db.receivables || []) {
      if (!ids.has(r.customer_id) || r.sales_user_id !== p.p_tu_nv || r.status === "paid") continue
      r.giao_tu_nv = (r.giao_tu_nv ?? p.p_tu_nv) === p.p_den_nv ? null : (r.giao_tu_nv ?? p.p_tu_nv)
      r.sales_user_id = p.p_den_nv
      noSo++; noTien += (Number(r.amount) || 0) - (Number(r.paid) || 0)
    }
  }
  if (p.p_giao_no_npp !== false) {
    const chinh = new Set(rows.filter((r) => r.se_la === "primary").map((r) => r.id))
    for (const r of db.receivables || []) {
      if (!chinh.has(r.customer_id) || !r.ve_npp_luc || r.status === "paid") continue
      r.sales_user_id = p.p_den_nv; r.ve_npp_luc = null
      nppSo++; nppTien += (Number(r.amount) || 0) - (Number(r.paid) || 0)
    }
  }
  const log = { id: newId(), org_id: toi.org_id, nguon: p.p_nguon, tu_nv: p.p_nguon === "nv" ? p.p_tu_nv : null, den_nv: p.p_den_nv,
    kieu: p.p_kieu, bo_loc: { tuyen, ncc, tu_ngay: p.p_tu_ngay ?? null }, khach: [...ids], tao_boi: toi.id, tao_luc: new Date().toISOString() }
  const ket = { so_khach: rows.length, them_moi: tong.them_moi, da_co: tong.da_co, len_chinh: tong.len_chinh, bo_khoi_nv_giao: bo,
    lich: tong.lich, no_chuyen: { so: noSo, tien: noTien }, no_npp: { so: nppSo, tien: nppTien }, bo_qua: tong.bo_qua }
  ;(db.ban_giao_khach_log ?? (db.ban_giao_khach_log = [])).push({ ...log, ket_qua: ket })
  return { ...ket, log_id: log.id }
}
function hangKhachDaLay(p, { db, user }) {
  const toi = (db.users || []).find((u) => u.id === user?.id)
  let nv = null
  if (toi?.role === "sales") nv = toi.id
  else if (["owner", "manager", "accountant"].includes(toi?.role)) nv = p.p_nv ?? null
  else throw loiP("KHONG_DU_QUYEN: vai này không xem hàng khách đã lấy")
  const rong = { nv, khach: [], hang: [], sp: [], ncc: [] }
  if (!nv && !p.p_khach) return rong
  const tuyen = p.p_tuyen || []
  const kh = (db.customers || []).filter((c) => (!p.p_khach || p.p_khach.includes(c.id))
    && (!nv || pcCon(db, c.id).some((a) => a.user_id === nv))
    && (!tuyen.length || tuyen.includes(tuyenCua(c))))
    .sort((a, b) => String(a.store_name).localeCompare(String(b.store_name)))
  const nccNv = new Set((db.user_suppliers || []).filter((r) => r.user_id === nv).map((r) => r.supplier_id))
  const sp = (db.products || []).filter((x) => !nv || !x.primary_supplier_id || nccNv.has(x.primary_supplier_id))
  const spId = new Set(sp.map((x) => x.id)), khId = new Set(kh.map((c) => c.id))
  const hang = new Map()
  const lay = (k, pid) => hang.get(`${k}|${pid}`) ?? hang.set(`${k}|${pid}`, { k, p: pid, di: 0, tra: 0, hd: new Set(), cuoi: null }).get(`${k}|${pid}`)
  for (const i of db.sales_invoices || []) {
    if (i.status !== "posted" || !khId.has(i.customer_id) || (p.p_tu && i.invoice_date < p.p_tu)) continue
    for (const l of (db.sales_invoice_lines || []).filter((x) => x.invoice_id === i.id && !x.is_exchange && spId.has(x.product_id))) {
      const h = lay(i.customer_id, l.product_id)
      h.di += (Number(l.quantity) || 0) * heSoE2e(db, l.product_id, l.unit_name, l.conversion_factor)
      h.hd.add(i.id)
      if (!h.cuoi || i.invoice_date > h.cuoi) h.cuoi = i.invoice_date
    }
  }
  for (const r of db.returns || []) {
    if (!r.revenue_date || !khId.has(r.customer_id) || (p.p_tu && r.revenue_date < p.p_tu)) continue
    for (const l of (db.return_lines || []).filter((x) => x.return_id === r.id && !x.is_exchange && spId.has(x.product_id))) {
      lay(r.customer_id, l.product_id).tra += (Number(l.quantity) || 0) * heSoE2e(db, l.product_id, l.unit_name, null)
    }
  }
  const dong = [...hang.values()].map((h) => ({ k: h.k, p: h.p, di: h.di, tra: h.tra, sl: h.di - h.tra, lan: h.hd.size, cuoi: h.cuoi }))
  const coHang = new Set(dong.map((h) => h.p))
  const spRa = sp.filter((x) => coHang.has(x.id)).map((x) => ({ id: x.id, sku: x.sku ?? null, name: x.name, base_unit: x.base_unit, ncc: x.primary_supplier_id ?? null }))
  const nccId = new Set([...spRa.map((x) => x.ncc).filter(Boolean), ...nccNv])
  return {
    nv,
    khach: kh.map((c) => ({
      id: c.id, store_name: c.store_name, owner_name: c.owner_name ?? null, phone: c.phone ?? null, address: c.address ?? null,
      ward: c.ward ?? null, channel: c.channel ?? null, status: c.status ?? null,
      nv_chinh: pcCon(db, c.id).filter((a) => a.role === "primary").map((a) => (db.users || []).find((u) => u.id === a.user_id)?.full_name).filter(Boolean).join(", ") || null,
    })),
    hang: dong,
    sp: spRa,
    ncc: (db.suppliers || []).filter((s) => nccId.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
  }
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

/** Lỗi RPC như Postgres ném: `MÃ: câu` + mã SQLSTATE. */
const loiRpc = (ma, cau, sqlstate = "P0001") => Object.assign(new Error(`${ma}: ${cau}`), { code: sqlstate })
const tenNguoi = (db, id) => (db.users || []).find((x) => x.id === id)?.full_name ?? null
/** Quyền `customers.approve` (mig 244): chủ NPP luôn có; người khác khi được cấp riêng (bảng giả `user_permission_overrides`). */
const duocDuyetAnh = (db, user) => {
  const u = (db.users || []).find((x) => x.id === user?.id)
  const ov = (db.user_permission_overrides || []).find((o) => o.user_id === user?.id && o.permission_key === "customers.approve")
  if (ov) return !!ov.granted
  return u?.role === "owner"
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
  /* Công nợ theo NCC (mig 093 `payables_by_supplier`): gộp các khoản CHƯA TRẢ XONG theo NCC, còn lại = Σ(amount − paid)
     — dòng âm (phiếu trả NCC) trừ vào, không kẹp. Mig 239: `total_returned` = Σ(−amount) của dòng nợ thuộc phiếu trả NCC. */
  payables_by_supplier: (_p, { db }) => {
    const nhom = new Map()
    const noTra = new Set((db.supplier_returns || []).map((x) => x.payable_credit_id).filter(Boolean))
    for (const r of db.payables || []) {
      if (r.status === "paid") continue
      const g = nhom.get(r.supplier_id) ?? { supplier_id: r.supplier_id, invoice_count: 0, total_debt: 0, total_paid: 0, remaining: 0, overdue_count: 0, total_returned: 0 }
      g.invoice_count++
      g.total_debt += Number(r.amount) || 0
      g.total_paid += Number(r.paid) || 0
      g.remaining += (Number(r.amount) || 0) - (Number(r.paid) || 0)
      if (noTra.has(r.id)) g.total_returned -= Number(r.amount) || 0
      if (r.status === "overdue") g.overdue_count++
      nhom.set(r.supplier_id, g)
    }
    return [...nhom.values()].map((g) => {
      const s = (db.suppliers || []).find((x) => x.id === g.supplier_id)
      return { ...g, supplier_name: s?.name ?? "-", supplier_code: s?.code ?? "-" }
    }).sort((a, b) => b.remaining - a.remaining)
  },
  /* Bảng cân đối (mig 243): phải trả / trả trước NCC RÒNG THEO TỪNG NCC (Σ amount − paid trên dòng chưa 'paid'); tiền =
     thu (bỏ cấn trừ) − trả NCC − chi đã trả; phải thu không kẹp dòng âm; tồn kho = Σ tồn × giá vốn. Luật thật chạy ở
     scripts/sql/thu-243-can-doi-tra-truoc-ncc.sql. */
  finance_balance_sheet: (_p, { db }) => {
    const so = (v) => Number(v) || 0
    const rong = new Map()
    for (const r of db.payables || []) {
      if (r.status === "paid") continue
      rong.set(r.supplier_id, (rong.get(r.supplier_id) || 0) + so(r.amount) - so(r.paid))
    }
    const tong = (ds, f) => ds.reduce((s, x) => s + f(x), 0)
    const thu = tong((db.payments || []).filter((t) => !["return_credit", "credit_applied"].includes(t.method)), (t) => so(t.amount))
    return {
      cash: thu - tong(db.payable_payments || [], (t) => so(t.amount)) - tong((db.expenses || []).filter((x) => x.is_paid), (x) => so(x.amount)),
      accounts_receivable: tong((db.receivables || []).filter((r) => r.status !== "paid"), (r) => so(r.amount) - so(r.paid)),
      inventory: tong((db.batches || []).filter((b) => so(b.qty_on_hand) > 0), (b) => so(b.qty_on_hand) * so(b.unit_cost)),
      accounts_payable: tong([...rong.values()], (v) => Math.max(v, 0)),
      unpaid_expenses: tong((db.expenses || []).filter((x) => !x.is_paid), (x) => so(x.amount)),
      supplier_prepayments: tong([...rong.values()], (v) => Math.max(-v, 0)),
    }
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
  /* NCC (mig 232): đếm chứng từ chặn xoá; gộp = chuyển mọi chứng từ / mặt hàng / phân công NV sang NCC giữ lại,
     chép ô hồ sơ còn trống, xoá NCC bị gộp. */
  so_chung_tu_ncc: ({ p_supplier_id }, { db }) => {
    const BANG = [["payables", "supplier_id", "dòng công nợ NCC"], ["products", "primary_supplier_id", "mặt hàng"],
      ["purchase_invoices", "supplier_id", "phiếu nhập"], ["purchase_orders", "supplier_id", "đơn đặt hàng NCC"],
      ["stock_entries", "supplier_id", "phiếu kho"], ["supplier_returns", "supplier_id", "phiếu trả NCC"]]
    if (!(db.suppliers || []).some((s) => s.id === p_supplier_id)) throw Object.assign(new Error("KHONG_TIM_THAY_NCC"), { code: "P0001" })
    const chi_tiet = BANG.map(([bang, cot, nhan]) => ({ bang, cot, nhan, so: (db[bang] || []).filter((r) => r[cot] === p_supplier_id).length }))
      .filter((d) => d.so > 0)
    const no = (db.payables || []).filter((r) => r.supplier_id === p_supplier_id && r.status !== "paid")
    return {
      tong: chi_tiet.reduce((t, d) => t + d.so, 0), chi_tiet,
      nhan_vien: (db.user_suppliers || []).filter((r) => r.supplier_id === p_supplier_id).length,
      so_khoan_no: no.length, con_no: no.reduce((t, r) => t + (Number(r.amount) || 0) - (Number(r.paid) || 0), 0),
    }
  },
  gop_nha_cung_cap: ({ p_tu, p_vao }, { db }) => {
    const tu = (db.suppliers || []).find((s) => s.id === p_tu)
    const vao = (db.suppliers || []).find((s) => s.id === p_vao)
    if (!p_tu || p_tu === p_vao) throw Object.assign(new Error("GOP_NCC_TRUNG: chọn hai nhà cung cấp khác nhau"), { code: "P0001" })
    if (!tu || !vao) throw Object.assign(new Error("KHONG_TIM_THAY_NCC"), { code: "P0001" })
    const da_chuyen = []
    for (const [bang, cot] of [["payables", "supplier_id"], ["products", "primary_supplier_id"], ["purchase_invoices", "supplier_id"],
      ["purchase_orders", "supplier_id"], ["stock_entries", "supplier_id"], ["supplier_returns", "supplier_id"]]) {
      const ds = (db[bang] || []).filter((r) => r[cot] === p_tu)
      for (const r of ds) r[cot] = p_vao
      if (ds.length) da_chuyen.push({ bang, cot, so: ds.length })
    }
    const nv = new Set((db.user_suppliers || []).filter((r) => r.supplier_id === p_vao).map((r) => r.user_id))
    db.user_suppliers = (db.user_suppliers || []).flatMap((r) => r.supplier_id !== p_tu ? [r] : nv.has(r.user_id) ? [] : [{ ...r, supplier_id: p_vao }])
    for (const k of ["contact_name", "phone", "email", "address", "tax_code", "bank_account", "bank_name", "legal_name"]) {
      if (!vao[k] && tu[k]) vao[k] = tu[k]
    }
    db.suppliers = db.suppliers.filter((s) => s.id !== p_tu)
    return { vao: p_vao, tu_ten: tu.name, tu_ma: tu.code, da_chuyen, nhan_vien: 0, da_xoa: true }
  },
  /* Xoá NCC (mig 233): chỉ khi chưa có chứng từ; p_xoa_hang → mặt hàng chưa nằm trong phiếu thì xoá, đã nằm thì Ngừng
     bán + gỡ NCC; không xoá hàng → chỉ gỡ NCC khỏi mặt hàng. */
  xoa_nha_cung_cap: ({ p_id, p_xoa_hang }, { db, user }) => {
    const u = (db.users || []).find((x) => x.id === user?.id)
    if (u?.role !== "owner") throw Object.assign(new Error("KHONG_DU_QUYEN_XOA_NCC: chỉ Chủ NPP được xoá nhà cung cấp"), { code: "P0001" })
    const s = (db.suppliers || []).find((x) => x.id === p_id)
    if (!s) throw Object.assign(new Error("KHONG_TIM_THAY_NCC"), { code: "P0001" })
    const coChungTu = [["payables", "supplier_id"], ["purchase_invoices", "supplier_id"], ["purchase_orders", "supplier_id"],
      ["stock_entries", "supplier_id"], ["supplier_returns", "supplier_id"]].some(([bang, cot]) => (db[bang] || []).some((r) => r[cot] === p_id))
    if (coChungTu) throw Object.assign(new Error(`NCC_CO_CHUNG_TU: không xoá được nhà cung cấp "${s.name}"`), { code: "P0001" })
    const trongPhieu = (pid) => ["sales_order_lines", "sales_invoice_lines", "purchase_invoice_lines", "supplier_return_lines",
      "return_lines", "stock_entry_lines", "purchase_order_lines"].some((b) => (db[b] || []).some((r) => r.product_id === pid))
    let xoa = 0, ngung = 0, go = 0
    const boDi = new Set()
    for (const p of (db.products || []).filter((x) => x.primary_supplier_id === p_id)) {
      if (!p_xoa_hang) { p.primary_supplier_id = null; go++ }
      else if (trongPhieu(p.id)) { p.status = "inactive"; p.primary_supplier_id = null; ngung++ }
      else { boDi.add(p.id); xoa++ }
    }
    db.products = (db.products || []).filter((p) => !boDi.has(p.id))
    db.suppliers = db.suppliers.filter((x) => x.id !== p_id)
    return { ten: s.name, ma: s.code ?? null, mat_hang_da_xoa: xoa, mat_hang_ngung_ban: ngung, mat_hang_go: go }
  },
  /* Tra trùng khách — mig 245 (chủ nhà 15/10/2026: "nhập đúng số điện thoại của khách thì khách mới hiện ra"): CHỈ
     khớp ĐÚNG số (chữ số, "84…" → "0…"; số chưa đủ 10–11 chữ số → không trả gì). `has_my_assignment` / phụ trách
     chính đọc từ `customer_assignments` như hàm thật. */
  search_customer_dupes: ({ p_q }, { db, user }) => {
    const chuan = (x) => { const d = String(x ?? "").replace(/\D/g, ""); return /^84\d{9}$/.test(d) ? "0" + d.slice(2) : d }
    const so = chuan(p_q)
    if (!/^0\d{9,10}$/.test(so)) return []
    const pc = (cid) => (db.customer_assignments || []).filter((a) => a.customer_id === cid && (a.status ?? "active") === "active")
    return (db.customers || [])
      .filter((c) => chuan(c.phone) === so)
      .map((c) => {
        const chinh = pc(c.id).find((a) => a.role === "primary")
        return {
          id: c.id, store_name: c.store_name, owner_name: c.owner_name, phone: c.phone, address: c.address ?? null, ward: c.ward ?? null,
          primary_user_name: chinh ? ((db.users || []).find((u) => u.id === chinh.user_id)?.full_name ?? null) : null,
          has_my_assignment: !!user && pc(c.id).some((a) => a.user_id === user.id),
        }
      })
  },
  /* NVBH nhận khách đã có vào danh sách (mig 083): chỉ vai sales; chưa có phụ trách chính → chính, có rồi → phụ. */
  claim_customer_for_me: ({ p_customer_id }, { db, newId, user }) => {
    /* Vai đọc ở bảng users (e2e đổi vai bằng PATCH users), không ở tài khoản đăng nhập giả. */
    const toi = (db.users || []).find((u) => u.id === user?.id)
    if (toi?.role !== "sales") throw Object.assign(new Error("ONLY_SALES_CAN_CLAIM"), { code: "P0001" })
    const ds = db.customer_assignments ?? (db.customer_assignments = [])
    const cua = ds.filter((a) => a.customer_id === p_customer_id && (a.status ?? "active") === "active")
    const daCo = cua.find((a) => a.user_id === toi.id)
    if (daCo) return { status: "already_assigned", role: daCo.role }
    const role = cua.some((a) => a.role === "primary") ? "secondary" : "primary"
    ds.push({ id: newId(), customer_id: p_customer_id, user_id: toi.id, role, status: "active", org_id: toi.org_id })
    return { status: "claimed", role }
  },
  ban_giao_khach: banGiaoKhach,
  hang_khach_da_lay: hangKhachDaLay,
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
  /* Sửa tại chỗ phiếu nhập đã hoàn thành (mig 235): ghi lại đầu phiếu + dòng; luật kho / công nợ kiểm ở
     scripts/sql/thu-235-sua-phieu-nhap-da-ban.sql. */
  sua_phieu_nhap: ({ p_invoice_id, p_head, p_lines }, { db, newId }) => {
    const inv = (db.purchase_invoices || []).find((x) => x.id === p_invoice_id)
    if (!inv) throw Object.assign(new Error("PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này."), { code: "P0001" })
    if (inv.status !== "completed") throw Object.assign(new Error("PHIEU_CHUA_HOAN_THANH: Chỉ sửa tại chỗ phiếu nhập đã hoàn thành."), { code: "P0001" })
    const sub = (p_lines || []).reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price) - Number(l.line_discount || 0), 0)
    Object.assign(inv, {
      supplier_id: p_head.supplier_id, invoice_number: p_head.invoice_number, invoice_date: p_head.invoice_date,
      warehouse_zone: p_head.warehouse_zone, discount: p_head.discount, notes: p_head.notes, vat_override: p_head.vat_override,
      subtotal: sub, total: Math.max(0, sub + Number(p_head.vat_override || 0) - Number(p_head.discount || 0)),
    })
    db.purchase_invoice_lines = (db.purchase_invoice_lines || []).filter((l) => l.invoice_id !== p_invoice_id)
    ;(p_lines || []).forEach((l, i) => db.purchase_invoice_lines.push({ id: newId(), invoice_id: p_invoice_id, sort_order: i + 1, ...l }))
    return { id: p_invoice_id, total: inv.total }
  },
  /* Bảng giá nhập (mig 234): sửa tay — price null/"" = bỏ giá; vai mua hàng mới được. */
  luu_gia_nhap: ({ p_dong }, { db, user, newId }) => {
    const u = (db.users || []).find((x) => x.id === user?.id)
    if (!["owner", "manager", "accountant", "warehouse"].includes(u?.role))
      throw Object.assign(new Error("KHONG_DU_QUYEN_GIA_NHAP: vai này không sửa được bảng giá nhập"), { code: "P0001" })
    db.purchase_price_lists = db.purchase_price_lists || []
    let luu = 0, bo = 0
    for (const d of p_dong || []) {
      const i = db.purchase_price_lists.findIndex((r) => r.product_id === d.product_id && r.unit_name === d.unit_name)
      if (d.price === null || d.price === "") {
        if (i >= 0) db.purchase_price_lists.splice(i, 1)
        bo++
        continue
      }
      const row = { product_id: d.product_id, unit_name: d.unit_name, price: Math.round(Number(d.price)), effective_date: "2026-09-30", source_invoice_id: null, updated_at: "2026-09-30T03:00:00Z", invoice: null }
      if (i >= 0) db.purchase_price_lists[i] = { ...db.purchase_price_lists[i], ...row }
      else db.purchase_price_lists.push({ id: newId(), org_id: u.org_id, ...row })
      luu++
    }
    return { luu, bo }
  },
  complete_supplier_return: () => null,
  /* Khôi phục phiếu nhập / phiếu trả NCC đã huỷ (mig 241) — chỉ đổi trạng thái như máy chủ trả về; luật kho / công nợ
     kiểm ở scripts/sql/thu-241-khoi-phuc-phieu-ncc.sql. Có phiếu kho = đã hoàn thành / đã gửi trước khi huỷ.
     Phiếu trả mang `e2e_ly_do` = gửi lại không được (kho thiếu) → dừng ở Nháp kèm lý do. */
  khoi_phuc_phieu_nhap: ({ p_invoice_id }, { db }) => {
    const inv = (db.purchase_invoices || []).find((x) => x.id === p_invoice_id)
    if (!inv) throw Object.assign(new Error("PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này."), { code: "P0001" })
    if (inv.status !== "cancelled") return { id: inv.id, trang_thai: inv.status, da_khoi_phuc: false, so_lo: 0 }
    const st = inv.stock_entry_id ? "completed" : "draft"
    Object.assign(inv, { status: st, cancelled_at: null, cancelled_by: null, cancel_reason: null })
    return { id: inv.id, trang_thai: st, da_khoi_phuc: true, so_lo: st === "completed" ? 1 : 0 }
  },
  khoi_phuc_phieu_tra_ncc: ({ p_return_id }, { db }) => {
    const r = (db.supplier_returns || []).find((x) => x.id === p_return_id)
    if (!r) throw Object.assign(new Error("PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này."), { code: "P0001" })
    if (r.status !== "cancelled") return { id: r.id, trang_thai: r.status, da_khoi_phuc: false }
    const st = r.stock_entry_id && !r.e2e_ly_do ? "completed" : "draft"
    Object.assign(r, { status: st, cancel_reason: null })
    return { id: r.id, trang_thai: st, da_khoi_phuc: true, ...(r.stock_entry_id && r.e2e_ly_do ? { ly_do: r.e2e_ly_do } : {}) }
  },
  /* Phiếu chi trả NCC (mig 242): mã PCNCC- theo NPP; tiền chia vào các khoản nợ CÒN PHẢI TRẢ của NCC — nợ đầu kỳ trước,
     rồi khoản ghi nợ trước; dư thành dòng trả trước của chính phiếu. Luật thật (khoá, trigger khoản nợ mới, huỷ phiếu
     nhập…) chạy ở scripts/sql/thu-242-phieu-chi-tra-ncc.sql — đây chỉ đủ để màn hình thấy kết quả. Dòng phần tiền mang
     sẵn `payable` (máy giả không nhúng bảng). */
  chi_tra_ncc: ({ p_supplier_id, p_amount, p_paid_date, p_method, p_notes, p_reference }, { db, newId, user }) => {
    const u = (db.users || []).find((x) => x.id === user?.id)
    if (!["owner", "accountant"].includes(u?.role)) throw Object.assign(new Error("FORBIDDEN: chỉ chủ NPP hoặc kế toán được lập phiếu chi trả NCC."), { code: "42501" })
    const s = (db.suppliers || []).find((x) => x.id === p_supplier_id)
    if (!s) throw Object.assign(new Error("NCC_KHONG_HOP_LE: Nhà cung cấp không thuộc đơn vị của bạn."), { code: "P0001" })
    const tien = Number(p_amount)
    if (!(tien > 0)) throw Object.assign(new Error("BAD_AMOUNT: Số tiền chi phải lớn hơn 0."), { code: "P0001" })
    for (const b of ["supplier_payments", "payable_payments", "payables"]) db[b] = db[b] || []
    const seq = db.supplier_payments.length + 1
    const code = `PCNCC-${String(seq).padStart(4, "0")}`
    const id = newId()
    const luc = `${p_paid_date}T05:00:00Z`
    const phan = (p, t) => db.payable_payments.push({
      id: newId(), payable_id: p.id, amount: t, method: p_method, paid_at: luc, paid_by: user?.id ?? null,
      notes: `Phiếu chi ${code}${p_notes ? ` — ${p_notes}` : ""}`, supplier_payment_id: id, verified_at: null,
      payable: { id: p.id, invoice_number: p.invoice_number ?? null, opening_balance: !!p.opening_balance, created_at: p.created_at },
    })
    const no = db.payables
      .filter((p) => p.supplier_id === p_supplier_id && Number(p.amount) - Number(p.paid || 0) > 0)
      .sort((a, b) => Number(!!b.opening_balance) - Number(!!a.opening_balance) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    let con = tien
    let soKhoan = 0
    for (const p of no) {
      if (con <= 0) break
      const t = Math.min(con, Number(p.amount) - Number(p.paid || 0))
      p.paid = Number(p.paid || 0) + t
      p.status = p.paid >= Number(p.amount) ? "paid" : "partial"
      phan(p, t)
      con -= t
      soKhoan++
    }
    let truoc = null
    if (con > 0) {
      truoc = {
        id: newId(), org_id: ORG, supplier_id: p_supplier_id, invoice_number: code, amount: 0, paid: con, status: "open",
        opening_balance: false, due_date: null, notes: `Trả trước NCC — phiếu chi ${code}`, created_at: luc, supplier: { name: s.name, code: s.code },
      }
      db.payables.push(truoc)
      phan(truoc, con)
    }
    db.supplier_payments.push({
      id, org_id: ORG, seq, code, supplier_id: p_supplier_id, paid_date: p_paid_date, amount: tien, method: p_method,
      reference_code: p_reference ?? null, notes: p_notes ?? null, status: "posted", prepay_payable_id: truoc?.id ?? null,
      created_by: user?.id ?? null, created_at: new Date().toISOString(), cancelled_at: null, cancel_reason: null,
      supplier: { name: s.name, code: s.code },
    })
    return { id, code, so_tien: tien, da_tru_no: tien - con, tra_truoc: con, so_khoan: soKhoan }
  },
  huy_phieu_chi_ncc: ({ p_id, p_reason }, { db, user }) => {
    const sp = (db.supplier_payments || []).find((x) => x.id === p_id)
    if (!sp) throw Object.assign(new Error("PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu chi này."), { code: "P0001" })
    const u = (db.users || []).find((x) => x.id === user?.id)
    if (!["owner", "accountant"].includes(u?.role)) throw Object.assign(new Error("FORBIDDEN: chỉ chủ NPP hoặc kế toán được huỷ phiếu chi trả NCC."), { code: "42501" })
    if (sp.status === "cancelled") return { id: p_id, code: sp.code, da_huy: false, so_tien_go: 0 }
    let go = 0
    for (const pp of (db.payable_payments || []).filter((x) => x.supplier_payment_id === p_id)) {
      const p = (db.payables || []).find((x) => x.id === pp.payable_id)
      if (p) {
        p.paid = Number(p.paid || 0) - pp.amount
        p.status = p.paid <= 0 ? "open" : p.paid >= Number(p.amount) ? "paid" : "partial"
      }
      go += pp.amount
    }
    db.payable_payments = (db.payable_payments || []).filter((x) => x.supplier_payment_id !== p_id)
    if (sp.prepay_payable_id) db.payables = (db.payables || []).filter((x) => x.id !== sp.prepay_payable_id)
    Object.assign(sp, { status: "cancelled", cancelled_at: "2026-09-30T04:00:00Z", cancelled_by: user?.id ?? null, cancel_reason: p_reason ?? null, prepay_payable_id: null })
    return { id: p_id, code: sp.code, da_huy: true, so_tien_go: go }
  },
  /* ── Duyệt ảnh + vị trí điểm bán (mig 244) — rút gọn đúng các luật màn cần: quyền duyệt (chủ NPP / được cấp riêng),
     đã duyệt mới gửi yêu cầu, yêu cầu mới thay yêu cầu cũ cùng ô / cùng vị trí, duyệt áp vào ảnh / toạ độ, ảnh gốc đã
     đổi thì tự huỷ, từ chối bỏ; trả `file_bo` (URL ảnh không còn dùng) như hàm thật. ── */
  duyet_anh_diem_ban: ({ p_customer_id, p_duyet }, { db, user }) => {
    if (!duocDuyetAnh(db, user)) throw loiRpc("FORBIDDEN", "chỉ chủ NPP (hoặc người được cấp quyền Duyệt khách hàng) được duyệt ảnh điểm bán.", "42501")
    const c = (db.customers || []).find((x) => x.id === p_customer_id)
    if (!c) throw loiRpc("KHACH_KHONG_HOP_LE", "Điểm bán không thuộc đơn vị của bạn.")
    if (p_duyet !== false) {
      if (c.gps_lat == null && !(db.customer_photos || []).some((p) => p.customer_id === c.id)) {
        throw loiRpc("CHUA_CO_GI_DE_DUYET", "Điểm bán chưa có ảnh hay vị trí để duyệt.")
      }
      Object.assign(c, { photo_approved_at: "2026-09-30T04:00:00Z", photo_approved_by: user.id, approver: { full_name: tenNguoi(db, user.id) } })
      return { duyet: true, file_bo: [] }
    }
    const bo = (db.customer_photo_requests || []).filter((r) => r.customer_id === c.id && r.status === "pending")
    for (const r of bo) Object.assign(r, { status: "cancelled", decided_by: user.id, decision_note: "Bỏ duyệt — nhân viên sửa thẳng được" })
    Object.assign(c, { photo_approved_at: null, photo_approved_by: null, approver: null })
    return { duyet: false, file_bo: bo.map((r) => r.photo_url).filter(Boolean) }
  },
  xin_doi_anh_diem_ban: (a, { db, newId, user }) => {
    const u = (db.users || []).find((x) => x.id === user?.id)
    if (!["owner", "manager", "sales"].includes(u?.role)) throw loiRpc("FORBIDDEN", "vai trò của bạn không được sửa ảnh điểm bán.", "42501")
    const c = (db.customers || []).find((x) => x.id === a.p_customer_id)
    if (!c) throw loiRpc("KHACH_KHONG_HOP_LE", "Điểm bán không thuộc đơn vị của bạn.")
    if (!c.photo_approved_at) throw loiRpc("CHUA_DUYET", "Ảnh điểm bán chưa được duyệt — sửa thẳng được, không cần gửi yêu cầu.")
    const anh = a.p_photo_action ?? "none"
    const vt = a.p_pin_action ?? "keep"
    if (anh === "none" && vt === "keep") throw loiRpc("YEU_CAU_RONG", "Không có gì để đổi.")
    const photos = db.customer_photos || []
    let slot = null
    let photoId = null
    if (anh === "replace" || anh === "delete") {
      const p = photos.find((x) => x.id === a.p_photo_id && x.customer_id === c.id)
      if (!p) throw loiRpc("ANH_KHONG_TON_TAI", "Ảnh này không còn — tải lại trang.")
      slot = p.slot
      photoId = p.id
    } else if (anh === "add") {
      slot = a.p_slot
      if (photos.some((x) => x.customer_id === c.id && x.slot === slot)) throw loiRpc("O_DA_CO_ANH", `Ô ảnh ${slot} đã có ảnh — dùng Chụp lại.`)
    }
    if ((anh === "add" || anh === "replace") && !String(a.p_photo_url || "").includes(`/customer-photos/${c.org_id}/${c.id}/`)) {
      throw loiRpc("FILE_SAI", "Ảnh mới không nằm trong kho ảnh của điểm bán này.")
    }
    db.customer_photo_requests = db.customer_photo_requests || []
    const bo = db.customer_photo_requests.filter((r) => r.customer_id === c.id && r.status === "pending"
      && ((anh !== "none" && r.kind.startsWith("photo_") && r.slot === slot) || (vt !== "keep" && r.kind.startsWith("pin_"))))
    for (const r of bo) Object.assign(r, { status: "cancelled", decided_by: user.id, decision_note: "Thay bằng yêu cầu mới" })
    const goc = {
      org_id: c.org_id, customer_id: c.id, status: "pending", requested_by: user.id, requested_at: new Date().toISOString(),
      requester: { full_name: tenNguoi(db, user.id) }, photo_id: null, slot: null, photo_url: null, taken_at: null,
      gps_lat: null, gps_lng: null, gps_accuracy: null, pin_lat: null, pin_lng: null,
    }
    const ids = []
    if (anh !== "none") {
      const id = newId()
      const moi = anh !== "delete"
      db.customer_photo_requests.push({ ...goc, id, kind: `photo_${anh}`, photo_id: photoId, slot,
        photo_url: moi ? a.p_photo_url : null, taken_at: moi ? a.p_taken_at : null,
        gps_lat: moi ? a.p_gps_lat : null, gps_lng: moi ? a.p_gps_lng : null, gps_accuracy: moi ? a.p_gps_accuracy : null })
      ids.push(id)
    }
    if (vt !== "keep") {
      const id = newId()
      db.customer_photo_requests.push({ ...goc, id, kind: `pin_${vt}`,
        pin_lat: vt === "set" ? a.p_pin_lat : null, pin_lng: vt === "set" ? a.p_pin_lng : null })
      ids.push(id)
    }
    return { ids, file_bo: bo.map((r) => r.photo_url).filter(Boolean) }
  },
  duyet_yeu_cau_anh_diem_ban: ({ p_request_ids, p_dong_y, p_ghi_chu }, { db, newId, user }) => {
    if (!duocDuyetAnh(db, user)) throw loiRpc("FORBIDDEN", "chỉ chủ NPP (hoặc người được cấp quyền Duyệt khách hàng) được duyệt ảnh điểm bán.", "42501")
    const ds = (db.customer_photo_requests || []).filter((r) => (p_request_ids || []).includes(r.id))
    if (ds.length !== new Set(p_request_ids || []).size) throw loiRpc("YEU_CAU_KHONG_TON_TAI", "Có yêu cầu không còn — tải lại trang.")
    let xong = 0
    let boQua = 0
    const fileBo = []
    db.customer_photos = db.customer_photos || []
    for (const r of ds) {
      if (r.status !== "pending") throw loiRpc("DA_XU_LY", "Yêu cầu đã được xử lý rồi — tải lại trang.")
      if (!p_dong_y) {
        Object.assign(r, { status: "rejected", decided_by: user.id, decision_note: p_ghi_chu ?? null })
        if (r.photo_url) fileBo.push(r.photo_url)
        xong++
        continue
      }
      const c = (db.customers || []).find((x) => x.id === r.customer_id)
      let loiThoi = false
      if (r.kind === "photo_add") {
        if (db.customer_photos.some((p) => p.customer_id === r.customer_id && p.slot === r.slot)) loiThoi = true
        else db.customer_photos.push({ id: newId(), org_id: r.org_id, customer_id: r.customer_id, slot: r.slot, photo_url: r.photo_url,
          taken_at: r.taken_at, gps_lat: r.gps_lat, gps_lng: r.gps_lng, gps_accuracy: r.gps_accuracy, uploaded_by: r.requested_by })
      } else if (r.kind === "photo_replace" || r.kind === "photo_delete") {
        const p = db.customer_photos.find((x) => x.id === r.photo_id)
        if (!p) loiThoi = true
        else {
          fileBo.push(p.photo_url)
          if (r.kind === "photo_replace") Object.assign(p, { photo_url: r.photo_url, taken_at: r.taken_at, gps_lat: r.gps_lat, gps_lng: r.gps_lng, gps_accuracy: r.gps_accuracy, uploaded_by: r.requested_by })
          else db.customer_photos = db.customer_photos.filter((x) => x.id !== p.id)
        }
      } else if (r.kind === "pin_set") Object.assign(c, { gps_lat: r.pin_lat, gps_lng: r.pin_lng })
      else Object.assign(c, { gps_lat: null, gps_lng: null })
      if (loiThoi) {
        Object.assign(r, { status: "cancelled", decided_by: user.id, decision_note: "Ảnh gốc đã đổi — yêu cầu không còn áp được" })
        if (r.photo_url) fileBo.push(r.photo_url)
        boQua++
      } else {
        Object.assign(r, { status: "approved", decided_by: user.id, decision_note: p_ghi_chu ?? null })
        Object.assign(c, { photo_approved_at: "2026-09-30T04:00:00Z", photo_approved_by: user.id, approver: { full_name: tenNguoi(db, user.id) } })
        xong++
      }
    }
    return { xong, bo_qua: boQua, file_bo: fileBo }
  },
  huy_yeu_cau_anh_diem_ban: ({ p_request_id }, { db, user }) => {
    const r = (db.customer_photo_requests || []).find((x) => x.id === p_request_id)
    if (!r) throw loiRpc("YEU_CAU_KHONG_TON_TAI", "Không tìm thấy yêu cầu này.")
    if (r.requested_by !== user?.id && !duocDuyetAnh(db, user)) throw loiRpc("FORBIDDEN", "chỉ người gửi hoặc người duyệt được rút yêu cầu.", "42501")
    if (r.status !== "pending") throw loiRpc("DA_XU_LY", "Yêu cầu đã được xử lý rồi — tải lại trang.")
    Object.assign(r, { status: "cancelled", decided_by: user.id, decision_note: r.requested_by === user.id ? "Người gửi rút yêu cầu" : "Người duyệt bỏ yêu cầu" })
    return { file_bo: r.photo_url ? [r.photo_url] : [] }
  },
  /* Huỷ hóa đơn (mig 217) — máy chủ huỷ luôn đơn, trả trạng thái đơn 'cancelled'. */
  cancel_invoice: () => [{ import_entry_id: null, order_status: "cancelled" }],
  reissue_invoice: () => [{ invoice_id: "00000000-0000-4000-8000-00000000f003", invoice_code: "HD-E2E-1-1", entry_id: null, receivable_id: null, short_qty: 0, near_expiry_skipped: 0, order_status: "completed" }],
}
