import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import type { Receivable } from "@/types"

/**
 * ĐỌC CÁC KHOẢN NỢ CHO MÀN THU TIỀN (`/receivables/collect`).
 *
 * ⚠ VÌ SAO (rà soát 03/10/2026): bản cũ không có `customerId` thì đọc TRƠN mọi khoản chưa thu của cả đơn vị —
 *   `db.max_rows = 1000` cắt im lặng ở 1.000 dòng. Mở `?receivableId=X` mà X nằm sau dòng 1.000 thì thẻ khoản nợ
 *   không có, `selected` rỗng, nút Thu tiền chết mà không nói vì sao.
 *   Nay: có `receivableId` (không có `customerId`) → tra ĐÚNG khoản đó theo id để biết khách, rồi đọc các khoản của
 *   khách ấy; không có gì → đọc cả sổ bằng `fetchAllForAggregate` (phân trang, khoá thứ tự `due_date` + `id`).
 *
 * ⚠ Công nợ ÂM / đã thu dư (mig 186) là DƯ CÓ của khách, không phải khoản để thu — lọc bỏ (máy chủ cũng chặn).
 */
type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const COT_CONG_NO_THU = "id, customer_id, amount, paid, due_date, customer:customers(store_name)"

export interface CongNoDeThu {
  list: Receivable[]
  /** Khách đang thu: theo `customerId`, hoặc khách của `receivableId`; rỗng = cả sổ. */
  customerId: string
  error: string | null
  truncated: boolean
}

export async function docCongNoDeThu(
  supabase: Client,
  { customerId, receivableId }: { customerId?: string; receivableId?: string }
): Promise<CongNoDeThu> {
  let khach = customerId || ""
  if (!khach && receivableId) {
    const { data, error } = await supabase
      .from("receivables")
      .select("id, customer_id")
      .eq("id", receivableId)
      .maybeSingle()
    if (error) return { list: [], customerId: "", error: error.message, truncated: false }
    khach = (data as { customer_id?: string | null } | null)?.customer_id || ""
  }
  const res = await fetchAllForAggregate<Receivable>((from, to) => {
    let q = supabase
      .from("receivables")
      .select(COT_CONG_NO_THU, { count: "exact" })
      .neq("status", "paid")
    if (khach) q = q.eq("customer_id", khach)
    // ⚠ Mốc phụ `id`: các trang đọc SONG SONG — thiếu khoá duy nhất thì khoản nợ lặp / sót giữa hai trang.
    return q.order("due_date").order("id").range(from, to)
  })
  const list = res.rows.filter((r) => Number(r.amount) - Number(r.paid || 0) > 0)
  return { list, customerId: khach, error: res.error, truncated: res.truncated }
}
