"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessModule, hasPermission, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, Settings, Award,
  CreditCard, Truck, Tag, FileText, RotateCcw, BarChart3,
  Plus, HelpCircle, LogOut, LayoutDashboard, Home, Factory,
  ChevronRight, UserCog, ClipboardList, Navigation, Wallet, Receipt,
  TrendingUp, FileBarChart2,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"

interface NavLink {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}

interface NavGroup {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: NavLink[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Bán hàng",
    icon: ShoppingCart,
    items: [
      { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders" },
      { label: "Khách hàng", href: "/customers", icon: Users, module: "customers" },
      { label: "Phân tích KH", href: "/customers/analytics", icon: BarChart3, module: "customers" },
      { label: "Lịch sử đi tuyến", href: "/sales/visits", icon: Navigation, module: "customers" },
      { label: "Bảng giá", href: "/products/price-lists", icon: FileText, module: "products" },
      { label: "Khuyến mãi", href: "/promotions", icon: Tag, module: "promotions" },
      { label: "Hoa hồng", href: "/commissions", icon: Award, module: "commissions" },
    ],
  },
  {
    label: "Vận hành",
    icon: Truck,
    items: [
      { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries" },
      { label: "Trả hàng", href: "/returns", icon: RotateCcw, module: "returns" },
    ],
  },
  {
    label: "Mua hàng",
    icon: ClipboardList,
    items: [
      { label: "Đơn mua hàng", href: "/purchasing/orders", icon: ShoppingCart, module: "inventory" },
      { label: "HĐ mua hàng", href: "/purchasing/invoices", icon: FileText, module: "inventory" },
      { label: "Nhà cung cấp", href: "/suppliers", icon: Factory, module: "inventory" },
      { label: "CN nhà cung cấp", href: "/payables", icon: CreditCard, module: "receivables" },
    ],
  },
  {
    label: "Kho vận",
    icon: Boxes,
    items: [
      { label: "Kho hàng", href: "/inventory", icon: Boxes, module: "inventory" },
      { label: "Sản phẩm", href: "/products", icon: Package, module: "products" },
    ],
  },
  {
    label: "Kế toán",
    icon: CreditCard,
    items: [
      { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
      { label: "CN theo KH", href: "/receivables/by-customer", icon: Users, module: "receivables" },
      { label: "CN theo NV", href: "/receivables/by-rep", icon: UserCog, module: "receivables" },
      { label: "Phiếu thu", href: "/finance/cash-receipts", icon: Receipt, module: "receivables" },
      { label: "Chi phí", href: "/finance/expenses", icon: Wallet, module: "settings" },
      { label: "Hóa đơn", href: "/invoices", icon: FileText, module: "invoices" },
    ],
  },
  {
    label: "Nhân sự",
    icon: UserCog,
    items: [
      { label: "Nhân sự", href: "/hr", icon: UserCog, module: "settings" },
    ],
  },
  {
    label: "Phân tích",
    icon: TrendingUp,
    items: [
      { label: "Kinh doanh", href: "/analytics/business/overview", icon: TrendingUp, module: "reports" },
      { label: "Hàng hóa", href: "/analytics/products/overview", icon: Package, module: "reports" },
      { label: "Khách hàng", href: "/analytics/customers/overview", icon: Users, module: "reports" },
      { label: "Công nợ khách hàng", href: "/analytics/performance/receivables", icon: CreditCard, module: "reports" },
    ],
  },
  {
    label: "Báo cáo",
    icon: BarChart3,
    items: [
      { label: "Tổng quan", href: "/dashboard", icon: LayoutDashboard, module: "reports" },
      { label: "Cuối ngày", href: "/reports/end-of-day", icon: FileBarChart2, module: "reports" },
      { label: "Bán hàng", href: "/reports/sales", icon: Receipt, module: "reports" },
      { label: "Đặt hàng", href: "/reports/orders", icon: ShoppingCart, module: "reports" },
      { label: "Hàng hóa", href: "/reports/products", icon: Boxes, module: "reports" },
      { label: "Khách hàng", href: "/reports/customers", icon: Users, module: "reports" },
      { label: "Nhà cung cấp", href: "/reports/suppliers", icon: Factory, module: "reports" },
      { label: "Nhân viên", href: "/reports/employees", icon: UserCog, module: "reports" },
      { label: "Kênh bán hàng", href: "/reports/channels", icon: BarChart3, module: "reports" },
      { label: "Tài chính", href: "/reports/finance/pnl", icon: Wallet, module: "reports" },
    ],
  },
  {
    label: "Cài đặt",
    icon: Settings,
    items: [
      { label: "Cài đặt", href: "/settings", icon: Settings, module: "settings" },
    ],
  },
]

interface SidebarProps {
  role: Role
  mobile?: boolean
  onNavigate?: () => void
}

export function Sidebar({ role, mobile, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { signOut } = useAuth()
  const canCreateOrder = hasPermission(role, "orders", "create")

  // Determine which groups have visible items
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessModule(role, item.module)),
  })).filter((group) => group.items.length > 0)

