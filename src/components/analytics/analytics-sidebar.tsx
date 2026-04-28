"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import {
  TrendingUp,
  Package,
  Users,
  Target,
  Calendar,
  Receipt,
  ShoppingBag,
  Boxes,
  UserCircle,
  Factory,
  Network,
  Wallet,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface NavLink {
  label: string
  href: string
}

interface NavSection {
  title: string
  groups: {
    label: string
    icon: React.ComponentType<{ className?: string }>
    items: NavLink[]
  }[]
}

const NAV: NavSection[] = [
  {
    title: "Phân tích",
    groups: [
      {
        label: "Kinh doanh",
        icon: TrendingUp,
        items: [
          { label: "Tổng quan", href: "/analytics/business/overview" },
          { label: "Chi phí - Lợi nhuận", href: "/analytics/business/cost-profit" },
        ],
      },
      {
        label: "Hàng hóa",
        icon: Package,
        items: [
          { label: "Tổng quan", href: "/analytics/products/overview" },
          { label: "Tồn kho", href: "/analytics/products/stock" },
          { label: "Phân loại hàng hóa", href: "/analytics/products/categories" },
        ],
      },
      {
        label: "Khách hàng",
        icon: Users,
        items: [
          { label: "Tổng quan", href: "/analytics/customers/overview" },
          { label: "Phân loại khách hàng", href: "/analytics/customers/categories" },
        ],
      },
      {
        label: "Hiệu quả",
        icon: Target,
        items: [
          { label: "Công nợ khách hàng", href: "/analytics/performance/receivables" },
        ],
      },
    ],
  },
  {
    title: "Báo cáo",
    groups: [
      {
        label: "Cuối ngày",
        icon: Calendar,
        items: [{ label: "Cuối ngày", href: "/reports/end-of-day" }],
      },
      {
        label: "Bán hàng",
        icon: Receipt,
        items: [{ label: "Bán hàng", href: "/reports/sales" }],
      },
      {
        label: "Đặt hàng",
        icon: ShoppingBag,
        items: [{ label: "Đặt hàng", href: "/reports/orders" }],
      },
      {
        label: "Hàng hóa",
        icon: Boxes,
        items: [{ label: "Hàng hóa", href: "/reports/products" }],
      },
      {
        label: "Khách hàng",
        icon: UserCircle,
        items: [{ label: "Khách hàng", href: "/reports/customers" }],
      },
      {
        label: "Nhà cung cấp",
        icon: Factory,
        items: [{ label: "Nhà cung cấp", href: "/reports/suppliers" }],
      },
      {
        label: "Nhân viên",
        icon: Users,
        items: [{ label: "Nhân viên", href: "/reports/employees" }],
      },
      {
        label: "Kênh bán hàng",
        icon: Network,
        items: [{ label: "Kênh bán hàng", href: "/reports/channels" }],
      },
      {
        label: "Tài chính",
        icon: Wallet,
        items: [
          { label: "Kết quả HĐKD", href: "/reports/finance" },
          { label: "Lãi lỗ (P&L)", href: "/reports/finance/pnl" },
          { label: "Bảng cân đối", href: "/reports/finance/balance-sheet" },
          { label: "Dòng tiền", href: "/reports/finance/cash-flow" },
        ],
      },
    ],
  },
]

export function AnalyticsSidebar() {
  const pathname = usePathname()
  const initialOpen = new Set<string>()
  for (const sec of NAV) {
    for (const g of sec.groups) {
      if (g.items.some((it) => pathname.startsWith(it.href))) {
        initialOpen.add(`${sec.title}::${g.label}`)
      }
    }
  }
  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen)

  const toggle = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <aside className="hidden w-64 shrink-0 lg:block">
      <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-border/40 bg-card p-3 shadow-sm">
        {NAV.map((section) => (
          <div key={section.title} className="mb-2">
            <p className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.groups.map((g) => {
                const key = `${section.title}::${g.label}`
                const isOpen = openGroups.has(key)
                const hasActive = g.items.some(
                  (it) => pathname === it.href || pathname.startsWith(it.href + "/")
                )
                const Icon = g.icon
                const single = g.items.length === 1
                if (single) {
                  const it = g.items[0]
                  const active = pathname === it.href || pathname.startsWith(it.href + "/")
                  return (
                    <li key={key}>
                      <Link
                        href={it.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                          active
                            ? "bg-primary/[0.08] text-primary"
                            : "text-foreground hover:bg-muted/40"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{g.label}</span>
                      </Link>
                    </li>
                  )
                }
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium",
                        hasActive ? "text-primary" : "text-foreground hover:bg-muted/40"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4" />
                        {g.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          isOpen ? "rotate-180" : ""
                        )}
                      />
                    </button>
                    {isOpen && (
                      <ul className="ml-7 mt-0.5 space-y-0.5 border-l border-border/40 pl-3">
                        {g.items.map((it) => {
                          const active = pathname === it.href || pathname.startsWith(it.href + "/")
                          return (
                            <li key={it.href}>
                              <Link
                                href={it.href}
                                className={cn(
                                  "block rounded-md px-3 py-1.5 text-sm",
                                  active
                                    ? "bg-primary/[0.08] font-semibold text-primary"
                                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                )}
                              >
                                {it.label}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
