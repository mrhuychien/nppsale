"use client"

/**
 * DẢI THỐNG KÊ TRẠNG THÁI — một hàng viên thuốc, không khung, không thẻ.
 *
 * ⚠ THAY CHO `PipelineTabs` (chủ nhà chốt 20/09/2026: "phần stats thống
 * kê trạng thái này cho về đơn giản dễ nhìn thôi, không cần làm khung
 * như cũ nữa"). Bản cũ là một thẻ có viền, chia ô đều nhau, mỗi ô một
 * con số cỡ 22px — đẹp khi có ba ô, nhưng nó ÉP số ô: bốn ô đã phải thu
 * đệm và cỡ chữ để vừa màn 375px, và ô thứ năm thì không còn chỗ.
 *
 * ⚠ CHÍNH CÁI TRẦN ẤY LÀ THỨ LÀM MẤT ĐƠN. Vì chỉ vừa bốn ô nên trạng
 * thái `partially_invoiced` không được một ô nào, và đơn xuất thiếu biến
 * mất khỏi mọi tab. Hàng viên thuốc CUỘN NGANG thì không có trần: thêm
 * một trạng thái là thêm một viên, không phải đo lại cả dải.
 *
 * ⚠ CHẤM MÀU GIỮ LẠI NGÔN NGỮ MÀU CỦA `orderTone`. Bỏ hẳn màu thì dải
 * này chỉ còn là chữ, và người dùng mất cách nhận ra "còn việc" (hổ
 * phách) với "xong" (xanh) mà không phải đọc.
 */

import { cn } from "@/lib/utils"

export interface StatusChip {
  key: string
  label: string
  count: number
  /** Màu chấm — lấy từ `orderTone` / `invoiceTone`. */
  accent: string
}

export function StatusChips({
  chips,
  active,
  onPick,
  className,
}: {
  chips: StatusChip[]
  active: string
  onPick: (key: string) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      // ⚠ `-mx-1 px-1`: chừa chỗ cho viền viên thuốc đầu/cuối khỏi bị cắt
      //   khi dải cuộn ngang.
      className={cn("-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5", className)}
    >
      {chips.map((c) => {
        const on = c.key === active
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(c.key)}
            className={cn(
              // h-9 = 36px, đúng ngưỡng vùng chạm tối thiểu của dự án.
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors",
              on
                ? "bg-on-surface text-surface"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            )}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: c.accent }}
            />
            <span className="whitespace-nowrap">{c.label}</span>
            <span className={cn("tabular-data", on ? "opacity-90" : "text-on-surface")}>
              {c.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
