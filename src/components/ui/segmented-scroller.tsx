"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Một hàng chip lọc cuộn ngang, thay cho lưới chip nhiều dòng.
 *
 * Bốn màn danh sách đang có tới HAI hàng chip (pipeline + trạng thái), mỗi
 * hàng tự xuống dòng trên màn hẹp. Gộp về một hàng cuộn ngang lấy lại
 * khoảng 90px chiều cao và giữ mọi lựa chọn ở đúng một chỗ.
 *
 * Chip cao 40px — thấp hơn sàn 44px một chút vì chúng nằm sát nhau trong
 * một hàng cuộn, nơi bấm nhầm chỉ đổi bộ lọc chứ không phá dữ liệu. Đây là
 * ngoại lệ có chủ ý, không phải bỏ sót.
 */
export interface Segment {
  key: string
  label: string
  count?: number
}

export function SegmentedScroller({
  segments,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  segments: Segment[]
  value: string | null
  onChange: (k: string | null) => void
  className?: string
  ariaLabel?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)

  // Cuộn chip đang chọn vào giữa. Không có nó thì chọn một chip ở cuối dãy
  // rồi tải lại trang là chip đó nằm ngoài màn hình — người dùng không thấy
  // bộ lọc nào đang bật.
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-key="${value ?? ""}"]`)
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
  }, [value])

  return (
    <div
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      className={cn("row-scroll overscroll-x-none -mx-4 px-4 py-2", className)}
    >
      {segments.map((s) => {
        const active = value === s.key
        return (
          <button
            key={s.key}
            data-key={s.key}
            type="button"
            // Bấm lại chip đang chọn = bỏ chọn. Không có đường này thì
            // người dùng phải tìm chip "Tất cả" mới thoát được bộ lọc.
            onClick={() => onChange(active ? null : s.key)}
            aria-pressed={active}
            className={cn(
              "h-10 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
              active
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            )}
          >
            {s.label}
            {typeof s.count === "number" && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  active ? "bg-on-primary/20" : "bg-surface-container-high"
                )}
              >
                {s.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
