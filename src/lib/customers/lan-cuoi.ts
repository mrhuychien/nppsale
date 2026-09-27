/**
 * ĐƠN GẦN NHẤT + LẦN GHÉ GẦN NHẤT của một trang khách — MỘT lượt qua RPC `khach_lan_cuoi`
 * (mig 204). Chủ nhà 27/09/2026: "kiểm tra sao danh sách khách hàng load lâu vậy?" — cách cũ
 * đọc 1.000 dòng đơn + 1.000 dòng ghé thăm rồi hỏi bù từng khách, hơn 40 lượt đi mạng.
 *
 * ⚠ Sổ CHƯA chạy mig 204 (PGRST202 — không có hàm) thì trả `null` để màn quay về cách đọc cũ,
 *   không báo lỗi. Lỗi khác thì trả lỗi để màn NÓI RA (không đổ về "chưa có đơn").
 */
export interface LanCuoiDong {
  customer_id: string
  order_code: string | null
  order_date: string | null
  order_total: number | string | null
  visit_date: string | null
  check_in_at: string | null
  visit_result: string | null
  visit_user_name: string | null
}

export interface LanCuoi {
  don: Record<string, { order_code: string; order_date: string; total: number }>
  ghe: Record<string, { visit_date: string; check_in_at: string | null; result: string | null; sales_user_name: string | null }>
}

export function tachLanCuoi(rows: readonly LanCuoiDong[]): LanCuoi {
  const out: LanCuoi = { don: {}, ghe: {} }
  for (const r of rows) {
    if (r.order_code && r.order_date) out.don[r.customer_id] = { order_code: r.order_code, order_date: r.order_date, total: Number(r.order_total || 0) }
    if (r.visit_date) out.ghe[r.customer_id] = { visit_date: r.visit_date, check_in_at: r.check_in_at, result: r.visit_result, sales_user_name: r.visit_user_name }
  }
  return out
}

type GoiRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>

export async function docLanCuoi(rpc: GoiRpc, ids: string[]): Promise<{ ket: LanCuoi | null; loi: string | null }> {
  const { data, error } = await rpc("khach_lan_cuoi", { p_ids: ids })
  if (error) {
    if (error.code === "PGRST202" || /Could not find the function/i.test(error.message)) return { ket: null, loi: null }
    return { ket: null, loi: error.message }
  }
  return { ket: tachLanCuoi((data as LanCuoiDong[] | null) || []), loi: null }
}
