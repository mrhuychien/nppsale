"use client"

/**
 * Ô TÌM CỦA MỘT DANH SÁCH CÓ PHÂN TRANG — phần nối dây, dùng chung.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Tìm kiếm chỉ tìm trong trang 1, phải tìm
 * toàn bộ chứ?". Sáu màn mắc đúng lỗi ấy. Phép tính nằm ở
 * `@/lib/search/list-search`; hook này là phần nối dây mà sáu màn đều
 * phải làm y hệt nhau — và làm sai y hệt nhau nếu chép tay:
 *
 *   1. tra mã ở bảng khác (PostgREST không cho `or` bắc qua bảng nhúng),
 *   2. NHỚ CẢ TỪ KHOÁ đã tra, không chỉ nhớ danh sách mã,
 *   3. bắt truy vấn chính CHỜ lượt tra ấy,
 *   4. ngấm cờ "chạm trần" ra cho màn hình nói được là kết quả thiếu.
 *
 * Bỏ sót bước 2 hoặc 3 thì ô tìm trả về một danh sách THIẾU trong
 * khoảnh khắc đầu rồi tự sửa — và người dùng đọc phải đúng cái danh
 * sách thiếu ấy.
 */

import { useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  idsMatching, buildOrFilter, lookupSettled, NO_MATCH, type IdMatch,
} from "@/lib/search/list-search"

/** Một lượt tra phụ: khoá ngoại nào ↔ tìm ở bảng nào, cột nào. */
export interface LookupSpec {
  /** Cột khoá ngoại trên CHÍNH bảng đang liệt kê. */
  column: string
  table: string
  columns: string[]
  /** Cột lấy ra làm khoá — mặc định `id`. Xem `idsMatching`. */
  idColumn?: string
}

export interface ListSearch {
  /**
   * Chuỗi cho `.or(...)`, hoặc `null` khi không lọc gì.
   *
   * ⚠ ĐƯA VÀO CẢ TRUY VẤN DANH SÁCH LẪN TRUY VẤN ĐẾM. Chỉ đưa vào một
   * bên là thẻ tóm tắt cộng trên một tập còn danh sách hiện tập khác.
   */
  filter: string | null
  /**
   * Đã tra xong cho ĐÚNG từ khoá hiện tại chưa.
   *
   * ⚠ TRUY VẤN CHÍNH PHẢI CHỜ CỜ NÀY. Xem chú thích đầu tệp.
   */
  ready: boolean
  /** Có lượt tra nào chạm trần không — màn hình phải nói ra. */
  truncated: boolean
}

export function useListSearch(
  supabase: SupabaseClient,
  /** Từ khoá ĐÃ chống dội (debounced). */
  term: string,
  orgId: string | null | undefined,
  /** Cột của CHÍNH bảng đang liệt kê. */
  ownColumns: string[],
  lookups: LookupSpec[]
): ListSearch {
  const t = term.trim()
  const [state, setState] = useState<{ term: string; matches: IdMatch[] }>({
    term: "",
    matches: [],
  })

  /**
   * ⚠ KHOÁ ỔN ĐỊNH CHO MẢNG `lookups`. Nơi gọi thường dựng mảng ấy ngay
   *   trong thân component, nên tham chiếu đổi mỗi lần vẽ lại — để nó
   *   thẳng vào mảng phụ thuộc là hiệu ứng chạy vô hạn.
   */
  const key = JSON.stringify(lookups)

  useEffect(() => {
    if (!t) {
      setState({ term: "", matches: [] })
      return
    }
    let cancelled = false
    ;(async () => {
      const specs: LookupSpec[] = JSON.parse(key)
      const matches = await Promise.all(
        specs.map((s) => idsMatching(supabase, s.table, s.columns, t, orgId, s.idColumn ?? "id"))
      )
      if (!cancelled) setState({ term: t, matches })
    })()
    return () => { cancelled = true }
  }, [t, orgId, key]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ⚠ LUẬT NẰM Ở `lookupSettled`, không viết lại ở đây — xem chú thích
     của hàm ấy: bản viết thẳng vào hook thì không chốt nào canh được. */
  const ready = lookupSettled(state.term, t)
  const specs: LookupSpec[] = JSON.parse(key)
  const idFilters = specs.map((s, i) => ({
    column: s.column,
    match: state.matches[i] ?? NO_MATCH,
  }))
  const or = buildOrFilter(t, ownColumns, idFilters)
  return { filter: or.filter, ready, truncated: or.truncated }
}
