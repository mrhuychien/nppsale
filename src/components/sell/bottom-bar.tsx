"use client"

import { cn } from "@/lib/utils"

/**
 * Thanh hành động dính đáy của luồng bán hàng.
 *
 * ⚠ `fixed inset-x-0` NEO THEO CỬA SỔ, KHÔNG THEO CỘT NỘI DUNG. Trên máy
 * tính, thanh menu bên trái rộng `lg:w-60` (240px) và nằm cạnh phần nội
 * dung; một thanh `inset-x-0` chạy thẳng qua dưới nó, che mất mục cuối của
 * menu. Trên điện thoại không thấy vì menu bên trái ẩn hẳn — nên lỗi này
 * chỉ lộ ra khi có ai mở màn bán hàng bằng máy tính.
 *
 * Gom về một chỗ vì có BA màn dùng (giỏ hàng, điều khoản, hàng trả). Ba
 * bản chép tay thì bản nào sửa sau sẽ lệch.
 */
export const SELL_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-30 lg:left-60 border-t border-outline-variant/60 " +
  "bg-surface-container-lowest/95 px-4 pb-[calc(var(--safe-b)+16px)] pt-2.5 backdrop-blur-xl"

export function SellBottomBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(SELL_BAR_CLASS, className)}>{children}</div>
}
