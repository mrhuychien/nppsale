/**
 * Gộp các phiếu công nợ của MỘT ĐƠN — mỗi hóa đơn một phiếu (mig 125).
 *
 * ⚠ CÔNG NỢ TÍNH THEO HÓA ĐƠN (chủ nhà 24/09/2026). Đơn xuất hai đợt là hai
 *   phiếu; lấy một phiếu (dòng đầu / dòng cuối) là nói khách nợ một nửa số thật.
 * ⚠ TRẠNG THÁI THEO CHỖ XẤU NHẤT: còn một phiếu chưa trả hết thì cả đơn chưa.
 */
export type PhieuCongNo = { amount: number | string | null; paid: number | string | null; status: string; due_date: string | null }

export function gopCongNoCuaDon(rows: readonly PhieuCongNo[]): {
  amount: number
  paid: number
  status: string
  due_date: string | null
} | null {
  if (rows.length === 0) return null
  const amount = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const paid = rows.reduce((a, r) => a + (Number(r.paid) || 0), 0)
  const conNo = rows.some((r) => r.status !== "paid")
  return {
    amount,
    paid,
    status: !conNo ? "paid" : paid > 0 ? "partial" : "open",
    due_date: rows.map((r) => r.due_date).filter((d): d is string => !!d).sort()[0] ?? null,
  }
}

/** Gộp theo `order_id` cho danh sách đơn. */
export function gopCongNoTheoDon<T extends PhieuCongNo & { order_id: string | null }>(rows: readonly T[]) {
  const nhom: Record<string, T[]> = {}
  for (const r of rows) if (r.order_id) (nhom[r.order_id] ??= []).push(r)
  const out: Record<string, NonNullable<ReturnType<typeof gopCongNoCuaDon>>> = {}
  for (const [id, ds] of Object.entries(nhom)) out[id] = gopCongNoCuaDon(ds)!
  return out
}
