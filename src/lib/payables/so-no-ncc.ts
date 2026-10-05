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

/** Gắn mỗi dòng nợ với chứng từ sinh ra nó. */
export function ghepChungTu(
  rows: DongNoNcc[],
  phieuNhap: ReadonlyArray<{ id: string; payable_id: string | null; receipt_code: string | null }>,
  phieuTra: ReadonlyArray<{ id: string; payable_credit_id: string | null; return_code: string | null }>
): DongSoNoNcc[] {
  const nhap = new Map(phieuNhap.filter((p) => p.payable_id).map((p) => [p.payable_id as string, p]))
  const tra = new Map(phieuTra.filter((p) => p.payable_credit_id).map((p) => [p.payable_credit_id as string, p]))
  return rows.map((r) => {
    const n = nhap.get(r.id)
    const t = tra.get(r.id)
    const conLai = so(r.amount) - so(r.paid)
    if (n) return { ...r, loai: "phieu-nhap", ma: n.receipt_code || r.invoice_number || "Phiếu nhập", href: `/purchasing/receipts/${n.id}`, conLai }
    if (t) return { ...r, loai: "tra-ncc", ma: t.return_code || r.invoice_number || "Trả NCC", href: `/purchase-returns/${t.id}`, conLai }
    return {
      ...r,
      loai: r.opening_balance ? "dau-ky" : "lap-tay",
      ma: r.invoice_number || (r.opening_balance ? "Nợ đầu kỳ" : "Công nợ"),
      href: `/payables/${r.id}`,
      conLai,
    }
  })
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
  const ids = res.rows.map((r) => r.id)
  try {
    const [nhap, tra] = await Promise.all([
      docTheoLoId<{ id: string; payable_id: string | null; receipt_code: string | null }>(
        ids,
        (lo, from, to) =>
          sb.from("purchase_invoices").select("id, payable_id, receipt_code", { count: "exact" }).in("payable_id", lo).order("id").range(from, to),
        "phiếu nhập của NCC"
      ),
      docTheoLoId<{ id: string; payable_credit_id: string | null; return_code: string | null }>(
        ids,
        (lo, from, to) =>
          sb.from("supplier_returns").select("id, payable_credit_id, return_code", { count: "exact" }).in("payable_credit_id", lo).order("id").range(from, to),
        "phiếu trả NCC"
      ),
    ])
    return { rows: ghepChungTu(res.rows, nhap, tra), error: null, truncated: res.truncated }
  } catch (e) {
    return { rows: ghepChungTu(res.rows, [], []), error: errorMessage(e, "Không đọc được chứng từ của khoản nợ"), truncated: res.truncated }
  }
}
