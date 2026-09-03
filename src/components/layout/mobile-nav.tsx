"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Boxes, BarChart3, Truck, CreditCard,
  Home, Plus, Package, UserCog, PackagePlus, type LucideIcon,
} from "lucide-react"

interface NavItem { label: string; href: string; icon: LucideIcon; module: Module }
interface NavAction { label: string; href: string; icon: LucideIcon; module: Module }

/**
 * 4 mục điều hướng — 2 bên trái, 2 bên phải nút hành động ở giữa.
 *
 * KHÔNG còn mục "Menu": menu mở bằng nút hamburger trên app bar, còn /home
 * vốn đã là lưới toàn bộ chức năng. Đổi lại có ô giữa cho nút "Tạo đơn" —
 * vùng ngón cái với tới dễ nhất của cả tay trái và tay phải.
 */
const ROLE_NAV: Record<Role, NavItem[]> = {
  owner: [
    { label: "Tổng quan", href: "/dashboard", icon: BarChart3, module: "reports" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Kho", href: "/inventory", icon: Boxes, module: "inventory" },
    { label: "Nhân sự", href: "/hr", icon: UserCog, module: "settings" },
  ],
  manager: [
    { label: "Tổng quan", href: "/dashboard", icon: BarChart3, module: "reports" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Khách", href: "/customers", icon: Users, module: "customers" },
    { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries" },
  ],
  accountant: [
    { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Hoá đơn", href: "/invoices", icon: Package, module: "invoices" },
    { label: "Báo cáo", href: "/reports", icon: BarChart3, module: "reports" },
  ],
  sales: [
    { label: "Trang chủ", href: "/home", icon: Home, module: "orders" },
    { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
    { label: "Khách", href: "/customers", icon: Users, module: "customers" },
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

/** Hành động chính của từng vai trò — nằm ở ô GIỮA thanh nav, không nổi. */
const ROLE_ACTION: Partial<Record<Role, NavAction>> = {
  sales: { label: "Tạo đơn", href: "/orders/new", icon: Plus, module: "orders" },
  owner: { label: "Tạo đơn", href: "/orders/new", icon: Plus, module: "orders" },
  manager: { label: "Tạo đơn", href: "/orders/new", icon: Plus, module: "orders" },
  warehouse: { label: "Nhập kho", href: "/inventory/stock-in", icon: PackagePlus, module: "inventory" },
}

/**
 * Tầng hiển thị trên mobile — giữ cùng một chỗ để không lệch nhau:
 *   nav : z-40
 *   lớp phủ + ngăn kéo menu (Sheet, xem components/ui/sheet.tsx) : z-50
 *   lớp phủ tìm kiếm : z-[60]
 * Trước đây nav và nút "+" cũng z-50 nên mở menu ra mà nav vẫn sáng rõ và
 * vẫn bấm được xuyên qua lớp phủ.
 */
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const items = (ROLE_NAV[role] || ROLE_NAV.sales)
    .filter((i) => canAccessModule(role, i.module))
    .slice(0, 4)
  const action = ROLE_ACTION[role]

  // Cần ít nhất 2 mục mới chia được hai bên; vai trò `driver` có 2 mục và
  // không có action nên rơi về grid 2 cột — vẫn đúng.
  const showAction = !!action && canAccessModule(role, action.module) && items.length >= 2
  const left = showAction ? items.slice(0, 2) : items
  const right = showAction ? items.slice(2, 4) : []
  const cols = left.length + (showAction ? 1 : 0) + right.length

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden pb-safe bg-surface-container-lowest/95 backdrop-blur-xl border-t border-outline-variant/60"
      aria-label="Điều hướng chính"
    >
      <div
        className="grid items-stretch h-[var(--bottom-nav-h)]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
      >
        {left.map((i) => (
          <NavTab key={i.href} item={i} active={isActive(pathname, i.href)} />
        ))}

        {showAction && action && (
          <Link
            href={action.href}
            aria-label={action.label}
            aria-current={isActive(pathname, action.href) ? "page" : undefined}
            className="relative flex flex-col items-center justify-end pb-1.5 -mt-2.5"
          >
            <span
              className={cn(
                "flex h-[52px] w-[52px] items-center justify-center rounded-2xl",
                "shadow-[0_6px_16px_-4px_hsl(222_83%_53%/0.45)] transition-transform active:scale-95",
                isActive(pathname, action.href)
                  ? "bg-primary-container text-on-primary ring-4 ring-primary/15"
                  : "bg-primary text-on-primary"
              )}
            >
              <action.icon className="h-6 w-6" strokeWidth={2.5} />
            </span>
            <span className="mt-0.5 text-[10px] font-bold leading-none text-primary">
              {action.label}
            </span>
          </Link>
        )}

        {right.map((i) => (
          <NavTab key={i.href} item={i} active={isActive(pathname, i.href)} />
        ))}
      </div>
    </nav>
  )
}

function NavTab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 px-1",
        "transition-colors active:bg-surface-container-low",
        active ? "text-primary" : "text-on-surface-variant"
      )}
    >
      {/* Chỉ báo trang hiện tại — pill mỏng trên đỉnh ô. Chữ đậm một mình
          không đủ để nhận ra ở cỡ 10px. */}
      <span
        className={cn(
          "absolute top-0 h-[3px] w-8 rounded-b-full transition-opacity",
          active ? "bg-primary opacity-100" : "opacity-0"
        )}
      />
      <item.icon className={cn("h-[22px] w-[22px]", active && "stroke-[2.5px]")} />
      <span
        className={cn(
          "max-w-full truncate text-[10px] leading-none",
          active ? "font-bold" : "font-medium"
        )}
      >
        {item.label}
      </span>
    </Link>
  )
}
