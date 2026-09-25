/**
 * "HÀNG BÁN THEO NHÂN VIÊN" (Báo cáo > Nhân viên) — phần cộng dồn thuần.
 *
 * ⚠ CHỦ NHÀ 24/09/2026 (SP001945 "Bánh lễ đậu xanh 100g (10h/khay x 6
 *   khay/th)"): SL bán 64 "hộp", niêm yết 844.800đ, doanh thu 8.640.000đ.
 *   64 là KHAY, 13.200đ là giá một HỘP → niêm yết hụt 10 lần, chênh lệch
 *   phồng. Luật (`./units`):
 *     - SL cộng dồn / hiện cạnh `base_unit` → quy về đơn vị cơ sở.
 *     - Niêm yết = SL dòng × giá niêm yết CỦA ĐÚNG ĐƠN VỊ DÒNG.
 *   SL của nhân viên gộp nhiều mặt hàng → `qtyTheoDv` (theo từng đơn vị cơ
 *   sở, `./sl-theo-don-vi`); `qty` chỉ để sắp xếp, KHÔNG hiện.
 */
import { giaNiemYetDonVi, heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "./units"
import { congSL, type SLTheoDonVi } from "./sl-theo-don-vi"

export type SanPhamHangBan = SanPhamQuyDoi & { id: string; sku: string; name: string }

export interface DongBanHangBan {
  product_id: string
  unit_name: string
  /** Hệ số chụp trên dòng hóa đơn — ưu tiên hơn danh mục. */
  conversion_factor?: number | null
  quantity: number
  unit_price?: number | null
  line_total: number
}

export interface DongTraHangBan {
  product_id: string
  unit_name?: string | null
  quantity: number
  line_total: number
}

export interface HangBanSanPham {
  productId: string
  sku: string
  name: string
  /** Luôn là đơn vị cơ sở — SL bên cạnh đã quy đổi. */
  unit: string
  qty: number
  /** Một khoá (`unit`) — cùng số với `qty`. */
  qtyTheoDv: SLTheoDonVi
  listed: number
  revenue: number
  diff: number
  returnQty: number
  returnQtyTheoDv: SLTheoDonVi
  returnValue: number
  netRevenue: number
}

export interface HangBanNhanVien {
  id: string
  /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  listed: number
  revenue: number
  diff: number
  /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `returnQtyTheoDv`. */
  returnQty: number
  returnQtyTheoDv: SLTheoDonVi
  returnValue: number
  netRevenue: number
  products: HangBanSanPham[]
}

/**
 * Giá trị niêm yết của MỘT dòng hóa đơn = SL dòng × giá niêm yết của đơn vị dòng.
 * Mặt hàng chưa có giá niêm yết nào thì lấy đơn giá trên dòng (cùng đơn vị) —
 * chênh lệch 0 thay vì "chênh" cả doanh thu.
 */
export function giaTriNiemYetDong(l: DongBanHangBan, sp: SanPhamQuyDoi | null | undefined): number {
  const heSo = heSoQuyDoi(sp, l.unit_name, l.conversion_factor)
  const gia = giaNiemYetDonVi(sp, l.unit_name, heSo)
  const donGia = gia > 0 ? gia : Number(l.unit_price || 0)
  return (Number(l.quantity) || 0) * donGia
}

/**
 * Cộng dòng bán + dòng trả theo nhân viên → mặt hàng.
 * Dòng có mặt hàng không nằm trong `sanPham` (bị lọc / không đọc được) bị bỏ ở phía bán,
 * như bản cũ; phía trả vẫn cộng (tên "—").
 */
export function congHangBanNhanVien(input: {
  ban: ReadonlyArray<{ uid: string; line: DongBanHangBan }>
  tra: ReadonlyArray<{ uid: string; line: DongTraHangBan }>
  sanPham: ReadonlyMap<string, SanPhamHangBan>
}): HangBanNhanVien[] {
  const m = new Map<string, HangBanNhanVien & { _sp: Map<string, HangBanSanPham> }>()
  const dong = (uid: string) => {
    let r = m.get(uid)
    if (!r) {
      r = {
        id: uid, qty: 0, qtyTheoDv: {}, listed: 0, revenue: 0, diff: 0,
        returnQty: 0, returnQtyTheoDv: {}, returnValue: 0, netRevenue: 0, products: [], _sp: new Map(),
      }
      m.set(uid, r)
    }
    return r
  }
  const matHang = (r: ReturnType<typeof dong>, pid: string) => {
    let p = r._sp.get(pid)
    if (!p) {
      const sp = input.sanPham.get(pid)
      p = {
        productId: pid,
        sku: sp?.sku || "—",
        name: sp?.name || "—",
        unit: sp?.base_unit || "",
        qty: 0, qtyTheoDv: {}, listed: 0, revenue: 0, diff: 0,
        returnQty: 0, returnQtyTheoDv: {}, returnValue: 0, netRevenue: 0,
      }
      r._sp.set(pid, p)
      r.products.push(p)
    }
    return p
  }

  for (const { uid, line } of input.ban) {
    const sp = input.sanPham.get(line.product_id)
    if (!sp) continue
    // SL quy về đơn vị cơ sở; niêm yết theo đơn vị dòng.
    const qty = soLuongCoSo(line.quantity, heSoQuyDoi(sp, line.unit_name, line.conversion_factor))
    const listed = giaTriNiemYetDong(line, sp)
    const revenue = Number(line.line_total || 0)
    const r = dong(uid)
    r.qty += qty
    congSL(r.qtyTheoDv, sp.base_unit, qty)
    r.listed += listed
    r.revenue += revenue
    const p = matHang(r, line.product_id)
    p.qty += qty
    congSL(p.qtyTheoDv, p.unit, qty)
    p.listed += listed
    p.revenue += revenue
  }

  for (const { uid, line } of input.tra) {
    const sp = input.sanPham.get(line.product_id)
    // Dòng trả không có hệ số chụp → tra danh mục.
    const qty = soLuongCoSo(line.quantity, heSoQuyDoi(sp, line.unit_name || ""))
    const value = Number(line.line_total || 0)
    const r = dong(uid)
    r.returnQty += qty
    congSL(r.returnQtyTheoDv, sp?.base_unit, qty)
    r.returnValue += value
    const p = matHang(r, line.product_id)
    p.returnQty += qty
    congSL(p.returnQtyTheoDv, p.unit, qty)
    p.returnValue += value
  }

  const out: HangBanNhanVien[] = []
  for (const r of Array.from(m.values())) {
    r.diff = r.revenue - r.listed
    r.netRevenue = r.revenue - r.returnValue
    for (const p of r.products) {
      p.diff = p.revenue - p.listed
      p.netRevenue = p.revenue - p.returnValue
    }
    r.products.sort((a, b) => b.revenue - a.revenue)
    const { _sp, ...rest } = r
    void _sp
    out.push(rest)
  }
  return out.sort((a, b) => b.revenue - a.revenue)
}

/* =====================================================================
 * DOANH SỐ THUẦN / LÃI GỘP THUẦN — dùng chung cho `reports/sales` và
 * `reports/employees`.
 *
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 192): "Rà soát lại toàn bộ doanh số tính bằng
 *   số đi - số trả". Doanh thu = hóa đơn đã ghi sổ − hàng trả trừ trong kỳ
 *   (`fetchReturnsRowsDu`, cùng luật công nợ); giá vốn = giá vốn xuất − giá
 *   vốn hàng trả ĐÃ NHẬP LẠI KHO (`fetchReturnCosts`). Trừ doanh thu mà
 *   không trừ giá vốn là lãi bị hạ oan; trừ giá vốn mà không trừ doanh thu
 *   là lãi phồng.
 * ===================================================================== */

export interface PhieuTraQuyNv {
  id: string
  customer_id: string
  sales_user_id: string | null
  invoice_id?: string | null
}
export interface HoaDonQuyNv {
  id: string
  customer_id: string
  sales_user_id: string
  invoice_date: string
}

/**
 * Nhân viên MỘT phiếu trả tính cho — một luật cho mọi bảng của cả hai màn:
 *   1. `returns.sales_user_id` (mig 160) — phiếu có ghi tên thì đọc tên;
 *   2. nhân viên của hóa đơn phiếu gắn (`invoice_id`);
 *   3. phiếu cũ chưa gán, không gắn HĐ (hoặc HĐ ngoài kỳ): nhân viên của hóa
 *      đơn GẦN NHẤT của cùng khách trong kỳ — đường đoán cũ, giữ để phiếu
 *      trước mig 160 không rơi khỏi sổ.
 * Không đoán được → không có trong Map (nơi gọi quyết định bỏ hay gom "Chưa gán").
 *
 * ⚠ HAI BẢNG LỆCH LUẬT LÀ HAI CON SỐ TRẢ HÀNG KHÁC NHAU TRÊN CÙNG MỘT TRANG.
 */
export function nhanVienPhieuTra(
  phieuTra: ReadonlyArray<PhieuTraQuyNv>,
  hoaDon: ReadonlyArray<HoaDonQuyNv>
): Map<string, string> {
  const nvHoaDon = new Map<string, string>()
  const ganNhatCuaKhach = new Map<string, HoaDonQuyNv>()
  for (const o of hoaDon) {
    if (o.sales_user_id) nvHoaDon.set(o.id, o.sales_user_id)
    const cu = ganNhatCuaKhach.get(o.customer_id)
    if (!cu || o.invoice_date > cu.invoice_date) ganNhatCuaKhach.set(o.customer_id, o)
  }
  const out = new Map<string, string>()
  for (const r of phieuTra) {
    const uid =
      r.sales_user_id ||
      (r.invoice_id ? nvHoaDon.get(r.invoice_id) : undefined) ||
      ganNhatCuaKhach.get(r.customer_id)?.sales_user_id
    if (uid) out.set(r.id, uid)
  }
  return out
}

/** Giá vốn hàng trả đã nhập lại kho của một phiếu (lọc mặt hàng nếu có). */
export function giaVonTraCuaPhieu(
  gv: { total: number; byProduct: ReadonlyMap<string, number> } | undefined,
  matHangQua?: (productId: string) => boolean
): number {
  if (!gv) return 0
  if (!matHangQua) return gv.total
  let s = 0
  gv.byProduct.forEach((v, pid) => {
    if (matHangQua(pid)) s += v
  })
  return s
}

export interface LoiNhuanNhanVien {
  /** "" = phiếu trả không quy được về ai (nơi gọi quyết định bỏ hay hiện "Chưa gán"). */
  id: string
  orders: number
  /** Tiền hóa đơn đã ghi sổ (hàng đi). */
  grossRevenue: number
  /** Hàng trả trừ doanh số (`credit_note_amount`). */
  returnValue: number
  /** DOANH THU THUẦN = hàng đi − hàng trả. */
  revenue: number
  grossCogs: number
  /** Giá vốn hàng trả đã nhập lại kho. */
  returnCost: number
  /** GIÁ VỐN THUẦN = giá vốn xuất − giá vốn hàng trả. */
  cogs: number
  profit: number
}

/**
 * Lãi gộp THUẦN theo nhân viên. `hoaDon` / `phieuTra` đã lọc sẵn theo bộ lọc
 * của màn; `giaVonHoaDon(id)` là giá vốn các dòng đã lọc của hóa đơn.
 */
export function congLoiNhuanNhanVien(input: {
  hoaDon: ReadonlyArray<{ id: string; sales_user_id: string; total: number | null }>
  giaVonHoaDon: (invoiceId: string) => number
  phieuTra: ReadonlyArray<{ id: string; credit_note_amount: number | null }>
  nvPhieuTra: ReadonlyMap<string, string>
  giaVonTra: ReadonlyMap<string, { total: number; byProduct: ReadonlyMap<string, number> }>
  /** Lọc mặt hàng phía giá vốn — cùng bộ lọc với dòng hóa đơn. */
  matHangQua?: (productId: string) => boolean
}): LoiNhuanNhanVien[] {
  const m = new Map<string, LoiNhuanNhanVien>()
  const dong = (uid: string) => {
    let r = m.get(uid)
    if (!r) {
      r = { id: uid, orders: 0, grossRevenue: 0, returnValue: 0, revenue: 0, grossCogs: 0, returnCost: 0, cogs: 0, profit: 0 }
      m.set(uid, r)
    }
    return r
  }
  for (const o of input.hoaDon) {
    const r = dong(o.sales_user_id)
    r.orders += 1
    r.grossRevenue += Number(o.total || 0)
    r.grossCogs += input.giaVonHoaDon(o.id)
  }
  for (const t of input.phieuTra) {
    const r = dong(input.nvPhieuTra.get(t.id) ?? "")
    r.returnValue += Number(t.credit_note_amount || 0)
    r.returnCost += giaVonTraCuaPhieu(input.giaVonTra.get(t.id), input.matHangQua)
  }
  return Array.from(m.values()).map((r) => {
    const revenue = r.grossRevenue - r.returnValue
    const cogs = r.grossCogs - r.returnCost
    return { ...r, revenue, cogs, profit: revenue - cogs }
  })
}

export interface LoiNhuanNgay {
  date: string
  label: string
  grossRevenue: number
  returnValue: number
  /** DOANH THU THUẦN của ngày. */
  revenue: number
  grossCogs: number
  returnCost: number
  /** GIÁ VỐN THUẦN của ngày. */
  cogs: number
  profit: number
  margin: number
}

/**
 * Lãi gộp THUẦN theo ngày. Hóa đơn theo `invoice_date`, hàng trả theo ngày trừ
 * doanh số (`created_at` của `fetchReturnsRowsDu` = `revenue_date`), giá vốn xuất
 * / giá vốn hàng trả theo ngày nơi gọi đã xếp (giờ VN).
 */
export function congLoiNhuanTheoNgay(input: {
  hoaDon: ReadonlyArray<{ invoice_date: string; total: number | null }>
  phieuTra: ReadonlyArray<{ created_at: string; credit_note_amount: number | null }>
  giaVonXuat: ReadonlyArray<{ ngay: string; giaVon: number }>
  giaVonTra: ReadonlyArray<{ ngay: string; giaVon: number }>
}): LoiNhuanNgay[] {
  const m = new Map<string, LoiNhuanNgay>()
  const ngay = (raw: string) => {
    const d = String(raw).slice(0, 10)
    let e = m.get(d)
    if (!e) {
      const dd = d.split("-")
      e = {
        date: d, label: `${dd[2]}/${dd[1]}/${dd[0]}`,
        grossRevenue: 0, returnValue: 0, revenue: 0, grossCogs: 0, returnCost: 0, cogs: 0, profit: 0, margin: 0,
      }
      m.set(d, e)
    }
    return e
  }
  for (const o of input.hoaDon) ngay(o.invoice_date).grossRevenue += Number(o.total || 0)
  for (const r of input.phieuTra) ngay(r.created_at).returnValue += Number(r.credit_note_amount || 0)
  for (const x of input.giaVonXuat) ngay(x.ngay).grossCogs += x.giaVon
  for (const x of input.giaVonTra) ngay(x.ngay).returnCost += x.giaVon
  return Array.from(m.values())
    .map((e) => {
      const revenue = e.grossRevenue - e.returnValue
      const cogs = e.grossCogs - e.returnCost
      const profit = revenue - cogs
      return { ...e, revenue, cogs, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
