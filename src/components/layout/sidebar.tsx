"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, hasPermission, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, Settings, Award,
  CreditCard, Truck, Tag, FileText, RotateCcw, BarChart3,
  Plus, HelpCircle, LogOut, LayoutDashboard,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "reports" },
  { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
  { label: "Khách hàng", href: "/customers", icon: Users, module: "customers" },
  { label: "Sản phẩm", href: "/products", icon: Package, module: "products" },
  { label: "Kho hàng", href: "/inventory", icon: Boxes, module: "inventory" },
  { label: "Hoa hồng", href: "/commissions", icon: Award, module: "commissions" },
  { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
  { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries" },
  { label: "Khuyến mãi", href: "/promotions", icon: Tag, module: "promotions" },
  { label: "Hóa đơn", href: "/invoices", icon: FileText, module: "invoices" },
  { label: "Trả hàng", href: "/returns", icon: RotateCcw, module: "returns" },
  { label: "Báo cáo", href: "/reports", icon: BarChart3, module: "reports" },
  { label: "Cài đặt", href: "/settings", icon: Settings, module: "settings" },
]

interface SidebarProps {
  role: Role
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()
  const visibleItems = NAV_ITEMS.filter((item) => canAccessModule(role, item.module))
  const canCreateOrder = hasPermission(role, "orders", "create")

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-surface-low h-screen sticky top-0">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black text-xl shadow-ambient">
          N
        </div>
        <div>
          <h1 className="text-base font-black text-primary leading-none">npp.sale</h1>
          <p className="text-[10px] text-muted-foreground font-medium tracking-wider mt-1">PHÂN PHỐI FMCG</p>
        </div>
      </div>

      {/* Quick CTA */}
      {canCreateOrder && (
        <div className="px-4 mb-6">
          <Link
            href="/orders/new"
            className="w-full bg-gradient-primary text-white py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-ambient-md hover:scale-[0.98] transition-all"
          >
            <Plus className="h-5 w-5" />
            Tạo đơn mới
          </Link>
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-1">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all",
                  isActive
                    ? "bg-surface-lowest text-primary font-semibold shadow-ambient"
                    : "text-muted-foreground hover:bg-surface-container/50 font-medium"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </ScrollArea>

      {/* Footer Links */}
      <div className="p-4 mt-auto space-y-1">
        <Link
          href="/help"
          className="w-full flex items-center gap-3 px-4 py-2.5 text-muted-foreground font-medium hover:text-primary transition-colors text-sm rounded-lg"
        >
          <HelpCircle className="h-4 w-4" />
          Hỗ trợ
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-muted-foreground font-medium hover:text-destructive transition-colors text-sm rounded-lg"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </aside>
  )
}
