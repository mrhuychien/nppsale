"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { useOrg } from "@/hooks/use-org"
import { canAccessModule, type Module } from "@/lib/permissions"
import { SetupBanner } from "@/components/setup/setup-banner"
import {
  ShoppingCart,
  Users,
  Package,
  Boxes,
  Truck,
  RotateCcw,
  Tag,
  FileText,
  CreditCard,
  Receipt,
  Wallet,
  Award,
  TrendingUp,
  BarChart3,
  Factory,
  UserCog,
  Settings,
  ShieldCheck,
  HelpCircle,
  LogOut,
  Search,
  Navigation,
  PieChart,
  FilePlus2,
  MapPin,
  ArrowRight,
  type LucideIcon,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn, formatCurrency } from "@/lib/utils"

type TileColor =
  | "blue"
  | "indigo"
  | "green"
  | "emerald"
  | "orange"
  | "amber"
  | "purple"
  | "pink"
  | "red"
  | "rose"
  | "yellow"
  | "slate"
  | "zinc"

const COLOR_CLASS: Record<TileColor, string> = {
  blue: "bg-[#175cd3] text-white",
  indigo: "bg-[#6941c6] text-white",
  green: "bg-tertiary text-white",
  emerald: "bg-tertiary text-white",
  orange: "bg-[#fdb022] text-white",
  amber: "bg-[#fdb022] text-white",
  purple: "bg-[#6941c6] text-white",
  pink: "bg-[#be185d] text-white",
  red: "bg-error text-white",
  rose: "bg-error text-white",
  yellow: "bg-[#fdb022] text-white",
  slate: "bg-surface-container-low0 text-white",
  zinc: "bg-zinc-700 text-white",
}

interface Tile {
  label: string
  href: string
  icon: LucideIcon
  color: TileColor
  module: Module
  caption?: string
}

const TILES: Tile[] = [
  // Bán hàng
  { label: "Đơn hàng", href: "/orders", icon: ShoppingCart, color: "blue", module: "orders" },
  { label: "Khách hàng", href: "/customers", icon: Users, color: "green", module: "customers" },
  { label: "Sản phẩm", href: "/products", icon: Package, color: "orange", module: "products" },
  { label: "Bảng giá", href: "/products/price-lists", icon: Tag, color: "amber", module: "products" },
  { label: "Khuyến mãi", href: "/promotions", icon: Tag, color: "pink", module: "promotions" },
  { label: "Lịch sử đi tuyến", href: "/sales/visits", icon: Navigation, color: "indigo", module: "customers" },

  // Vận hành
  { label: "Kho hàng", href: "/inventory", icon: Boxes, color: "blue", module: "inventory" },
  { label: "Giao hàng", href: "/deliveries", icon: Truck, color: "indigo", module: "deliveries" },
  { label: "Trả hàng", href: "/returns", icon: RotateCcw, color: "rose", module: "returns" },

  // Mua hàng
  { label: "Hoá đơn mua", href: "/purchasing/invoices", icon: FileText, color: "purple", module: "inventory" },
  { label: "Nhà cung cấp", href: "/suppliers", icon: Factory, color: "slate", module: "inventory" },

  // Kế toán & Tài chính
  { label: "Hóa đơn bán", href: "/invoices", icon: FileText, color: "blue", module: "invoices" },
  { label: "Công nợ KH", href: "/receivables", icon: CreditCard, color: "red", module: "receivables" },
  { label: "Công nợ NCC", href: "/payables", icon: CreditCard, color: "rose", module: "receivables" },
  { label: "Phiếu thu", href: "/finance/cash-receipts", icon: Receipt, color: "emerald", module: "receivables" },
  { label: "Chi phí", href: "/finance/expenses", icon: Wallet, color: "amber", module: "settings" },
  { label: "Hoa hồng", href: "/commissions", icon: Award, color: "yellow", module: "commissions" },

  // Báo cáo & Phân tích
  { label: "Phân tích", href: "/analytics/business/overview", icon: TrendingUp, color: "purple", module: "reports" },
  { label: "Báo cáo", href: "/reports", icon: BarChart3, color: "blue", module: "reports" },
  { label: "Tài chính", href: "/reports/finance", icon: PieChart, color: "emerald", module: "reports" },

  // Hệ thống
  { label: "Nhân sự", href: "/hr", icon: UserCog, color: "orange", module: "settings" },
  { label: "Cài đặt", href: "/settings", icon: Settings, color: "slate", module: "settings" },
  { label: "Phân quyền", href: "/settings/permissions", icon: ShieldCheck, color: "zinc", module: "settings" },
  { label: "Trợ giúp", href: "/help", icon: HelpCircle, color: "blue", module: "settings" },
]

function startOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function todayDateOnly(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

interface SalesSnapshot {
  ordersToday: number
  ordersTodayValue: number
  draftOrders: number
  visitsToday: number
  myCustomers: number
}

export default function HomeLauncherPage() {
  const { user, signOut } = useAuth()
  const { org } = useOrg()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const orgName = org?.name ?? null
  const [snapshot, setSnapshot] = useState<SalesSnapshot | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const role = user?.role
  const isSales = role === "sales"

  // Sales-rep snapshot — only for the sales role.
  useEffect(() => {
    if (!isSales || !user?.id) return
    let cancelled = false
    const supabase = createClient()
    const t0 = startOfTodayISO()
    const todayDate = todayDateOnly()
    ;(async () => {
      const [ordersTodayRes, draftRes, visitsRes, custRes] = await Promise.all([
        supabase
          .from("sales_orders")
          .select("total", { count: "exact" })
          .eq("sales_user_id", user.id)
          .gte("order_date", t0),
        supabase
          .from("sales_orders")
          .select("id", { count: "exact", head: true })
          .eq("sales_user_id", user.id)
          .eq("status", "draft"),
        supabase
          .from("visit_logs")
          .select("id", { count: "exact", head: true })
          .eq("sales_user_id", user.id)
          .eq("visit_date", todayDate),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
      ])
      if (cancelled) return
      const ordersToday = ordersTodayRes.count ?? 0
      const ordersTodayValue = (
        (ordersTodayRes.data as Array<{ total: number | null }> | null) || []
      ).reduce((s, r) => s + Number(r.total || 0), 0)
      setSnapshot({
        ordersToday,
        ordersTodayValue,
        draftOrders: draftRes.count ?? 0,
        visitsToday: visitsRes.count ?? 0,
        myCustomers: custRes.count ?? 0,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [isSales, user?.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const visibleTiles = useMemo(() => {
    if (!role) return TILES
    return TILES.filter((t) => canAccessModule(role, t.module))
  }, [role])

  const filteredTiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return visibleTiles
    return visibleTiles.filter(
      (t) => t.label.toLowerCase().includes(q) || t.href.toLowerCase().includes(q)
    )
  }, [search, visibleTiles])

  const searching = search.trim().length > 0

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (filteredTiles.length > 0) router.push(filteredTiles[0].href)
  }

  const userInitials = useMemo(() => {
    const name = user?.full_name || ""
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return "U"
    if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "U"
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }, [user?.full_name])

  const firstName = useMemo(() => {
    const parts = (user?.full_name || "").trim().split(/\s+/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : "bạn"
  }, [user?.full_name])

  const todayLabel = useMemo(() => {
    const d = new Date()
    return d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })
  }, [])

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-0">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4">
        <Link
          href="/home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-300"
          title="Trang chủ"
        >
          <span className="text-lg font-black">N</span>
        </Link>

        <form onSubmit={handleSearchSubmit} className="relative mx-3 w-full max-w-xl sm:mx-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tính năng…"
            className="h-10 w-full rounded-full border border-border/40 bg-card pl-10 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:pr-16"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <span className="text-xs">⌘</span>
            <span>K</span>
          </kbd>
        </form>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground transition-transform hover:scale-105">
              {userInitials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="font-semibold">{user?.full_name || "Người dùng"}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {user?.role ?? "—"}
                {orgName ? ` · ${orgName}` : ""}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard")}>
              <BarChart3 className="mr-2 h-4 w-4" />
              <span>Tổng quan</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Cài đặt</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/help")}>
              <HelpCircle className="mr-2 h-4 w-4" />
              <span>Trợ giúp</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await signOut()
                router.push("/login")
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Đăng xuất</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Banner gợi ý chạy trình hướng dẫn cài đặt (owner, chưa setup) */}
        {!searching && (
          <div className="mb-6">
            <SetupBanner />
          </div>
        )}
        {/* Sales snapshot — only when not searching */}
        {isSales && !searching && (
          <section className="mb-8 space-y-4">
            <div>
              <h1 className="text-xl font-black">Chào {firstName} 👋</h1>
              <p className="text-sm capitalize text-muted-foreground">{todayLabel}</p>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Link
                href="/orders"
                className="rounded-2xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Đơn hôm nay</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{snapshot?.ordersToday ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {snapshot ? formatCurrency(snapshot.ordersTodayValue) : ""}
                </p>
              </Link>
              <Link
                href="/orders?status=draft"
                className="rounded-2xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Đơn nháp</p>
                <p className={cn("mt-1 text-2xl font-black tabular-nums", (snapshot?.draftOrders ?? 0) > 0 && "text-[#b54708]")}>
                  {snapshot?.draftOrders ?? "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">Chưa gửi duyệt</p>
              </Link>
              <Link
                href="/sales/visits"
                className="rounded-2xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Đã thăm h.nay</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{snapshot?.visitsToday ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">Điểm bán</p>
              </Link>
              <Link
                href="/customers"
                className="rounded-2xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Khách hàng</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{snapshot?.myCustomers ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">Đang hoạt động</p>
              </Link>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Link
                href="/orders/new"
                className="col-span-2 flex items-center gap-3 rounded-2xl bg-primary px-4 py-3.5 text-primary-foreground shadow-sm transition-transform active:scale-[0.99] sm:col-span-2"
              >
                <FilePlus2 className="h-5 w-5 shrink-0" />
                <span className="font-bold">Tạo đơn hàng mới</span>
                <ArrowRight className="ml-auto h-4 w-4" />
              </Link>
              <Link
                href="/sales/visits"
                className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-3.5 shadow-sm transition-colors hover:bg-muted/40"
              >
                <MapPin className="h-5 w-5 shrink-0 text-[#6941c6]" />
                <span className="text-sm font-semibold">Đi tuyến</span>
              </Link>
              <Link
                href="/receivables"
                className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-3.5 shadow-sm transition-colors hover:bg-muted/40"
              >
                <CreditCard className="h-5 w-5 shrink-0 text-error" />
                <span className="text-sm font-semibold">Công nợ</span>
              </Link>
            </div>
          </section>
        )}

        {/* App grid */}
        {!isSales || searching ? null : (
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Tất cả chức năng</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {filteredTiles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-base font-medium text-foreground">Không tìm thấy tính năng</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Thử từ khóa khác hoặc xóa ô tìm kiếm.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 gap-y-7 sm:grid-cols-4 sm:gap-x-6 md:grid-cols-5 lg:grid-cols-6">
            {filteredTiles.map((t) => {
              const Icon = t.icon
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className="group flex flex-col items-center gap-2 text-center"
                >
                  <div
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm transition-all group-active:scale-95 group-hover:-translate-y-0.5 group-hover:shadow-md sm:h-16 sm:w-16",
                      COLOR_CLASS[t.color]
                    )}
                  >
                    <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold leading-tight text-foreground sm:text-sm">{t.label}</p>
                    {t.caption ? (
                      <p className="text-[11px] text-muted-foreground">{t.caption}</p>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
