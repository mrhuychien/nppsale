"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CustomerForm } from "@/components/customers/customer-form"
import { AssignmentManager } from "@/components/customers/assignment-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import { Badge } from "@/components/ui/badge"
import {
  Trash2, Wallet, ShoppingBasket, CreditCard, TrendingUp,
  ArrowRight, Banknote,
} from "lucide-react"
import type { Customer, CustomerGroup, CustomerAssignment } from "@/types"

interface OrderRow {
  id: string
  order_code: string
  order_date: string
  total: number
  status: string
}

interface PriceRow {
  id: string
  product_id: string
  group_id: string | null
  unit_name: string
  price: number
  effective_from: string | null
  effective_to: string | null
  product?: { name: string; sku: string; base_unit: string }
  group?: { name: string } | null
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("customers")
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [assignments, setAssignments] = useState<CustomerAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // KPI state
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [totalOrders, setTotalOrders] = useState(0)
  const [currentDebt, setCurrentDebt] = useState(0)
  const [orderFrequency, setOrderFrequency] = useState(0)

  // Tab data
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([])
  const [recentPayments, setRecentPayments] = useState<Array<{ id: string; amount: number; method: string; collected_at: string }>>([])
  const [allOrders, setAllOrders] = useState<OrderRow[]>([])
  const [priceRows, setPriceRows] = useState<PriceRow[]>([])

  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const days90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const [custRes, groupsRes, assignRes] = await Promise.all([
      supabase.from("customers").select("*, group:customer_groups(*)").eq("id", id).single(),
      supabase.from("customer_groups").select("*"),
      supabase.from("customer_assignments").select("*, user:users(*)").eq("customer_id", id),
    ])
    if (custRes.data) setCustomer(custRes.data as Customer)
    setGroups((groupsRes.data as CustomerGroup[]) || [])
    setAssignments((assignRes.data as CustomerAssignment[]) || [])

    // KPIs + tab data
    const [
      monthOrdersRes,
      allOrdersRes,
      receivablesRes,
      last90Res,
      recentPayRes,
    ] = await Promise.all([
      supabase
        .from("sales_orders")
        .select("total")
        .eq("customer_id", id)
        .eq("status", "delivered")
        .gte("order_date", monthStart),
      supabase
        .from("sales_orders")
        .select("id, order_code, order_date, total, status")
        .eq("customer_id", id)
        .order("order_date", { ascending: false }),
      supabase
        .from("receivables")
        .select("amount, paid, status")
        .eq("customer_id", id)
        .neq("status", "paid"),
      supabase
        .from("sales_orders")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", id)
        .gte("order_date", days90Ago),
      supabase
        .from("payments")
        .select("id, amount, method, collected_at, receivable:receivables!inner(customer_id)")
        .eq("receivable.customer_id", id)
        .order("collected_at", { ascending: false })
        .limit(5),
    ])

    // Revenue this month
    const rev = (monthOrdersRes.data || []).reduce(
      (sum: number, o: { total: number }) => sum + (o.total || 0), 0
    )
    setMonthRevenue(rev)

    // All orders
    const orders = (allOrdersRes.data || []) as OrderRow[]
    setAllOrders(orders)
    setTotalOrders(orders.length)
    setRecentOrders(orders.slice(0, 5))

    // Debt
    const debt = (receivablesRes.data || []).reduce(
      (sum: number, r: { amount: number; paid: number }) => sum + Math.max(0, (r.amount || 0) - (r.paid || 0)), 0
    )
    setCurrentDebt(debt)

    // Frequency
    const count90 = last90Res.count || 0
    setOrderFrequency(Math.round((count90 / 3) * 10) / 10)

