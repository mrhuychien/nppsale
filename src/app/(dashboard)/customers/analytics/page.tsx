"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Users, UserPlus, UserX, Wallet, Phone,
} from "lucide-react"

interface TopCustomerRow {
  customer_id: string
  store_name: string
  revenue: number
  order_count: number
  avg_order: number
}

interface ChurnRow {
  customer_id: string
  store_name: string
  last_order_code: string
  last_order_date: string
  sales_user_name: string
  phone: string
}

interface NewCustomerRow {
  id: string
  store_name: string
  created_at: string
  sales_user_name: string
  first_order_code: string | null
}

export default function CustomerAnalyticsPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const [loading, setLoading] = useState(true)

  const [activeCount, setActiveCount] = useState(0)
  const [newThisMonth, setNewThisMonth] = useState(0)
  const [churnCount, setChurnCount] = useState(0)
  const [totalRevenue, setTotalRevenue] = useState(0)

  const [topCustomers, setTopCustomers] = useState<TopCustomerRow[]>([])
  const [churnCustomers, setChurnCustomers] = useState<ChurnRow[]>([])
  const [newCustomers, setNewCustomers] = useState<NewCustomerRow[]>([])

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

      const [
        activeRes,
        newCustRes,
        monthOrdersRes,
        allCustomersRes,
      ] = await Promise.all([
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        supabase
          .from("customers")
          .select("id, store_name, created_at")
          .gte("created_at", monthStart)
          .order("created_at", { ascending: false }),
        supabase
          .from("sales_orders")
          .select("customer_id, total, customer:customers(store_name)")
          .gte("order_date", monthStart),
        supabase
          .from("customers")
          .select("id, store_name, phone, status")
          .eq("status", "active"),
      ])

      setActiveCount(activeRes.count || 0)

      // New this month
      const newCusts = (newCustRes.data || []) as Array<{ id: string; store_name: string; created_at: string }>
      setNewThisMonth(newCusts.length)

      // Total revenue
      const rev = (monthOrdersRes.data || []).reduce(
        (sum: number, o: { total: number }) => sum + (o.total || 0), 0
      )
      setTotalRevenue(rev)

      // Top customers by revenue
      const custMap = new Map<string, TopCustomerRow>()
      const orderRows = (monthOrdersRes.data || []) as unknown as Array<{
        customer_id: string
        total: number
        customer: { store_name: string } | { store_name: string }[] | null
      }>
      for (const row of orderRows) {
        const cid = row.customer_id
        if (!cid) continue
        const cust = Array.isArray(row.customer) ? row.customer[0] : row.customer
        const existing = custMap.get(cid)
        if (existing) {
          existing.revenue += row.total || 0
          existing.order_count += 1
          existing.avg_order = existing.revenue / existing.order_count
        } else {
          custMap.set(cid, {
            customer_id: cid,
            store_name: cust?.store_name || "N/A",
            revenue: row.total || 0,
            order_count: 1,
            avg_order: row.total || 0,
          })
        }
      }
      const topList = Array.from(custMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20)
      setTopCustomers(topList)

      // Churn: customers whose last order > 30 days ago
      // Get customers with their latest order
      const allCusts = (allCustomersRes.data || []) as Array<{ id: string; store_name: string; phone: string }>
      const customerIds = allCusts.map((c) => c.id)

      // Get last order for each customer
      const churnList: ChurnRow[] = []
      if (customerIds.length > 0) {
        // Batch query: latest order per customer
        const { data: lastOrders } = await supabase
          .from("sales_orders")
          .select("customer_id, order_code, order_date, sales_user:users!sales_orders_sales_user_id_fkey(full_name)")
          .in("customer_id", customerIds)
          .order("order_date", { ascending: false })

        // Group by customer, pick latest
        const latestMap = new Map<string, { order_code: string; order_date: string; sales_user_name: string }>()
        for (const o of (lastOrders || []) as unknown as Array<{
          customer_id: string
          order_code: string
          order_date: string
          sales_user: { full_name: string } | { full_name: string }[] | null
        }>) {
          if (!latestMap.has(o.customer_id)) {
            const su = Array.isArray(o.sales_user) ? o.sales_user[0] : o.sales_user
            latestMap.set(o.customer_id, {
              order_code: o.order_code,
              order_date: o.order_date,
              sales_user_name: su?.full_name || "—",
            })
          }
        }

        for (const c of allCusts) {
          const latest = latestMap.get(c.id)
          if (!latest) {
            // Never ordered - also churn
            churnList.push({
              customer_id: c.id,
              store_name: c.store_name,
              last_order_code: "—",
              last_order_date: "—",
              sales_user_name: "—",
              phone: c.phone || "",
            })
          } else if (new Date(latest.order_date) < new Date(days30Ago)) {
            churnList.push({
              customer_id: c.id,
              store_name: c.store_name,
              last_order_code: latest.order_code,
              last_order_date: latest.order_date,
              sales_user_name: latest.sales_user_name,
              phone: c.phone || "",
            })
          }
        }
      }
      setChurnCount(churnList.length)
      setChurnCustomers(churnList.sort((a, b) => {
        if (a.last_order_date === "—") return -1
        if (b.last_order_date === "—") return -1
        return new Date(a.last_order_date).getTime() - new Date(b.last_order_date).getTime()
      }))

      // New customers with first order info
      const newCustIds = newCusts.map((c) => c.id)
      let firstOrderMap = new Map<string, string>()
      if (newCustIds.length > 0) {
        const { data: firstOrders } = await supabase
          .from("sales_orders")
          .select("customer_id, order_code")
          .in("customer_id", newCustIds)
          .order("order_date", { ascending: true })
        const firstMap = new Map<string, string>()
        for (const o of (firstOrders || []) as Array<{ customer_id: string; order_code: string }>) {
          if (!firstMap.has(o.customer_id)) {
            firstMap.set(o.customer_id, o.order_code)
          }
        }
        firstOrderMap = firstMap
      }

      // Get assignments for new customers
      const assignMap = new Map<string, string>()
      if (newCustIds.length > 0) {
        const { data: assigns } = await supabase
          .from("customer_assignments")
          .select("customer_id, user:users(full_name)")
          .in("customer_id", newCustIds)
          .eq("role", "primary")
        for (const a of (assigns || []) as unknown as Array<{
          customer_id: string
          user: { full_name: string } | { full_name: string }[] | null
        }>) {
          const u = Array.isArray(a.user) ? a.user[0] : a.user
          if (u) assignMap.set(a.customer_id, u.full_name)
        }
      }

      setNewCustomers(
        newCusts.map((c) => ({
          id: c.id,
          store_name: c.store_name,
          created_at: c.created_at,
          sales_user_name: assignMap.get(c.id) || "—",
          first_order_code: firstOrderMap.get(c.id) || null,
        }))
      )

      setLoading(false)
    }
    fetch()
  }, [supabase])

  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Phân tích khách hàng" backHref="/customers" />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-primary">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Tổng KH active</p>
            <span className="text-primary bg-primary/10 p-2 rounded-lg inline-flex">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-2xl font-black text-foreground tracking-tight">{activeCount}</h3>
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-green-500">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">KH mới tháng này</p>
            <span className="text-green-600 bg-green-100 p-2 rounded-lg inline-flex">
              <UserPlus className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-2xl font-black text-foreground tracking-tight">{newThisMonth}</h3>
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-destructive">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">{"KH ngừng mua (>30 ngày)"}</p>
            <span className="text-destructive bg-destructive/10 p-2 rounded-lg inline-flex">
              <UserX className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-2xl font-black text-destructive tracking-tight">{churnCount}</h3>
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-amber-500">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Tổng doanh thu KH</p>
            <span className="text-amber-600 bg-amber-100 p-2 rounded-lg inline-flex">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-2xl font-black text-foreground tracking-tight">{formatCurrency(totalRevenue)}</h3>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="top">
        <TabsList>
          <TabsTrigger value="top">Top khách hàng</TabsTrigger>
          <TabsTrigger value="churn">KH ngừng mua ({churnCount})</TabsTrigger>
          <TabsTrigger value="new">KH mới ({newThisMonth})</TabsTrigger>
        </TabsList>

        {/* Top customers */}
        <TabsContent value="top" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 20 khách hàng theo doanh thu tháng này</CardTitle>
            </CardHeader>
            <CardContent>
              {topCustomers.length === 0 ? (
                <EmptyState title="Chưa có dữ liệu" description="Chưa có đơn hàng nào trong tháng này" />
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Khách hàng</TableHead>
                          <TableHead className="text-right">Doanh thu</TableHead>
                          <TableHead className="text-right">Số đơn</TableHead>
                          <TableHead className="text-right">TB/đơn</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topCustomers.map((c, idx) => (
                          <TableRow key={c.customer_id}>
                            <TableCell>
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${
                                idx === 0 ? "bg-amber-100 text-amber-700" :
                                idx === 1 ? "bg-slate-200 text-slate-600" :
                                idx === 2 ? "bg-orange-100 text-orange-700" :
                                "bg-surface-container text-muted-foreground"
                              }`}>
                                {idx + 1}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Link href={`/customers/${c.customer_id}`} className="text-primary font-semibold hover:underline">
                                {c.store_name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(c.revenue)}</TableCell>
                            <TableCell className="text-right">{c.order_count}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{formatCurrency(c.avg_order)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile card list */}
                  <div className="md:hidden space-y-2">
                    {topCustomers.map((c, idx) => (
                      <Link
                        key={c.customer_id}
                        href={`/customers/${c.customer_id}`}
                        className="block rounded-xl border bg-muted/20 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-black shrink-0 ${
                            idx === 0 ? "bg-amber-100 text-amber-700" :
                            idx === 1 ? "bg-slate-200 text-slate-600" :
                            idx === 2 ? "bg-orange-100 text-orange-700" :
                            "bg-surface-container text-muted-foreground"
                          }`}>
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{c.store_name}</p>
                            <div className="grid grid-cols-3 gap-2 mt-1 text-xs">
                              <div>
                                <p className="text-muted-foreground">Doanh thu</p>
                                <p className="font-bold">{formatCurrency(c.revenue)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Số đơn</p>
                                <p className="font-medium">{c.order_count}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">TB/đơn</p>
                                <p className="font-medium">{formatCurrency(c.avg_order)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Churn customers */}
        <TabsContent value="churn" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{"Khách hàng ngừng mua (>30 ngày không đặt hàng)"}</CardTitle>
            </CardHeader>
            <CardContent>
              {churnCustomers.length === 0 ? (
                <EmptyState title="Không có KH ngừng mua" description="Tất cả khách hàng đều đặt hàng trong 30 ngày qua" />
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Khách hàng</TableHead>
                          <TableHead>Đơn cuối</TableHead>
                          <TableHead>Ngày</TableHead>
                          <TableHead>NVBH</TableHead>
                          <TableHead>Liên hệ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {churnCustomers.map((c) => (
                          <TableRow key={c.customer_id}>
                            <TableCell>
                              <Link href={`/customers/${c.customer_id}`} className="text-primary font-semibold hover:underline">
                                {c.store_name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{c.last_order_code}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {c.last_order_date !== "—" ? formatDate(c.last_order_date) : "—"}
                            </TableCell>
                            <TableCell>{c.sales_user_name}</TableCell>
                            <TableCell>
                              {c.phone ? (
                                <a href={`tel:${c.phone}`} className="text-primary hover:underline inline-flex items-center gap-1">
                                  <Phone className="h-3 w-3" /> {c.phone}
                                </a>
                              ) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile card list */}
                  <div className="md:hidden space-y-2">
                    {churnCustomers.map((c) => (
                      <div key={c.customer_id} className="rounded-xl border bg-muted/20 p-3">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <Link href={`/customers/${c.customer_id}`} className="text-primary font-semibold text-sm hover:underline truncate">
                            {c.store_name}
                          </Link>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} className="text-primary text-xs hover:underline inline-flex items-center gap-1 shrink-0">
                              <Phone className="h-3 w-3" /> {c.phone}
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          NVBH: {c.sales_user_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Đơn cuối: {c.last_order_code} • {c.last_order_date !== "—" ? formatDate(c.last_order_date) : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* New customers */}
        <TabsContent value="new" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Khách hàng mới tháng này</CardTitle>
            </CardHeader>
            <CardContent>
              {newCustomers.length === 0 ? (
                <EmptyState title="Chưa có KH mới" description="Chưa có khách hàng mới nào trong tháng này" />
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Khách hàng</TableHead>
                          <TableHead>Ngày tạo</TableHead>
                          <TableHead>NVBH phụ trách</TableHead>
                          <TableHead>Đơn đầu tiên</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newCustomers.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <Link href={`/customers/${c.id}`} className="text-primary font-semibold hover:underline">
                                {c.store_name}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                            <TableCell>{c.sales_user_name}</TableCell>
                            <TableCell>
                              {c.first_order_code ? (
                                <span className="text-green-600 font-semibold">{c.first_order_code}</span>
                              ) : (
                                <span className="text-muted-foreground">Chưa có đơn</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile card list */}
                  <div className="md:hidden space-y-2">
                    {newCustomers.map((c) => (
                      <Link
                        key={c.id}
                        href={`/customers/${c.id}`}
                        className="block rounded-xl border bg-muted/20 p-3"
                      >
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <p className="text-primary font-semibold text-sm truncate">{c.store_name}</p>
                          {c.first_order_code ? (
                            <span className="text-green-600 font-semibold text-xs shrink-0">{c.first_order_code}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs shrink-0">Chưa có đơn</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          NVBH: {c.sales_user_name} • Tạo: {formatDate(c.created_at)}
                        </p>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
