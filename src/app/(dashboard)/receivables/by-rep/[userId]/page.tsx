"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CreditCard, FileText, Users } from "lucide-react"
import type { User, Receivable, Payment, Customer } from "@/types"

type PaymentWithJoin = Payment & {
  receivable?: Receivable & {
    order?: { id: string; order_code: string }
    customer?: { store_name: string }
  }
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  ewallet: "Ví điện tử",
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Chủ NPP",
  manager: "Quản lý bán hàng",
  accountant: "Kế toán",
  sales: "NV bán hàng",
  warehouse: "NV kho",
  driver: "Tài xế",
}

interface CustomerDebtSummary {
  customerId: string
  storeName: string
  totalDebt: number
  overdueAmount: number
  creditLimit: number
  creditUsagePercent: number
}

export default function RepDebtDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = createClient()
  const router = useRouter()

  const [repUser, setRepUser] = useState<User | null>(null)
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [payments, setPayments] = useState<PaymentWithJoin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const [userRes, recRes] = await Promise.all([
        supabase.from("users").select("id, full_name, role, phone").eq("id", userId).single(),
        // Nhân viên làm lâu năm có thể vượt 1.000 dòng công nợ → lấy đủ.
        fetchAllForAggregate((from, to) =>
          supabase
            .from("receivables")
            .select(
              "id, customer_id, amount, paid, due_date, status, customer:customers(id, store_name, credit_limit), order:sales_orders(id, order_code, order_date)",
              { count: "exact" }
            )
            .eq("sales_user_id", userId)
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
      ])
      if (recRes.error) console.error("[by-rep/userId] truy vấn lỗi:", recRes.error)
      const qErr = ([userRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[by-rep/userId] truy vấn lỗi:", qErr.message)

      setRepUser(userRes.data as User | null)
      const recs = recRes.rows as unknown as Receivable[]
      setReceivables(recs)

      // Fetch payments for all receivables of this rep
      const recIds = recs.map((r) => r.id)
      if (recIds.length > 0) {
        const payRes = await fetchAllForAggregate((from, to) =>
          supabase
            .from("payments")
            .select(
              "id, amount, method, collected_at, collector:users!payments_collected_by_fkey(full_name), receivable:receivables(id, order_id, customer_id, order:sales_orders(id, order_code), customer:customers(store_name))",
              { count: "exact" }
            )
            .in("receivable_id", recIds)
            .order("collected_at", { ascending: false })
            .range(from, to)
        )
        if (payRes.error) console.error("[by-rep/userId] truy vấn lỗi:", payRes.error)
        setPayments(payRes.rows as unknown as PaymentWithJoin[])
      }

      setLoading(false)
    }
    fetchData()
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute KPIs
  const totalAmount = receivables.reduce((s, r) => s + r.amount, 0)
  const totalPaid = receivables.reduce((s, r) => s + r.paid, 0)
  const totalDebt = receivables.filter((r) => r.status !== "paid").reduce((s, r) => s + (r.amount - r.paid), 0)
  const overdueAmount = receivables.filter((r) => r.status === "overdue").reduce((s, r) => s + (r.amount - r.paid), 0)
  const collectionRate = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0

  const uniqueCustomersWithDebt = new Set(
    receivables.filter((r) => r.status !== "paid").map((r) => r.customer_id)
  ).size

  // Tab 1: customers with debt
  const customerDebtRows: CustomerDebtSummary[] = useMemo(() => {
    const map = new Map<string, CustomerDebtSummary>()

    receivables.forEach((r) => {
      if (r.status === "paid") return
      const remaining = r.amount - r.paid
      const isOverdue = r.status === "overdue"
      const creditLimit = (r.customer as Customer & { credit_limit: number })?.credit_limit || 0
      const existing = map.get(r.customer_id)

      if (existing) {
        existing.totalDebt += remaining
        if (isOverdue) existing.overdueAmount += remaining
        existing.creditUsagePercent = existing.creditLimit > 0
          ? Math.round((existing.totalDebt / existing.creditLimit) * 100)
          : 0
      } else {
        const debt = remaining
        map.set(r.customer_id, {
          customerId: r.customer_id,
          storeName: r.customer?.store_name || "-",
          totalDebt: debt,
          overdueAmount: isOverdue ? remaining : 0,
          creditLimit,
          creditUsagePercent: creditLimit > 0 ? Math.round((debt / creditLimit) * 100) : 0,
        })
      }
    })

    return Array.from(map.values()).sort((a, b) => b.totalDebt - a.totalDebt)
  }, [receivables])

  // Tab 2: all open receivables
  const openReceivables = receivables.filter((r) => r.status !== "paid")

  const agingDays = (dueDate: string | null): number => {
    if (!dueDate) return 0
    const now = new Date()
    const due = new Date(dueDate)
    const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    return Math.max(0, diff)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!repUser) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy nhân viên</div>

  return (
    <div className="space-y-4">
      <PageHeader title={repUser.full_name} backHref="/receivables/by-rep" />

      {/* Rep info */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Họ tên</p>
              <p className="font-semibold">{repUser.full_name}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vai trò</p>
              <p className="font-semibold">{ROLE_LABELS[repUser.role] || repUser.role}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số điện thoại</p>
              <p className="font-semibold">{repUser.phone || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng nợ gánh</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalDebt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">KH đang nợ</p>
            <p className="text-xl font-black mt-1">{uniqueCustomersWithDebt}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quá hạn</p>
            <p className="text-xl font-black mt-1 text-destructive">{formatCurrency(overdueAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tỷ lệ thu hồi</p>
            <p className={`text-xl font-black mt-1 ${
              collectionRate >= 80 ? "text-tertiary" : collectionRate >= 60 ? "text-[#b54708]" : "text-destructive"
            }`}>
              {collectionRate}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Khách hàng đang nợ</TabsTrigger>
          <TabsTrigger value="receivables">Chi tiết công nợ</TabsTrigger>
          <TabsTrigger value="collections">Lịch sử thu tiền</TabsTrigger>
        </TabsList>

        {/* Tab 1: Customers with debt */}
        <TabsContent value="customers">
          {customerDebtRows.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8 text-muted-foreground" />}
              title="Không có khách hàng nợ"
              description="Nhân viên này không có khách hàng nào đang nợ"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Khách hàng</TableHead>
                        <TableHead className="text-right">Tổng nợ</TableHead>
                        <TableHead className="text-right">Quá hạn</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Hạn mức</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">% sử dụng HM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerDebtRows.map((row) => (
                        <TableRow
                          key={row.customerId}
                          className="cursor-pointer"
                          onClick={() => router.push(`/receivables/by-customer/${row.customerId}`)}
                        >
                          <TableCell className="font-medium">{row.storeName}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(row.totalDebt)}</TableCell>
                          <TableCell className="text-right">
                            {row.overdueAmount > 0 ? (
                              <span className="text-destructive font-semibold">{formatCurrency(row.overdueAmount)}</span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell">
                            {row.creditLimit > 0 ? formatCurrency(row.creditLimit) : "-"}
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell">
                            {row.creditLimit > 0 ? (
                              <Badge variant={row.creditUsagePercent > 100 ? "danger" : row.creditUsagePercent > 80 ? "warning" : "success"}>
                                {row.creditUsagePercent}%
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab 2: Detail receivables */}
        <TabsContent value="receivables">
          {openReceivables.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
              title="Không có công nợ"
              description="Nhân viên này không có khoản nợ nào chưa thanh toán"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mã đơn</TableHead>
                        <TableHead>Khách hàng</TableHead>
                        <TableHead className="text-right">Số tiền</TableHead>
                        <TableHead className="text-right">Đã trả</TableHead>
                        <TableHead className="text-right">Còn lại</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Tuổi nợ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openReceivables.map((r) => {
                        const remaining = r.amount - r.paid
                        const aging = agingDays(r.due_date)
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
                            <TableCell className="font-medium">{r.customer?.store_name || "-"}</TableCell>
                            <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                            <TableCell className="text-right text-tertiary">{formatCurrency(r.paid)}</TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(remaining)}</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">
                              {aging > 0 ? (
                                <span className="text-destructive font-semibold">{aging} ngày</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
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

        {/* Tab 3: Collection history */}
        <TabsContent value="collections">
          {payments.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có thanh toán"
              description="Chưa có lịch sử thu tiền cho nhân viên này"
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ngày thu</TableHead>
                        <TableHead className="text-right">Số tiền</TableHead>
                        <TableHead>Phương thức</TableHead>
                        <TableHead>Người thu</TableHead>
                        <TableHead className="hidden sm:table-cell">Khách hàng</TableHead>
                        <TableHead className="hidden md:table-cell">Mã đơn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => {
                        const rec = p.receivable
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm">{formatDate(p.collected_at)}</TableCell>
                            <TableCell className="text-right font-semibold text-tertiary">{formatCurrency(p.amount)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{PAYMENT_METHOD_LABEL[p.method] || p.method}</Badge>
                            </TableCell>
                            <TableCell>{p.collector?.full_name || "-"}</TableCell>
                            <TableCell className="hidden sm:table-cell">{rec?.customer?.store_name || "-"}</TableCell>
                            <TableCell className="hidden md:table-cell">
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
      </Tabs>
    </div>
  )
}
