"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Khuôn thẻ chung cho mọi danh sách trên mobile.
 *
 * Hai dòng: tiêu đề + TIỀN ở dòng 1, phụ đề + badge ở dòng 2. Tiền nằm bên
 * phải dòng đầu vì đó là thứ NVBH quét mắt tìm — chôn nó ở dòng thứ tư như
 * bảng desktop là bắt người ta đọc cả thẻ mới thấy con số cần thấy.
 *
 * Cả thẻ là MỘT vùng chạm. Bốn màn danh sách trước đây rải checkbox 16px,
 * nút 32px và link chữ nhỏ khắp thẻ — riêng /orders đo được 107 vùng chạm
 * dưới 44px.
 */
export function MobileRecordCard({
  href,
  title,
  subtitle,
  amount,
  amountTone = "default",
  badges,
  accent,
  footer,
  selected,
  onSelect,
  onLongPress,
}: {
  href: string
  title: string
  subtitle?: React.ReactNode
  amount?: string
  amountTone?: "default" | "danger" | "success"
  badges?: React.ReactNode
  accent?: "warning" | "danger" | null
  /** Hàng nút hành động dưới thẻ — nằm NGOÀI vùng chạm chính. */
  footer?: React.ReactNode
  selected?: boolean
  /** Chỉ truyền khi đang ở chế độ chọn nhiều. Có nó thì thẻ là nút, không phải link. */
  onSelect?: () => void
  onLongPress?: () => void
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-on-surface">
          {title}
        </h3>
        {amount && (
          <span
            className={cn(
              "shrink-0 text-[15px] font-bold tabular-data",
              amountTone === "danger"
                ? "text-error"
                : amountTone === "success"
                  ? "text-tertiary"
                  : "text-on-surface"
            )}
          >
            {amount}
          </span>
        )}
      </div>
      {(subtitle || badges) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-on-surface-variant">
          {subtitle}
          {badges}
        </div>
      )}
    </>
  )

  const cls = cn(
    "block rounded-xl border bg-surface-container-lowest p-3.5 shadow-card transition-transform active:scale-[0.99]",
    selected ? "border-primary bg-primary-fixed/40" : "border-outline-variant/60",
    accent === "warning" && "border-l-4 border-l-[#fdb022]",
    accent === "danger" && "border-l-4 border-l-error"
  )

  // Nhấn giữ để bật chế độ chọn — không cần nút riêng chiếm chỗ trên thanh.
  const longPress = useLongPress(onLongPress)


  return (
    <div className={cn(footer && "space-y-0")}>
      {onSelect ? (
        <button type="button" onClick={onSelect} className={cn(cls, "w-full text-left")}>
          {body}
        </button>
      ) : (
        <Link href={href} className={cls} {...longPress}>
          {body}
        </Link>
      )}
      {/* Hành động nằm NGOÀI vùng chạm chính: nằm trong thì bấm nút cũng
          mở luôn bản ghi, và người dùng không hiểu vì sao. */}
      {footer && <div className="mt-1.5 flex gap-2">{footer}</div>}
    </div>
  )
}

/**
 * Nhấn giữ 500ms để bật chế độ chọn.
 *
 * Bộ đếm giờ nằm trong `ref`, KHÔNG phải biến cục bộ: giữa lúc chạm xuống
 * và lúc nhấc tay thường có một lần render lại (state đổi), mà biến cục bộ
 * thì mỗi lần render là một biến mới — `onTouchEnd` của lần render sau
 * không huỷ được bộ đếm do `onTouchStart` của lần render trước đặt, và
 * thao tác vẫn nổ dù ngón tay đã rời.
 *
 * Huỷ cả khi ngón tay DI CHUYỂN — không thì cuộn danh sách cũng bật chế độ
 * chọn.
 */
function useLongPress(handler?: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = React.useRef(false)

  const clear = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  // Dọn khi thẻ bị gỡ khỏi cây — cuộn qua một danh sách dài là gỡ hàng
  // chục thẻ, mỗi thẻ để lại một bộ đếm treo là rò rỉ thật.
  React.useEffect(() => clear, [clear])

  if (!handler) return {}
  return {
    onTouchStart: () => {
      fired.current = false
      clear()
      timer.current = setTimeout(() => {
        fired.current = true
        handler()
      }, 500)
    },
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
    // Nhấn giữ đã nổ thì cú chạm đó KHÔNG được mở bản ghi nữa.
    onClick: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        fired.current = false
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Android bật menu ngữ cảnh khi nhấn giữ — chặn để nó không đè lên
      // chính thao tác mình vừa nhận.
      e.preventDefault()
    },
  }
}
