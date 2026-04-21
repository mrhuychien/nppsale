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
  ChevronRight, UserCog,
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
    label: "Kho vận",
    icon: Boxes,
    items: [
      { label: "Kho hàng", href: "/inventory", icon: Boxes, module: "inventory" },
      { label: "Sản phẩm", href: "/products", icon: Package, module: "products" },
      { label: "Nhà cung cấp", href: "/suppliers", icon: Factory, module: "inventory" },
    ],
  },
  {
    label: "Kế toán",
    icon: CreditCard,
    items: [
      { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables" },
      { label: "CN theo KH", href: "/receivables/by-customer", icon: Users, module: "receivables" },
      { label: "CN theo NV", href: "/receivables/by-rep", icon: UserCog, module: "receivables" },
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
    label: "Báo cáo",
    icon: BarChart3,
    items: [
      { label: "Tổng quan", href: "/dashboard", icon: LayoutDashboard, module: "reports" },
      { label: "Báo cáo", href: "/reports", icon: BarChart3, module: "reports" },
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
}

export function Sidebar({ role }: SidebarProps) {
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
        <div className="px-4 mb-4">
          <Link
            href="/orders/new"
            className="w-full bg-gradient-primary text-white py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-ambient-md hover:scale-[0.98] transition-all"
          >
            <Plus className="h-5 w-5" />
            Tạo đơn mới
          </Link>
        </div>
      )}

      {/* Home shortcut (always visible, pinned) */}
      <div className="px-3 mb-2">
        <Link
          href="/home"
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all",
            pathname === "/home"
              ? "bg-surface-lowest text-primary font-semibold shadow-ambient"
              : "text-muted-foreground hover:bg-surface-container/50 font-medium"
          )}
        >
          <Home className="h-5 w-5 shrink-0" />
          <span>Trang chủ</span>
        </Link>
      </div>

      {/* Module groups */}
      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-1">
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
                    "w-full flex items-center justify-between px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                    hasActiveChild
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GroupIcon className="h-4 w-4" />
                    <span>{group.label}</span>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      isExpanded && "rotate-90"
                    )}
                  />
                </button>

                {/* Group items */}
                {isExpanded && (
                  <div className="ml-3 pl-3 border-l border-border/50 space-y-0.5 mb-2">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                            isActive
                              ? "bg-surface-lowest text-primary font-semibold shadow-sm"
                              : "text-muted-foreground hover:bg-surface-container/50 font-medium"
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
      <div className="p-4 mt-auto space-y-1 border-t border-border/30">
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
