"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
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
  draft: "bg-surface-container text-foreground",
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

export default function DashboardPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const [loading, setLoading] = useState(true)
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
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const today = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
        .toISOString()
        .slice(0, 10)
      const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)

      const [
        todayOrdersRes,
        monthOrdersRes,
        receivablesRes,
        overdueRes,
        lowStockRes,
        expiringRes,
        recentRes,
        topCustRes,
      ] = await Promise.all([
        supabase
          .from("sales_orders")
          .select("id", { count: "exact", head: true })
          .eq("order_date", todayStr),
        supabase
          .from("sales_orders")
          .select("total")
          .gte("order_date", firstDayOfMonth),
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
          .gte("order_date", firstDayOfMonth),
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
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-64" />
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  const topMax = topCustomers[0]?.total || 1

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tổng quan kinh doanh"
        description={`Cập nhật ${formatDate(new Date())}`}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {/* Revenue */}
        <div className="bg-card rounded-2xl shadow-ambient p-6 border-l-4 border-primary">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              Doanh thu tháng
            </p>
            <span className="text-primary bg-primary/10 p-2 rounded-lg inline-flex">
              <Wallet className="h-5 w-5" />
            </span>
          </div>
          <div className="flex items-end gap-3 mb-4">
            <h3 className="text-2xl xl:text-3xl font-black text-foreground tracking-tight">
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
        <div className="bg-card rounded-2xl shadow-ambient p-6 border-l-4 border-secondary">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              Don hang hom nay
            </p>
            <span className="text-secondary bg-secondary/10 p-2 rounded-lg inline-flex">
              <ShoppingBasket className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-3xl font-black text-foreground tracking-tight">
            {stats.todayOrders}
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium flex items-center gap-1">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            Don moi trong ngay
          </p>
        </div>

        {/* Overdue Receivables */}
        <div className="bg-card rounded-2xl shadow-ambient p-6 border-l-4 border-destructive">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              Cong no mo
            </p>
            <span className="text-destructive bg-destructive/10 p-2 rounded-lg inline-flex">
              <AlertTriangle className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-2xl xl:text-3xl font-black text-destructive tracking-tight">
            {formatCurrency(stats.openReceivables)}
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium">
            {stats.overdueCount} khoan qua han
          </p>
        </div>

        {/* Inventory Alert */}
        <div className="bg-card rounded-2xl shadow-ambient p-6 border-l-4 border-amber-500">
          <div className="flex justify-between items-start mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              Ton kho canh bao
            </p>
            <span className="text-amber-600 bg-amber-100 p-2 rounded-lg inline-flex">
              <Warehouse className="h-5 w-5" />
            </span>
          </div>
          <h3 className="text-3xl font-black text-foreground tracking-tight">
            {stats.lowStockCount} SKU
          </h3>
          <p className="text-xs text-muted-foreground mt-2 font-medium">
            Can nhap hang ngay lap tuc
          </p>
        </div>
      </div>

      {/* Charts + Top Customers */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Performance (2/3) */}
        <div className="xl:col-span-2 bg-surface-low rounded-2xl p-6 lg:p-8 relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h4 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight">
                Hieu suat tai chinh
              </h4>
              <p className="text-sm text-muted-foreground">
                Doanh thu trong thang
              </p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-xs font-semibold">Doanh thu</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-secondary" />
                <span className="text-xs font-semibold">Loi nhuan</span>
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
              Bieu do se som cap nhat du lieu thuc
            </div>
          </div>
        </div>

        {/* Top Customers (1/3) */}
        <div className="bg-card rounded-2xl p-6 lg:p-8 shadow-ambient">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg lg:text-xl font-bold text-foreground">
              Top khach hang
            </h4>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chua co du lieu</p>
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
                    <div className="h-2 bg-surface-low rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-primary rounded-full"
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
              Canh bao quan trong
            </h4>
            <span className="px-2 py-1 bg-destructive/10 text-destructive text-[10px] font-black rounded uppercase">
              Can xu ly
            </span>
          </div>
          <div className="space-y-3">
            <div className="p-4 bg-card rounded-2xl shadow-ambient flex gap-4 hover:shadow-ambient-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
                <Hourglass className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Lo hang sap het han
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.expiringSoonCount} lo con han duoi 30 ngay
                </p>
                <Link
                  href="/inventory"
                  className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  Xem chi tiet <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 bg-card rounded-2xl shadow-ambient flex gap-4 hover:shadow-ambient-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Vuot han muc no
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.overdueCount} khach hang co cong no qua han
                </p>
                <Link
                  href="/receivables"
                  className="mt-2 text-xs font-semibold text-primary inline-flex items-center gap-1"
                >
                  Nhac no ngay <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
            <div className="p-4 bg-card rounded-2xl shadow-ambient flex gap-4 hover:shadow-ambient-md transition-shadow">
              <div className="shrink-0 w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                <Warehouse className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  Ton kho thap
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.lowStockCount} lo co ton kho duoi 10 don vi
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
              Hoat dong gan day
            </h4>
            <Link
              href="/orders"
              className="text-sm font-semibold text-primary inline-flex items-center gap-1"
            >
              Tat ca <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="bg-card rounded-2xl overflow-hidden shadow-ambient">
            {recentOrders.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">
                Chua co don hang
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-low text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                      <th className="px-6 py-4">Ma don</th>
                      <th className="px-6 py-4">Khach hang</th>
                      <th className="px-6 py-4 text-right">Gia tri</th>
                      <th className="px-6 py-4 text-center">Trang thai</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {recentOrders.map((o) => (
                      <tr
                        key={o.id}
                        className="hover:bg-surface-low/50 transition-colors"
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
                              "bg-surface-container text-foreground"
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
