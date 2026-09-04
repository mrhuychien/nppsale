"use client"

import { Button } from "@/components/ui/button"
import type { UsePaginationReturn } from "@/hooks/use-pagination"

/**
 * "Tải thêm" cho mobile, thay bốn nút mũi tên 32×32 và ô chọn "50/trang".
 *
 * CÁCH HOẠT ĐỘNG: `setPageSize` reset `page` về 1, nên nới pageSize chính
 * là "mở rộng cửa sổ trang 1" — đúng ngữ nghĩa tải thêm. Đổi lại, mỗi lần
 * bấm là một lượt fetch với range lớn hơn, tức tải lại cả những dòng đã có.
 *
 * Chấp nhận được tới khoảng 200 dòng. Vượt mức đó thì trang gọi phải tự
 * giữ mảng cộng dồn. KHÔNG sửa use-pagination.ts để chiều chỗ này — nó
 * đang phục vụ cả desktop, và desktop cần phân trang thật.
 */
export function LoadMore({
  pg,
  shown,
  step = 50,
}: {
  pg: UsePaginationReturn
  /** Số dòng đang hiện trên màn. */
  shown: number
  step?: number
}) {
  // `shown` là số dòng THẬT trả về, không phải pageSize: trang cuối trả ít
  // hơn pageSize, lấy pageSize thì nút "Tải thêm" không bao giờ tắt.
  const loaded = pg.from + shown
  const done = loaded >= pg.total

  return (
    <div className="pt-2 text-center lg:hidden">
      <p className="mb-2 text-xs tabular-nums text-on-surface-variant">
        {Math.min(loaded, pg.total)} / {pg.total} dòng
      </p>
      {!done && (
        <Button
          variant="outline"
          className="h-12 w-full"
          onClick={() => pg.setPageSize(pg.pageSize + step)}
        >
          Tải thêm {step}
        </Button>
      )}
    </div>
  )
}
