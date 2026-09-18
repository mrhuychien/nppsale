"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { canSeeHref, filterNavGroups } from "@/lib/nav/nav-permission"
import { NEW_ORDER_HREF } from "@/lib/nav/new-order"
import type { Role } from "@/types"
import {
  ShoppingCart, Users, Package, Boxes, Settings, Award,
  CreditCard, Truck, Tag, FileText, RotateCcw, BarChart3,
  Plus, HelpCircle, LogOut, LayoutDashboard, Home, Factory,
  ChevronRight, UserCog, ClipboardList, Navigation, Wallet, Receipt,
  TrendingUp, FileBarChart2, ShieldCheck, FileSpreadsheet, Camera, Route, Store,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"

interface NavLink {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Quyền cần có KHÔNG khai ở đây — tra theo `href` trong
   * `@/lib/nav/nav-permission`, để ngăn kéo, lưới Trang chủ và thanh dưới
   * không thể trả lời khác nhau cho cùng một đường dẫn. */
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
      { label: "Bán hàng", href: "/sell", icon: Store },
      { label: "Đơn hàng", href: "/orders", icon: ShoppingCart },
      { label: "Khách hàng", href: "/customers", icon: Users },
      { label: "Tuyến bán hàng", href: "/customers/routes", icon: Route },
      { label: "Điểm bán cần cập nhật", href: "/customers/missing-photos", icon: Camera },
      { label: "Lịch sử đi tuyến", href: "/sales/visits", icon: Navigation },
      { label: "Khuyến mãi", href: "/promotions", icon: Tag },
    ],
  },
  {
    label: "Mua hàng",
    icon: ClipboardList,
    items: [
      { label: "Tạo phiếu nhập kho", href: "/inventory/stock-in", icon: ShoppingCart },
      { label: "Hoá đơn mua (tra cứu)", href: "/purchasing/invoices", icon: FileText },
      { label: "Trả hàng NCC", href: "/purchase-returns", icon: RotateCcw },
      { label: "Nhà cung cấp", href: "/suppliers", icon: Factory },
      { label: "Công nợ NCC", href: "/payables", icon: CreditCard },
    ],
  },
  {
    label: "Kho vận",
    icon: Boxes,
    items: [
      { label: "Kho hàng", href: "/inventory", icon: Boxes },
      { label: "Sản phẩm", href: "/products", icon: Package },
      { label: "Giao hàng", href: "/deliveries", icon: Truck },
      { label: "Trả hàng", href: "/returns", icon: RotateCcw },
    ],
  },
  {
    label: "Kế toán",
    icon: CreditCard,
    items: [
      { label: "Công nợ", href: "/receivables", icon: CreditCard },
      { label: "CN theo KH", href: "/receivables/by-customer", icon: Users },
      { label: "CN theo NV", href: "/receivables/by-rep", icon: UserCog },
      { label: "Công nợ đầu kỳ", href: "/finance/opening-balances", icon: FileSpreadsheet },
      { label: "Phiếu thu", href: "/finance/cash-receipts", icon: Receipt },
      { label: "Chi phí", href: "/finance/expenses", icon: Wallet },
      { label: "Hóa đơn bán", href: "/sales-invoices", icon: Receipt },
      { label: "Hóa đơn điện tử", href: "/invoices", icon: FileText },
      { label: "Cấu hình HĐ điện tử", href: "/settings/einvoice", icon: Settings },
    ],
  },
  {
    label: "Nhân sự",
    icon: UserCog,
    items: [
      { label: "Danh sách nhân viên", href: "/settings/users", icon: Users },
      { label: "Tạo nhân viên", href: "/settings/users/new", icon: Plus },
      { label: "Phân quyền & Template", href: "/settings/permissions", icon: ShieldCheck },
      { label: "Chấm công", href: "/hr/attendance", icon: UserCog },
      { label: "Cấu hình thưởng", href: "/hr/bonus-config", icon: Award },
      { label: "Cấu hình lương", href: "/hr/salary-config", icon: Wallet },
      { label: "Bảng lương", href: "/hr/payroll/runs", icon: Receipt },
      { label: "Hoa hồng (báo cáo)", href: "/commissions", icon: Award },
    ],
  },
  {
    label: "Phân tích",
    icon: TrendingUp,
    items: [
      { label: "Kinh doanh", href: "/analytics/business/overview", icon: TrendingUp },
      { label: "Hàng hóa", href: "/analytics/products/overview", icon: Package },
      { label: "Khách hàng", href: "/analytics/customers/overview", icon: Users },
      { label: "Công nợ khách hàng", href: "/analytics/performance/receivables", icon: CreditCard },
    ],
  },
  {
    label: "Báo cáo",
    icon: BarChart3,
    items: [
      { label: "Tổng quan", href: "/dashboard", icon: LayoutDashboard },
      { label: "Cuối ngày", href: "/reports/end-of-day", icon: FileBarChart2 },
      { label: "Bán hàng", href: "/reports/sales", icon: Receipt },
      { label: "Đặt hàng", href: "/reports/orders", icon: ShoppingCart },
      { label: "Hàng hóa", href: "/reports/products", icon: Boxes },
      { label: "Khách hàng", href: "/reports/customers", icon: Users },
      { label: "Nhà cung cấp", href: "/reports/suppliers", icon: Factory },
      { label: "Nhân viên", href: "/reports/employees", icon: UserCog },
      { label: "Kênh bán hàng", href: "/reports/channels", icon: BarChart3 },
      { label: "Tài chính", href: "/reports/finance", icon: Wallet },
    ],
  },
  {
    label: "Cài đặt",
    icon: Settings,
    items: [
      { label: "Tổng quan", href: "/settings", icon: Settings },
      { label: "Trình hướng dẫn cài đặt", href: "/setup", icon: Plus },
      { label: "Tổ chức / NPP", href: "/settings/org", icon: Settings },
      { label: "Ngưỡng cảnh báo đơn", href: "/settings/approval-rules", icon: ShieldCheck },
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
  // Nút "Tạo đơn mới" cũng tra cùng một bảng — `/sell` khai
  // `action: "create"`, nên vai trò chỉ được XEM đơn sẽ không thấy nút.
  const canCreateOrder = canSeeHref(role, NEW_ORDER_HREF)

  // Phép lọc nằm trong `@/lib/nav/nav-permission`, không viết lại ở đây —
  // viết lại là mở đường cho ngăn kéo và lưới Trang chủ lệch nhau lần nữa.
  const visibleGroups = filterNavGroups(role, NAV_GROUPS)

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

  /**
   * Bản mobile: lưới 3 cột icon + nhãn, không phải danh sách dọc có accordion.
   *
   * Ngăn kéo giờ là bottom sheet cao tối đa 85vh (xem dashboard-shell). Một
   * danh sách dọc 8 nhóm trong đó nghĩa là mỗi lần muốn tới một trang phải
   * bung nhóm rồi cuộn — hai thao tác trước cả cú bấm thật. Lưới cho ngón cái
   * với tới cả 3 cột và mắt quét theo hàng nhanh hơn theo cột dài.
   *
   * Không lặp lại nút "Tạo đơn mới" ở đây: ô giữa thanh nav đã là chính nút
   * đó và luôn hiện, kể cả khi ngăn kéo đang đóng.
   */
  if (mobile) {
    return (
      <div className="flex w-full flex-col">
        <div className="flex items-center justify-between px-4 pb-3">
          <Link href="/home" onClick={onNavigate} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary text-sm font-bold text-white shadow-brand">
              N
            </span>
            <span className="text-sm font-bold text-on-surface">npp.sale</span>
          </Link>
          <button
            onClick={handleSignOut}
            className="flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-on-surface-variant active:bg-error-container active:text-on-error-container"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Đăng xuất
          </button>
        </div>

        <div className="space-y-4 px-3 pb-2">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
                {group.label}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/")
                  return (
                    <MenuTile
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
            </div>
          ))}

          <div>
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
              Khác
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <MenuTile
                href="/home"
                icon={Home}
                label="Trang chủ"
                isActive={pathname === "/home"}
                onNavigate={onNavigate}
              />
              <MenuTile
                href="/help"
                icon={HelpCircle}
                label="Hỗ trợ"
                isActive={pathname === "/help"}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        </div>
      </div>
    )
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
            href={NEW_ORDER_HREF}
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

/** Ô trong lưới menu mobile — tối thiểu 64px mỗi chiều. */
function MenuTile({ href, icon: IconComp, label, isActive, onNavigate }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-colors",
        isActive
          ? "bg-primary/[0.08] text-primary"
          : "bg-surface-container-lowest text-on-surface-variant active:bg-surface-container"
      )}
    >
      <IconComp className={cn("h-5 w-5 shrink-0", isActive && "stroke-[2.25px]")} />
      {/* Nhãn dài ("Cấu hình HĐ điện tử") xuống 2 dòng rồi mới cắt — cắt ở
          dòng đầu thì "Trả hàng NCC" và "Trả hàng" trông giống nhau. */}
      <span className="line-clamp-2 text-[11px] font-medium leading-tight">{label}</span>
    </Link>
  )
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
