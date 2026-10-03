"use client"

/**
 * DÒNG "+ TẠO … MỚI" cho các ô tìm TỰ VẼ danh sách (hộp thoại chọn hàng ở phiếu xuất kho, sửa đơn, kiểm kê) —
 * cùng chữ, cùng dáng với dòng của `SearchSelect` / `ProductPicker` (chủ nhà 03/10/2026, Update 3.10).
 *
 * mousedown chặn mặc định: ô tìm không mất tiêu điểm (danh sách đóng theo `onBlur`) trước khi cú bấm tới nơi.
 */
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { nhanTaoMoi } from "@/lib/ui/tao-moi"

export function DongTaoMoi({
  nhan,
  chu,
  onTao,
  testId = "dong-tao-moi",
  className,
}: {
  nhan: string
  /** Chữ đang gõ ở ô tìm — hiện trong ngoặc kép và chuyển cho `onTao`. */
  chu: string
  onTao: (chu: string) => void
  testId?: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onTao(chu.trim())}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-muted/60",
        className
      )}
    >
      <Plus className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{nhanTaoMoi(nhan, chu)}</span>
    </button>
  )
}
