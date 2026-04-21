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
  draft: "bg-muted/50 text-foreground",
  confirmed: "bg-green-100 text-green-700",
  picking: "bg-amber-100 text-amber-700",
  delivering: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-destructive/10 text-destructive",
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
            .select("*, customer:customers(store_name, phone)")
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
        setRecentOrders((recentRes.data as SalesOrder[]) || [])
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
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-muted/50 rounded-lg animate-pulse" />
          <div className="h-4 w-40 bg-muted/30 rounded animate-pulse" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted/50 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-muted/50 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tổng quan kinh doanh" />
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 rounded-2xl">
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

  return (
    <div className="space-y-8">
      <PageHeader
        title={isSales ? "Tổng quan của tôi" : "Tổng quan kinh doanh"}
        description={today ? `Cập nhật ${today}` : undefined}
      />

      {/* Period filter pills */}
      <div className="flex gap-2 flex-wrap">
        {([
          { value: "today", label: "Hôm nay" },
          { value: "week", label: "Tuần này" },
          { value: "month", label: "Tháng này" },
          { value: "quarter", label: "Quý này" },
        ] as const).map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              period === p.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isSales && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-bold">i</span>
          Bạn đang xem dữ liệu của chính bạn (đơn hàng bạn tạo, khách hàng bạn phụ trách, công nợ bạn theo dõi)
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {/* Revenue */}
        <div className="bg-card rounded-2xl shadow-sm p-6 border-l-4 border-primary">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              {isSales ? "Doanh số của tôi" : "Doanh thu"} ({period === "today" ? "hôm nay" : period === "week" ? "tuần" : period === "quarter" ? "quý" : "tháng"})
            </p>
            <span className="text-primary bg-primary/10 p-2 rounded-lg inline-flex">
              <Wallet className="h-5 w-5" />
            </span>
          </div>
          <div className="flex items-end gap-3 mb-4">
            <h3 className="text-2xl xl:text-2xl font-bold text-foreground tracking-tight">
              {formatCurrency(stats.monthRevenue)}
            </h3>
          </div>
          <div className="h-12 w-full flex items-end gap-1">
            <div className="flex-1 bg-primary/10 h-6 rounded-t-sm" />
            <div className="flex-1 bg-primary/20 h-8 rounded-t-sm" />
            <div className="flex-1 bg-primary/30 h-10 rounded-t-sm" />
            <div className="flex-1 bg-primary/40 h-7 rounded-t-sm" />
            <div className="flex-1 bg-primary/50 h-9 rounded-t-sm" />
            <div className="flex-1 bg-primary/60 h-12 rounded-t-sm" />
            <div className="flex-1 bg-primary h-11 rounded-t-sm" />
          </div>
        </div>

        {/* Today's Orders */}
        <div className="bg-card rounded-2xl shadow-sm p-6 border-l-4 border-secondary">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              {isSales ? "Đơn tôi tạo" : "Đơn hàng"} ({period === "today" ? "hôm nay" : period === "week" ? "tuần này" : period === "quarter" ? "quý này" : "tháng này"})
            </p>
            <span className="text-secondary bg-secondary/10 p-2 rounded-lg inline-flex">
              <ShoppingBasket className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-2xl font-bold text-foreground tracking-tight">
            {stats.todayOrders}
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium flex items-center gap-1">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            Đơn mới trong ngày
          </p>
        </div>

        {/* Overdue Receivables */}
        <div className="bg-card rounded-2xl shadow-sm p-6 border-l-4 border-destructive">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              {isSales ? "Công nợ KH của tôi" : "Công nợ mở"}
            </p>
            <span className="text-destructive bg-destructive/10 p-2 rounded-lg inline-flex">
              <AlertTriangle className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-2xl xl:text-2xl font-bold text-destructive tracking-tight">
            {formatCurrency(stats.openReceivables)}
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium">
            {stats.overdueCount} khoản quá hạn
          </p>
        </div>

        {/* Inventory Alert */}
        <div className="bg-card rounded-2xl shadow-sm p-6 border-l-4 border-amber-500">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              Tồn kho cảnh báo
            </p>
            <span className="text-amber-600 bg-amber-100 p-2 rounded-lg inline-flex">
              <Warehouse className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-2xl font-bold text-foreground tracking-tight">
            {stats.lowStockCount} SKU
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium">
            Cần nhập hàng ngay lập tức
          </p>
        </div>
      </div>

      {/* Channel Breakdown */}
      {channelBreakdown.length > 0 && (
        <div className="bg-card rounded-2xl shadow-sm p-6">
          <h4 className="text-lg font-bold text-foreground mb-4">Doanh thu theo kênh</h4>
          <div className="space-y-4">
            {channelBreakdown.map((ch) => (
              <div key={ch.channel} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{ch.channel}</span>
                  <span className="text-muted-foreground">{formatCurrency(ch.revenue)} ({ch.percent}%)</span>
                </div>
                <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
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

      {/* Charts + Top Customers */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Performance (2/3) */}
        <div className="xl:col-span-2 bg-muted/30 rounded-2xl p-6 lg:p-8 relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h4 className="text-xl lg:text-xl font-bold text-foreground tracking-tight">
                Hiệu suất tài chính
              </h4>
              <p className="text-sm text-muted-foreground">
                Doanh thu trong tháng
              </p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs font-semibold">Doanh thu</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-secondary" />
                <span className="text-xs font-semibold">Lợi nhuận</span>
              </div>
            </div>
          </div>
          <div className="relative h-56 w-full bg-card rounded-2xl flex items-end justify-around px-4 pb-8">
            <div className="absolute inset-x-8 bottom-10 h-32 flex items-end gap-6 lg:gap-12 opacity-80">
              <div className="flex-1 h-3/4 bg-primary/10 rounded-full relative">
                <div className="absolute bottom-0 w-full h-1/2 bg-primary rounded-full" />
              </div>
              <div className="flex-1 h-1/2 bg-primary/10 rounded-full relative">
                <div className="absolute bottom-0 w-full h-2/3 bg-primary rounded-full" />
              </div>
              <div className="flex-1 h-full bg-primary/10 rounded-full relative">
                <div className="absolute bottom-0 w-full h-4/5 bg-primary rounded-full" />
              </div>
              <div className="flex-1 h-2/3 bg-primary/10 rounded-full relative">
                <div className="absolute bottom-0 w-full h-1/3 bg-primary rounded-full" />
              </div>
              <div className="flex-1 h-4/5 bg-primary/10 rounded-full relative">
                <div className="absolute bottom-0 w-full h-3/4 bg-primary rounded-full" />
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-card/20 to-transparent pointer-events-none" />
            <div className="relative z-10 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Biểu đồ sẽ sớm cập nhật dữ liệu thực
            </div>
          </div>
        </div>

        {/* Top Customers (1/3) */}
        <div className="bg-card rounded-2xl p-6 lg:p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg lg:text-xl font-bold text-foreground">
              Top khách hàng
            </h4>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-5">
              {topCustomers.map((c) => {
                const pct = Math.round((c.total / topMax) * 100)
                return (
                  <div key={c.customer_id} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-bold text-foreground truncate pr-2">
                        {c.store_name}
                      </span>
                      <span className="font-medium text-muted-foreground shrink-0">
                        {formatCurrency(c.total)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Alerts (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg lg:text-xl font-bold text-foreground">
              Cảnh báo quan trọng
            </h4>
            <span className="px-2 py-1 bg-destructive/10 text-destructive text-[10px] font-bold rounded uppercase">
              Cần xử lý
            </span>
          </div>
          <div className="space-y-3">
            <div className="p-4 bg-card rounded-2xl shadow-sm flex gap-4 hover:shadow-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
                <Hourglass className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Lô hàng sắp hết hạn
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.expiringSoonCount} lô còn hạn dưới 30 ngày
                </p>
                <Link
                  href="/inventory"
                  className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  Xem chi tiết <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 bg-card rounded-2xl shadow-sm flex gap-4 hover:shadow-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Vượt hạn mức nợ
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.overdueCount} khách hàng có công nợ quá hạn
                </p>
                <Link
                  href="/receivables"
                  className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  Nhắc nợ ngay <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 bg-card rounded-2xl shadow-sm flex gap-4 hover:shadow-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                <Warehouse className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Tồn kho thấp
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.lowStockCount} lô có tồn kho dưới 10 đơn vị
                </p>
                <Link
                  href="/inventory"
                  className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  Xem kho <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Orders (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg lg:text-xl font-bold text-foreground">
              Hoạt động gần đây
            </h4>
            <Link
              href="/orders"
              className="text-sm font-semibold text-primary inline-flex items-center gap-1"
            >
              Tất cả <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="bg-card rounded-2xl overflow-hidden shadow-sm">
            {recentOrders.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">
                Chưa có đơn hàng
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/30 text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                      <th className="px-6 py-4">Mã đơn</th>
                      <th className="px-6 py-4">Khách hàng</th>
                      <th className="px-6 py-4 text-right">Giá trị</th>
                      <th className="px-6 py-4 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {recentOrders.map((o) => (
                      <tr
                        key={o.id}
                        className="hover:bg-muted/30/50 transition-colors"
                      >
                        <td className="px-6 py-4 font-bold text-primary">
                          <Link href={`/orders/${o.id}`}>{o.order_code}</Link>
                        </td>
                        <td className="px-6 py-4 text-foreground truncate max-w-[180px]">
                          {o.customer?.store_name || "-"}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold text-foreground">
                          {formatCurrency(o.total)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`px-2 py-1 text-[10px] font-bold rounded-full ${
                              STATUS_BADGE[o.status] ||
                              "bg-muted/50 text-foreground"
                            }`}
                          >
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
