"use client"

/**
 * DẢI TÓM TẮT trên đầu danh sách đơn / hóa đơn (điện thoại) — theo mẫu
 * chủ nhà gửi: một viên thuốc đổi khoảng thời gian, rồi "Tổng tiền hàng"
 * với số chứng từ bên trái và TỔNG TIỀN cỡ lớn bên phải.
 *
 * ⚠ TỔNG PHẢI LÀ TỔNG CỦA CẢ BỘ LỌC, KHÔNG PHẢI CỦA TRANG ĐANG HIỆN.
 * Danh sách phân trang 50 dòng một lần; cộng những dòng đang tải về rồi
 * gọi nó là "Tổng tiền hàng" là in ra một con số nhỏ hơn sự thật mà
 * không có gì báo. Nơi gọi phải cộng bằng một truy vấn riêng — và khi
 * truy vấn ấy hỏng thì truyền `total = null`.
 *
 * ⚠ `total = null` HIỆN "—", KHÔNG HIỆN 0. Số 0 nghĩa là "bán được 0
 * đồng"; đó là câu trả lời sai cho một câu hỏi chưa đọc được.
 */

import { cn } from "@/lib/utils"
import { LIST_PERIOD_LABEL, type ListPeriod } from "@/lib/orders/list-summary"

export function DocListSummary({
  period,
  onCyclePeriod,
  onOpenFilter,
  filtersActive,
  onClearFilters,
  countText,
  total,
  label = "Tổng tiền hàng",
}: {
  period: ListPeriod
  onCyclePeriod: () => void
  onOpenFilter?: () => void
  filtersActive: boolean
  onClearFilters: () => void
  /** "12 đơn hàng" / "8 hóa đơn". */
  countText: string
  /** Đã định dạng sẵn; `null` = chưa cộng được. */
  total: string | null
  label?: string
}) {
  return (
    <div className="grid gap-2.5 lg:hidden">
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1">
        {onOpenFilter && (
          <button
            type="button"
            onClick={onOpenFilter}
            aria-label="Bộ lọc"
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full",
              filtersActive
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface"
            )}
          >
            <span aria-hidden className="grid gap-[3px]">
              <span className="block h-[2px] w-4 rounded bg-current" />
              <span className="block h-[2px] w-3 rounded bg-current" />
              <span className="block h-[2px] w-2 rounded bg-current" />
            </span>
          </button>
        )}
        {/* ⚠ Viên thuốc QUAY VÒNG bốn khoảng — một chạm là đổi, không mở
            thêm một lớp chọn nữa cho thứ người ta đổi liên tục. */}
        <button
          type="button"
          onClick={onCyclePeriod}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-surface-container-high px-4 text-[14px] font-bold text-on-surface"
        >
          {LIST_PERIOD_LABEL[period]}
          <span aria-hidden className="text-[10px] text-on-surface-variant">▼</span>
        </button>
        {filtersActive && (
          <button
            type="button"
            onClick={onClearFilters}
            className="h-10 shrink-0 px-3 text-[14px] font-bold text-primary"
          >
            Xoá lọc
          </button>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 px-1">
        <span className="min-w-0">
          <span className="block truncate text-[18px] font-bold text-on-surface">{label}</span>
          <span className="mt-0.5 block truncate text-[14px] font-semibold text-on-surface-variant">
            {countText}
          </span>
        </span>
        <span className="whitespace-nowrap pt-0.5 text-[21px] font-extrabold tabular-data text-on-surface">
          {total ?? "—"}
        </span>
      </div>
    </div>
  )
}