    // Recent payments
    setRecentPayments(
      (recentPayRes.data || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        amount: p.amount as number,
        method: p.method as string,
        collected_at: p.collected_at as string,
      }))
    )

    // Price list
    const groupId = custRes.data?.group_id
    let priceQuery = supabase
      .from("price_lists")
      .select("*, product:products(name, sku, base_unit), group:customer_groups(name)")
      .order("product_id")
    if (groupId) {
      priceQuery = priceQuery.or(`group_id.eq.${groupId},group_id.is.null`)
    } else {
      priceQuery = priceQuery.is("group_id", null)
    }
    const priceRes = await priceQuery
    setPriceRows((priceRes.data || []) as PriceRow[])

    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleDelete = async () => {
    if (!customer) return
    setDeleting(true)
    try {
      const { error } = await supabase.from("customers").delete().eq("id", customer.id)
      if (error) throw error
      toast({ title: "Đã xóa khách hàng" })
      router.push("/customers")
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
      setDeleting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!customer) return <div>Không tìm thấy khách hàng</div>

  const canDelete = user && hasPermission(user.role, "customers", "delete")

  const paymentMethodLabel: Record<string, string> = {
    cash: "Tiền mặt",
    transfer: "Chuyển khoản",
    ewallet: "Ví điện tử",
  }

  return (
    <div className="space-y-6">
      <PageHeader title={customer.store_name} description={customer.address} backHref="/customers">
        <div className="flex items-center gap-2">
          <StatusBadge status={customer.status} type="customer" />
          {currentDebt > 0 && user && hasPermission(user.role, "receivables", "create") && (
            <Button
              size="sm"
              className="bg-gradient-primary text-white"
              onClick={() => router.push(`/receivables/collect?customerId=${customer.id}`)}
            >
              <Banknote className="h-4 w-4 mr-1.5" />
              Thu tiền
            </Button>
          )}
        </div>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-primary">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Doanh thu tháng này</p>
            <span className="text-primary bg-primary/10 p-2 rounded-lg inline-flex">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-xl font-black text-foreground tracking-tight">
            {monthRevenue > 0 ? formatCurrency(monthRevenue) : <span className="text-muted-foreground">0đ</span>}
          </h3>
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-secondary">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Tổng đơn hàng</p>
            <span className="text-secondary bg-secondary/10 p-2 rounded-lg inline-flex">
              <ShoppingBasket className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-xl font-black text-foreground tracking-tight">
            {totalOrders > 0 ? totalOrders : <span className="text-muted-foreground">0</span>}
          </h3>
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-destructive">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Công nợ hiện tại</p>
            <span className="text-destructive bg-destructive/10 p-2 rounded-lg inline-flex">
              <CreditCard className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-xl font-black tracking-tight">
            {currentDebt > 0
              ? <span className="text-destructive">{formatCurrency(currentDebt)}</span>
              : <span className="text-muted-foreground">0đ</span>}
          </h3>
          {currentDebt > 0 && user && hasPermission(user.role, "receivables", "create") && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => router.push(`/receivables/collect?customerId=${customer.id}`)}
            >
              <Banknote className="h-4 w-4 mr-1.5" />
              Thu tiền ngay
            </Button>
          )}
        </div>

        <div className="bg-card rounded-2xl shadow-ambient p-5 border-l-4 border-amber-500">
          <div className="flex justify-between items-start mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Tần suất mua</p>
            <span className="text-amber-600 bg-amber-100 p-2 rounded-lg inline-flex">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <h3 className="text-xl font-black text-foreground tracking-tight">
            {orderFrequency > 0
              ? <>{orderFrequency} <span className="text-sm font-semibold text-muted-foreground">đơn/tháng</span></>
              : <span className="text-muted-foreground">0 đơn/tháng</span>}
          </h3>
        </div>
      </div>

      {/* Main content */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="orders">Lịch sử đơn hàng</TabsTrigger>
              <TabsTrigger value="prices">Bảng giá áp dụng</TabsTrigger>
              <TabsTrigger value="info">Thông tin</TabsTrigger>
              <TabsTrigger value="assignments">Phân công ({assignments.length})</TabsTrigger>
            </TabsList>

            {/* Tab: Tổng quan */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              {/* Recent orders */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Đơn hàng gần đây</CardTitle>
                  {allOrders.length > 5 && (
                    <button
                      onClick={() => {
                        const tabEl = document.querySelector('[data-state="active"][value="overview"]')
                        if (tabEl) {
                          const ordersTrigger = document.querySelector('[value="orders"]') as HTMLButtonElement
                          ordersTrigger?.click()
                        }
                      }}
                      className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"
                    >
                      Xem tất cả <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </CardHeader>
                <CardContent>
                  {recentOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Chưa có đơn hàng nào</p>
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Mã đơn</TableHead>
                              <TableHead>Ngày</TableHead>
                              <TableHead className="text-right">Tổng tiền</TableHead>
                              <TableHead>Trạng thái</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recentOrders.map((o) => {
                              const st = ORDER_STATUS_MAP[o.status]
                              return (
                                <TableRow key={o.id}>
                                  <TableCell>
                                    <Link href={`/orders/${o.id}`} className="text-primary font-semibold hover:underline">
                                      {o.order_code}
                                    </Link>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">{formatDate(o.order_date)}</TableCell>
                                  <TableCell className="text-right font-semibold">{formatCurrency(o.total)}</TableCell>
                                  <TableCell>
                                    {st ? <Badge variant={st.variant}>{st.label}</Badge> : o.status}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden space-y-2">
                        {recentOrders.map((o) => {
                          const st = ORDER_STATUS_MAP[o.status]
                          return (
                            <Link
                              key={o.id}
                              href={`/orders/${o.id}`}
                              className="block rounded-xl border bg-muted/20 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-mono text-xs font-bold text-primary">{o.order_code}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{formatDate(o.order_date)}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="font-bold text-sm">{formatCurrency(o.total)}</p>
                                  {st && <Badge variant={st.variant} className="mt-1">{st.label}</Badge>}
                                </div>
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Recent payments */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Thanh toán gần đây</CardTitle>
                </CardHeader>
                <CardContent>
                  {recentPayments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Chưa có thanh toán nào</p>
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Ngày</TableHead>
                              <TableHead className="text-right">Số tiền</TableHead>
                              <TableHead>Phương thức</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recentPayments.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="text-muted-foreground">{formatDate(p.collected_at)}</TableCell>
                                <TableCell className="text-right font-semibold">{formatCurrency(p.amount)}</TableCell>
                                <TableCell>{paymentMethodLabel[p.method] || p.method}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden space-y-2">
                        {recentPayments.map((p) => (
                          <div key={p.id} className="rounded-xl border bg-muted/20 p-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">{formatDate(p.collected_at)}</p>
                              <p className="text-xs mt-0.5">{paymentMethodLabel[p.method] || p.method}</p>
                            </div>
                            <p className="font-bold text-sm">{formatCurrency(p.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Lịch sử đơn hàng */}
            <TabsContent value="orders" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tất cả đơn hàng ({allOrders.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {allOrders.length === 0 ? (
                    <EmptyState title="Chưa có đơn hàng" description="Khách hàng này chưa có đơn hàng nào" />
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Mã đơn</TableHead>
                              <TableHead>Ngày</TableHead>
                              <TableHead className="text-right">Tổng tiền</TableHead>
                              <TableHead>Trạng thái</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allOrders.map((o) => {
                              const st = ORDER_STATUS_MAP[o.status]
                              return (
                                <TableRow key={o.id}>
                                  <TableCell>
                                    <Link href={`/orders/${o.id}`} className="text-primary font-semibold hover:underline">
                                      {o.order_code}
                                    </Link>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">{formatDate(o.order_date)}</TableCell>
                                  <TableCell className="text-right font-semibold">{formatCurrency(o.total)}</TableCell>
                                  <TableCell>
                                    {st ? <Badge variant={st.variant}>{st.label}</Badge> : o.status}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden space-y-2">
                        {allOrders.map((o) => {
                          const st = ORDER_STATUS_MAP[o.status]
                          return (
                            <Link
                              key={o.id}
                              href={`/orders/${o.id}`}
                              className="block rounded-xl border bg-muted/20 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-mono text-xs font-bold text-primary">{o.order_code}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{formatDate(o.order_date)}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="font-bold text-sm">{formatCurrency(o.total)}</p>
                                  {st && <Badge variant={st.variant} className="mt-1">{st.label}</Badge>}
                                </div>
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Bảng giá áp dụng */}
            <TabsContent value="prices" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bảng giá áp dụng</CardTitle>
                </CardHeader>
                <CardContent>
                  {priceRows.length === 0 ? (
                    <EmptyState title="Chưa có bảng giá" description="Chưa có giá nào được thiết lập cho nhóm khách hàng này" />
                  ) : (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Sản phẩm</TableHead>
                              <TableHead>SKU</TableHead>
                              <TableHead>ĐVT</TableHead>
                              <TableHead className="text-right">Giá (nhóm KH)</TableHead>
                              <TableHead className="text-right">Giá mặc định</TableHead>
                              <TableHead>Hiệu lực</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {priceRows.map((p) => {
                              const isGroupPrice = !!p.group_id
                              const effectiveRange = p.effective_from || p.effective_to
                                ? `${p.effective_from ? formatDate(p.effective_from) : "..."} - ${p.effective_to ? formatDate(p.effective_to) : "..."}`
                                : "Không giới hạn"
                              return (
                                <TableRow key={p.id}>
                                  <TableCell className="font-medium">{p.product?.name || "—"}</TableCell>
                                  <TableCell className="text-muted-foreground">{p.product?.sku || "—"}</TableCell>
                                  <TableCell>{p.unit_name || p.product?.base_unit || "—"}</TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {isGroupPrice ? formatCurrency(p.price) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {!isGroupPrice ? formatCurrency(p.price) : "—"}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-xs">{effectiveRange}</TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden space-y-2">
                        {priceRows.map((p) => {
                          const isGroupPrice = !!p.group_id
                          const effectiveRange = p.effective_from || p.effective_to
                            ? `${p.effective_from ? formatDate(p.effective_from) : "..."} - ${p.effective_to ? formatDate(p.effective_to) : "..."}`
                            : "Không giới hạn"
                          return (
                            <div key={p.id} className="rounded-xl border bg-muted/20 p-3">
                              <div className="flex justify-between items-start gap-2 mb-1">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-sm leading-tight">{p.product?.name || "—"}</p>
                                  <p className="font-mono text-xs text-muted-foreground mt-0.5">
                                    SKU: {p.product?.sku || "—"} • ĐVT: {p.unit_name || p.product?.base_unit || "—"}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-bold text-sm">{formatCurrency(p.price)}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {isGroupPrice ? "Giá nhóm" : "Giá mặc định"}
                                  </p>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">Hiệu lực: {effectiveRange}</p>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Thông tin */}
            <TabsContent value="info">
              <CustomerForm customer={customer} groups={groups} />
            </TabsContent>

            {/* Tab: Phân công */}
            <TabsContent value="assignments">
              <AssignmentManager customerId={customer.id} assignments={assignments} onUpdate={fetchData} />
            </TabsContent>
          </Tabs>
        </div>

        {canDelete && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Vùng nguy hiểm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Xóa khách hàng vĩnh viễn. Thao tác này cũng sẽ xóa các phân công nhân viên và có thể thất bại nếu khách hàng có đơn hàng.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa khách hàng
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn khách hàng?"
        description={`Khách hàng "${customer.store_name}" sẽ bị xóa cùng các phân công nhân viên. Thao tác có thể thất bại nếu khách hàng có đơn hàng. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  )
}
