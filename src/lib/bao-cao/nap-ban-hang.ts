/**
 * NẠP SỐ BÁN của Báo cáo tổng hợp → `DongBan[]`.
 *
 * Luật (CLAUDE.md "Doanh thu tính theo HOÁ ĐƠN", "Doanh số THUẦN = hàng đi − hàng trả"):
 * - Bán = hoá đơn `status = 'posted'` theo `invoice_date` (`fetchRevenueInvoicesDu`).
 * - Trả = phiếu trả theo `returns.revenue_date`, tiền `credit_note_amount`, hàng đổi không tính
 *   (`fetchReturnsRowsDu`, `fetchReturnLines`).
 * - Giá vốn bán = SL cơ sở × giá vốn bình quân cơ sở của phiếu xuất trong kỳ (như báo cáo Nhân
 *   viên); giá vốn trả = giá vốn hàng trả đã nhập lại kho (`fetchReturnCosts`).
 * - Nhân viên của phiếu trả: `nhanVienPhieuTra` — một luật với báo cáo Nhân viên.
 *
 * ⚠ PHÂN BỔ TIỀN DÒNG. `line_total` là tiền hàng TRƯỚC giảm giá cả đơn và TRƯỚC thuế; doanh
 *   thu là `sales_invoices.total`. Mỗi dòng nhận phần của nó theo tỉ lệ `line_total`, để Σ theo
 *   mặt hàng = Σ theo khách = doanh thu của kỳ. Không phân bổ thì bảng "theo mặt hàng" lệch
 *   thẻ "Doanh thu thuần" đúng bằng giảm giá + VAT, và người xem không biết tin số nào.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  fetchRevenueInvoicesDu, fetchInvoiceLines, fetchReturnsRowsDu, fetchReturnLines, fetchReturnCosts, fetchCogsForRange,
  giaVonBinhQuanCoSo, soLuongCoSoDongHd, soLuongCoSoDongTra, giamGiaHoaDon,
  type RevenueInvoiceRow, type InvoiceLineRow, type ReturnSummaryRow, type ReturnLineRow,
} from "@/lib/analytics/sales"
import { nhanVienPhieuTra } from "@/lib/analytics/hang-ban-nhan-vien"
import { chenhDong } from "@/lib/analytics/chenh-lech"
import { docTheoLoId } from "@/lib/supabase/aggregate"
import { docMaPhieuTra } from "@/lib/returns/ma-phieu"
import type { DanhMucBC, DanhMucVao, DongBan } from "./cong"
import { goiMotLuot } from "./mot-luot"
import { nhanLyDoTra } from "@/lib/constants"
import { quyDoiTuDanhMuc } from "./nap-danh-muc"

export interface HoaDonBC {
  id: string
  ma: string
  ngay: string
  kh: string
  nv: string
  tong: number
  giam: number
  nguoiLap: string
}

export interface PhieuTraBC {
  id: string
  ma: string
  ngay: string
  kh: string
  nv: string
  tien: number
  lyDo: string
  /** "Tự sinh" (theo hoá đơn) · "Tự lập". */
  loai: string
  hd: string | null
}

export interface SoBan {
  dong: DongBan[]
  hoaDon: Map<string, HoaDonBC>
  phieuTra: PhieuTraBC[]
  thieu: boolean
}

type TraCoMa = ReturnSummaryRow & { ma?: string; lyDo?: string; tuSinh?: boolean }

