"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { formatCurrency } from "@/lib/utils"
import {
  Plus,
  Wallet,
  Users,
  ClipboardList,
  MapPin,
  TrendingUp,
  ShoppingBasket,
  AlertTriangle,
  ArrowRight,
  Package,
} from "lucide-react"

interface HomeStats {
  todayOrderCount: number
  todayRevenue: number
  openReceivables: number
}

interface AssignedCustomer {
  customer_id: string
  store_name: string
  address: string | null
  visited: boolean
}

interface TopProduct {
  product_id: string
  name: string
  sku: string
  quantity: number
  revenue: number
}

function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return "Chào buổi sáng"
  if (hour >= 11 && hour < 13) return "Chào buổi trưa"
  if (hour >= 13 && hour < 18) return "Chào buổi chiều"
  return "Chào buổi tối"
}

export default function HomePage() {
  const { loading: authLoading, user } = useRoleGuard("orders")
  const { user: authedUser } = useAuth()
  const currentUser = user ?? authedUser
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<HomeStats>({
    todayOrderCount: 0,
    todayRevenue: 0,
    openReceivables: 0,
  })
  const [assignedCustomers, setAssignedCustomers] = useState<AssignedCustomer[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [greeting, setGreeting] = useState<string>("Chào bạn")
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    setGreeting(getGreeting(new Date().getHours()))
  }, [])

  useEffect(() => {
    if (!currentUser?.id) return
    let cancelled = false

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        const now = new Date()
        const todayStr = now.toISOString().slice(0, 10)
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .slice(0, 10)
        const myUserId = currentUser!.id

        const [
          assignmentsRes,
          todayOrdersRes,
          receivablesRes,
          monthOrdersRes,
        ] = await Promise.all([
          supabase
            .from("customer_assignments")
            .select(
              "customer_id, customer:customers(id, store_name, address)"
            )
            .eq("user_id", myUserId)
            .eq("status", "active"),
          supabase
            .from("sales_orders")
            .select("id, total, customer_id, created_at")
            .eq("sales_user_id", myUserId)
            .eq("order_date", todayStr),
          supabase
            .from("receivables")
            .select("amount, paid, status")
            .eq("sales_user_id", myUserId)
            .neq("status", "paid"),
          supabase
            .from("sales_orders")
            .select(
              "id, order_date, lines:sales_order_lines(product_id, quantity, line_total, product:products(id, sku, name))"
            )
            .eq("sales_user_id", myUserId)
            .gte("order_date", firstDayOfMonth),
        ])

        if (cancelled) return

        // Assigned customers + today's visits
        const rawAssignments =
          (assignmentsRes.data as unknown as Array<{
            customer_id: string
            customer:
              | { id: string; store_name: string; address: string | null }
              | { id: string; store_name: string; address: string | null }[]
              | null
          }>) || []

        const custRows: AssignedCustomer[] = rawAssignments.map((r) => {
          const c = Array.isArray(r.customer) ? r.customer[0] : r.customer
          return {
            customer_id: r.customer_id,
            store_name: c?.store_name || "N/A",
            address: c?.address || null,
            visited: false,
          }
        })

        const todayOrders =
          (todayOrdersRes.data as Array<{
            id: string
            total: number
            customer_id: string
          }>) || []
        const visitedCustomerIds = new Set(
          todayOrders.map((o) => o.customer_id).filter(Boolean)
        )
        for (const row of custRows) {
          if (visitedCustomerIds.has(row.customer_id)) row.visited = true
        }

        // KPIs
        const todayRevenue = todayOrders.reduce(
          (s, o) => s + (o.total || 0),
          0
        )
        const openReceivables = (
          (receivablesRes.data as Array<{ amount: number; paid: number }>) || []
        ).reduce(
          (s, r) => s + Math.max(0, (r.amount || 0) - (r.paid || 0)),
          0
        )

        // Top products from user's month orders
        type LineRow = {
          product_id: string
          quantity: number
          line_total: number
          product:
            | { id: string; sku: string; name: string }
            | { id: string; sku: string; name: string }[]
            | null
        }
        type OrderRow = { lines: LineRow[] | null }
        const monthOrders =
          (monthOrdersRes.data as unknown as OrderRow[]) || []
        const prodMap = new Map<string, TopProduct>()
        for (const o of monthOrders) {
          for (const ln of o.lines || []) {
            const p = Array.isArray(ln.product) ? ln.product[0] : ln.product
            if (!p?.id) continue
            const existing = prodMap.get(p.id)
            if (existing) {
              existing.quantity += ln.quantity || 0
              existing.revenue += ln.line_total || 0
            } else {
              prodMap.set(p.id, {
                product_id: p.id,
                sku: p.sku,
                name: p.name,
                quantity: ln.quantity || 0,
                revenue: ln.line_total || 0,
              })
            }
          }
        }
        const topList = Array.from(prodMap.values())
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 5)

        setStats({
          todayOrderCount: todayOrders.length,
          todayRevenue,
          openReceivables,
        })
        setAssignedCustomers(custRows)
        setTopProducts(topList)
      } catch (err) {
        if (cancelled) return
        console.error("[home] fetch error:", err)
        setError(err instanceof Error ? err.message : "Không thể tải dữ liệu")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
  }, [currentUser?.id, supabase])

  const firstName =
    currentUser?.full_name?.trim().split(/\s+/).slice(-1)[0] || "bạn"

  const visitedCount = assignedCustomers.filter((c) => c.visited).length
  const totalAssigned = assignedCustomers.length
  const progressPct = totalAssigned
    ? Math.round((visitedCount / totalAssigned) * 100)
    : 0

  if (authLoading || (loading && !error)) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-10 w-2/3 bg-surface-container rounded-xl animate-pulse" />
          <div className="h-4 w-1/2 bg-surface-low rounded animate-pulse" />
        </div>
        <div className="h-32 bg-surface-container rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 bg-surface-container rounded-2xl animate-pulse"
            />
          ))}
        </div>
        <div className="h-40 bg-surface-container rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
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

  return (
    <div className="space-y-6 pb-4">
      {/* Greeting */}
      <section className="space-y-1">
        <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-foreground">
          {greeting}, {firstName}!
        </h1>
        <p className="text-sm text-muted-foreground font-medium">
          {totalAssigned > 0
            ? `Hôm nay bạn có ${totalAssigned} điểm ghé thăm được phân công.`
            : "Chưa có khách hàng nào được phân công cho bạn."}
        </p>
      </section>

      {/* Route card */}
      <section className="bg-card rounded-2xl shadow-ambient p-5 lg:p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground leading-tight">
                Lộ trình hôm nay
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {visitedCount}/{totalAssigned} khách hàng đã ghé thăm
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              alert("Tích hợp bản đồ sẽ được bổ sung trong phiên bản sau.")
            }
            className="text-xs font-bold text-primary hover:underline shrink-0"
          >
            Xem bản đồ
          </button>
        </div>

        <div className="space-y-2">
          <div className="h-2 w-full bg-surface-low rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-primary rounded-full transition-all"
              style={{ width: `${Math.max(progressPct, totalAssigned ? 4 : 0)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
            <span>Tiến độ: {progressPct}%</span>
            <span>{totalAssigned - visitedCount} còn lại</span>
          </div>
        </div>

        {assignedCustomers.length > 0 && (
          <div className="space-y-2 pt-1">
            {assignedCustomers.slice(0, 3).map((c) => (
              <Link
                key={c.customer_id}
                href={`/customers/${c.customer_id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-low/70 active:bg-surface-container transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      c.visited
                        ? "bg-green-100 text-green-600"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {c.store_name}
                    </p>
                    {c.address && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.address}
                      </p>
                    )}
                  </div>
                </div>
                {c.visited ? (
                  <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full shrink-0">
                    Đã ghé
                  </span>
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </Link>
            ))}
            {assignedCustomers.length > 3 && (
              <Link
                href="/customers"
                className="block text-center text-xs font-semibold text-primary py-2"
              >
                Xem tất cả {assignedCustomers.length} khách hàng
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Quick actions 2x2 */}
      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/orders/new"
          className="flex flex-col items-start justify-between gap-3 p-5 bg-gradient-primary text-white rounded-2xl shadow-ambient-md active:scale-[0.98] transition-transform min-h-[112px]"
        >
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-sm font-bold leading-tight">Tạo đơn</span>
        </Link>
        <Link
          href="/receivables/collect"
          className="flex flex-col items-start justify-between gap-3 p-5 bg-card rounded-2xl shadow-ambient active:scale-[0.98] transition-transform min-h-[112px]"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Wallet className="h-5 w-5" />
          </div>
          <span className="text-sm font-bold leading-tight text-foreground">
            Thu tiền
          </span>
        </Link>
        <Link
          href="/customers"
          className="flex flex-col items-start justify-between gap-3 p-5 bg-card rounded-2xl shadow-ambient active:scale-[0.98] transition-transform min-h-[112px]"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <span className="text-sm font-bold leading-tight text-foreground">
            Khách hàng
          </span>
        </Link>
        <Link
          href="/orders"
          className="flex flex-col items-start justify-between gap-3 p-5 bg-card rounded-2xl shadow-ambient active:scale-[0.98] transition-transform min-h-[112px]"
        >
          <div className="w-10 h-10 rounded-xl bg-green-100 text-green-600 flex items-center justify-center">
            <ClipboardList className="h-5 w-5" />
          </div>
          <span className="text-sm font-bold leading-tight text-foreground">
            Đơn của tôi
          </span>
        </Link>
      </section>

      {/* KPI cards */}
      <section className="space-y-3">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Kết quả hôm nay
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-primary">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Số đơn tạo
              </p>
              <ShoppingBasket className="h-4 w-4 text-primary" />
            </div>
            <p className="text-2xl font-black text-foreground tracking-tight">
              {stats.todayOrderCount}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Đơn hàng tạo hôm nay
            </p>
          </div>
          <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-green-500">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Doanh thu
              </p>
              <Wallet className="h-4 w-4 text-green-600" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              {formatCurrency(stats.todayRevenue)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Tổng giá trị đơn hôm nay
            </p>
          </div>
          <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-destructive">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Công nợ cần thu
              </p>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <p className="text-xl sm:text-2xl font-black text-destructive tracking-tight">
              {formatCurrency(stats.openReceivables)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Khoản chưa tất toán
            </p>
          </div>
        </div>
      </section>

      {/* Top products */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Mặt hàng bán chạy tháng này
          </h3>
          <Link
            href="/products"
            className="text-xs font-semibold text-primary"
          >
            Tất cả
          </Link>
        </div>
        <div className="bg-card rounded-2xl shadow-ambient divide-y divide-border overflow-hidden">
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Chưa có dữ liệu bán hàng trong tháng
            </div>
          ) : (
            topProducts.map((p, idx) => (
              <div
                key={p.product_id}
                className="flex items-center gap-3 p-4"
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
                    idx === 0
                      ? "bg-primary text-white"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground truncate">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    SKU: {p.sku} • SL: {p.quantity}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-foreground">
                    {formatCurrency(p.revenue)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
