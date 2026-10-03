"use client"

/**
 * ĐẦU TRANG ĐIỆN THOẠI THEO BẢN THIẾT KẾ KHO / TỔNG QUAN / SẢN PHẨM — chủ nhà 30/09/2026 gửi 8 màn
 * ("Làm lại các màn Tổng quan, Danh sách phiếu kho, Phiếu nhập kho, Kiểm kê, Duyệt điều chỉnh, Quản lý
 * kho, Chi tiết phiếu, Danh sách sản phẩm").
 *
 *   `DauTrangXanh`  — màn gốc (Tổng quan, Kho hàng, Sản phẩm): ☰ · tiêu đề + dòng phụ · chuông · ảnh
 *                     đại diện; `children` là phần nằm TRONG dải xanh (thẻ trắng nổi lên thì để ngoài,
 *                     kéo `-mt-*`).
 *   `DauTrangTrang` — màn con / tác vụ (Phiếu kho, Nhập kho, Kiểm kê, Duyệt điều chỉnh, Chi tiết phiếu):
 *                     nút ← · tiêu đề + dòng phụ · một nút bên phải.
 * ⚠ Màn dùng hai đầu này phải ẩn app bar chuẩn (`hidesMobileAppBar`), không thì hai hàng tiêu đề.
 */

import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { NutMenuDauTrang } from "@/components/layout/mo-menu-context"
import { useAuth } from "@/hooks/use-auth"
import { viTatTen } from "@/lib/returns/mobile-list"
import { cn } from "@/lib/utils"

export function DauTrangXanh({
  title,
  subtitle,
  children,
  className,
  testId = "dau-xanh",
}: {
  title: string
  subtitle?: ReactNode
  children?: ReactNode
  className?: string
  testId?: string
}) {
  const { user } = useAuth()
  return (
    <div className={cn("bg-primary px-3.5 pb-4 pt-4 text-primary-foreground", className)} data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <div className="rounded-xl bg-primary-foreground/15 [&>button]:h-10 [&>button]:w-10 [&>button]:ml-0">
          <NutMenuDauTrang />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs opacity-85">{subtitle}</p>}
        </div>
        <div className="rounded-xl bg-primary-foreground/15 [&_button]:text-primary-foreground">
          <NotificationBell />
        </div>
        <UserMenu className="grid h-10 w-10 place-items-center rounded-full bg-primary-foreground text-sm font-bold text-primary">
          {viTatTen(user?.full_name)}
        </UserMenu>
      </div>
      {children}
    </div>
  )
}

export function DauTrangTrang({
  title,
  subtitle,
  backHref,
  action,
  className,
  testId = "dau-trang",
  onBack,
}: {
  title: string
  subtitle?: ReactNode
  /** Bỏ trống = lùi theo lịch sử. */
  backHref?: string
  action?: ReactNode
  className?: string
  testId?: string
  /** Thay cho điều hướng — khi màn nằm trong một khung tạo nhanh (bấm lùi = đóng khung). */
  onBack?: () => void
}) {
  const router = useRouter()
  return (
    <div
      className={cn("flex items-center gap-2.5 border-b border-outline-variant/60 bg-card px-3.5 py-3.5", className)}
      data-testid={testId}
    >
      <button
        type="button"
        aria-label="Quay lại"
        onClick={() => (onBack ? onBack() : backHref ? router.push(backHref) : router.back())}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-outline-variant/60 text-on-surface active:bg-surface-container-low"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold text-on-surface">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