/** Phần thuần (không mạng) — test được. */
export function dungDongBan(p: {
  hoaDon: readonly RevenueInvoiceRow[]
  dongHd: readonly InvoiceLineRow[]
  tra: readonly TraCoMa[]
  dongTra: readonly ReturnLineRow[]
  giaVonCoSo: ReadonlyMap<string, number>
  giaVonTra: ReadonlyMap<string, { total: number; byProduct: ReadonlyMap<string, number> }>
  nvTra: ReadonlyMap<string, string>
  dm: DanhMucBC
}): { dong: DongBan[]; hoaDon: Map<string, HoaDonBC>; phieuTra: PhieuTraBC[] } {
  const { dm } = p
  const dong: DongBan[] = []
  const theoHd = new Map<string, InvoiceLineRow[]>()
  for (const l of p.dongHd) {
    // ⚠ Dòng HÀNG ĐỔI trên hoá đơn không phải hàng bán — tính vào là SL bán phồng.
    if (l.is_exchange) continue
    const a = theoHd.get(l.invoice_id)
    if (a) a.push(l)
    else theoHd.set(l.invoice_id, [l])
  }
  const hoaDon = new Map<string, HoaDonBC>()
  for (const h of p.hoaDon) {
    const ngay = String(h.invoice_date).slice(0, 10)
    const ls = theoHd.get(h.id) || []
    const tong = Number(h.total || 0)
    hoaDon.set(h.id, { id: h.id, ma: h.invoice_code, ngay, kh: h.customer_id, nv: h.sales_user_id || "", tong, giam: giamGiaHoaDon(h, ls), nguoiLap: h.posted_by || "" })
    const S = ls.reduce((s, l) => s + Number(l.line_total || 0), 0)
    const base = { ngay, loai: 1 as const, ct: h.id, hd: h.id, kh: h.customer_id, nv: h.sales_user_id || "" }
    if (!ls.length || S <= 0) {
      dong.push({ ...base, sp: ls[0]?.product_id || "", tien: tong, giaVon: 0, sl: 0 })
      continue
    }
    let conLai = tong
    ls.forEach((l, i) => {
      const tien = i === ls.length - 1 ? conLai : Math.round((Number(l.line_total || 0) / S) * tong)
      conLai -= tien
      const qd = quyDoiTuDanhMuc(dm, l.product_id)
      const sl = soLuongCoSoDongHd(l, qd)
      const gvCoSo = p.giaVonCoSo.get(l.product_id) || 0
      // Chênh = SL × (giá trên HĐ − giá bảng cùng đơn vị); giảm giá cả đơn tính RIÊNG (`giamDon`) — chenh-lech.ts.
      const c = chenhDong(l, qd)
      dong.push({
        ...base, sp: l.product_id, tien, giaVon: sl * gvCoSo, sl, niemYet: c.niemYet, tienTT: c.tien,
        goc: { dv: l.unit_name || "", sl: Number(l.quantity || 0), donGia: Number(l.unit_price || 0), giam: Number(l.line_discount || 0), thanhTien: Number(l.line_total || 0) },
        ...(i === 0 ? { giamDon: giamGiaHoaDon(h, ls) } : {}),
        ...(sl > 0 && !(gvCoSo > 0) ? { thieuGV: true as const } : {}),
      })
    })
  }
  const theoTra = new Map<string, ReturnLineRow[]>()
  for (const l of p.dongTra) {
    const a = theoTra.get(l.return_id)
    if (a) a.push(l)
    else theoTra.set(l.return_id, [l])
  }
  const phieuTra: PhieuTraBC[] = []
  for (const r of p.tra) {
    const ngay = String(r.created_at).slice(0, 10)
    const tien = Math.abs(Number(r.credit_note_amount || 0))
    const nv = p.nvTra.get(r.id) || ""
    phieuTra.push({ id: r.id, ma: r.ma || r.id.slice(0, 8), ngay, kh: r.customer_id, nv, tien, lyDo: nhanLyDoTra(r.lyDo), loai: r.tuSinh ? "Tự sinh" : "Tự lập", hd: r.invoice_id ?? null })
    const ls = (theoTra.get(r.id) || []).map((l) => ({ l, sl: soLuongCoSoDongTra(l, quyDoiTuDanhMuc(dm, l.product_id)) }))
    const gv = p.giaVonTra.get(r.id)
    const base = { ngay, loai: -1 as const, ct: r.id, hd: "", kh: r.customer_id, nv }
    const S = ls.reduce((s, x) => s + Number(x.l.line_total || 0), 0)
    if (!ls.length || S <= 0) {
      dong.push({ ...base, sp: ls[0]?.l.product_id || "", tien, giaVon: gv?.total || 0, sl: ls.reduce((s, x) => s + x.sl, 0) })
      continue
    }
    // Giá vốn trả theo mặt hàng chia cho các dòng cùng mặt hàng theo SL cơ sở.
    const slTheoSp = new Map<string, number>()
    for (const x of ls) slTheoSp.set(x.l.product_id, (slTheoSp.get(x.l.product_id) || 0) + x.sl)
    let conLai = tien
    ls.forEach((x, i) => {
      const t = i === ls.length - 1 ? conLai : Math.round((Number(x.l.line_total || 0) / S) * tien)
      conLai -= t
      const gvSp = gv?.byProduct.get(x.l.product_id) || 0
      const tong = slTheoSp.get(x.l.product_id) || 0
      // Chênh trả: cùng luật hàng đi — giá trên phiếu trả so với giá bảng cùng đơn vị (chenh-lech.ts).
      const c = chenhDong(x.l, quyDoiTuDanhMuc(dm, x.l.product_id))
      dong.push({
        ...base, sp: x.l.product_id, tien: t, giaVon: tong ? (gvSp * x.sl) / tong : 0, sl: x.sl, niemYet: c.niemYet, tienTT: c.tien,
        goc: { dv: x.l.unit_name || "", sl: Math.abs(Number(x.l.quantity || 0)), donGia: Number(x.l.unit_price || 0), giam: 0, thanhTien: Math.abs(Number(x.l.line_total || 0)) },
      })
    })
  }
  return { dong, hoaDon, phieuTra }
}

