"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, BarChart3, Truck,
  CreditCard, Home, Plus, Menu, UserCog,
} from "lucide-react"

interface MobileNavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

// Role-specific nav items - show what matters most for each role
const ROLE_NAV: Record<Role, MobileNavItem[]> = {
  owner: [
    { label: "Tổng quan", href: "/dashboard", icon: BarChart3, module: "reports" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Kho", href: "/inventory", icon: Boxes, module: "inventory" },
    { label: "Nhân sự", href: "/hr", icon: UserCog, module: "settings" },
  ],
  manager: [
    { label: "Tổng quan", href: "/dashboard", icon: BarChart3, module: "reports" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "KH", href: "/customers", icon: Users, module: "customers" },
    { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries" },
  ],
  accountant: [
    { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Hóa đơn", href: "/invoices", icon: Package, module: "invoices" },
    { label: "Báo cáo", href: "/reports", icon: BarChart3, module: "reports" },
  ],
  sales: [
    { label: "Trang chủ", href: "/home", icon: Home, module: "orders" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "KH", href: "/customers", icon: Users, module: "customers" },
    { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
  ],
  warehouse: [
    { label: "Kho", href: "/inventory", icon: Boxes, module: "inventory" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries" },
    { label: "Sản phẩm", href: "/products", icon: Package, module: "products" },
  ],
  driver: [
    { label: "Chuyến", href: "/deliveries", icon: Truck, module: "deliveries" },
    { label: "Thu tiền", href: "/receivables/collect", icon: CreditCard, module: "receivables" },
  ],
}

/**
 * Tầng hiển thị trên mobile — giữ cùng một chỗ để không lệch nhau:
 *   nav + FAB : z-40
 *   lớp phủ + ngăn kéo menu (Sheet, xem components/ui/sheet.tsx) : z-50
 * Trước đây cả ba đều z-50 nên mở menu ra mà nav và nút "+" vẫn sáng rõ
 * và vẫn bấm được xuyên qua lớp phủ.
 */

/** Chiều cao thực tế của thanh nav (px) — dashboard-shell dùng để chừa đệm. */
export const MOBILE_NAV_HEIGHT = 88
/** Đỉnh của nút "+" tính từ đáy màn hình (px) = bottom 88 + cao 48. */
export const MOBILE_FAB_TOP = 136

// Role-specific quick action (FAB)
const ROLE_FAB: Partial<Record<Role, { label: string; href: string }>> = {
  sales: { label: "Tạo đơn", href: "/orders/new" },
  owner: { label: "Tạo đơn", href: "/orders/new" },
  manager: { label: "Tạo đơn", href: "/orders/new" },
  warehouse: { label: "Nhập kho", href: "/inventory/stock-in" },
}

/**
 * Có hiện nút "+" trên route này không.
 *
 * Ẩn ở hai chỗ:
 *  • Chính trang đích của nút — bấm vào là đứng yên tại chỗ.
 *  • Các trang biểu mẫu (/new, /edit) — ở đó nút đè lên ô nhập và dòng
 *    cảnh báo tồn kho, tức là che cả thứ bấm được lẫn thứ cần đọc.
 *
 * dashboard-shell dùng chung hàm này để biết có phải chừa thêm đệm đáy
 * cho nút hay không.
 */
export function hasMobileFab(role: Role, pathname: string): boolean {
  const fab = ROLE_FAB[role]
  if (!fab) return false
  if (pathname === fab.href || pathname.startsWith(fab.href + "/")) return false
  if (/\/(new|edit)(\/|$)/.test(pathname)) return false
  return true
}

interface MobileNavProps {
  role: Role
  onMenuClick?: () => void
}

export function MobileNav({ role, onMenuClick }: MobileNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const items = (ROLE_NAV[role] || ROLE_NAV.sales)
    .filter((item) => canAccessModule(role, item.module))
    .slice(0, 4)
  const fab = hasMobileFab(role, pathname) ? ROLE_FAB[role] : null

  return (
    <>
      {/* FAB - floating action button above nav */}
      {fab && (
        <button
          onClick={() => router.push(fab.href)}
          className="fixed right-5 bottom-[88px] z-40 lg:hidden w-12 h-12 bg-primary text-on-primary rounded-xl shadow-card-hover flex items-center justify-center active:scale-95 transition-transform"
          title={fab.label}
        >
          <Plus className="h-5 w-5" />
        </button>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/60 rounded-t-2xl safe-area-bottom">
        <div className="flex items-center justify-around px-2 pt-2 pb-5">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg px-3 py-1.5 transition-all min-w-[60px]",
                  isActive
                    ? "bg-primary/[0.08] text-primary"
                    : "text-on-surface-variant active:scale-95"
                )}
              >
                <item.icon className={cn("h-[18px] w-[18px]", isActive && "stroke-[2.5px]")} />
                <span className={cn(
                  "text-[10px] mt-0.5 font-medium",
                  isActive && "font-bold"
                )}>
                  {item.label}
                </span>
              </Link>
            )
          })}
          <button
            onClick={onMenuClick}
            className="flex flex-col items-center justify-center rounded-lg px-3 py-1.5 transition-all min-w-[60px] text-on-surface-variant active:scale-95"
          >
            <Menu className="h-[18px] w-[18px]" />
            <span className="text-[10px] mt-0.5 font-medium">Menu</span>
          </button>
        </div>
      </nav>
    </>
  )
}
