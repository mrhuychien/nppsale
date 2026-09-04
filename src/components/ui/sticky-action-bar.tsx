"use client"

import { cn } from "@/lib/utils"

/**
 * Thanh hành động dính đáy trên mobile, luôn nằm NGAY TRÊN thanh nav.
 *
 * Trang dùng nó PHẢI thêm lớp `pb-nav-action` cho vùng nội dung, nếu
 * không thanh này che mất phần cuối trang — đúng chỗ thường có nút hoặc
 * dòng tổng cần đọc.
 *
 * Mang lớp `kb-hide` nên tự trốn khi bàn phím ảo mở (xem globals.css +
 * use-keyboard-open) — thanh dính đáy đè lên ô đang gõ là lỗi thường gặp
 * nhất của biểu mẫu trên điện thoại.
 *
 * Quy tắc dùng: MỘT hành động chính (nút đặc, flex-1, h-12) và tối đa MỘT
 * hành động phụ (nút viền 44px). Nhồi thêm nút thứ ba là quay lại đúng
 * cái mớ nút rải rác mà thanh này sinh ra để dọn.
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "lg:hidden fixed inset-x-0 bottom-above-nav z-30 flex items-center gap-2 px-4 py-2.5",
        "border-t border-outline-variant bg-surface-container-lowest/95 backdrop-blur-xl",
        "shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.25)] transition-transform duration-150 kb-hide",
        className
      )}
    >
      {children}
    </div>
  )
}
