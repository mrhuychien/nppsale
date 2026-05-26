"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"
import {
  TrendingUp,
  Package,
  Wallet,
  Users,
  BarChart3,
  Download,
  ArrowRight,
  Boxes,
  AlertTriangle,
  Receipt,
  Percent,
  UserCircle,
  Truck,
  ShoppingCart,
  Calendar,
} from "lucide-react"
import type { SalesOrder, Receivable, Batch, User } from "@/types"

type Period = "today" | "week" | "month" | "quarter" | "custom"

const PERIOD_LABELS: Record<Period, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
  quarter: "Quý này",
  custom: "Tùy chỉnh",
}

type TabKey = "sales" | "inventory" | "finance" | "hr"

const TAB_DEFS: { key: TabKey; label: string; icon: typeof TrendingUp }[] = [
  { key: "sales", label: "Bán hàng", icon: TrendingUp },
  { key: "inventory", label: "Kho hàng", icon: Package },
  { key: "finance", label: "Tài chính", icon: Wallet },
  { key: "hr", label: "Nhân sự", icon: Users },
]

interface ReportStats {
  salesOrders: SalesOrder[]
  receivables: Receivable[]
  batches: (Batch & { product?: { shelf_life_days: number | null } })[]
  users: User[]
  productCount: number
}