  // Auto-expand the group containing the current active route
  const activeGroupIndex = visibleGroups.findIndex((g) =>
    g.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  )

  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    new Set(activeGroupIndex >= 0 ? [activeGroupIndex] : [0])
  )

  // Update expansion when route changes
  useEffect(() => {
    if (activeGroupIndex >= 0) {
      setExpandedGroups((prev) => new Set([...Array.from(prev), activeGroupIndex]))
    }
  }, [activeGroupIndex])

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleSignOut = async () => {
    onNavigate?.()
    await signOut()
    router.push("/login")
  }

  return (
    <aside className={cn(
      "flex flex-col bg-card h-screen",
      mobile ? "w-full" : "hidden lg:flex lg:w-64 border-r border-border/50 sticky top-0"
    )}>
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-primary rounded-[10px] flex items-center justify-center text-white font-black text-lg">
          N
        </div>
        <div>
          <h1 className="text-sm font-bold text-primary leading-none">npp.sale</h1>
          <p className="text-[10px] text-muted-foreground font-medium mt-0.5">PHÂN PHỐI FMCG</p>
        </div>
      </div>

      {/* Quick CTA */}
      {canCreateOrder && (
        <div className="px-4 mb-3">
          <Link
            href="/orders/new"
            onClick={onNavigate}
            className="w-full bg-primary text-white py-2.5 px-4 rounded-[10px] font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo đơn mới
          </Link>
        </div>
      )}

      {/* Home shortcut (always visible, pinned) */}
      <div className="px-3 mb-1">
        <Link
          href="/home"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
            pathname === "/home"
              ? "bg-primary/[0.08] text-primary font-medium"
              : "text-muted-foreground hover:bg-muted/50 font-medium"
          )}
        >
          <Home className="h-4 w-4 shrink-0" />
          <span>Trang chủ</span>
        </Link>
      </div>

      {/* Module groups */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-0.5">
          {visibleGroups.map((group, groupIdx) => {
            const isExpanded = expandedGroups.has(groupIdx)
            const hasActiveChild = group.items.some(
              (item) => pathname === item.href || pathname.startsWith(item.href + "/")
            )
            const GroupIcon = group.icon

            return (
              <div key={group.label}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(groupIdx)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    hasActiveChild
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GroupIcon className="h-3.5 w-3.5" />
                    <span>{group.label}</span>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      isExpanded && "rotate-90"
                    )}
                  />
                </button>

                {/* Group items */}
                {isExpanded && (
                  <div className="ml-3 pl-3 border-l border-border/40 space-y-0.5 mb-1.5">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                            isActive
                              ? "bg-primary/[0.08] text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted/50 font-medium"
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </ScrollArea>

      {/* Footer Links */}
      <div className="p-3 mt-auto space-y-0.5 border-t border-border/40">
        <Link
          href="/help"
          onClick={onNavigate}
          className="w-full flex items-center gap-3 px-3 py-2 text-muted-foreground font-medium hover:text-primary transition-colors text-sm rounded-lg"
        >
          <HelpCircle className="h-4 w-4" />
          Hỗ trợ
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 text-muted-foreground font-medium hover:text-destructive transition-colors text-sm rounded-lg"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </aside>
  )
}
