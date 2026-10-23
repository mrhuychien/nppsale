"use client"

import { lazy, Suspense, useState, type ReactNode } from "react"
import { Home, Wallet, BarChart3, Settings, HelpCircle } from "lucide-react"

/** Các mục của menu người dùng — mục nào không có quyền thì ẩn (`canSeeHref`). */
export const MUC_MENU_NGUOI_DUNG = [
  { href: "/home", label: "Trang chủ", icon: Home },
  { href: "/luong-cua-toi", label: "Phiếu lương của tôi", icon: Wallet },
  { href: "/dashboard", label: "Tổng quan", icon: BarChart3 },
  { href: "/settings", label: "Cài đặt", icon: Settings },
  { href: "/help", label: "Trợ giúp", icon: HelpCircle },
] as const

/** Chữ viết tắt cho ảnh đại diện: "Nguyễn Thị Hiền" → "NH". */
export function chuVietTat(ten: string | null | undefined): string {
  const w = String(ten ?? "").trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return "U"
  return ((w[0][0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase()
}

const MenuNguoiDungDay = lazy(() => import("./user-menu-day").then((m) => ({ default: m.MenuNguoiDungDay })))

/**
 * MENU NGƯỜI DÙNG — chủ nhà 26/09/2026: "bấm vào icon và tên người dùng phải ra menu người
 * dùng". Một chỗ cho mọi nơi hiện ảnh đại diện / tên (thanh trên, trang chủ, đầu trang xanh
 * của Đơn hàng / Khách hàng): tên + vai, các lối đi nhanh theo quyền, Đăng xuất.
 * `children` là phần bấm được (ảnh đại diện, kèm tên nếu có).
 *
 * ⚠ MENU TẢI LƯỜI (chủ nhà 23/10/2026 "load trang chậm lắm"): menu thả (Radix DropdownMenu + định vị) chỉ cần khi bấm,
 *   mà nút này có ở MỌI màn — nên trước lần bấm đầu chỉ là một nút thường; bấm thì tải phần menu (chạm / rê chuột là
 *   tải trước) và mở luôn. Sau đó là menu thường.
 */
export function UserMenu({ children, label = "Tài khoản", className }: { children: ReactNode; label?: string; className?: string }) {
  const [can, setCan] = useState(false)
  const taiMenu = () => void import("./user-menu-day")
  const nutTruoc = (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={false}
      className={className}
      onPointerEnter={taiMenu}
      onTouchStart={taiMenu}
      onFocus={taiMenu}
      onClick={() => setCan(true)}
    >
      {children}
    </button>
  )
  if (!can) return nutTruoc
  return (
    <Suspense fallback={nutTruoc}>
      <MenuNguoiDungDay label={label} className={className} moNgay>
        {children}
      </MenuNguoiDungDay>
    </Suspense>
  )
}
