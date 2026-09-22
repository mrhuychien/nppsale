/**
 * Ghi một lần trả tiền cho NCC.
 *
 * ⚠ ĐI QUA RPC `record_payable_payment` (mig 167), KHÔNG tự ghi hai bảng.
 *   Bản cũ chèn `payable_payments` rồi tự tính `paid = payable.paid + amt`
 *   từ số đọc lúc mở trang — hai tab cùng trả là mất một khoản (đã đo:
 *   trả 5tr, sổ ghi 2tr, báo còn nợ 3tr). Máy chủ khoá dòng, cộng dồn và
 *   tính trạng thái trong một giao dịch.
 */

import { dongDau, type CoRpc } from "@/lib/db/co-rpc"

export interface KetQuaTraTien {
  paymentId: string
  newPaid: number
  newStatus: string
}

export async function ghiTraTienNcc(
  supabase: CoRpc,
  input: { payableId: string; amount: number; method: string; notes?: string | null }
): Promise<KetQuaTraTien> {
  const { data, error } = await supabase.rpc("record_payable_payment", {
    p_payable_id: input.payableId,
    p_amount: input.amount,
    p_method: input.method,
    p_notes: input.notes?.trim() || null,
  })
  if (error) throw error
  const row = dongDau<{ payment_id: string; new_paid: number | string; new_status: string }>(data)
  if (!row) throw new Error("Máy chủ không trả về kết quả ghi trả tiền — tải lại trang để xem đã ghi chưa.")
  return { paymentId: row.payment_id, newPaid: Number(row.new_paid), newStatus: row.new_status }
}
