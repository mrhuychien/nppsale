import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate, docTheoLoId } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"

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

export type LoaiDongNoNcc = "phieu-nhap" | "tra-ncc" | "dau-ky" | "lap-tay"

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
}

const so = (v: unknown) => Number(v) || 0

/** Còn phải trả NCC = Σ(amount − paid) trên các dòng chưa xong — KHÔNG kẹp dòng âm. */
export function tongNoNcc(rows: ReadonlyArray<Pick<DongNoNcc, "amount" | "paid" | "status">>): number {
  return rows.filter((r) => r.status !== "paid").reduce((s, r) => s + so(r.amount) - so(r.paid), 0)
}

type PhieuNhapCuaNo = { id: string; payable_id: string | null; receipt_code: string | null }
type PhieuTraCuaNo = { id: string; payable_credit_id: string | null; return_code: string | null }

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
  tra: ReadonlyMap<string, PhieuTraCuaNo>
): ChungTuNo {
  const hd = r.invoice_number?.trim() || null
  const n = nhap.get(r.id)
  if (n) {
    const ma = n.receipt_code || hd || "Phiếu nhập"
    return { loai: "phieu-nhap", ma, href: `/purchasing/receipts/${n.id}`, soHdNcc: hd && hd !== ma ? hd : null }
  }
  const t = tra.get(r.id)
  if (t) return { loai: "tra-ncc", ma: t.return_code || hd || "Trả NCC", href: `/purchase-returns/${t.id}`, soHdNcc: null }
  return {
    loai: r.opening_balance ? "dau-ky" : "lap-tay",
    ma: hd || (r.opening_balance ? "Nợ đầu kỳ" : "Công nợ"),
    href: `/payables/${r.id}`,
    soHdNcc: null,
  }
}

const theoNo = (phieuNhap: ReadonlyArray<PhieuNhapCuaNo>, phieuTra: ReadonlyArray<PhieuTraCuaNo>) => ({
  nhap: new Map(phieuNhap.filter((p) => p.payable_id).map((p) => [p.payable_id as string, p])),
  tra: new Map(phieuTra.filter((p) => p.payable_credit_id).map((p) => [p.payable_credit_id as string, p])),
})

/** Gắn mỗi dòng nợ với chứng từ sinh ra nó. */
export function ghepChungTu(
  rows: DongNoNcc[],
  phieuNhap: ReadonlyArray<PhieuNhapCuaNo>,
  phieuTra: ReadonlyArray<PhieuTraCuaNo>
): DongSoNoNcc[] {
  const { nhap, tra } = theoNo(phieuNhap, phieuTra)
  return rows.map((r) => {
    const c = chungTuCuaNo(r, nhap, tra)
    return { ...r, loai: c.loai, ma: c.ma, href: c.href, conLai: so(r.amount) - so(r.paid) }
  })
}

/** Phiếu nhập / phiếu trả NCC sinh ra các dòng nợ `ids` (đọc theo lô — danh sách mã dài không vỡ URL). */
export async function docPhieuCuaNo(
  sb: SupabaseClient,
  ids: readonly string[]
): Promise<{ nhap: PhieuNhapCuaNo[]; tra: PhieuTraCuaNo[] }> {
  const [nhap, tra] = await Promise.all([
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
  ])
  return { nhap, tra }
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
    const { nhap, tra } = theoNo(p.nhap, p.tra)
    return new Map(rows.map((r) => [r.id, chungTuCuaNo(r, nhap, tra)]))
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
    const { nhap, tra } = await docPhieuCuaNo(sb, res.rows.map((r) => r.id))
    return { rows: ghepChungTu(res.rows, nhap, tra), error: null, truncated: res.truncated }
  } catch (e) {
    return { rows: ghepChungTu(res.rows, [], []), error: errorMessage(e, "Không đọc được chứng từ của khoản nợ"), truncated: res.truncated }
  }
}
