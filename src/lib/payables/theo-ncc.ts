/**
 * CÔNG NỢ THEO NHÀ CUNG CẤP — một dòng của RPC `payables_by_supplier()` thành một dòng màn hình.
 *
 * ⚠ CHỦ NHÀ 08/10/2026: "Phần công nợ theo NCC thêm cột hàng trả lại, đã trả đổi tên thành đã thanh toán cho dễ
 *   theo dõi". Mig 239 thêm `total_returned` (Σ dòng nợ âm của phiếu trả NCC, số dương); `total_debt` vẫn là số RÒNG
 *   (đã trừ hàng trả). Màn hiện Tổng nợ GỘP = ròng + hàng trả lại, nên:
 *     Tổng nợ − Hàng trả lại − Đã thanh toán = Còn lại.
 * ⚠ Sổ chưa chạy mig 239 thì không có `total_returned` → Hàng trả lại `null` (hiện "—"), Tổng nợ giữ số ròng như cũ.
 */

/** Một dòng trả về của `payables_by_supplier()` (mig 093, thêm `total_returned` ở mig 239). */
export interface DongCongNoNccRaw {
  supplier_id: string
  supplier_name: string | null
  supplier_code: string | null
  invoice_count: number | string | null
  total_debt: number | string | null
  total_paid: number | string | null
  remaining: number | string | null
  overdue_count: number | string | null
  total_returned?: number | string | null
}

export interface DongCongNoNcc {
  supplierId: string
  supplierName: string
  supplierCode: string
  invoiceCount: number
  /** Tổng nợ GỘP (tiền hàng nhập + nợ đầu kỳ) — chưa trừ hàng trả lại. */
  totalDebt: number
  /** Hàng trả lại NCC (số dương); `null` = sổ chưa chạy mig 239. */
  totalReturned: number | null
  /** Đã thanh toán. */
  totalPaid: number
  remaining: number
  overdueCount: number
}

const so = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function dongCongNoTheoNcc(r: DongCongNoNccRaw): DongCongNoNcc {
  const tra = r.total_returned === undefined || r.total_returned === null ? null : so(r.total_returned)
  return {
    supplierId: r.supplier_id,
    supplierName: r.supplier_name || "-",
    supplierCode: r.supplier_code || "-",
    invoiceCount: so(r.invoice_count),
    totalDebt: so(r.total_debt) + (tra ?? 0),
    totalReturned: tra,
    totalPaid: so(r.total_paid),
    remaining: so(r.remaining),
    overdueCount: so(r.overdue_count),
  }
}
