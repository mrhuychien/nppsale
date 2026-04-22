"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { CustomerTable } from "@/components/customers/customer-table"
import { VisitCheckinDialog } from "@/components/customers/visit-checkin-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Users, MapPin, HandCoins, ClipboardList, Navigation, Calendar, ShoppingBag } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { Customer, Receivable, SalesOrder } from "@/types"

interface LastOrderInfo {
  order_code: string
  order_date: string
  total: number
}

interface LastVisitInfo {
  visit_date: string
  check_in_at: string | null
  result: string | null
  sales_user_name: string | null
}

export default function CustomersPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [customers, setCustomers] = useState<Customer[]>([])
  const [debts, setDebts] = useState<Record<string, number>>({})
  const [visitedToday, setVisitedToday] = useState<Set<string>>(new Set())
  const [lastOrders, setLastOrders] = useState<Record<string, LastOrderInfo>>({})
  const [lastVisits, setLastVisits] = useState<Record<string, LastVisitInfo>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [visitTarget, setVisitTarget] = useState<Customer | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const { data: cData } = await supabase
        .from("customers")
        .select("*, group:customer_groups(*)")
        .order("store_name")
      const list = (cData as Customer[]) || []
      setCustomers(list)

      // Unpaid receivables per customer
      const { data: recData } = await supabase
        .from("receivables")
        .select("customer_id, amount, paid, status")
        .neq("status", "paid")
      const debtMap: Record<string, number> = {}
      for (const r of (recData as Pick<Receivable, "customer_id" | "amount" | "paid">[]) || []) {
        const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
        if (outstanding > 0) {
          debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + outstanding
        }
      }
      setDebts(debtMap)

      // Today's orders (visits) per customer
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: orders } = await supabase
        .from("sales_orders")
        .select("customer_id, order_date, created_at")
        .gte("created_at", todayStart.toISOString())
      const visits = new Set<string>()
      for (const o of (orders as Pick<SalesOrder, "customer_id">[]) || []) {
        if (o.customer_id) visits.add(o.customer_id)
      }
      setVisitedToday(visits)

      // Latest order per customer (any time)
      const { data: latestOrders } = await supabase
        .from("sales_orders")
        .select("customer_id, order_code, order_date, total")
        .order("order_date", { ascending: false })
        .limit(500)
      const orderMap: Record<string, LastOrderInfo> = {}
      for (const o of (latestOrders as Array<Pick<SalesOrder, "customer_id" | "order_code" | "order_date" | "total">>) || []) {
        if (o.customer_id && !orderMap[o.customer_id]) {
          orderMap[o.customer_id] = {
            order_code: o.order_code,
            order_date: o.order_date,
            total: o.total,
          }
        }
      }
      setLastOrders(orderMap)

      // Latest visit per customer
      const { data: latestVisits } = await supabase
        .from("visit_logs")
        .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
        .order("visit_date", { ascending: false })
        .order("check_in_at", { ascending: false })
        .limit(500)
      const visitMap: Record<string, LastVisitInfo> = {}
      for (const v of (latestVisits as Array<{ customer_id: string; visit_date: string; check_in_at: string | null; result: string | null; sales_user?: { full_name?: string } | null }>) || []) {
        if (v.customer_id && !visitMap[v.customer_id]) {
          visitMap[v.customer_id] = {
            visit_date: v.visit_date,
            check_in_at: v.check_in_at,
            result: v.result,
            sales_user_name: v.sales_user?.full_name || null,
          }
        }
      }
      setLastVisits(visitMap)

      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = customers.filter((c) => {
    const matchSearch = c.store_name.toLowerCase().includes(search.toLowerCase()) ||
      c.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    const matchChannel = channelFilter === "all" || c.channel === channelFilter
    return matchSearch && matchChannel
  })

  const totalRoute = customers.length
  const visitedCount = customers.filter((c) => visitedToday.has(c.id)).length
  const progressPct = totalRoute > 0 ? Math.round((visitedCount / totalRoute) * 100) : 0

  const handleCheckIn = (c: Customer) => {
    setVisitTarget(c)
  }

  const handleVisitSuccess = async () => {
    // Refresh last visits after check-in
    const { data: latestVisits } = await supabase
      .from("visit_logs")
      .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
      .order("visit_date", { ascending: false })
      .order("check_in_at", { ascending: false })
      .limit(500)
    const visitMap: Record<string, LastVisitInfo> = {}
    for (const v of (latestVisits as Array<{ customer_id: string; visit_date: string; check_in_at: string | null; result: string | null; sales_user?: { full_name?: string } | null }>) || []) {
      if (v.customer_id && !visitMap[v.customer_id]) {
        visitMap[v.customer_id] = {
          visit_date: v.visit_date,
          check_in_at: v.check_in_at,
          result: v.result,
          sales_user_name: v.sales_user?.full_name || null,
        }
      }
    }
    setLastVisits(visitMap)
  }

  const handleInventoryCheck = () => {
    alert("Tính năng đang phát triển")
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Khách hàng của tôi" : "Khách hàng"} description={`${customers.length} khách hàng`}>
        {user && hasPermission(user.role, "customers", "create") && (
          <Button onClick={() => router.push("/customers/new")}><Plus className="mr-2 h-4 w-4" /> Thêm KH</Button>
        )}
      </PageHeader>

      {isSales && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-bold">i</span>
          Bạn chỉ thấy KH được phân công cho bạn. Liên hệ Quản lý nếu cần phân công thêm.
        </div>
      )}

      {/* Route progress (visible on all sizes; prominent on mobile) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lộ trình hôm nay</p>
            <p className="text-xl font-bold tracking-tight">
              {visitedCount}
              <span className="text-sm font-medium text-muted-foreground"> / {totalRoute} điểm đã ghé</span>
            </p>
          </div>
          <span className="text-sm font-bold text-primary">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm tên, SĐT..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Kênh" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="GT">GT</SelectItem>
            <SelectItem value="MT">MT</SelectItem>
            <SelectItem value="HORECA">HORECA</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chưa có khách hàng" description="Bắt đầu bằng cách thêm khách hàng đầu tiên" />
      ) : (
        <>
          {/* Desktop: existing table */}
          <div className="hidden lg:block">
            <CustomerTable
              customers={filtered}
              debts={debts}
              lastOrders={lastOrders}
              lastVisits={lastVisits}
              canCollect={!!user && hasPermission(user.role, "receivables", "create")}
            />
          </div>

          {/* Mobile: card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((c) => {
              const debt = debts[c.id] || 0
              const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
              const hasVisited = visitedToday.has(c.id)
              const lastOrder = lastOrders[c.id]
              const lastVisit = lastVisits[c.id]
              return (
                <div
                  key={c.id}
                  className="relative rounded-xl border bg-card shadow-sm overflow-hidden"
                >
                  <div
                    className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${
                      isBadDebt ? "bg-danger" : hasVisited ? "bg-success" : "bg-primary"
                    }`}
                  />
                  <div
                    className="p-4 pl-5 cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => router.push(`/customers/${c.id}`)}
                  >
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {c.store_name}
                        </h3>
                        {c.owner_name && (
                          <p className="text-xs font-medium text-primary/80 mt-0.5 truncate">
                            {c.owner_name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{c.phone}</p>
                        <div className="flex items-center gap-1 text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <p className="text-xs truncate">{c.address || "-"}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {hasVisited && (
                          <Badge variant="success" className="whitespace-nowrap mb-1">Đã ghé hôm nay</Badge>
                        )}
                        {c.channel && <Badge variant="outline">{c.channel}</Badge>}
                      </div>
                    </div>

                    {/* Summary row: last visit, last order, debt */}
                    <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <Navigation className="h-3 w-3 shrink-0" />
                          <span>Ghé thăm</span>
                        </div>
                        {lastVisit ? (
                          <p className="font-medium">{formatDate(lastVisit.visit_date)}</p>
                        ) : (
                          <p className="text-muted-foreground italic">Chưa có</p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <ShoppingBag className="h-3 w-3 shrink-0" />
                          <span>Đơn gần nhất</span>
                        </div>
                        {lastOrder ? (
                          <>
                            <p className="font-medium truncate">{formatDate(lastOrder.order_date)}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {formatCurrency(lastOrder.total)}
                            </p>
                          </>
                        ) : (
                          <p className="text-muted-foreground italic">Chưa có</p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span>Công nợ</span>
                        </div>
                        {debt > 0 ? (
                          <p className={`font-bold ${isBadDebt ? "text-danger" : "text-warning-foreground"}`}>
                            {formatCurrency(debt)}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">0đ</p>
                        )}
                        {isBadDebt && (
                          <p className="text-[10px] font-bold text-danger">Nợ xấu</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 border-t divide-x">
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCheckIn(c)
                      }}
                    >
                      <Navigation className="h-3.5 w-3.5" /> Ghé thăm
                    </button>
                    <button
                      type="button"
                      disabled={debt <= 0}
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-primary hover:bg-muted/50 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/receivables/collect?customerId=${c.id}`)
                      }}
                    >
                      <HandCoins className="h-3.5 w-3.5" /> Thu tiền
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleInventoryCheck()
                      }}
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Kiểm tồn
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {visitTarget && (
        <VisitCheckinDialog
          open={!!visitTarget}
          onOpenChange={(open) => !open && setVisitTarget(null)}
          customerId={visitTarget.id}
          customerName={visitTarget.store_name}
          onSuccess={handleVisitSuccess}
        />
      )}
    </div>
  )
}
