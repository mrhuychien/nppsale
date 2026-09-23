"use client"

import { useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IdMatch } from "@/lib/search/list-search"
import { chiaNganSach, dieuKienTruong, maTheoChuoi, type TruongTim } from "@/lib/search/field-search"

export interface FieldSearch {
  /** Mỗi phần tử là MỘT `.or(...)` — nơi gọi áp lần lượt, PostgREST ghép bằng AND. */
  filters: string[]
  /** Đã tra xong cho đúng bộ chữ đang gõ chưa — chưa thì ĐỪNG đọc danh sách. */
  ready: boolean
  /** Một bước tra chạm trần — kết quả có thể thiếu, phải nói ra. */
  truncated: boolean
  /** Khoá ổn định để đặt vào mảng phụ thuộc của effect. */
  key: string
}

/**
 * Tìm theo từng trường — xem `@/lib/search/field-search`.
 *
 * ⚠ `truong` PHẢI ỔN ĐỊNH (hằng ở đầu tệp), không dựng lại mỗi lần vẽ.
 */
export function useFieldSearch(
  sb: SupabaseClient,
  orgId: string | null | undefined,
  truong: readonly TruongTim[],
  values: Record<string, string>
): FieldSearch {
  const key = JSON.stringify(truong.map((t) => [t.key, (values[t.key] ?? "").trim()]))
  const [kq, setKq] = useState<{ key: string; khop: Record<string, IdMatch[]> }>({ key: "", khop: {} })

  useEffect(() => {
    let huy = false
    ;(async () => {
      const khop: Record<string, IdMatch[]> = {}
      await Promise.all(
        truong.map(async (t) => {
          const v = (values[t.key] ?? "").trim()
          if (!v || !t.chuoi?.length) return
          khop[t.key] = await Promise.all(t.chuoi.map((c) => maTheoChuoi(sb, c.buoc, v, orgId)))
        })
      )
      if (!huy) setKq({ key, khop })
    })()
    return () => { huy = true }
  }, [key, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = kq.key === key
  return useMemo(() => {
    const khop = chiaNganSach(kq.khop, truong.map((t) => t.key))
    const filters = truong
      .map((t) => dieuKienTruong(t, values[t.key] ?? "", khop[t.key] ?? []))
      .filter((f): f is string => !!f)
    const truncated = Object.values(khop).some((ms) => ms.some((m) => m.truncated))
    return { filters, ready, truncated, key: ready ? filters.join("|") : "…" }
  }, [kq, ready, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
