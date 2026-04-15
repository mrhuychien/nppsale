"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, BarChart3, Menu,
} from "lucide-react"

interface MobileNavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { label: "Đơn", href: "/orders", icon: ShoppingCart, module: "orders" },
  { label: "KH", href: "/customers", icon: Users, module: "customers" },
  { label: "SP", href: "/products", icon: Package, module: "products" },
  { label: "Kho", href: "/inventory", icon: Boxes, module: "inventory" },
  { label: "BC", href: "/reports", icon: BarChart3, module: "reports" },
]

interface MobileNavProps {
  role: Role
  onMenuClick?: () => void
}

export function MobileNav({ role, onMenuClick }: MobileNavProps) {
  const pathname = usePathname()
  const visibleItems = MOBILE_NAV_ITEMS.filter((item) => canAccessModule(role, item.module)).slice(0, 4)

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden glass-panel rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.05)] px-4 pb-6 pt-3">
      <div className="flex items-center justify-around">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center rounded-2xl px-4 py-1 transition-all min-w-[56px]",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold tracking-wide mt-0.5">{item.label}</span>
            </Link>
          )
        })}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center rounded-2xl px-4 py-1 transition-all min-w-[56px] text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-semibold tracking-wide mt-0.5">Menu</span>
        </button>
      </div>
    </nav>
  )
}
