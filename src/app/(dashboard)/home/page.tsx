"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { canAccessModule, type Module } from "@/lib/permissions"
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
  ClipboardList,
  PieChart,
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
import { cn } from "@/lib/utils"

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
  blue: "bg-blue-500 text-white",
  indigo: "bg-indigo-500 text-white",
  green: "bg-green-500 text-white",
  emerald: "bg-emerald-500 text-white",
  orange: "bg-orange-500 text-white",
  amber: "bg-amber-500 text-white",
  purple: "bg-purple-500 text-white",
  pink: "bg-pink-500 text-white",
  red: "bg-red-500 text-white",
  rose: "bg-rose-500 text-white",
  yellow: "bg-yellow-500 text-white",
  slate: "bg-slate-500 text-white",
  zinc: "bg-zinc-700 text-white",
}

interface Tile {
  label: string
  href: string
  icon: LucideIcon
  color: TileColor
  module: Module
  /** Small caption shown below the label (e.g. "10 Workspaces"). */
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
  { label: "Đơn mua hàng", href: "/purchasing/orders", icon: ClipboardList, color: "purple", module: "inventory" },
  { label: "Hóa đơn mua", href: "/purchasing/invoices", icon: FileText, color: "purple", module: "inventory" },
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

export default function HomeLauncherPage() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [orgName, setOrgName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch org name (used in profile dropdown caption)
  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    const supabase = createClient()
    supabase
      .from("organizations")
      .select("name")
      .eq("id", user.org_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setOrgName((data as { name?: string } | null)?.name ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user?.org_id])

  // Cmd/Ctrl + K focuses the search box
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

  const role = user?.role
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

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background/80 px-6 py-4 backdrop-blur-md">
        <Link
          href="/home"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-300"
          title="Trang chủ"
        >
          <span className="text-lg font-black">N</span>
        </Link>

        <form onSubmit={handleSearchSubmit} className="relative mx-4 w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tính năng…"
            className="h-10 w-full rounded-full border border-border/40 bg-card pl-10 pr-16 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <span className="text-xs">⌘</span>
            <span>K</span>
          </kbd>
        </form>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground transition-transform hover:scale-105">
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

      {/* App grid */}
      <main className="mx-auto max-w-6xl px-6 py-12 lg:py-20">
        {filteredTiles.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-base font-medium text-foreground">Không tìm thấy tính năng</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Thử từ khóa khác hoặc xóa ô tìm kiếm.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-6 gap-y-10 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {filteredTiles.map((t) => {
              const Icon = t.icon
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className="group flex flex-col items-center gap-2.5 text-center"
                >
                  <div
                    className={cn(
                      "flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md",
                      COLOR_CLASS[t.color]
                    )}
                  >
                    <Icon className="h-7 w-7" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.label}</p>
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
