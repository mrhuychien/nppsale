"use client"

import { Search, SlidersHorizontal, X } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"

/**
 * Một hàng lọc duy nhất trên mobile: [ô tìm][nút Lọc + số badge].
 *
 * Mọi thứ còn lại — lọc nâng cao, FilterPicker, chọn ngày — chui vào bottom
 * sheet. Trước đây bốn màn danh sách xếp chồng ô tìm, nút "Bộ lọc nâng
 * cao", FilterPicker và ColumnPicker thành bốn hàng riêng, đẩy bản ghi đầu
 * tiên xuống quá mép màn hình.
 *
 * Số badge trên nút Lọc là thứ giữ cho việc giấu bộ lọc không thành giấu
 * mất trạng thái: người dùng luôn thấy đang có mấy bộ lọc bật.
 */
interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Số bộ lọc đang bật, KHÔNG tính ô tìm. */
  activeCount: number
  onClear?: () => void
  /** Nội dung sheet lọc. */
  children: React.ReactNode
  open: boolean
  onOpenChange: (o: boolean) => void
}

export function MobileFilterBar({
  value,
  onChange,
  placeholder = "Tìm…",
  activeCount,
  onClear,
  children,
  open,
  onOpenChange,
}: Props) {
  return (
    <>
      {/* `top-below-appbar` neo theo --app-bar-h, không phải một con số
          cứng — app bar đổi chiều cao thì hàng này đi theo. */}
      <div className="lg:hidden sticky top-below-appbar z-30 -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-outline-variant/50">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              inputMode="search"
              enterKeyHint="search"
              aria-label={placeholder}
              // text-base (16px): iOS tự phóng to trang khi focus vào ô
              // nhập nhỏ hơn 16px, và không tự thu lại.
              className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-11 text-base"
            />
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                aria-label="Xoá tìm kiếm"
                className="tap absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center"
              >
                <X className="h-4 w-4 text-on-surface-variant" />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            className="tap relative shrink-0 px-3"
            onClick={() => onOpenChange(true)}
            aria-label={activeCount > 0 ? `Bộ lọc (${activeCount} đang bật)` : "Bộ lọc"}
          >
            <SlidersHorizontal className="h-5 w-5" />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary">
                {activeCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="lg:hidden">
          <div className="space-y-4">{children}</div>
          <div className="mt-6 flex gap-2">
            {onClear && (
              <Button variant="outline" className="h-12 flex-1" onClick={onClear}>
                Xoá lọc
              </Button>
            )}
            <Button className="h-12 flex-1" onClick={() => onOpenChange(false)}>
              Xem kết quả
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
