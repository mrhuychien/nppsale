"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, BoxesIcon, Settings, Award,
  CreditCard, Truck, Tag, FileText, RotateCcw, BarChart3,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

const NAV_ITEMS: NavItem[] = [
  { label: "Don hang", href: "/orders", icon: ShoppingCart, module: "orders" },
  { label: "Khach hang", href: "/customers", icon: Users, module: "customers" },
  { label: "San pham", href: "/products", icon: Package, module: "products" },
  { label: "Kho hang", href: "/inventory", icon: BoxesIcon, module: "inventory" },
  { label: "Hoa hong", href: "/commissions", icon: Award, module: "commissions" },
  { label: "Cong no", href: "/receivables", icon: CreditCard, module: "receivables" },
  { label: "Giao hang", href: "/deliveries", icon: Truck, module: "deliveries" },
  { label: "Khuyen mai", href: "/promotions", icon: Tag, module: "promotions" },
  { label: "Hoa don", href: "/invoices", icon: FileText, module: "invoices" },
  { label: "Tra hang", href: "/returns", icon: RotateCcw, module: "returns" },
  { label: "Bao cao", href: "/reports", icon: BarChart3, module: "reports" },
  { label: "Cai dat", href: "/settings", icon: Settings, module: "settings" },
]

interface SidebarProps {
  role: Role
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const visibleItems = NAV_ITEMS.filter((item) => canAccessModule(role, item.module))

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:border-r bg-card">
      <div className="flex h-14 items-center border-b px-6">
        <Link href="/" className="text-xl font-bold text-primary">
          npp.sale
        </Link>
      </div>
      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-1 px-3">
          {visibleItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </ScrollArea>
    </aside>
  )
}
