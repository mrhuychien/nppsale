import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate, docTheoLoId } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { daysOverdueOf } from "@/lib/utils"

/**
 * SỔ CÔNG NỢ CỦA MỘT NHÀ CUNG CẤP — đọc từ `payables`, không từ phiếu kho.
 *
 * ⚠ Chủ nhà 05/10/2026: "Vào xem chi tiết nhà cung cấp hiển thị công nợ chưa đúng (công nợ tính theo phiếu nhập)".
 *   Màn chi tiết NCC cũ để ô "Công nợ NCC" = 0 cứng và tab Công nợ liệt kê phiếu KHO. Nguồn đúng: mỗi phiếu nhập hoàn
 *   thành ghi MỘT dòng `payables` (`complete_purchase_invoice`, `purchase_invoices.payable_id`); phiếu trả NCC ghi một
 *   dòng SỐ ÂM (`complete_supplier_return`, `supplier_returns.payable_credit_id`); nợ đầu kỳ / công nợ lập tay là dòng
 *   không có phiếu. Tiền đã trả nằm ở `paid` (phiếu chi `payable_payments`).
 * ⚠ KHÔNG kẹp từng dòng về 0 (cùng luật công nợ âm phía khách, CLAUDE.md / mig 186): dòng âm là NCC còn nợ lại mình,
 *   phải trừ vào tổng.
 */

export interface DongNoNcc {
  id: string
  amount: number
  paid: number
  status: string
  due_date: string | null
  created_at: string
  invoice_number: string | null
  opening_balance: boolean | null
  notes: string | null
}

/** "tra-truoc": dòng tiền trả trước của phiếu chi trả NCC (mig 242) — phần chưa trừ được vào khoản nợ nào. */
export type LoaiDongNoNcc = "phieu-nhap" | "tra-ncc" | "dau-ky" | "lap-tay" | "tra-truoc"

export interface DongSoNoNcc extends DongNoNcc {
  loai: LoaiDongNoNcc
  /** Mã chứng từ hiện ra (mã phiếu nhập / phiếu trả / số HĐ NCC). */
  ma: string
  /** Trang chứng từ gốc — phiếu nhập, phiếu trả NCC, hoặc chính khoản nợ. */
  href: string
  conLai: number
}

export const NHAN_LOAI_NO_NCC: Record<LoaiDongNoNcc, string> = {
  "phieu-nhap": "Phiếu nhập",
  "tra-ncc": "Trả NCC",
  "dau-ky": "Nợ đầu kỳ",
  "lap-tay": "Công nợ lập tay",
  "tra-truoc": "Trả trước",
}

const so = (v: unknown) => Number(v) || 0

/** Còn phải trả NCC = Σ(amount − paid) trên các dòng chưa xong — KHÔNG kẹp dòng âm. */
export function tongNoNcc(rows: ReadonlyArray<Pick<DongNoNcc, "amount" | "paid" | "status">>): number {
  return rows.filter((r) => r.status !== "paid").reduce((s, r) => s + so(r.amount) - so(r.paid), 0)
}

/** Một NCC trong bảng "Công nợ NCC" của báo cáo nhà cung cấp. */
export interface NoTheoNcc {
  supplier_id: string
  /** Số dòng còn phải trả (> 0) — dòng âm không phải "phiếu nợ". */
  soPhieu: number
  /** Còn phải trả — đã TRỪ dòng âm (phiếu trả NCC, khoản trả dư). */
  conNo: number
  /** Số ngày quá hạn lớn nhất của các dòng còn phải trả, theo lịch VN. */
  quaHan: number
}

/**
 * Gộp sổ nợ NCC theo từng NCC — cùng luật `tongNoNcc`: dòng chưa xong (`status <> 'paid'`), KHÔNG kẹp dòng âm.
 * ⚠ Báo cáo NCC cũ bỏ mọi dòng ≤ 0 → phiếu trả NCC (dòng âm, mig 239) không trừ, nợ NCC hiện CAO hơn sổ; tuổi nợ
 *   `Math.ceil` trên ngày UTC dư 1 ngày từ 07:00 sáng (rà báo cáo 09/10/2026).
 */
