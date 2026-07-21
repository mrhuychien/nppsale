"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CreditCard, FileText, Clock } from "lucide-react"
import type { Customer, Receivable, Payment, CustomerAssignment, SalesOrder } from "@/types"

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  ewallet: "Ví điện tử",
}

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "warning" | "danger" | "secondary" }> = {
  open: { label: "Chưa thu", variant: "secondary" },
  partial: { label: "Thu một phần", variant: "warning" },
  overdue: { label: "Quá hạn", variant: "danger" },
  paid: { label: "Đã thu đủ", variant: "success" },
}

interface TimelineEntry {
  id: string
  date: string
  type: "order" | "payment"
  amount: number
  balance: number
  label: string
  orderId?: string
  orderCode?: string
}

export default function CustomerDebtDetailPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = createClient()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [payments, setPayments] = useState<(Payment & { receivable?: Receivable & { order?: SalesOrder } })[]>([])
  const [assignment, setAssignment] = useState<CustomerAssignment | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const [custRes, recRes, assignRes] = await Promise.all([
        supabase.from("customers").select("id, store_name, phone, address, credit_limit").eq("id", customerId).single(),
        supabase
          .from("receivables")
          .select("id, amount, paid, due_date, status, created_at, order:sales_orders(id, order_code, order_date, total), sales_user:users!receivables_sales_user_id_fkey(full_name)")
          .eq("customer_id", customerId)
          .order("due_date"),
        supabase
          .from("customer_assignments")
          .select("id, customer_id, user_id, role, assigned_at, status, user:users(full_name, phone)")
          .eq("customer_id", customerId)
          .eq("role", "primary")
          .limit(1),
      ])

      setCustomer(custRes.data as Customer | null)
      const recs = (recRes.data as unknown as Receivable[]) || []
      setReceivables(recs)
      setAssignment(((assignRes.data as unknown as CustomerAssignment[]) || [])[0] || null)

      // Fetch payments for all receivables of this customer
      const recIds = recs.map((r) => r.id)
      if (recIds.length > 0) {
        const { data: payData } = await supabase
          .from("payments")
          .select("id, amount, method, collected_at, verified_at, collector:users!payments_collected_by_fkey(full_name), verifier:users!payments_verified_by_fkey(full_name), receivable:receivables(id, order_id, order:sales_orders(id, order_code))")
          .in("receivable_id", recIds)
          .order("collected_at", { ascending: false })
        setPayments((payData as unknown as typeof payments) || [])
      }

      setLoading(false)
    }
    fetchData()
  }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalDebt = receivables.reduce((s, r) => s + r.amount, 0)
  const totalPaid = receivables.reduce((s, r) => s + r.paid, 0)
  const totalRemaining = totalDebt - totalPaid
  const creditRemaining = (customer?.credit_limit || 0) - totalRemaining

  const openReceivables = receivables.filter((r) => r.status !== "paid")

  const agingDays = (dueDate: string | null): number => {
    if (!dueDate) return 0
    const now = new Date()
    const due = new Date(dueDate)
    const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    return Math.max(0, diff)
  }

  // Timeline combining orders and payments
  const timeline: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = []

    receivables.forEach((r) => {
      if (r.order) {
        entries.push({
          id: `order-${r.id}`,
          date: r.order.order_date || r.created_at,
          type: "order",
          amount: r.amount,
          balance: 0,
          label: r.order.order_code || `Đơn #${r.id.slice(0, 8)}`,
          orderId: r.order.id,
          orderCode: r.order.order_code,
        })
      }
    })

    payments.forEach((p) => {
      const rec = p.receivable as Receivable & { order?: SalesOrder } | undefined
      entries.push({
        id: `pay-${p.id}`,
        date: p.collected_at,
        type: "payment",
        amount: p.amount,
        balance: 0,
        label: `Thanh toán ${PAYMENT_METHOD_LABEL[p.method] || p.method}`,
        orderId: rec?.order?.id,
        orderCode: rec?.order?.order_code,
      })
    })

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    let running = 0
    entries.forEach((e) => {
      if (e.type === "order") {
        running += e.amount
      } else {
        running -= e.amount
      }
      e.balance = running
    })

    return entries.reverse() // Most recent first
  }, [receivables, payments])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!customer) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy khách hàng</div>

  return (
    <div className="space-y-4">
      <PageHeader title={customer.store_name} backHref="/receivables/by-customer" />

      {/* Customer info card */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cửa hàng</p>
              <p className="font-semibold">{customer.store_name}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số điện thoại</p>
              <p className="font-semibold">{customer.phone || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Địa chỉ</p>
              <p className="font-semibold text-sm">{customer.address || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hạn mức nợ</p>
              <p className="font-bold text-lg">{formatCurrency(customer.credit_limit || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">NVBH phụ trách</p>
              <p className="font-semibold">{assignment?.user?.full_name || receivables[0]?.sales_user?.full_name || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng nợ</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalDebt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Đã trả</p>
            <p className="text-xl font-black mt-1 text-tertiary">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Còn lại</p>
            <p className="text-xl font-black mt-1 text-destructive">{formatCurrency(totalRemaining)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hạn mức còn lại</p>
            <p className={`text-xl font-black mt-1 ${creditRemaining < 0 ? "text-destructive" : "text-tertiary"}`}>
              {formatCurrency(creditRemaining)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Công nợ hiện tại</TabsTrigger>
          <TabsTrigger value="payments">Lịch sử thanh toán</TabsTrigger>
          <TabsTrigger value="timeline">Lịch sử giao dịch</TabsTrigger>
        </TabsList>

        {/* Tab 1: Current receivables */}
        <TabsContent value="current">
          {openReceivables.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
              title="Không có công nợ"
              description="Khách hàng không có khoản nợ nào chưa thanh toán"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mã đơn</TableHead>
                        <TableHead>Ngày</TableHead>
                        <TableHead className="text-right">Số tiền</TableHead>
                        <TableHead className="text-right">Đã trả</TableHead>
                        <TableHead className="text-right">Còn lại</TableHead>
                        <TableHead>Hạn trả</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Tuổi nợ</TableHead>
                        <TableHead>Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openReceivables.map((r) => {
                        const remaining = r.amount - r.paid
                        const aging = agingDays(r.due_date)
                        const statusCfg = STATUS_BADGE[r.status] || { label: r.status, variant: "secondary" as const }
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              {r.order ? (
                                <Link href={`/orders/${r.order.id}`} className="font-mono text-primary font-bold hover:underline">
                                  {r.order.order_code}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                            <TableCell className="text-right text-tertiary">{formatCurrency(r.paid)}</TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(remaining)}</TableCell>
                            <TableCell className="text-sm">{r.due_date ? formatDate(r.due_date) : "-"}</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">
                              {aging > 0 ? (
                                <span className="text-destructive font-semibold">{aging} ngày</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 2: Payment history */}
        <TabsContent value="payments">
          {payments.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có thanh toán"
              description="Khách hàng chưa có lịch sử thanh toán"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ngày</TableHead>
                        <TableHead className="text-right">Số tiền</TableHead>
                        <TableHead>Phương thức</TableHead>
                        <TableHead>Người thu</TableHead>
                        <TableHead>Xác minh</TableHead>
                        <TableHead>Mã đơn liên quan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => {
                        const rec = p.receivable as Receivable & { order?: SalesOrder } | undefined
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm">{formatDate(p.collected_at)}</TableCell>
                            <TableCell className="text-right font-semibold text-tertiary">{formatCurrency(p.amount)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{PAYMENT_METHOD_LABEL[p.method] || p.method}</Badge>
                            </TableCell>
                            <TableCell>{p.collector?.full_name || "-"}</TableCell>
                            <TableCell>
                              {p.verified_at ? (
                                <Badge variant="success">Đã xác minh</Badge>
                              ) : (
                                <Badge variant="warning">Chờ xác minh</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {rec?.order ? (
                                <Link href={`/orders/${rec.order.id}`} className="font-mono text-primary font-bold hover:underline">
                                  {rec.order.order_code}
                                </Link>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 3: Transaction timeline */}
        <TabsContent value="timeline">
          {timeline.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có giao dịch"
              description="Khách hàng chưa có giao dịch nào"
            />
          ) : (
            <Card>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {timeline.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                        entry.type === "order"
                          ? "bg-[#eff8ff] text-[#175cd3]"
                          : "bg-[#ecfdf3] text-tertiary"
                      }`}>
                        {entry.type === "order" ? "\u{1F4E6}" : "\u{1F4B0}"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-sm">{entry.label}</p>
                          <p className={`font-bold text-sm ${
                            entry.type === "order" ? "text-destructive" : "text-tertiary"
                          }`}>
                            {entry.type === "order" ? "+" : "-"}{formatCurrency(entry.amount)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground">
                            {formatDate(entry.date)}
                            {entry.orderCode && entry.type === "payment" && (
                              <> &middot; <Link href={`/orders/${entry.orderId}`} className="text-primary hover:underline">{entry.orderCode}</Link></>
                            )}
                          </p>
                          <p className="text-xs font-semibold text-muted-foreground">
                            Dư nợ: {formatCurrency(entry.balance)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