/** Dòng thô của số bán — đọc từng bảng (cách cũ) hoặc một lượt qua hàm máy chủ (mig 204). */
interface SoBanTho {
  hd: RevenueInvoiceRow[]
  dongHd: InvoiceLineRow[]
  tra: ReturnSummaryRow[]
  traThem: Map<string, { ma?: string; lyDo: string; tuSinh: boolean }>
  dongTra: ReturnLineRow[]
  giaVonCoSo: Map<string, number>
  giaVonTra: Map<string, { total: number; byProduct: Map<string, number> }>
  thieu: boolean
}

interface SoBanMotLuot {
  hd: (Omit<RevenueInvoiceRow, "sales_user_id"> & { sales_user_id: string | null })[]
  dong_hd: InvoiceLineRow[]
  tra: {
    id: string; status: string; customer_id: string; invoice_id: string | null; credit_note_amount: number | null
    created_at: string; revenue_date: string | null; sales_user_id: string | null; reason: string | null
    credit_with_invoice: boolean | null; ma: string | null
  }[]
  dong_tra: ReturnLineRow[]
  gv: { product_id: string; sl: number; tien: number }[]
  gv_tra: { return_id: string; product_id: string; tien: number }[]
}

/** Chuyển kết quả hàm máy chủ về đúng dạng dòng mà cách đọc cũ trả ra (cùng phép chuẩn hoá). */
export function tuMotLuot(x: SoBanMotLuot): SoBanTho {
  const hd = x.hd.map((r) => ({
    ...r,
    total: Number(r.total || 0),
    subtotal: Number(r.subtotal || 0),
    vat: Number(r.vat || 0),
    sales_user_id: r.sales_user_id ?? "",
  }))
  // Như fetchReturnsRowsDu: ngày xếp kỳ = ngày trừ doanh số (mig 192).
  const tra: ReturnSummaryRow[] = x.tra.map((r) => ({
    id: r.id,
    status: r.status,
    customer_id: r.customer_id,
    credit_note_amount: Number(r.credit_note_amount || 0),
    created_at: r.revenue_date || r.created_at,
    sales_user_id: r.sales_user_id ?? null,
    invoice_id: r.invoice_id ?? null,
  }))
  const traThem = new Map(x.tra.map((r) => [r.id, { ma: r.ma || undefined, lyDo: r.reason || "", tuSinh: !!r.credit_with_invoice }]))
  // Như giaVonBinhQuanCoSo: Σ giá trị / Σ SL cơ sở của phiếu xuất trong kỳ.
  const giaVonCoSo = new Map(x.gv.map((g) => [g.product_id, Number(g.sl) > 0 ? Number(g.tien) / Number(g.sl) : 0]))
  const giaVonTra = new Map<string, { total: number; byProduct: Map<string, number> }>()
  for (const g of x.gv_tra) {
    const o = giaVonTra.get(g.return_id) ?? { total: 0, byProduct: new Map<string, number>() }
    o.total += Number(g.tien || 0)
    o.byProduct.set(g.product_id, (o.byProduct.get(g.product_id) ?? 0) + Number(g.tien || 0))
    giaVonTra.set(g.return_id, o)
  }
  return {
    hd, dongHd: x.dong_hd, tra, traThem, dongTra: x.dong_tra, giaVonCoSo, giaVonTra, thieu: false,
  }
}

