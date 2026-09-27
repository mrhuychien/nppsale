"use client"

import { useEffect, useMemo } from "react"
import { usePagination } from "@/hooks/use-pagination"

/**
 * PHÂN TRANG TẠI CHỖ cho các màn ĐÃ TẢI ĐỦ danh sách (lọc ở trình duyệt, cộng tổng bằng
 * `tongChungTu`) — cùng `DataPagination`, cùng mặc định 20 dòng/trang như màn đơn / hóa đơn
 * (chủ nhà 26/09/2026: "để mặc định load 20 đơn thì phải để mặc định 20 đơn 1 trang").
 *
 * ⚠ ĐỔI BỘ LỌC → VỀ TRANG 1. Đứng ở trang 7 của một kết quả 2 dòng là màn trắng. `khoaLoc`
 *   là chuỗi mô tả bộ lọc hiện tại; đổi là về đầu.
 */
export function usePhanTrangTaiCho<T>(items: readonly T[], khoaLoc: string) {
  const pg = usePagination()
  const { setTotal, reset } = pg
  useEffect(() => { setTotal(items.length) }, [items.length, setTotal])
  useEffect(() => { reset() }, [khoaLoc, reset])
  /* Xoá bớt dòng ở trang cuối → lùi về trang còn dòng, không để trang trắng. */
  const { page, totalPages, setPage } = pg
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages, setPage])
  const trang = useMemo(() => items.slice(pg.from, pg.to + 1), [items, pg.from, pg.to])
  return { pg, trang }
}
