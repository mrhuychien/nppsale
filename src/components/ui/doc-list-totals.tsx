/**
 * KHỐI THỐNG KÊ ĐẦU DANH SÁCH CHỨNG TỪ — "Tổng tiền hàng 503.410.450đ ·
 * 285 đơn hàng" (chủ nhà yêu cầu 23/09/2026, cho cả máy tính và điện thoại).
 *
 * ⚠ CÙNG LUẬT VỚI `DocListSummary`: tổng là của CẢ BỘ LỌC, không phải của
 *   trang đang hiện — nơi gọi cộng bằng một truy vấn riêng; `total = null`
 *   hiện "—", không hiện 0 (0 là "bán được 0 đồng", câu trả lời sai cho
 *   một câu hỏi chưa đọc được).
 */
import { cn } from "@/lib/utils"

export function DocListTotals({
  label = "Tổng tiền hàng",
  countText,
  total,
  desktopOnly = false,
  className,
}: {
  label?: string
  /** "285 đơn hàng" — đã định dạng. */
  countText: string
  /** Đã định dạng; `null` = chưa cộng được. */
  total: string | null
  /** Điện thoại đã có `DocListSummary` thì chỉ hiện ở máy tính. */
  desktopOnly?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "items-center justify-between gap-3 border-b border-outline-variant/40 bg-surface-container-low/40 px-4 py-3",
        desktopOnly ? "hidden lg:flex" : "flex",
        className
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold text-on-surface">{label}</span>
        <span className="mt-0.5 block truncate text-[13px] font-semibold text-on-surface-variant">
          {countText}
        </span>
      </span>
      <span
        className="whitespace-nowrap text-xl font-extrabold tabular-data text-on-surface"
        title={total === null ? "Chưa cộng được tổng của bộ lọc này" : undefined}
      >
        {total ?? "—"}
      </span>
    </div>
  )
}