export function gopNoTheoNcc(
  rows: ReadonlyArray<{ supplier_id: string; amount: number | null; paid: number | null; status: string | null; due_date: string | null }>,
  qua: (supplierId: string) => boolean = () => true,
): Map<string, NoTheoNcc> {
  const m = new Map<string, NoTheoNcc>()
  for (const r of rows) {
    if (r.status === "paid" || !qua(r.supplier_id)) continue
    const conLai = so(r.amount) - so(r.paid)
    if (conLai === 0) continue
    const e = m.get(r.supplier_id) || { supplier_id: r.supplier_id, soPhieu: 0, conNo: 0, quaHan: 0 }
    e.conNo += conLai
    if (conLai > 0) {
      e.soPhieu += 1
      e.quaHan = Math.max(e.quaHan, daysOverdueOf(r.due_date))
    }
    m.set(r.supplier_id, e)
  }
  return m
}

type PhieuNhapCuaNo = { id: string; payable_id: string | null; receipt_code: string | null }
type PhieuTraCuaNo = { id: string; payable_credit_id: string | null; return_code: string | null }
/** Phiếu chi trả NCC còn tiền trả trước — dòng nợ `prepay_payable_id` (mig 242). */
type PhieuChiCuaNo = { id: string; prepay_payable_id: string | null; code: string }

/** Chứng từ gốc của một dòng nợ. */
export interface ChungTuNo {
  loai: LoaiDongNoNcc
  /** Mã chứng từ hiện ra: mã phiếu nhập PN- / phiếu trả PTNCC- / số HĐ NCC / "Nợ đầu kỳ". */
  ma: string
  /** Trang chứng từ gốc — phiếu nhập, phiếu trả NCC, hoặc chính khoản nợ. */
  href: string
  /** Số hoá đơn của NCC gõ trên phiếu nhập (`payables.invoice_number`) — chỉ khi khác mã chứng từ. */
  soHdNcc: string | null
}

/**
 * Chứng từ của MỘT dòng nợ. ⚠ `invoice_number` là SỐ HOÁ ĐƠN CỦA NCC (gõ tay, hay để trống) — không phải mã phiếu
 * nhập; dòng của phiếu nhập phải hiện mã PN- (chủ nhà 08/10/2026: "sao cột mã HĐ ko có mã phiếu nhập nhỉ").
 */
export function chungTuCuaNo(
  r: { id: string; invoice_number: string | null; opening_balance?: boolean | null },
  nhap: ReadonlyMap<string, PhieuNhapCuaNo>,
  tra: ReadonlyMap<string, PhieuTraCuaNo>,
  truoc: ReadonlyMap<string, PhieuChiCuaNo> = new Map()
): ChungTuNo {
  const hd = r.invoice_number?.trim() || null
  const n = nhap.get(r.id)
  if (n) {
    const ma = n.receipt_code || hd || "Phiếu nhập"
    return { loai: "phieu-nhap", ma, href: `/purchasing/receipts/${n.id}`, soHdNcc: hd && hd !== ma ? hd : null }
  }
  const t = tra.get(r.id)
  if (t) return { loai: "tra-ncc", ma: t.return_code || hd || "Trả NCC", href: `/purchase-returns/${t.id}`, soHdNcc: null }
  const c = truoc.get(r.id)
  if (c) return { loai: "tra-truoc", ma: c.code || hd || "Trả trước", href: `/finance/phieu-chi-ncc/${c.id}`, soHdNcc: null }
  return {
    loai: r.opening_balance ? "dau-ky" : "lap-tay",
    ma: hd || (r.opening_balance ? "Nợ đầu kỳ" : "Công nợ"),
    href: `/payables/${r.id}`,
    soHdNcc: null,
  }
}

const theoNo = (
  phieuNhap: ReadonlyArray<PhieuNhapCuaNo>,
  phieuTra: ReadonlyArray<PhieuTraCuaNo>,
  phieuChi: ReadonlyArray<PhieuChiCuaNo> = []
) => ({
  nhap: new Map(phieuNhap.filter((p) => p.payable_id).map((p) => [p.payable_id as string, p])),
  tra: new Map(phieuTra.filter((p) => p.payable_credit_id).map((p) => [p.payable_credit_id as string, p])),
  truoc: new Map(phieuChi.filter((p) => p.prepay_payable_id).map((p) => [p.prepay_payable_id as string, p])),
})

