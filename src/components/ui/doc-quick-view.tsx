"use client"

/**
 * NGĂN XEM NHANH DÙNG CHUNG — cho các danh sách chưa có ngăn xem nhanh riêng.
 *
 * ⚠ CÙNG KHUÔN NGĂN ĐƠN / HÓA ĐƠN / PHIẾU TRẢ (chủ nhà 27/09/2026: "Làm chung form hiển thị
 *   danh sách cho toàn bộ các danh sách"): tiêu đề mã chứng từ + ngày, huy hiệu trạng thái
 *   góc phải, các ô thông tin, tổng tiền, nút ở chân. Bấm dòng mở ngăn này → giữ nguyên bộ lọc
 *   và chỗ đang đứng; nút "Chi tiết" mở TAB MỚI như ngăn hóa đơn.
 */

import type { ReactNode } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { NewTabLink } from "@/components/ui/new-tab-link"

export interface QuickField {
  label: string
  value: ReactNode
  /** Chiếm cả hàng. */
  wide?: boolean
}

export function DocQuickView({
  open,
  onClose,
  title,
  subtitle,
  badge,
  fields,
  total,
  children,
  detailHref,
  actions,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  badge?: ReactNode
  fields: QuickField[]
  /** Dòng tổng đậm cuối ngăn. */
  total?: { label: string; value: string }
  children?: ReactNode
  /** Trang chi tiết (tab mới). */
  detailHref?: string
  /** Nút thêm ở chân — ví dụ Xoá (tự kiểm quyền ở nơi gọi). */
  actions?: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
        <div className="flex items-center gap-2.5 border-b border-outline-variant/40 py-4 pl-5 pr-14">
          <span className="min-w-0 flex-1">
            <SheetTitle className="block truncate font-mono text-lg font-extrabold text-on-surface">{title}</SheetTitle>
            {subtitle && <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">{subtitle}</span>}
          </span>
          {badge}
        </div>

        <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5">
            {fields.map((f) => (
              <div key={f.label} className={`rounded-xl bg-surface-container-low p-3 ${f.wide ? "col-span-2" : ""}`}>
                <span className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">{f.label}</span>
                <span className="mt-1 block text-sm font-extrabold text-on-surface [overflow-wrap:anywhere]">
                  {f.value === null || f.value === undefined || f.value === "" ? "—" : f.value}
                </span>
              </div>
            ))}
          </div>
          {children}
          {total && (
            <div className="flex justify-between rounded-xl bg-surface-container-low px-3 py-3 text-sm font-extrabold">
              <span>{total.label}</span>
              <span className="tabular-data">{total.value}</span>
            </div>
          )}
        </div>

        {(detailHref || actions) && (
          <div className="flex gap-2 border-t border-outline-variant/40 px-5 pb-5 pt-3">
            {actions}
            {detailHref && (
              <NewTabLink href={detailHref} className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary">
                Chi tiết
              </NewTabLink>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
