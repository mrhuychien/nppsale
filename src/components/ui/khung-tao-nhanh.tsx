"use client"

/**
 * KHUNG TẠO NHANH — mở biểu mẫu tạo mới NGAY TẠI CHỖ, chứng từ đang làm dở không mất.
 *
 * Chủ nhà 03/10/2026 (Update 3.10, mục 4): "Khi tạo xong sản phẩm hoặc NCC -> bấm xong thì quay về phần đang
 * làm … add luôn khách vừa thêm vào". Máy tính: hộp thoại (sm:max-w-2xl, cuộn được). Điện thoại: tấm trượt
 * từ đáy phủ kín màn (`useKhoMay` — cùng mốc `lg` các màn khác dùng để tách bố cục).
 */
import type { ReactNode } from "react"
import { X } from "lucide-react"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function KhungTaoNhanh({
  open,
  onOpenChange,
  tieuDe,
  moTa,
  children,
  tuVeDauDienThoai = false,
  testId = "khung-tao-nhanh",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tieuDe: string
  moTa?: string
  children: ReactNode
  /** Điện thoại: nội dung TỰ vẽ đầu trang (vd `TaoKhachDienThoai`) — khung chỉ giữ tiêu đề cho trình đọc màn hình. */
  tuVeDauDienThoai?: boolean
  testId?: string
}) {
  const laMay = useKhoMay()
  /* ⚠ Cổng (portal) đưa khung ra ngoài DOM, nhưng sự kiện React vẫn nổi theo cây component: nơi gọi đặt khung
     trong một <form> thì bấm Lưu ở đây là gửi luôn chứng từ bên ngoài. Chặn tại đây. */
  const noiDung = <div onSubmit={(e) => e.stopPropagation()}>{children}</div>

  if (laMay === false) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          data-testid={testId}
          /* Phủ kín màn: bỏ bo góc, bỏ thanh kéo (con đầu `aria-hidden` của SheetContent). */
          className="h-[100dvh] max-h-[100dvh] gap-0 rounded-none bg-surface-container-low p-0 [&>div[aria-hidden]:first-child]:hidden"
        >
          {tuVeDauDienThoai ? (
            <>
              <SheetTitle className="sr-only">{tieuDe}</SheetTitle>
              <SheetDescription className="sr-only">{moTa ?? tieuDe}</SheetDescription>
            </>
          ) : (
            <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-outline-variant/60 bg-card px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base font-bold">{tieuDe}</SheetTitle>
                <SheetDescription className={cn("truncate text-xs", !moTa && "sr-only")}>{moTa ?? tieuDe}</SheetDescription>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => onOpenChange(false)}
                className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-outline-variant/60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
          <div className={cn(!tuVeDauDienThoai && "p-3.5 pb-safe")}>{noiDung}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId} className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          <DialogDescription className={cn(!moTa && "sr-only")}>{moTa ?? tieuDe}</DialogDescription>
        </DialogHeader>
        {noiDung}
      </DialogContent>
    </Dialog>
  )
}
