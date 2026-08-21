"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Wallet,
  ShoppingBasket,
  AlertTriangle,
  Warehouse,
  TrendingUp,
  Hourglass,
  Users,
  ArrowRight,
} from "lucide-react"
import type { SalesOrder } from "@/types"
import { PendingWorkWidget } from "@/components/dashboard/pending-work-widget"

interface DashboardStats {
  todayOrders: number
  monthRevenue: number
  openReceivables: number
  overdueCount: number
  lowStockCount: number
  expiringSoonCount: number
}

interface TopCustomer {
  customer_id: string
  store_name: string
  total: number
  order_count: number
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-surface-container text-on-surface-variant",
  confirmed: "bg-[#ecfdf3] text-[#027a48]",
  picking: "bg-[#fff4ed] text-[#b54708]",
  delivering: "bg-[#eff8ff] text-[#175cd3]",
  delivered: "bg-[#ecfdf3] text-[#027a48]",
  cancelled: "bg-error-container text-on-error-container",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Mới tạo",
  confirmed: "Đã duyệt",
  picking: "Đang lấy hàng",
  delivering: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
}

type Period = "today" | "week" | "month" | "quarter"

interface ChannelBreakdown {
  channel: string
  revenue: number
  percent: number
}

export default function DashboardPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const isSales = user?.role === "sales"
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState<string>("")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [period, setPeriod] = useState<Period>("month")
  const [stats, setStats] = useState<DashboardStats>({
    todayOrders: 0,
    monthRevenue: 0,
    openReceivables: 0,
    overdueCount: 0,
    lowStockCount: 0,
    expiringSoonCount: 0,
  })
  const [recentOrders, setRecentOrders] = useState<SalesOrder[]>([])
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [channelBreakdown, setChannelBreakdown] = useState<ChannelBreakdown[]>([])
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      try {
        setLoading(true)
        setError(null)
        const now = new Date()
        setToday(formatDate(now))
        const todayStr = now.toISOString().slice(0, 10)
        const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)

        // Period-based date range
        let periodStart: string
        if (period === "today") {
          periodStart = todayStr
        } else if (period === "week") {
          const dayOfWeek = now.getDay() || 7
          const monday = new Date(now)
          monday.setDate(now.getDate() - dayOfWeek + 1)
          periodStart = monday.toISOString().slice(0, 10)
        } else if (period === "quarter") {
          const qMonth = Math.floor(now.getMonth() / 3) * 3
          periodStart = new Date(now.getFullYear(), qMonth, 1).toISOString().slice(0, 10)
        } else {
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
        }

        const [
          todayOrdersRes,
          monthOrdersRes,
          receivablesRes,
          overdueRes,
          lowStockRes,
          expiringRes,
          recentRes,
          topCustRes,
          channelRes,
        ] = await Promise.all([
          supabase
            .from("sales_orders")
            .select("id", { count: "exact", head: true })
            .gte("order_date", periodStart),
          supabase
            .from("sales_orders")
            .select("total")
            .gte("order_date", periodStart),
          supabase
            .from("receivables")
            .select("amount, paid, status")
            .neq("status", "paid"),
          supabase
            .from("receivables")
            .select("id", { count: "exact", head: true })
            .eq("status", "overdue"),
          supabase
            .from("batches")
            .select("id", { count: "exact", head: true })
            .lt("qty_on_hand", 10),
          supabase
            .from("batches")
            .select("id", { count: "exact", head: true })
            .lte("expires_at", in30Days)
            .gte("expires_at", todayStr),
          supabase
            .from("sales_orders")
            .select("id, order_code, total, status, created_at, customer:customers(store_name, phone)")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("sales_orders")
            .select("customer_id, total, customer:customers(store_name)")
            .gte("order_date", periodStart),
          supabase
            .from("sales_orders")
            .select("total, customer:customers(channel)")
            .gte("order_date", periodStart),
        ])
        const qErr = ([todayOrdersRes, monthOrdersRes, receivablesRes, overdueRes, lowStockRes, expiringRes, recentRes, topCustRes, channelRes] as Array<{ error?: { message?: string } | null }>)
          .find((r) => r?.error)?.error
        if (qErr) console.error("[app/dashboard] truy vấn lỗi:", qErr.message)

        const monthRevenue = (monthOrdersRes.data || []).reduce(
          (sum, o: { total: number }) => sum + (o.total || 0),
          0
        )
        const openReceivables = (receivablesRes.data || []).reduce(
          (sum, r: { amount: number; paid: number }) =>
            sum + Math.max(0, (r.amount || 0) - (r.paid || 0)),
          0
        )

        // Group top customers
        const custMap = new Map<string, TopCustomer>()
        const topRows = (topCustRes.data || []) as unknown as Array<{
          customer_id: string
          total: number
          customer: { store_name: string } | { store_name: string }[] | null
        }>
        for (const row of topRows) {
          const id = row.customer_id
          if (!id) continue
          const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer
          const existing = custMap.get(id)
          if (existing) {
            existing.total += row.total || 0
            existing.order_count += 1
          } else {
            custMap.set(id, {
              customer_id: id,
              store_name: cust?.store_name || "N/A",
              total: row.total || 0,
              order_count: 1,
            })
          }
        }
        const topList = Array.from(custMap.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)

        // Channel breakdown
        const channelMap = new Map<string, number>()
        const channelRows = (channelRes.data || []) as unknown as Array<{
          total: number
          customer: { channel: string | null } | { channel: string | null }[] | null
        }>
        let channelTotal = 0
        for (const row of channelRows) {
          const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer
          const ch = cust?.channel || "Khác"
          channelMap.set(ch, (channelMap.get(ch) || 0) + (row.total || 0))
          channelTotal += row.total || 0
        }
        const channelList: ChannelBreakdown[] = Array.from(channelMap.entries())
          .map(([channel, revenue]) => ({
            channel,
            revenue,
            percent: channelTotal > 0 ? Math.round((revenue / channelTotal) * 100) : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue)

        setStats({
          todayOrders: todayOrdersRes.count || 0,
          monthRevenue,
          openReceivables,
          overdueCount: overdueRes.count || 0,
          lowStockCount: lowStockRes.count || 0,
          expiringSoonCount: expiringRes.count || 0,
        })
        setRecentOrders((recentRes.data as unknown as SalesOrder[]) || [])
        setTopCustomers(topList)
        setChannelBreakdown(channelList)
      } catch (err) {
        console.error("Dashboard fetch error:", err)
        setError(err instanceof Error ? err.message : "Không thể tải dữ liệu")
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) {
    return (
      <div className="space-y-card-gap">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-surface-container-low rounded-lg animate-pulse" />
          <div className="h-4 w-40 bg-surface-container-low rounded animate-pulse" />
        </div>
        <div className="grid gap-card-gap sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-surface-container-low rounded-xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-card-gap">
        <PageHeader title="Tổng quan kinh doanh" />
        <div className="bg-error-container border border-error/30 text-on-error-container p-6 rounded-xl">
          <p className="font-semibold mb-1">Không thể tải dữ liệu</p>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm font-semibold underline"
          >
            Thử lại
          </button>
        </div>
      </div>
    )
  }

  const topMax = topCustomers[0]?.total || 1
  const periodLabel =
    period === "today" ? "hôm nay" : period === "week" ? "tuần này" : period === "quarter" ? "quý này" : "tháng này"

  return (
    <div className="space-y-card-gap">
      <PageHeader
        title={isSales ? "Tổng quan của tôi" : "Tổng quan kinh doanh"}
        description={today ? `Cập nhật ${today}` : undefined}
      >
        {/* Period filter pills */}
        <div className="flex gap-1 flex-wrap rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          {([
            { value: "today", label: "Hôm nay" },
            { value: "week", label: "Tuần này" },
            { value: "month", label: "Tháng này" },
            { value: "quarter", label: "Quý này" },
          ] as const).map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                period === p.value
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {isSales && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>Bạn đang xem dữ liệu của chính bạn (đơn hàng bạn tạo, khách hàng bạn phụ trách, công nợ bạn theo dõi)</span>
        </div>
      )}

      {/* KPI Cards — Stitch Bento style */}
      <div className="grid grid-cols-2 gap-card-gap md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={isSales ? `Doanh số của tôi (${periodLabel})` : `Doanh thu (${periodLabel})`}
          value={formatCurrency(stats.monthRevenue)}
          icon={Wallet}
          iconTone="primary"
          tabular
        />
        <KpiCard
          label={isSales ? `Đơn tôi tạo (${periodLabel})` : `Đơn hàng (${periodLabel})`}
          value={stats.todayOrders.toLocaleString("vi-VN")}
          icon={ShoppingBasket}
          iconTone="secondary"
          tabular
          footer={
            <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <span className="w-1.5 h-1.5 bg-tertiary rounded-full animate-pulse" />
              Đơn mới trong kỳ
            </span>
          }
        />
        <KpiCard
          label={isSales ? "Công nợ KH của tôi" : "Công nợ mở"}
          value={formatCurrency(stats.openReceivables)}
          icon={AlertTriangle}
          iconTone="error"
          valueTone="error"
          tabular
          footer={
            <span className="text-xs text-on-surface-variant">
              {stats.overdueCount} khoản quá hạn
            </span>
          }
        />
        <KpiCard
          label="Tồn kho cảnh báo"
          value={`${stats.lowStockCount} SKU`}
          icon={Warehouse}
          iconTone="warning"
          tabular
          footer={
            <span className="text-xs text-on-surface-variant">
              Cần nhập hàng ngay
            </span>
          }
        />
      </div>

      {/* T-05: Resume in-progress workflows (xuất kho, giao hàng, thu tiền…) */}
      <PendingWorkWidget />

      {/* Channel Breakdown */}
      {channelBreakdown.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card p-6">
          <h4 className="text-headline-md font-semibold text-on-surface mb-4">Doanh thu theo kênh</h4>
          <div className="space-y-4">
            {channelBreakdown.map((ch) => (
              <div key={ch.channel} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-on-surface">{ch.channel}</span>
                  <span className="text-on-surface-variant tabular-data">
                    {formatCurrency(ch.revenue)} <span className="text-on-surface-variant/70">({ch.percent}%)</span>
                  </span>
                </div>
                <div className="h-2.5 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(ch.percent, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance + Top Customers */}
      <div className="grid grid-cols-1 gap-card-gap xl:grid-cols-3">
        {/* Performance (col-span-2) */}
        <div className="xl:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-outline-variant/40">
            <div>
              <h4 className="text-headline-md font-semibold text-on-surface">Hiệu suất tài chính</h4>
              <p className="text-sm text-on-surface-variant mt-0.5">Doanh thu trong {periodLabel}</p>
            </div>
            <div className="hidden sm:flex gap-4">
              <LegendDot color="primary" label="Doanh thu" />
              <LegendDot color="secondary" label="Lợi nhuận" />
            </div>
          </div>
          <div className="relative h-56 flex-1 bg-surface-container-low rounded-lg flex items-end px-6 pb-6 gap-3">
            {[55, 38, 72, 48, 65, 80, 50].map((h, i) => (
              <div key={i} className="flex-1 relative h-full flex items-end">
                <div className="w-full bg-primary/15 rounded-t-md relative" style={{ height: `${h}%` }}>
                  <div className="absolute bottom-0 left-0 right-0 bg-primary rounded-t-md" style={{ height: "55%" }} />
                </div>
              </div>
            ))}
            <div className="absolute top-3 right-4 flex items-center gap-1.5 text-[11px] font-medium text-on-surface-variant bg-surface-container-lowest/80 backdrop-blur px-2 py-1 rounded-md">
              <TrendingUp className="h-3 w-3 text-primary" />
              Sắp cập nhật dữ liệu thực
            </div>
          </div>
        </div>

        {/* Top Customers (col-span-1) */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card p-6">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-outline-variant/40">
            <h4 className="text-headline-md font-semibold text-on-surface">Top khách hàng</h4>
            <Users className="h-5 w-5 text-on-surface-variant" strokeWidth={1.75} />
          </div>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-6">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-4">
              {topCustomers.map((c) => {
                const pct = Math.round((c.total / topMax) * 100)
                return (
                  <div key={c.customer_id} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-on-surface truncate pr-2">
                        {c.store_name}
                      </span>
                      <span className="text-on-surface-variant tabular-data shrink-0">
                        {formatCurrency(c.total)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Alerts + Recent Orders */}
      <div className="grid grid-cols-1 gap-card-gap lg:grid-cols-5">
        {/* Alerts (2 cols) */}
        <div className="lg:col-span-2 space-y-stack-md">
          <div className="flex items-center justify-between">
            <h4 className="text-headline-md font-semibold text-on-surface">Cảnh báo quan trọng</h4>
            <span className="px-2.5 py-1 bg-error/10 text-error text-[10px] font-bold rounded-full uppercase tracking-wider">
              Cần xử lý
            </span>
          </div>
          <div className="space-y-3">
            <AlertCard
              icon={Hourglass}
              tone="error"
              title="Lô hàng sắp hết hạn"
              detail={`${stats.expiringSoonCount} lô còn hạn dưới 30 ngày`}
              actionHref="/inventory"
              actionLabel="Xem chi tiết"
            />
            <AlertCard
              icon={AlertTriangle}
              tone="warning"
              title="Vượt hạn mức nợ"
              detail={`${stats.overdueCount} khách hàng có công nợ quá hạn`}
              actionHref="/receivables"
              actionLabel="Nhắc nợ ngay"
            />
            <AlertCard
              icon={Warehouse}
              tone="warning"
              title="Tồn kho thấp"
              detail={`${stats.lowStockCount} lô có tồn kho dưới 10 đơn vị`}
              actionHref="/inventory"
              actionLabel="Xem kho"
            />
          </div>
        </div>

        {/* Recent Orders (3 cols) */}
        <div className="lg:col-span-3 space-y-stack-md">
          <div className="flex items-center justify-between">
            <h4 className="text-headline-md font-semibold text-on-surface">Hoạt động gần đây</h4>
            <Link
              href="/orders"
              className="text-sm font-semibold text-primary inline-flex items-center gap-1 hover:underline"
            >
              Tất cả <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card overflow-hidden">
            {recentOrders.length === 0 ? (
              <p className="text-center py-8 text-on-surface-variant text-sm">
                Chưa có đơn hàng
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-[11px] uppercase font-semibold tracking-wider text-on-surface-variant border-b border-outline-variant/40">
                      <th className="px-6 py-3">Mã đơn</th>
                      <th className="px-6 py-3">Khách hàng</th>
                      <th className="px-6 py-3 text-right">Giá trị</th>
                      <th className="px-6 py-3 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-outline-variant/30">
                    {recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#F5F9FF] transition-colors group cursor-pointer">
                        <td className="px-6 py-3.5 font-semibold text-primary group-hover:underline">
                          <Link href={`/orders/${o.id}`}>{o.order_code}</Link>
                        </td>
                        <td className="px-6 py-3.5 text-on-surface truncate max-w-[180px]">
                          {o.customer?.store_name || "-"}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold text-on-surface tabular-data">
                          {formatCurrency(o.total)}
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full ${STATUS_BADGE[o.status] || "bg-surface-container text-on-surface-variant"}`}>
                            {STATUS_LABEL[o.status] || o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// === Local presentational helpers ===

type IconTone = "primary" | "secondary" | "error" | "warning"
type ValueTone = "default" | "error"

interface KpiCardProps {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  iconTone?: IconTone
  valueTone?: ValueTone
  tabular?: boolean
  footer?: React.ReactNode
}

function KpiCard({ label, value, icon: IconComp, iconTone = "primary", valueTone = "default", tabular, footer }: KpiCardProps) {
  const iconClasses: Record<IconTone, string> = {
    primary: "bg-primary-fixed text-primary",
    secondary: "bg-secondary-fixed text-on-secondary-fixed",
    error: "bg-error-container text-error",
    warning: "bg-[#fff4ed] text-[#b54708]",
  }
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card p-5 sm:p-6 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <p className="text-label-md uppercase text-on-surface-variant pr-2">{label}</p>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClasses[iconTone]}`}>
          <IconComp className="h-5 w-5" />
        </div>
      </div>
      <h3 className={`text-xl sm:text-headline-lg font-bold leading-tight tracking-tight ${valueTone === "error" ? "text-error" : "text-on-surface"} ${tabular ? "tabular-data" : ""}`}>
        {value}
      </h3>
      {footer && <div className="mt-auto pt-1">{footer}</div>}
    </div>
  )
}

interface AlertCardProps {
  icon: React.ComponentType<{ className?: string }>
  tone: "error" | "warning"
  title: string
  detail: string
  actionHref: string
  actionLabel: string
}

function AlertCard({ icon: IconComp, tone, title, detail, actionHref, actionLabel }: AlertCardProps) {
  const iconClasses = tone === "error"
    ? "bg-error-container text-error"
    : "bg-[#fff4ed] text-[#b54708]"
  return (
    <div className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/60 shadow-card flex gap-3 hover:shadow-card-hover transition-shadow">
      <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${iconClasses}`}>
        <IconComp className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-on-surface">{title}</p>
        <p className="text-xs text-on-surface-variant mt-0.5">{detail}</p>
        <Link
          href={actionHref}
          className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1 hover:underline"
        >
          {actionLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: "primary" | "secondary"; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full ${color === "primary" ? "bg-primary" : "bg-secondary"}`} />
      <span className="text-xs font-medium text-on-surface-variant">{label}</span>
    </div>
  )
}
