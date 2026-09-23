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
import { ID_MOI_LO } from "@/lib/supabase/aggregate"

/**
 * Số mã tối đa kéo về cho một lượt tra cứu phụ.
 *
 * ⚠ CÓ TRẦN VÌ URL CÓ TRẦN. `customer_id.in.(...)` đi trong chuỗi truy
 * vấn; vài trăm mã UUID là một URL vỡ trước khi máy chủ kịp đọc — và
 * nó vỡ bằng một lỗi mạng khó hiểu, không phải một câu nói được.
 *
 * ⚠ VÀ VÌ CÓ TRẦN NÊN PHẢI BÁO KHI CHẠM TRẦN. Cắt im lặng là ô tìm trả
 * về thiếu kết quả mà trông y hệt lúc trả đủ — đúng cái lỗi tệp này
 * sinh ra để dọn, chỉ đổi chỗ từ "trang 1" sang "150 khách đầu".
 *
 * ⚠ 150, KHÔNG PHẢI 300 NHƯ TRƯỚC (đợt QA 23/09/2026). 300 uuid trong một
 * `in.(…)` đi qua `.or()` là ~11 KB chuỗi truy vấn — sát/vượt trần URL
 * của cổng API, và vỡ bằng đúng cái lỗi mạng khó hiểu nói ở trên. Dùng
 * CHUNG con số với `ID_MOI_LO` (mức cả kho đã đo là an toàn cho một
 * `.in()`), để hai nơi không trôi lệch nhau.
 */
export const MATCH_CAP = ID_MOI_LO

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
  orgId?: string | null,
  /**
   * Cột lấy ra làm khoá.
   *
   * ⚠ KHÔNG PHẢI LÚC NÀO CŨNG LÀ `id`. Tìm phiếu nhập theo SỐ HOÁ ĐƠN
   * thì số ấy nằm ở `payables`, và thứ cần lấy ra là
   * `payables.stock_entry_id` — khoá ngoại TRỎ NGƯỢC về bảng đang
   * liệt kê. Cố định `id` là không tra được chiều ấy.
   */
  idColumn = "id"
): Promise<IdMatch> {
  const t = term.trim()
  if (!t || columns.length === 0) return NO_MATCH
  const like = likeTerm(t)
  let q = supabase
    .from(table)
    .select(idColumn)
    .or(columns.map((c) => `${c}.ilike.${like}`).join(","))
    // ⚠ CÓ MỐC SẮP XẾP. Không có thì hai lần gọi cùng một từ khoá có thể
    //   trả về hai tập mã khác nhau, và danh sách nhấp nháy.
    .order(idColumn)
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
  const rows = ((data as unknown) as Array<Record<string, string | null>>) || []
  return {
    /* ⚠ BỎ KHOÁ RỖNG. `stock_entry_id` có thể NULL; nhét `null` vào
       `in.(…)` là một câu truy vấn hỏng. */
    ids: rows.slice(0, MATCH_CAP).map((r) => r[idColumn]).filter(Boolean) as string[],
    truncated: rows.length > MATCH_CAP,
  }
}

/**
 * ĐÃ TRA XONG CHO ĐÚNG TỪ KHOÁ HIỆN TẠI CHƯA.
 *
 * ⚠ MỘT DÒNG, NHƯNG PHẢI NẰM Ở ĐÂY CHỨ KHÔNG NẰM TRONG HOOK. Đã thử
 * phá: đổi nó thành `true` bên trong `useListSearch` mà cả 35 chốt vẫn
 * XANH — vì chốt chỉ soi được rằng các màn CÓ GỌI `listSearch.ready`,
 * không soi được luật quyết định giá trị ấy. Một luật không ai canh là
 * một luật sẽ trôi.
 *
 * ⚠ `""` KHỚP `""`: lúc không tìm gì thì luôn sẵn sàng, không bắt màn
 * hình chờ một lượt tra không bao giờ chạy.
 */
export function lookupSettled(lookedUpTerm: string, currentTerm: string): boolean {
  return lookedUpTerm === currentTerm.trim()
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
