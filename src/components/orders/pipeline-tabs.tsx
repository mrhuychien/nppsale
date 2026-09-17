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
              "relative grid gap-1 px-4 py-3.5 text-left transition-colors hover:bg-surface-container-low",
              i > 0 && "border-l border-outline-variant/40",
              on ? "bg-surface-container-low" : "bg-transparent"
            )}
          >
            <span
              className={cn(
                "truncate text-xs font-bold",
                on ? "text-on-surface" : "text-on-surface-variant"
              )}
            >
              {t.label}
            </span>
            <span
              className={cn(
                "text-[22px] font-extrabold leading-none tabular-data",
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
