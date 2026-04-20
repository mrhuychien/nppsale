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
    { label: "Trip", href: "/driver/trip", icon: Truck, module: "deliveries" },
  ],
}

// Role-specific quick action (FAB)
const ROLE_FAB: Partial<Record<Role, { label: string; href: string }>> = {
  sales: { label: "Tạo đơn", href: "/orders/new" },
  owner: { label: "Tạo đơn", href: "/orders/new" },
  manager: { label: "Tạo đơn", href: "/orders/new" },
  warehouse: { label: "Nhập kho", href: "/inventory/stock-in" },
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
  const fab = ROLE_FAB[role]

  return (
    <>
      {/* FAB - floating action button above nav */}
      {fab && (
        <button
          onClick={() => router.push(fab.href)}
          className="fixed right-5 bottom-[88px] z-50 lg:hidden w-14 h-14 bg-gradient-primary text-white rounded-full shadow-[0_8px_30px_-4px_rgba(0,74,198,0.5)] flex items-center justify-center active:scale-95 transition-transform"
          title={fab.label}
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden glass-panel rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.05)] safe-area-bottom">
        <div className="flex items-center justify-around px-2 pt-2 pb-5">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl px-3 py-1.5 transition-all min-w-[60px]",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground active:scale-95"
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "stroke-[2.5px]")} />
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
            className="flex flex-col items-center justify-center rounded-2xl px-3 py-1.5 transition-all min-w-[60px] text-muted-foreground active:scale-95"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">Menu</span>
          </button>
        </div>
      </nav>
    </>
  )
}
