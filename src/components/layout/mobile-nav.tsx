"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, BoxesIcon, BarChart3,
} from "lucide-react"

interface MobileNavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { label: "Don hang", href: "/orders", icon: ShoppingCart, module: "orders" },
  { label: "Khach hang", href: "/customers", icon: Users, module: "customers" },
  { label: "San pham", href: "/products", icon: Package, module: "products" },
  { label: "Kho", href: "/inventory", icon: BoxesIcon, module: "inventory" },
  { label: "Bao cao", href: "/reports", icon: BarChart3, module: "reports" },
]

interface MobileNavProps {
  role: Role
}

export function MobileNav({ role }: MobileNavProps) {
  const pathname = usePathname()
  const visibleItems = MOBILE_NAV_ITEMS.filter((item) => canAccessModule(role, item.module)).slice(0, 5)

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card lg:hidden">
      <div className="flex items-center justify-around">
        {visibleItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 py-2 px-3 text-xs transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
