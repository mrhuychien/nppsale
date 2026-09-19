"use client"

import { cn } from "@/lib/utils"

/**
 * Hàng thẻ trạng thái trên MÁY TÍNH — theo mẫu thiết kế "Đơn hàng":
 * một thẻ trắng chia đều cột, mỗi ô là nhãn + con số to, ô đang chọn có
 * vạch màu ở đáy. Thay cho hàng chip nhỏ: trên màn rộng, con số là thứ
 * quản lý đọc trước ("bao nhiêu đơn đang chờ duyệt"), không phải nhãn.
 *
 * ⚠ Con số đến từ CÙNG phép đếm với danh sách bên dưới (server, cùng bộ
 * lọc) — chip và bảng lệch nhau là lỗi đã sửa một lần, không lặp lại.
 *
 * ⚠ BỐN Ô LÀ KHỔ CHẬT NHẤT PHẢI CHỊU ĐƯỢC. Cả hai màn dùng khuôn này
 * (đơn hàng, hóa đơn) nay đều có ô "Tất cả"; đệm và cỡ chữ vì thế co lại
 * ở điện thoại. Thêm ô thứ NĂM thì phải đo lại ở 375px, không thêm bừa.
 */
export interface PipelineTab {
  key: string
  label: string
  count: number
  /** Màu vạch đáy khi chọn. */
  accent: string
}

export function PipelineTabs({
  tabs,
  active,
  onPick,
  className,
}: {
  tabs: PipelineTab[]
  active: string
  onPick: (key: string) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "grid overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t, i) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(t.key)}
            className={cn(
              // ⚠ ĐỆM NGANG PHẢI CO Ở ĐIỆN THOẠI. Từ khi có thêm ô "Tất
              // cả" là bốn cột chia một màn 375px — để nguyên px-4 thì
              // mỗi ô còn ~54px cho chữ và "Hoàn thành" cụt thành "Hoàn…".
              "relative grid gap-1 px-2 py-3 text-left transition-colors hover:bg-surface-container-low sm:px-4 sm:py-3.5",
              i > 0 && "border-l border-outline-variant/40",
              on ? "bg-surface-container-low" : "bg-transparent"
            )}
          >
            <span
              className={cn(
                "truncate text-[11px] font-bold sm:text-xs",
                on ? "text-on-surface" : "text-on-surface-variant"
              )}
            >
              {t.label}
            </span>
            <span
              className={cn(
                "text-[19px] font-extrabold leading-none tabular-data sm:text-[22px]",
                t.count === 0 ? "text-outline-variant" : "text-on-surface"
              )}
            >
              {t.count}
            </span>
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[3px]"
              style={{ background: on ? t.accent : "transparent" }}
            />
          </button>
        )
      })}
    </div>
  )
}
