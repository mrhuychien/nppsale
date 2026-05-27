"use client"

import { useState, useCallback } from "react"

/**
 * Pagination state management cho list view dùng Supabase
 * range/count. Tách khỏi UI để mọi page dùng pattern chung.
 *
 * Cách dùng:
 *   const pg = usePagination(50)
 *   const { data, count } = await supabase
 *     .from("...")
 *     .select("...", { count: "exact" })
 *     .range(pg.from, pg.to)
 *   pg.setTotal(count ?? 0)
 *
 * Khi filter/search đổi → gọi pg.reset() để về trang 1.
 */
export function usePagination(initialPageSize = 50) {
  const [page, setPageRaw] = useState(1)
  const [pageSize, setPageSizeRaw] = useState(initialPageSize)
  const [total, setTotal] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const setPage = useCallback(
    (next: number) => setPageRaw(Math.min(Math.max(1, next), totalPages)),
    [totalPages]
  )
  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size)
    setPageRaw(1)
  }, [])
  const reset = useCallback(() => setPageRaw(1), [])

  return {
    page,
    pageSize,
    total,
    totalPages,
    from,
    to,
    setPage,
    setPageSize,
    setTotal,
    reset,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  }
}

export type UsePaginationReturn = ReturnType<typeof usePagination>