/** Cách đọc cũ: từng bảng từ trình duyệt (khi sổ chưa chạy mig 204). */
async function docTungBang(sb: SupabaseClient, orgId: string, a: string, b: string): Promise<SoBanTho> {
  const range = { from: a, to: b }
  const [hd, tra, gv] = await Promise.all([
    fetchRevenueInvoicesDu(sb, orgId, range),
    fetchReturnsRowsDu(sb, orgId, range),
    fetchCogsForRange(sb, orgId, range),
  ])
  const traIds = tra.rows.map((r) => r.id)
  const [dongHd, dongTra, giaVonTra, thongTinTra, maTra] = await Promise.all([
    fetchInvoiceLines(sb, hd.rows.map((h) => h.id)),
    fetchReturnLines(sb, traIds),
    fetchReturnCosts(sb, traIds),
    docTheoLoId<{ id: string; reason: string | null; credit_with_invoice: boolean | null }>(
      traIds,
      (lo, from, to) =>
        sb.from("returns").select("id, reason, credit_with_invoice", { count: "exact" }).in("id", lo).order("id").range(from, to),
      "đọc lý do phiếu trả"
    ),
    // ⚠ Số phiếu TH- chỉ đọc riêng qua `docMaPhieuTra` (sổ chưa chạy mig 193 thì chỉ mất số).
    docMaPhieuTra(sb, traIds),
  ])
  const traThem = new Map(thongTinTra.map((r) => [r.id, { ma: maTra.get(r.id), lyDo: r.reason || "", tuSinh: !!r.credit_with_invoice }]))
  for (const id of traIds) if (!traThem.has(id)) traThem.set(id, { ma: maTra.get(id), lyDo: "", tuSinh: false })
  return {
    hd: hd.rows,
    dongHd,
    tra: tra.rows,
    traThem,
    dongTra,
    giaVonCoSo: giaVonBinhQuanCoSo(gv.lines),
    giaVonTra,
    thieu: hd.truncated || tra.truncated || gv.truncated,
  }
}

export async function napSoBan(sb: SupabaseClient, orgId: string, a: string, b: string, dmVao: DanhMucVao): Promise<SoBan> {
  // Một lượt qua hàm máy chủ (mig 204); sổ chưa chạy 204 thì đọc từng bảng như cũ.
  const mot = await goiMotLuot<SoBanMotLuot>(sb, "bao_cao_so_ban", { p_tu: a, p_den: b }, "đọc số bán")
  const tho = mot ? tuMotLuot(mot) : await docTungBang(sb, orgId, a, b)
  const dm = await dmVao
  const traCoMa: TraCoMa[] = tho.tra.map((r) => {
    const x = tho.traThem.get(r.id)
    return { ...r, ma: x?.ma, lyDo: x?.lyDo || "", tuSinh: !!x?.tuSinh }
  })
  const out = dungDongBan({
    hoaDon: tho.hd,
    dongHd: tho.dongHd,
    tra: traCoMa,
    dongTra: tho.dongTra,
    giaVonCoSo: tho.giaVonCoSo,
    giaVonTra: tho.giaVonTra,
    nvTra: nhanVienPhieuTra(tho.tra, tho.hd),
    dm,
  })
  return { ...out, thieu: tho.thieu }
}
