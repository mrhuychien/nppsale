/**
 * TÌM KIẾM TRÊN DANH SÁCH CÓ PHÂN TRANG — tìm CẢ SỔ, không chỉ trang đang xem.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "trong danh sách Hóa đơn, danh sách Đơn
 * hàng, Tìm kiếm chỉ tìm trong trang 1, phải tìm toàn bộ chứ?".
 *
 * ⚠ LỖI NÀY ĐÃ ĐƯỢC GHI LẠI TRONG MÃ MÀ KHÔNG ĐƯỢC SỬA. Màn hoá đơn bán
 * có hẳn một chú thích: "Ô TÌM NHANH LỌC TRONG TRANG ĐANG XEM — nó
 * không hỏi lại máy chủ. Placeholder phải nói ra, nếu không người dùng
 * gõ số của một hóa đơn ở trang 3, không thấy gì, và kết luận là hóa đơn
 * đã mất." Ai đó đã thấy đúng hậu quả, viết ra, rồi đi vá bằng một dòng
 * chữ trên ô tìm. Một danh sách 50 dòng mỗi trang thì ô tìm ấy đúng 2%
 * số lần dùng.
 *
 * ⚠ VÌ SAO PHẢI CÓ TỆP NÀY, KHÔNG CHỈ SỬA TỪNG MÀN. PostgREST KHÔNG cho
 * `or` bắc qua bảng nhúng: `or=(order_code.ilike.*x*,
 * customer.store_name.ilike.*x*)` không chạy. Muốn tìm theo tên khách
 * thì phải hỏi mã khách trước rồi mới lọc theo `customer_id`. Đó là hai
 * lượt gọi và một cái bẫy — danh sách mã có thể dài quá URL — nên nó
 * phải nằm ở MỘT chỗ có chốt, không phải chép ra từng màn.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Số mã tối đa kéo về cho một lượt tra cứu phụ.
 *
 * ⚠ CÓ TRẦN VÌ URL CÓ TRẦN. `customer_id.in.(...)` đi trong chuỗi truy
 * vấn; vài nghìn mã UUID là một URL vỡ trước khi máy chủ kịp đọc — và
 * nó vỡ bằng một lỗi mạng khó hiểu, không phải một câu nói được.
 *
 * ⚠ VÀ VÌ CÓ TRẦN NÊN PHẢI BÁO KHI CHẠM TRẦN. Cắt im lặng là ô tìm trả
 * về thiếu kết quả mà trông y hệt lúc trả đủ — đúng cái lỗi tệp này
 * sinh ra để dọn, chỉ đổi chỗ từ "trang 1" sang "300 khách đầu".
 */
export const MATCH_CAP = 300

/**
 * Chuỗi cho `ilike`, đã bọc `%` và ĐÃ THOÁT ký tự đại diện.
 *
 * ⚠ KHÔNG THOÁT `%` VÀ `_` LÀ MỘT Ô TÌM NÓI DỐI. Người dùng gõ `50%`
 * để tìm một mã khuyến mãi; `%` của họ biến thành "khớp mọi thứ", và
 * danh sách trả về mọi dòng có số 50 ở bất kỳ đâu.
 */
export function likeTerm(raw: string): string {
  return `%${raw.trim().replace(/[%_]/g, "\\$&")}%`
}

export interface IdMatch {
  ids: string[]
  /** Chạm trần — kết quả đang THIẾU, và màn hình phải nói ra. */
  truncated: boolean
}

/** Không có gì để tra thì không phải gọi máy chủ. */
export const NO_MATCH: IdMatch = { ids: [], truncated: false }

/**
 * Mã của những dòng ở bảng `table` có BẤT KỲ cột nào trong `columns`
 * khớp `term`.
 *
 * ⚠ ĐÂY LÀ LƯỢT TRA CỨU PHỤ, KHÔNG PHẢI DANH SÁCH HIỆN RA. Nó chỉ lấy
 * cột `id`, có trần, và kết quả đi vào một `in.(...)` của truy vấn
 * chính.
 */
export async function idsMatching(
  supabase: SupabaseClient,
  table: string,
  columns: string[],
  term: string,
  orgId?: string | null
): Promise<IdMatch> {
  const t = term.trim()
  if (!t || columns.length === 0) return NO_MATCH
  const like = likeTerm(t)
  let q = supabase
    .from(table)
    .select("id")
    .or(columns.map((c) => `${c}.ilike.${like}`).join(","))
    // ⚠ CÓ MỐC SẮP XẾP. Không có thì hai lần gọi cùng một từ khoá có thể
    //   trả về hai tập 300 mã khác nhau, và danh sách nhấp nháy.
    .order("id")
    .limit(MATCH_CAP + 1)
  if (orgId) q = q.eq("org_id", orgId)

  const { data, error } = await q
  if (error) {
    /**
     * ⚠ TRA CỨU PHỤ HỎNG THÌ COI NHƯ CHẠM TRẦN, đừng coi như "không có
     *   ai khớp". Trả mảng rỗng lặng lẽ là ô tìm nói "không tìm thấy
     *   khách nào tên vậy" trong khi sự thật là nó chưa hỏi được.
     */
    console.error(`[list-search] tra ${table} lỗi:`, error.message)
    return { ids: [], truncated: true }
  }
  const rows = (data as Array<{ id: string }>) || []
  return {
    ids: rows.slice(0, MATCH_CAP).map((r) => r.id),
    truncated: rows.length > MATCH_CAP,
  }
}

export interface OrClause {
  /** Chuỗi cho `.or(...)`, hoặc `null` khi không có gì để lọc. */
  filter: string | null
  /** Có lượt tra cứu phụ nào chạm trần không. */
  truncated: boolean
}

/**
 * Dựng mệnh đề `or` cho truy vấn chính.
 *
 * @param ownColumns Cột của CHÍNH bảng đang liệt kê (`order_code`…).
 * @param idFilters  Cặp "cột khoá ngoại" ↔ mã đã tra được.
 *
 * ⚠ KHÔNG CÓ MÃ NÀO KHỚP THÌ BỎ HẲN VẾ ẤY, đừng dựng `in.()` rỗng.
 * PostgREST đọc `in.()` là "không khớp gì" — nối vào `or` thì vô hại,
 * nhưng cú pháp rỗng ấy từng làm cả câu truy vấn hỏng. Bỏ đi thì vế còn
 * lại vẫn chạy, và người dùng vẫn tìm được theo mã chứng từ.
 */
export function buildOrFilter(
  term: string,
  ownColumns: string[],
  idFilters: Array<{ column: string; match: IdMatch }>
): OrClause {
  const t = term.trim()
  if (!t) return { filter: null, truncated: false }
  const like = likeTerm(t)
  const parts = ownColumns.map((c) => `${c}.ilike.${like}`)
  let truncated = false
  for (const f of idFilters) {
    if (f.match.truncated) truncated = true
    if (f.match.ids.length > 0) parts.push(`${f.column}.in.(${f.match.ids.join(",")})`)
  }
  return { filter: parts.length > 0 ? parts.join(",") : null, truncated }
}