/** Gắn mỗi dòng nợ với chứng từ sinh ra nó. */
export function ghepChungTu(
  rows: DongNoNcc[],
  phieuNhap: ReadonlyArray<PhieuNhapCuaNo>,
  phieuTra: ReadonlyArray<PhieuTraCuaNo>,
  phieuChi: ReadonlyArray<PhieuChiCuaNo> = []
): DongSoNoNcc[] {
  const { nhap, tra, truoc } = theoNo(phieuNhap, phieuTra, phieuChi)
  return rows.map((r) => {
    const c = chungTuCuaNo(r, nhap, tra, truoc)
    return { ...r, loai: c.loai, ma: c.ma, href: c.href, conLai: so(r.amount) - so(r.paid) }
  })
}

/** Phiếu nhập / phiếu trả NCC sinh ra các dòng nợ `ids` (đọc theo lô — danh sách mã dài không vỡ URL). */
export async function docPhieuCuaNo(
  sb: SupabaseClient,
  ids: readonly string[]
): Promise<{ nhap: PhieuNhapCuaNo[]; tra: PhieuTraCuaNo[]; chi: PhieuChiCuaNo[] }> {
  const [nhap, tra, chi] = await Promise.all([
    docTheoLoId<PhieuNhapCuaNo>(
      [...ids],
      (lo, from, to) =>
        // audit-ok: docTheoLoId tự ném lỗi (res.error → throw); docSoNoNcc / docChungTuNoNcc bắt.
        sb.from("purchase_invoices").select("id, payable_id, receipt_code", { count: "exact" }).in("payable_id", lo).order("id").range(from, to),
      "phiếu nhập của NCC"
    ),
    docTheoLoId<PhieuTraCuaNo>(
      [...ids],
      (lo, from, to) =>
        // audit-ok: docTheoLoId tự ném lỗi (res.error → throw); docSoNoNcc / docChungTuNoNcc bắt.
        sb.from("supplier_returns").select("id, payable_credit_id, return_code", { count: "exact" }).in("payable_credit_id", lo).order("id").range(from, to),
      "phiếu trả NCC"
    ),
    /* ⚠ Bảng mới (mig 242) đọc RIÊNG và nuốt lỗi: sổ chưa chạy 242 thì dòng trả trước chỉ hiện như công nợ lập tay. */
    docTheoLoId<PhieuChiCuaNo>(
      [...ids],
      (lo, from, to) =>
        sb.from("supplier_payments").select("id, prepay_payable_id, code", { count: "exact" }).in("prepay_payable_id", lo).order("id").range(from, to),
      "phiếu chi trả NCC"
    ).catch(() => [] as PhieuChiCuaNo[]),
  ])
  return { nhap, tra, chi }
}

/**
 * Chứng từ gốc của các dòng nợ đang hiện (màn Công nợ NCC — nhiều NCC một lúc).
 * ⚠ Đọc hỏng thì trả map RỖNG — màn hiện lại số HĐ như cũ, không gán nhầm nhãn "Công nợ" cho dòng của phiếu nhập.
 */
export async function docChungTuNoNcc(
  sb: SupabaseClient,
  rows: ReadonlyArray<{ id: string; invoice_number: string | null; opening_balance?: boolean | null }>
): Promise<Map<string, ChungTuNo>> {
  if (rows.length === 0) return new Map()
  try {
    const p = await docPhieuCuaNo(sb, rows.map((r) => r.id))
    const { nhap, tra, truoc } = theoNo(p.nhap, p.tra, p.chi)
    return new Map(rows.map((r) => [r.id, chungTuCuaNo(r, nhap, tra, truoc)]))
  } catch {
    return new Map()
  }
}

/** Đọc đủ sổ nợ của NCC (mọi trạng thái, mới trước) kèm chứng từ gốc. */
export async function docSoNoNcc(
  sb: SupabaseClient,
  supplierId: string
): Promise<{ rows: DongSoNoNcc[]; error: string | null; truncated: boolean }> {
  const res = await fetchAllForAggregate<DongNoNcc>((from, to) =>
    sb
      .from("payables")
      .select("id, amount, paid, status, due_date, created_at, invoice_number, opening_balance, notes", { count: "exact" })
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  )
  if (res.error) return { rows: [], error: res.error, truncated: false }
  try {
    const { nhap, tra, chi } = await docPhieuCuaNo(sb, res.rows.map((r) => r.id))
    return { rows: ghepChungTu(res.rows, nhap, tra, chi), error: null, truncated: res.truncated }
  } catch (e) {
    return { rows: ghepChungTu(res.rows, [], []), error: errorMessage(e, "Không đọc được chứng từ của khoản nợ"), truncated: res.truncated }
  }
}
