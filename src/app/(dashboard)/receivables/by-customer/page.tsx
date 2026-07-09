"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { Users, Search } from "lucide-react"
import type { Receivable, Customer, CustomerAssignment } from "@/types"

type Filter = "all" | "overdue" | "over_limit"

interface CustomerDebtRow {
  customerId: string
  storeName: string
  phone: string
  repName: string
  totalDebt: number
  totalPaid: number
  remaining: number
  overdueAmount: number
  creditLimit: number
  status: "normal" | "warning" | "danger"
}

export default function ReceivablesByCustomerPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])

  const [assignments, setAssignments] = useState<CustomerAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetchData() {
      const [recRes, assignRes] = await Promise.all([
        supabase
          .from("receivables")
          .select("id, customer_id, amount, paid, status, customer:customers(store_name, phone, credit_limit), sales_user:users!receivables_sales_user_id_fkey(full_name)")
          .neq("status", "paid"),
        supabase.from("customer_assignments").select("id, customer_id, user_id, role, assigned_at, status, user:users(full_name)").eq("role", "primary"),
      ])
      setReceivables((recRes.data as unknown as Receivable[]) || [])
      setAssignments((assignRes.data as unknown as CustomerAssignment[]) || [])
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: CustomerDebtRow[] = useMemo(() => {
    const map = new Map<string, CustomerDebtRow>()

    receivables.forEach((r) => {
      const existing = map.get(r.customer_id)
      const remaining = r.amount - r.paid
      const isOverdue = r.status === "overdue"
      const creditLimit = (r.customer as Customer & { credit_limit: number })?.credit_limit || 0

      if (existing) {
        existing.totalDebt += r.amount
        existing.totalPaid += r.paid
        existing.remaining += remaining
        if (isOverdue) existing.overdueAmount += remaining
      } else {
        const assignment = assignments.find((a) => a.customer_id === r.customer_id)
        map.set(r.customer_id, {
          customerId: r.customer_id,
          storeName: r.customer?.store_name || "-",
          phone: r.customer?.phone || "-",
          repName: assignment?.user?.full_name || r.sales_user?.full_name || "-",
          totalDebt: r.amount,
          totalPaid: r.paid,
          remaining,
          overdueAmount: isOverdue ? remaining : 0,
          creditLimit,
          status: "normal",
        })
      }
    })

    // Compute status
    map.forEach((row) => {
      if (row.overdueAmount > 0 && row.overdueAmount > row.creditLimit && row.creditLimit > 0) {
        row.status = "danger"
      } else if (row.overdueAmount > 0) {
        row.status = "warning"
      } else {
        row.status = "normal"
      }
    })

    const result = Array.from(map.values())
    result.sort((a, b) => b.remaining - a.remaining)
    return result
  }, [receivables, assignments])

  const filteredRows = useMemo(() => {
    let result = rows
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r) => r.storeName.toLowerCase().includes(q))
    }
    if (filter === "overdue") {
      result = result.filter((r) => r.overdueAmount > 0)
    } else if (filter === "over_limit") {
      result = result.filter((r) => r.status === "danger")
    }
    return result
  }, [rows, search, filter])

  const totalOutstanding = rows.reduce((s, r) => s + r.remaining, 0)
  const totalInTerm = rows.reduce((s, r) => s + (r.remaining - r.overdueAmount), 0)
  const totalOverdue = rows.reduce((s, r) => s + r.overdueAmount, 0)
  const customersWithDebt = rows.length

  if (authLoading || loading) return <Skeleton className="h-96" />

  const statusBadge = (status: CustomerDebtRow["status"]) => {
    switch (status) {
      case "normal":
        return <Badge variant="success">Bình thường</Badge>
      case "warning":
        return <Badge variant="warning">Cảnh báo</Badge>
      case "danger":
        return <Badge variant="danger">Nguy hiểm</Badge>
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ theo khách hàng" backHref="/receivables" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng công nợ</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trong hạn</p>
            <p className="text-xl font-black mt-1 text-tertiary tabular-data">{formatCurrency(totalInTerm)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quá hạn</p>
            <p className="text-xl font-black mt-1 text-destructive">{formatCurrency(totalOverdue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số KH đang nợ</p>
            <p className="text-xl font-black mt-1">{customersWithDebt}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo tên khách hàng..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              {(["all", "overdue", "over_limit"] as Filter[]).map((f) => {
                const labels: Record<Filter, string> = {
                  all: "Tất cả",
                  overdue: "Có nợ quá hạn",
                  over_limit: "Vượt hạn mức",
                }
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      filter === f
                        ? "bg-primary text-on-primary"
                        : "bg-surface-low text-muted-foreground hover:bg-surface-container"
                    }`}
                  >
                    {labels[f]}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {filteredRows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8 text-muted-foreground" />}
          title="Không có dữ liệu"
          description={search || filter !== "all" ? "Thử thay đổi bộ lọc" : "Chưa có khách hàng nào đang nợ"}
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Khách hàng</TableHead>
                      <TableHead>SĐT</TableHead>
                      <TableHead>NVBH phụ trách</TableHead>
                      <TableHead className="text-right">Tổng nợ</TableHead>
                      <TableHead className="text-right">Đã trả</TableHead>
                      <TableHead className="text-right">Còn lại</TableHead>
                      <TableHead className="text-right">Quá hạn</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={row.customerId}
                        className="cursor-pointer"
                        onClick={() => router.push(`/receivables/by-customer/${row.customerId}`)}
                      >
                        <TableCell className="font-medium">{row.storeName}</TableCell>
                        <TableCell>{row.phone}</TableCell>
                        <TableCell>{row.repName}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalDebt)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalPaid)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(row.remaining)}</TableCell>
                        <TableCell className="text-right">
                          {row.overdueAmount > 0 ? (
                            <span className="text-destructive font-semibold">{formatCurrency(row.overdueAmount)}</span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(row.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filteredRows.map((row) => (
              <div
                key={row.customerId}
                className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/receivables/by-customer/${row.customerId}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight truncate">{row.storeName}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">SĐT: {row.phone}</p>
                      <p className="text-xs text-muted-foreground truncate">NVBH: {row.repName}</p>
                    </div>
                    <div className="shrink-0">{statusBadge(row.status)}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                    <div>
                      <p className="text-muted-foreground">Tổng nợ</p>
                      <p className="font-medium">{formatCurrency(row.totalDebt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Đã trả</p>
                      <p className="font-medium">{formatCurrency(row.totalPaid)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Còn lại</p>
                      <p className="font-bold text-destructive">{formatCurrency(row.remaining)}</p>
                    </div>
                  </div>
                  {row.overdueAmount > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t text-xs">
                      <span className="text-muted-foreground">Quá hạn</span>
                      <span className="font-bold text-destructive">{formatCurrency(row.overdueAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
