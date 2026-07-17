"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canAccessFeature, canAccessModule, hasPermission, type Module } from "@/lib/permissions"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, Settings, Award,
  CreditCard, Truck, Tag, FileText, RotateCcw, BarChart3,
  Plus, HelpCircle, LogOut, LayoutDashboard, Home, Factory,
  ChevronRight, UserCog, ClipboardList, Navigation, Wallet, Receipt,
  TrendingUp, FileBarChart2, ShieldCheck, QrCode,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"

interface NavLink {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
  /** Optional finer-grained permission feature key. When set, this is
   * checked first; otherwise the parent module's permission is used. */
  feature?: string
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
      { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, module: "orders", feature: "orders" },
      { label: "Khách hàng", href: "/customers", icon: Users, module: "customers", feature: "customers" },
      { label: "Lịch sử đi tuyến", href: "/sales/visits", icon: Navigation, module: "customers", feature: "customers.visits" },
      { label: "Khuyến mãi", href: "/promotions", icon: Tag, module: "promotions", feature: "promotions" },
    ],
  },
  {
    label: "Mua hàng",
    icon: ClipboardList,
    items: [
      { label: "Tạo phiếu nhập kho", href: "/inventory/stock-in", icon: ShoppingCart, module: "inventory", feature: "inventory" },
      { label: "Hoá đơn mua (tra cứu)", href: "/purchasing/invoices", icon: FileText, module: "inventory", feature: "purchasing.invoices" },
      { label: "Trả hàng NCC", href: "/purchase-returns", icon: RotateCcw, module: "inventory", feature: "purchasing.returns" },
      { label: "Nhà cung cấp", href: "/suppliers", icon: Factory, module: "inventory", feature: "suppliers" },
      { label: "Công nợ NCC", href: "/payables", icon: CreditCard, module: "receivables", feature: "payables" },
    ],
  },
  {
    label: "Kho vận",
    icon: Boxes,
    items: [
      { label: "Kho hàng", href: "/inventory", icon: Boxes, module: "inventory", feature: "inventory" },
      { label: "Sản phẩm", href: "/products", icon: Package, module: "products", feature: "products" },
      { label: "Giao hàng", href: "/deliveries", icon: Truck, module: "deliveries", feature: "deliveries" },
      { label: "Trả hàng", href: "/returns", icon: RotateCcw, module: "returns", feature: "returns" },
    ],
  },
  {
    label: "Kế toán",
    icon: CreditCard,
    items: [
      { label: "Công nợ", href: "/receivables", icon: CreditCard, module: "receivables", feature: "receivables" },
      { label: "CN theo KH", href: "/receivables/by-customer", icon: Users, module: "receivables", feature: "receivables.by_customer" },
      { label: "CN theo NV", href: "/receivables/by-rep", icon: UserCog, module: "receivables", feature: "receivables.by_rep" },
      { label: "Phiếu thu", href: "/finance/cash-receipts", icon: Receipt, module: "receivables", feature: "finance.cash_receipts" },
      { label: "Chi phí", href: "/finance/expenses", icon: Wallet, module: "settings", feature: "finance.expenses" },
      { label: "Hóa đơn", href: "/invoices", icon: FileText, module: "invoices", feature: "invoices" },
      { label: "Cấu hình HĐ điện tử", href: "/settings/einvoice", icon: Settings, module: "settings", feature: "einvoice.config" },
    ],
  },
  {
    label: "Nhân sự",
    icon: UserCog,
    items: [
      { label: "Danh sách nhân viên", href: "/settings/users", icon: Users, module: "settings", feature: "settings.users" },
      { label: "Tạo nhân viên", href: "/settings/users/new", icon: Plus, module: "settings", feature: "settings.users" },
      { label: "Tạo NV quét QR", href: "/settings/users/qr-new", icon: QrCode, module: "settings", feature: "settings.users" },
      { label: "Phân quyền & Template", href: "/settings/permissions", icon: ShieldCheck, module: "settings", feature: "settings.permissions" },
      { label: "Chấm công", href: "/hr/attendance", icon: UserCog, module: "settings", feature: "hr" },
      { label: "Cấu hình thưởng", href: "/hr/bonus-config", icon: Award, module: "settings", feature: "hr" },
      { label: "Cấu hình lương", href: "/hr/salary-config", icon: Wallet, module: "settings", feature: "hr" },
      { label: "Bảng lương", href: "/hr/payroll/runs", icon: Receipt, module: "settings", feature: "hr" },
      { label: "Hoa hồng (báo cáo)", href: "/commissions", icon: Award, module: "commissions", feature: "commissions" },
    ],
  },
  {
    label: "Phân tích",
    icon: TrendingUp,
    items: [
      { label: "Kinh doanh", href: "/analytics/business/overview", icon: TrendingUp, module: "reports", feature: "analytics.business" },
      { label: "Hàng hóa", href: "/analytics/products/overview", icon: Package, module: "reports", feature: "analytics.products" },
      { label: "Khách hàng", href: "/analytics/customers/overview", icon: Users, module: "reports", feature: "analytics.customers" },
      { label: "Công nợ khách hàng", href: "/analytics/performance/receivables", icon: CreditCard, module: "reports", feature: "analytics.performance" },
    ],
  },
  {
    label: "Báo cáo",
    icon: BarChart3,
    items: [
      { label: "Tổng quan", href: "/dashboard", icon: LayoutDashboard, module: "reports", feature: "reports.dashboard" },
      { label: "Cuối ngày", href: "/reports/end-of-day", icon: FileBarChart2, module: "reports", feature: "reports.end_of_day" },
      { label: "Bán hàng", href: "/reports/sales", icon: Receipt, module: "reports", feature: "reports.sales" },
      { label: "Đặt hàng", href: "/reports/orders", icon: ShoppingCart, module: "reports", feature: "reports.orders" },
      { label: "Hàng hóa", href: "/reports/products", icon: Boxes, module: "reports", feature: "reports.products" },
      { label: "Khách hàng", href: "/reports/customers", icon: Users, module: "reports", feature: "reports.customers" },
      { label: "Nhà cung cấp", href: "/reports/suppliers", icon: Factory, module: "reports", feature: "reports.suppliers" },
      { label: "Nhân viên", href: "/reports/employees", icon: UserCog, module: "reports", feature: "reports.employees" },
      { label: "Kênh bán hàng", href: "/reports/channels", icon: BarChart3, module: "reports", feature: "reports.channels" },
      { label: "Tài chính", href: "/reports/finance", icon: Wallet, module: "reports", feature: "reports.finance" },
    ],
  },
  {
    label: "Cài đặt",
    icon: Settings,
    items: [
      { label: "Tổng quan", href: "/settings", icon: Settings, module: "settings", feature: "settings" },
      { label: "Trình hướng dẫn cài đặt", href: "/setup", icon: Plus, module: "settings", feature: "settings.org" },
      { label: "Tổ chức / NPP", href: "/settings/org", icon: Settings, module: "settings", feature: "settings.org" },
      { label: "Duyệt đơn tự động", href: "/settings/approval-rules", icon: ShieldCheck, module: "settings", feature: "settings.approval_rules" },
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

  // Determine which groups have visible items. When a feature key is
  // specified, prefer the granular check; otherwise fall back to the
  // module-level access.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.feature
        ? canAccessFeature(role, item.feature, item.module)
        : canAccessModule(role, item.module)
    ),
  })).filter((group) => group.items.length > 0)

  // Auto-expand the group containing the current active route
  const activeGroupIndex = visibleGroups.findIndex((g) =>
    g.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  )

  // Accordion mode: chỉ 1 group mở tại 1 thời điểm. Khi user click 1 mục con,
  // route đổi → activeGroupIndex đổi → useEffect tự thu các group khác và chỉ
  // giữ group chứa item active.
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(
    new Set(activeGroupIndex >= 0 ? [activeGroupIndex] : [0])
  )

  useEffect(() => {
    if (activeGroupIndex >= 0) {
      setExpandedGroups(new Set([activeGroupIndex]))
    }
  }, [activeGroupIndex])

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) =>
      prev.has(index) && prev.size === 1 ? new Set() : new Set([index])
    )
  }

  const handleSignOut = async () => {
    onNavigate?.()
    await signOut()
    router.push("/login")
  }

  return (
    <aside className={cn(
      "flex flex-col bg-surface-container-low h-screen",
      mobile ? "w-full" : "hidden lg:flex lg:w-60 border-r border-outline-variant/60 sticky top-0"
    )}>
      {/* Brand — click logo về Trang chủ */}
      <Link
        href="/home"
        onClick={onNavigate}
        className="px-5 py-5 flex items-center gap-3 hover:bg-surface-container/40 transition-colors"
      >
        <div className="w-9 h-9 bg-gradient-primary rounded-xl flex items-center justify-center text-white font-bold text-base shadow-brand shrink-0">
          N
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-on-surface leading-tight">npp.sale</h1>
          <p className="text-[10px] text-on-surface-variant font-semibold tracking-[0.05em] uppercase mt-0.5">PHÂN PHỐI FMCG</p>
        </div>
      </Link>

      {/* Quick CTA */}
      {canCreateOrder && (
        <div className="px-4 mb-3">
          <Link
            href="/orders/new"
            onClick={onNavigate}
            className="w-full bg-primary text-on-primary py-2.5 px-4 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:bg-primary-container transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tạo đơn mới
          </Link>
        </div>
      )}

      {/* Home shortcut (always visible, pinned) */}
      <div className="px-3 mb-1">
        <SidebarLink
          href="/home"
          icon={Home}
          label="Trang chủ"
          isActive={pathname === "/home"}
          onNavigate={onNavigate}
        />
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
                    "w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-[0.05em] transition-colors",
                    hasActiveChild
                      ? "text-primary"
                      : "text-on-surface-variant hover:text-on-surface"
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
                  <div className="ml-3 pl-3 border-l border-outline-variant/40 space-y-0.5 mb-1.5">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
                      return (
                        <SidebarLink
                          key={item.href}
                          href={item.href}
                          icon={item.icon}
                          label={item.label}
                          isActive={isActive}
                          onNavigate={onNavigate}
                        />
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
      <div className="p-3 mt-auto space-y-0.5 border-t border-outline-variant/40">
        <Link
          href="/help"
          onClick={onNavigate}
          className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant font-medium hover:bg-surface-container hover:text-on-surface transition-colors text-sm rounded-lg"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          Hỗ trợ
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant font-medium hover:bg-error-container hover:text-on-error-container transition-colors text-sm rounded-lg"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Đăng xuất
        </button>
      </div>
    </aside>
  )
}

interface SidebarLinkProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  isActive: boolean
  onNavigate?: () => void
}

/**
 * Sidebar nav item with Stitch active treatment: 3px vertical bar on the
 * left + subtle primary tint background + bold primary text. Hover state
 * uses surface-container as a neutral grey panel.
 */
function SidebarLink({ href, icon: IconComp, label, isActive, onNavigate }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isActive
          ? "bg-primary/[0.08] text-primary"
          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
      )}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary"
        />
      )}
      <IconComp className={cn("h-4 w-4 shrink-0", isActive && "stroke-[2.25px]")} />
      <span className="truncate">{label}</span>
    </Link>
  )
}