export default function ReportsPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>("month")
  const [activeTab, setActiveTab] = useState<TabKey>("sales")
  const [data, setData] = useState<ReportStats>({
    salesOrders: [],
    receivables: [],
    batches: [],
    users: [],
    productCount: 0,
  })
  const supabase = createClient()

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      const [ordersRes, recvRes, batchesRes, usersRes, prodRes] = await Promise.all([
        supabase.from("sales_orders").select("*").order("order_date", { ascending: false }),
        supabase.from("receivables").select("*"),
        supabase.from("batches").select("*, product:products(shelf_life_days)").gt("qty_on_hand", 0),
        supabase.from("users").select("*"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
      ])
      setData({
        salesOrders: (ordersRes.data as SalesOrder[]) || [],
        receivables: (recvRes.data as Receivable[]) || [],
        batches: (batchesRes.data as (Batch & { product?: { shelf_life_days: number | null } })[]) || [],
        users: (usersRes.data as User[]) || [],
        productCount: prodRes.count || 0,
      })
      setLoading(false)
    }
    fetchAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Range for current period + the immediately preceding equal-length
  // window (used for MoM% comparison). Returned as [start, end].
  const periodWindows = useMemo(() => {
    const now = new Date()
    const end = new Date(now)
    const start = new Date(now)
    switch (period) {
      case "today":
        start.setHours(0, 0, 0, 0)
        break
      case "week":
        start.setDate(now.getDate() - 7)
        break
      case "month":
        start.setMonth(now.getMonth() - 1)
        break
      case "quarter":
        start.setMonth(now.getMonth() - 3)
        break
      default:
        start.setFullYear(2000)
    }
    const prevEnd = new Date(start)
    const span = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - span)
    return { start, end, prevStart, prevEnd }
  }, [period])

  const filteredOrders = useMemo(() => {
    const { start } = periodWindows
    return data.salesOrders.filter((o) => new Date(o.order_date) >= start)
  }, [data.salesOrders, periodWindows])

  const prevPeriodOrders = useMemo(() => {
    const { prevStart, prevEnd } = periodWindows
    return data.salesOrders.filter((o) => {
      const t = new Date(o.order_date).getTime()
      return t >= prevStart.getTime() && t < prevEnd.getTime()
    })
  }, [data.salesOrders, periodWindows])

  const momPct = (curr: number, prev: number): number | null => {
    if (!Number.isFinite(prev) || prev === 0) return null
    return ((curr - prev) / prev) * 100
  }

  const handleExport = () => {
    if (typeof window !== "undefined") window.print()
  }

  if (authLoading || loading) return <Skeleton className="h-[600px]" />

  // KPI calculations
  const totalRevenue = filteredOrders
    .filter((o) => o.status === "delivered")
    .reduce((sum, o) => sum + o.total, 0)
  const totalOrders = filteredOrders.length
  const deliveredOrders = filteredOrders.filter((o) => o.status === "delivered").length
  const aov = deliveredOrders > 0 ? totalRevenue / deliveredOrders : 0

  // Previous-period equivalents for MoM%
  const prevRevenue = prevPeriodOrders
    .filter((o) => o.status === "delivered")
    .reduce((sum, o) => sum + o.total, 0)
  const prevTotalOrders = prevPeriodOrders.length
  const prevDeliveredOrders = prevPeriodOrders.filter((o) => o.status === "delivered").length
  const prevAov = prevDeliveredOrders > 0 ? prevRevenue / prevDeliveredOrders : 0

  const momRevenue = momPct(totalRevenue, prevRevenue)
  const momOrders = momPct(totalOrders, prevTotalOrders)
  const momAov = momPct(aov, prevAov)

  const totalStock = data.batches.reduce((s, b) => s + b.qty_on_hand, 0)
  const expiringCount = data.batches.filter((b) => {
    const days = Math.ceil((new Date(b.expires_at).getTime() - Date.now()) / 86400000)
    return days <= 30
  }).length

  const openReceivables = data.receivables
    .filter((r) => r.status === "open" || r.status === "overdue" || r.status === "partial")
    .reduce((s, r) => s + (r.amount - r.paid), 0)
  const overdueCount = data.receivables.filter((r) => r.status === "overdue").length

  // Period-scoped finance MoM: receivables created/paid in current vs
  // prev period. `created_at` on receivables is reliable; payments live
  // in a separate table but here we approximate paid-this-period via
  // `paid` field on rows whose `created_at` is in the window.
  const inWindow = (s: string | null | undefined, lo: Date, hi: Date) => {
    if (!s) return false
    const t = new Date(s).getTime()
    return t >= lo.getTime() && t < hi.getTime()
  }
  const recvCurrent = data.receivables.filter((r) =>
    inWindow(r.created_at, periodWindows.start, periodWindows.end)
  )
  const recvPrev = data.receivables.filter((r) =>
    inWindow(r.created_at, periodWindows.prevStart, periodWindows.prevEnd)
  )
  const currOpenAmount = recvCurrent
    .filter((r) => r.status === "open" || r.status === "overdue" || r.status === "partial")
    .reduce((s, r) => s + (r.amount - r.paid), 0)
  const prevOpenAmount = recvPrev
    .filter((r) => r.status === "open" || r.status === "overdue" || r.status === "partial")
    .reduce((s, r) => s + (r.amount - r.paid), 0)
  const currPaid = recvCurrent.reduce((s, r) => s + r.paid, 0)
  const prevPaid = recvPrev.reduce((s, r) => s + r.paid, 0)
  const momOpenRecv = momPct(currOpenAmount, prevOpenAmount)
  const momPaid = momPct(currPaid, prevPaid)
  const momRecvCount = momPct(recvCurrent.length, recvPrev.length)

  // HR tab MoM: count of new active users created in window
  const userInWindow = (u: { created_at: string }, lo: Date, hi: Date) =>
    inWindow(u.created_at, lo, hi)
  const newUsersCurr = data.users.filter((u) =>
    userInWindow(u, periodWindows.start, periodWindows.end)
  ).length
  const newUsersPrev = data.users.filter((u) =>
    userInWindow(u, periodWindows.prevStart, periodWindows.prevEnd)
  ).length
  const momNewUsers = momPct(newUsersCurr, newUsersPrev)

  const usersByRole = data.users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1
    return acc
  }, {})

  const salesByUser = new Map<string, number>()
  filteredOrders
    .filter((o) => o.status === "delivered")
    .forEach((o) => {
      salesByUser.set(o.sales_user_id, (salesByUser.get(o.sales_user_id) || 0) + o.total)
    })
  const topPerformers = Array.from(salesByUser.entries())
    .map(([uid, total]) => {
      const u = data.users.find((x) => x.id === uid)
      return { name: u?.full_name || "—", total }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Hero Header */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/5 via-surface-low to-surface-lowest border border-border/40 p-6 lg:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Hệ thống báo cáo
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-foreground">
              Hệ thống Báo cáo M12
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Tổng hợp các chỉ số vận hành doanh nghiệp - phân tích bán hàng, kho vận, tài chính và nhân sự.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-full bg-muted/30 p-1.5">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-full transition-colors",
                    period === p
                      ? "bg-muted/30est text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p === "custom" ? (
                    <span className="flex items-center gap-1">
                      {PERIOD_LABELS[p]} <Calendar className="h-3 w-3" />
                    </span>
                  ) : (
                    PERIOD_LABELS[p]
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md shadow-primary/10 hover:brightness-110 transition-all print:hidden"
            >
              <Download className="h-4 w-4" />
              Xuất báo cáo
            </button>
          </div>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border/40 print:hidden">
        {TAB_DEFS.map((t) => {
          const Icon = t.icon
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "sales" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Doanh thu thuần"
              value={formatCurrency(totalRevenue)}
              icon={TrendingUp}
              accent="primary"
              hint={`${deliveredOrders} đơn đã giao`}
              momPct={momRevenue}
            />
            <KpiCard
              label="Tổng đơn hàng"
              value={String(totalOrders)}
              icon={ShoppingCart}
              accent="secondary"
              hint={`${PERIOD_LABELS[period]}`}
              momPct={momOrders}
            />
            <KpiCard
              label="Giá trị đơn TB"
              value={formatCurrency(aov)}
              icon={Receipt}
              accent="success"
              hint="AOV (Average Order Value)"
              momPct={momAov}
            />
            <KpiCard
              label="Sản phẩm"
              value={String(data.productCount)}
              icon={Package}
              accent="primary"
              hint="Đang hoạt động"
            />
          </div>
          <Link
            href="/reports/sales"
            className="group flex items-center justify-between rounded-2xl border border-border/40 bg-muted/30est p-5 hover:border-primary transition-colors"
          >
            <div>
              <p className="font-bold text-foreground">Xem báo cáo chi tiết Bán hàng</p>
              <p className="text-sm text-muted-foreground">
                Phân tích doanh thu, top sản phẩm, top nhân viên, xu hướng
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </Link>
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Tổng SKU có tồn"
              value={String(new Set(data.batches.map((b) => b.product_id)).size)}
              icon={Boxes}
              accent="primary"
              hint="Sản phẩm đang có hàng"
            />
            <KpiCard
              label="Tổng đơn vị tồn"
              value={totalStock.toLocaleString("vi-VN")}
              icon={Package}
              accent="secondary"
              hint={`${data.batches.length} lô hàng`}
            />
            <KpiCard
              label="Sắp hết hạn"
              value={String(expiringCount)}
              icon={AlertTriangle}
              accent="danger"
              hint="Lô cận date (< 30 ngày)"
            />
            <KpiCard
              label="Lô hàng hoạt động"
              value={String(data.batches.length)}
              icon={Boxes}
              accent="success"
              hint="Còn tồn kho"
            />
          </div>
          <Link
            href="/reports/inventory"
            className="group flex items-center justify-between rounded-2xl border border-border/40 bg-muted/30est p-5 hover:border-primary transition-colors"
          >
            <div>
              <p className="font-bold text-foreground">Xem báo cáo chi tiết Kho hàng</p>
              <p className="text-sm text-muted-foreground">
                Xu hướng tồn kho, cơ cấu theo ngành, SKU cần chú ý
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
          </Link>
        </div>
      )}

      {activeTab === "finance" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Công nợ đang mở"
              value={formatCurrency(openReceivables)}
              icon={Wallet}
              accent="danger"
              hint={`${overdueCount} quá hạn`}
              momPct={momOpenRecv}
              momHigherIsBetter={false}
            />
            <KpiCard
              label="Số phiếu công nợ"
              value={String(data.receivables.length)}
              icon={Receipt}
              accent="primary"
              hint="Tổng phiếu"
              momPct={momRecvCount}
            />
            <KpiCard
              label="Đã thanh toán"
              value={formatCurrency(
                data.receivables.reduce((s, r) => s + r.paid, 0)
              )}
              icon={BarChart3}
              accent="success"
              momPct={momPaid}
              hint="Tổng đã thu"
            />
            <KpiCard
              label="Tỷ lệ quá hạn"
              value={
                data.receivables.length > 0
                  ? `${Math.round((overdueCount / data.receivables.length) * 100)}%`
                  : "0%"
              }
              icon={Percent}
              accent="danger"
              hint="Trên tổng phiếu"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/reports/finance/pnl"
              className="group flex items-center justify-between rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Báo cáo Lãi Lỗ (P&L)</p>
                <p className="text-sm text-muted-foreground">Doanh thu − COGS − chi phí</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              href="/reports/finance/balance-sheet"
              className="group flex items-center justify-between rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Bảng cân đối tài sản</p>
                <p className="text-sm text-muted-foreground">Tài sản, nợ, vốn tại một thời điểm</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              href="/reports/finance/cash-flow"
              className="group flex items-center justify-between rounded-2xl border-2 border-primary/30 bg-primary/5 p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Báo cáo dòng tiền</p>
                <p className="text-sm text-muted-foreground">Thu/chi thực tế theo hoạt động</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              href="/receivables/aging"
              className="group flex items-center justify-between rounded-2xl border border-border/40 bg-muted/30est p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Báo cáo Aging công nợ</p>
                <p className="text-sm text-muted-foreground">Phân tích công nợ theo tuổi nợ</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              href="/finance/expenses"
              className="group flex items-center justify-between rounded-2xl border border-border/40 bg-muted/30est p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Quản lý chi phí</p>
                <p className="text-sm text-muted-foreground">Thêm/xem chi phí vận hành</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              href="/commissions"
              className="group flex items-center justify-between rounded-2xl border border-border/40 bg-muted/30est p-5 hover:border-primary transition-colors"
            >
              <div>
                <p className="font-bold text-foreground">Hoa hồng nhân viên</p>
                <p className="text-sm text-muted-foreground">Ví hoa hồng, chính sách, chi tiết</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </Link>
          </div>
        </div>
      )}

      {activeTab === "hr" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Tổng nhân viên"
              value={String(data.users.length)}
              icon={Users}
              accent="primary"
              hint={`${data.users.filter((u) => u.is_active).length} đang hoạt động • ${newUsersCurr} mới trong kỳ`}
              momPct={momNewUsers}
            />
            <KpiCard
              label="Nhân viên Sales"
              value={String(usersByRole.sales || 0)}
              icon={TrendingUp}
              accent="success"
              hint="Kinh doanh"
            />
            <KpiCard
              label="Nhân viên kho"
              value={String(usersByRole.warehouse || 0)}
              icon={Package}
              accent="secondary"
              hint="Quản lý kho"
            />
            <KpiCard
              label="Tài xế"
              value={String(usersByRole.driver || 0)}
              icon={Truck}
              accent="primary"
              hint="Giao vận"
            />
          </div>
          <Card className="border border-border/40 bg-muted/30est">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-bold text-foreground">Top nhân viên xuất sắc</h3>
                  <p className="text-sm text-muted-foreground">
                    Xếp hạng theo doanh thu trong {PERIOD_LABELS[period].toLowerCase()}
                  </p>
                </div>
              </div>
              {topPerformers.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Chưa có dữ liệu hiệu suất cho kỳ này
                </p>
              ) : (
                <div className="space-y-4">
                  {topPerformers.map((p, i) => {
                    const max = topPerformers[0]?.total || 1
                    const pct = Math.round((p.total / max) * 100)
                    return (
                      <div key={i} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-xs font-bold text-primary">
                              {String(i + 1).padStart(2, "0")}
                            </div>
                            <div className="flex items-center gap-2">
                              <UserCircle className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold text-foreground">{p.name}</span>
                            </div>
                          </div>
                          <span className="font-bold text-primary">{formatCurrency(p.total)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-high">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

type Accent = "primary" | "secondary" | "success" | "danger"

const ACCENT_BORDER: Record<Accent, string> = {
  primary: "border-l-primary",
  secondary: "border-l-secondary",
  success: "border-l-success",
  danger: "border-l-danger",
}

const ACCENT_BG: Record<Accent, string> = {
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary/20 text-secondary-foreground",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
  momPct,
  momHigherIsBetter = true,
}: {
  label: string
  value: string
  icon: typeof TrendingUp
  accent: Accent
  hint?: string
  /** Month-over-month delta in % (e.g. +12.4 = up 12.4% vs prev period). */
  momPct?: number | null
  /** Whether positive = good (green) — false for "expiring count" etc. */
  momHigherIsBetter?: boolean
}) {
  const showMom = momPct != null && Number.isFinite(momPct)
  const isUp = showMom && (momPct as number) > 0
  const isDown = showMom && (momPct as number) < 0
  const positive = (isUp && momHigherIsBetter) || (isDown && !momHigherIsBetter)
  const negative = (isDown && momHigherIsBetter) || (isUp && !momHigherIsBetter)
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/40 border-l-4 bg-muted/30est p-5 shadow-sm transition-transform hover:-translate-y-0.5",
        ACCENT_BORDER[accent]
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={cn("inline-flex p-2 rounded-lg", ACCENT_BG[accent])}>
          <Icon className="h-4 w-4" />
        </span>
        {showMom && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-bold rounded-full px-2 py-0.5",
              positive && "bg-[#ecfdf3] text-tertiary border border-tertiary/40",
              negative && "bg-error-container text-error border border-error/40",
              !positive && !negative && "bg-muted text-muted-foreground border border-border/40"
            )}
            title="So với kỳ trước (Month-over-Month)"
          >
            {isUp ? "▲" : isDown ? "▼" : "—"}{" "}
            {Math.abs(momPct as number).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <h3 className="mt-1 text-xl font-bold text-foreground">{value}</h3>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
