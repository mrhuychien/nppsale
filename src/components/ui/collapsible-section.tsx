"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Khối gập được — CHỈ gập trên mobile, desktop luôn mở và không có nút gập.
 *
 * VÌ SAO: trang chi tiết đơn có bốn khối lịch sử (kho, sửa dòng, trạng
 * thái…) xếp sau nội dung chính. Trên desktop chúng nằm ở cột phụ hoặc
 * dưới màn hình rộng nên vô hại; trên điện thoại chúng đẩy phần cần đọc
 * (tổng tiền, nút hành động) xuống 4–5 màn cuộn. Đo trên máy thật: đơn 8
 * dòng phải cuộn 3.400px mới thấy hết trang.
 *
 * KHÔNG dùng thẻ <details>: muốn "đóng trên mobile, mở trên desktop" thì
 * phải chống lại quy tắc ẩn nội dung của trình duyệt bằng CSS — mỗi trình
 * duyệt ẩn một kiểu (`::details-content`, slot ẩn…). Dựng bằng state thì
 * hành vi giống nhau ở mọi nơi.
 *
 * Nút gập cao 44px và nằm TRỌN chiều ngang: ngón tay cái bấm được mà
 * không cần ngắm.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest lg:border-0 lg:bg-transparent lg:rounded-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="tap flex w-full items-center justify-between gap-2 px-4 py-3 text-left lg:hidden"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {subtitle ? (
            <span className="block text-xs text-on-surface-variant">{subtitle}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-on-surface-variant transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>
      {/* lg:block — desktop bỏ qua state, luôn hiện. */}
      <div className={cn(open ? "block" : "hidden", "lg:block")}>{children}</div>
    </div>
  )
}
