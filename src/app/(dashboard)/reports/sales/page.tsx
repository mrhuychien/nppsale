"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, cn } from "@/lib/utils"
import {
  ShoppingCart,
  TrendingUp,
  Users,
  Package,
  UserCircle,
  Download,
  Trophy,
} from "lucide-react"
import type { SalesOrder, SalesOrderLine, User, Product } from "@/types"

type Period = "today" | "week" | "month"

const PERIOD_LABELS: Record<Period, string> = {
  today: "Hôm nay",
  week: "Tuần này",
  month: "Tháng này",
}

export default function SalesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [lines, setLines] = useState<(SalesOrderLine & { product?: Product })[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [customerCount, setCustomerCount] = useState(0)
  const [productCount, setProductCount] = useState(0)
  const [period, setPeriod] = useState<Period>("month")
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const [ordersRes, linesRes, usersRes, custRes, prodRes] = await Promise.all([
        supabase.from("sales_orders").select("*").order("order_date", { ascending: false }),
        supabase.from("sales_order_lines").select("*, product:products(*)"),
        supabase.from("users").select("*"),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
      ])
      setOrders((ordersRes.data as SalesOrder[]) || [])
      setLines((linesRes.data as (SalesOrderLine & { product?: Product })[]) || [])
      setUsers((usersRes.data as User[]) || [])
      setCustomerCount(custRes.count || 0)
      setProductCount(prodRes.count || 0)
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredOrders = useMemo(() => {
    const now = new Date()
    const cutoff = new Date(now)
    if (period === "today") cutoff.setHours(0, 0, 0, 0)
    else if (period === "week") cutoff.setDate(now.getDate() - 7)
    else cutoff.setMonth(now.getMonth() - 1)
    return orders.filter((o) => new Date(o.order_date) >= cutoff)
  }, [orders, period])

  const trendData = useMemo(() => {
    // Build buckets based on period
    const now = new Date()
    const buckets: { label: string; value: number }[] = []
    if (period === "today") {
      for (let h = 0; h < 24; h += 4) {
        buckets.push({ label: `${h}h`, value: 0 })
      }
      filteredOrders
        .filter((o) => o.status === "delivered")
        .forEach((o) => {
          const d = new Date(o.order_date)
          const idx = Math.floor(d.getHours() / 4)
          if (buckets[idx]) buckets[idx].value += o.total
        })
    } else if (period === "week") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(now.getDate() - i)
        buckets.push({ label: `T${d.getDay() === 0 ? "CN" : d.getDay() + 1}`, value: 0 })
      }
      filteredOrders
        .filter((o) => o.status === "delivered")
        .forEach((o) => {
          const d = new Date(o.order_date)
          const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
          const idx = 6 - diff
          if (idx >= 0 && idx < 7) buckets[idx].value += o.total
        })
    } else {
      for (let i = 3; i >= 0; i--) {
        buckets.push({ label: `Tuần ${4 - i}`, value: 0 })
      }
      filteredOrders
        .filter((o) => o.status === "delivered")
        .forEach((o) => {
          const d = new Date(o.order_date)
          const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
          const idx = 3 - Math.min(3, Math.floor(diff / 7))
          if (idx >= 0 && idx < 4) buckets[idx].value += o.total
        })
    }
    return buckets
  }, [filteredOrders, period])

  const topReps = useMemo(() => {
    const map = new Map<string, number>()
    filteredOrders
      .filter((o) => o.status === "delivered")
      .forEach((o) => {
        map.set(o.sales_user_id, (map.get(o.sales_user_id) || 0) + o.total)
      })
    return Array.from(map.entries())
      .map(([uid, total]) => ({
        name: users.find((u) => u.id === uid)?.full_name || "—",
        total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [filteredOrders, users])

  const topProducts = useMemo(() => {
    const orderIds = new Set(
      filteredOrders.filter((o) => o.status === "delivered").map((o) => o.id)
    )
    const map = new Map<string, { name: string; quantity: number; revenue: number }>()
    lines
      .filter((l) => orderIds.has(l.order_id))
      .forEach((l) => {
        const existing = map.get(l.product_id) || {
          name: l.product?.name || "—",
          quantity: 0,
          revenue: 0,
        }
        existing.quantity += l.quantity
        existing.revenue += l.line_total
        map.set(l.product_id, existing)
      })
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }, [filteredOrders, lines])

  if (authLoading || loading) return <Skeleton className="h-[500px]" />

  const totalRevenue = filteredOrders
    .filter((o) => o.status === "delivered")
    .reduce((sum, o) => sum + o.total, 0)
  const totalOrders = filteredOrders.length
  const deliveredOrders = filteredOrders.filter((o) => o.status === "delivered").length
  const avgOrderValue = deliveredOrders > 0 ? totalRevenue / deliveredOrders : 0
  const maxTrend = Math.max(...trendData.map((t) => t.value), 1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Báo cáo Doanh số"
        description="Phân tích doanh thu, top sản phẩm và hiệu suất nhân viên kinh doanh"
        backHref="/reports"
      >
        <button
          onClick={() => typeof window !== "undefined" && window.print()}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-md hover:brightness-110 transition-all print:hidden"
        >
          <Download className="h-4 w-4" /> Xuất báo cáo
        </button>
      </PageHeader>

      {/* Period selector */}
      <div className="flex items-center gap-1 rounded-full bg-surface-low p-1.5 w-fit print:hidden">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "px-4 py-1.5 text-xs font-semibold rounded-full transition-colors",
              period === p
                ? "bg-surface-lowest text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-primary bg-surface-lowest shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Doanh thu thuần
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">{formatCurrency(totalRevenue)}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{deliveredOrders} đơn đã giao</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary bg-surface-lowest shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-secondary/20 text-secondary-foreground">
                <ShoppingCart className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tổng đơn hàng
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">{totalOrders}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{deliveredOrders} đã giao</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-success bg-surface-lowest shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-success/10 text-success">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Khách hàng
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">{customerCount}</h3>
            <p className="mt-2 text-xs text-muted-foreground">Tổng số khách</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary bg-surface-lowest shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-primary/10 text-primary">
                <Package className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Giá trị TB/đơn
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">{formatCurrency(avgOrderValue)}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{productCount} sản phẩm</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue trend chart */}
      <Card className="bg-surface-lowest border border-border/40 shadow-sm">
        <CardContent className="p-6 lg:p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-foreground">Biểu đồ doanh thu</h3>
              <p className="text-sm text-muted-foreground">
                Xu hướng doanh thu trong {PERIOD_LABELS[period].toLowerCase()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-primary" />
              <span className="text-xs font-semibold text-muted-foreground">Doanh thu</span>
            </div>
          </div>
          <div className="relative h-56">
            <div className="absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="border-t border-border/20" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-3 px-2">
              {trendData.map((t, i) => {
                const h = Math.max(4, Math.round((t.value / maxTrend) * 100))
                return (
                  <div
                    key={i}
                    className="group flex-1 flex flex-col items-center gap-2 h-full justify-end"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatCurrency(t.value)}
                    </span>
                    <div
                      className="w-full max-w-[48px] rounded-t-lg bg-gradient-to-t from-primary to-primary/60 shadow-sm transition-all group-hover:brightness-110"
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top sales reps */}
        <Card className="bg-surface-lowest border border-border/40 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <Trophy className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-bold text-foreground">Top 5 nhân viên kinh doanh</h3>
            </div>
            {topReps.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có dữ liệu doanh thu trong kỳ này
              </p>
            ) : (
              <div className="space-y-4">
                {topReps.map((rep, i) => {
                  const max = topReps[0]?.total || 1
                  const pct = Math.round((rep.total / max) * 100)
                  return (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-xs font-black text-primary">
                            {String(i + 1).padStart(2, "0")}
                          </div>
                          <div className="flex items-center gap-2">
                            <UserCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{rep.name}</span>
                          </div>
                        </div>
                        <span className="font-bold text-primary">{formatCurrency(rep.total)}</span>
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

        {/* Top products */}
        <Card className="bg-surface-lowest border border-border/40 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-bold text-foreground">Top 5 sản phẩm bán chạy</h3>
            </div>
            {topProducts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có dữ liệu sản phẩm trong kỳ này
              </p>
            ) : (
              <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 bg-surface-low p-3 rounded-xl"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-high font-black text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {p.quantity} đơn vị • {formatCurrency(p.revenue)}
                      </p>
                    </div>
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
