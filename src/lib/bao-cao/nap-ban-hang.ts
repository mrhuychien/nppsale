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
import { docTheoLoId } from "@/lib/supabase/aggregate"
import { docMaPhieuTra } from "@/lib/returns/ma-phieu"
import type { DanhMucBC, DongBan } from "./cong"
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
      const sl = soLuongCoSoDongHd(l, quyDoiTuDanhMuc(dm, l.product_id))
      dong.push({ ...base, sp: l.product_id, tien, giaVon: sl * (p.giaVonCoSo.get(l.product_id) || 0), sl })
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
    phieuTra.push({ id: r.id, ma: r.ma || r.id.slice(0, 8), ngay, kh: r.customer_id, nv, tien, lyDo: r.lyDo || "", loai: r.tuSinh ? "Tự sinh" : "Tự lập", hd: r.invoice_id ?? null })
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
      dong.push({ ...base, sp: x.l.product_id, tien: t, giaVon: tong ? (gvSp * x.sl) / tong : 0, sl: x.sl })
    })
  }
  return { dong, hoaDon, phieuTra }
}

export async function napSoBan(sb: SupabaseClient, orgId: string, a: string, b: string, dm: DanhMucBC): Promise<SoBan> {
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
  const tt = new Map(thongTinTra.map((r) => [r.id, r]))
  const traCoMa: TraCoMa[] = tra.rows.map((r) => {
    const x = tt.get(r.id)
    return { ...r, ma: maTra.get(r.id), lyDo: x?.reason || "", tuSinh: !!x?.credit_with_invoice }
  })
  const out = dungDongBan({
    hoaDon: hd.rows,
    dongHd,
    tra: traCoMa,
    dongTra,
    giaVonCoSo: giaVonBinhQuanCoSo(gv.lines),
    giaVonTra,
    nvTra: nhanVienPhieuTra(tra.rows, hd.rows),
    dm,
  })
  return { ...out, thieu: hd.truncated || tra.truncated || gv.truncated }
}
