"use client"

import { useRef, useState } from "react"
import { Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

/** Kéo qua bao nhiêu px thì tính là muốn xoá. */
const THRESHOLD = 96
/** Ngưỡng phân biệt vuốt NGANG với cuộn DỌC, đo ở lần chạm đầu tiên. */
const AXIS_LOCK = 10

/**
 * Vuốt sang trái để xoá — chỉ trên mobile (desktop có nút riêng).
 *
 * VÌ SAO KHÔNG chỉ dùng nút X: thẻ dòng hàng đã bị nén còn 2 hàng (M3.3e),
 * nhét thêm một nút 44px vào là mất 1/4 chiều ngang cho thao tác hiếm
 * nhất. Vuốt lấy 0px.
 *
 * VÌ SAO PHẢI KHOÁ TRỤC: danh sách dòng hàng cuộn dọc. Không phân biệt
 * trục thì mỗi lần cuộn hơi chéo tay là một dòng bị kéo ra — và người ta
 * cuộn danh sách này liên tục. Quyết định trục MỘT LẦN ở lần di chuyển
 * đầu, rồi giữ nguyên tới khi nhấc tay.
 *
 * VÌ SAO KHÔNG xoá ngay: xoá dòng vừa nhập mà không hoàn tác được là mất
 * cả giá, VAT, ghi chú đã gõ. Nơi gọi phải cho hoàn tác — xem
 * `useUndoableRemove`.
 */
export function SwipeToDelete({
  onDelete,
  disabled,
  children,
  className,
}: {
  onDelete: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  // null = chưa quyết; "x" = đang vuốt ngang; "y" = đang cuộn, bỏ qua.
  const axis = useRef<null | "x" | "y">(null)

  const reset = () => {
    start.current = null
    axis.current = null
    setDx(0)
  }

  if (disabled) return <div className={className}>{children}</div>

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Nền đỏ lộ dần ra sau thẻ. Chỉ là chỉ báo — không bấm được, để
          không ai bấm nhầm vào nó khi thẻ đang trượt. */}
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-error px-4 text-on-error"
        style={{ width: Math.max(0, -dx) }}
      >
        <Trash2 className="h-5 w-5" />
      </div>
      <div
        style={{ transform: `translateX(${dx}px)` }}
        className={dx === 0 ? "transition-transform duration-150" : undefined}
        onTouchStart={(e) => {
          const t = e.touches[0]
          start.current = { x: t.clientX, y: t.clientY }
          axis.current = null
        }}
        onTouchMove={(e) => {
          if (!start.current) return
          const t = e.touches[0]
          const mx = t.clientX - start.current.x
          const my = t.clientY - start.current.y
          if (axis.current === null) {
            if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return
            axis.current = Math.abs(mx) > Math.abs(my) ? "x" : "y"
          }
          if (axis.current !== "x") return
          // Chỉ cho kéo sang TRÁI, và chặn ở 1.4× ngưỡng để thẻ không bay
          // khỏi màn hình.
          setDx(Math.max(-THRESHOLD * 1.4, Math.min(0, mx)))
        }}
        onTouchEnd={() => {
          const shouldDelete = axis.current === "x" && dx <= -THRESHOLD
          reset()
          if (shouldDelete) onDelete()
        }}
        onTouchCancel={reset}
      >
        {children}
      </div>
    </div>
  )
}
