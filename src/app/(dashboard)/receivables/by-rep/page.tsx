"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { UserCog } from "lucide-react"

/** Một dòng trả về của hàm SQL `receivables_by_rep()` (migration 093). */
interface RepDebtRowRaw {
  user_id: string
  full_name: string
  customer_count: number
  customers_with_debt: number
  total_debt: number
  total_paid: number
  total_amount: number
  overdue_amount: number
  collection_rate: number
  dso: number
}

interface RepDebtRow {
  userId: string
  fullName: string
  customerCount: number
  customersWithDebt: number
  totalDebt: number
  totalPaid: number
  totalAmount: number
  overdueAmount: number
  collectionRate: number
  dso: number
}

export default function ReceivablesByRepPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  // Database cộng sẵn (hàm SQL `receivables_by_rep`, migration 093): mỗi
  // nhân viên một dòng, thay vì tải toàn bộ công nợ về rồi gộp bằng
  // JavaScript. Chính xác tuyệt đối và không phụ thuộc `db.max_rows`.
  const [rows, setRows] = useState<RepDebtRow[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase.rpc("receivables_by_rep")
      if (error) console.error("[receivables/by-rep] receivables_by_rep lỗi:", error.message)
      const raw = (data as RepDebtRowRaw[] | null) || []
      setRows(
        raw.map((r) => ({
          userId: r.user_id,
          fullName: r.full_name || "-",
          customerCount: Number(r.customer_count || 0),
          customersWithDebt: Number(r.customers_with_debt || 0),
          totalDebt: Number(r.total_debt || 0),
          totalPaid: Number(r.total_paid || 0),
          totalAmount: Number(r.total_amount || 0),
          overdueAmount: Number(r.overdue_amount || 0),
          collectionRate: Number(r.collection_rate || 0),
          dso: Number(r.dso || 0),
        }))
      )
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalOutstanding = rows.reduce((s, r) => s + r.totalDebt, 0)
  const repsWithDebt = rows.filter((r) => r.totalDebt > 0).length
  const worstRep = rows.reduce<RepDebtRow | null>((worst, r) => {
    if (!worst || r.overdueAmount > worst.overdueAmount) return r
    return worst
  }, null)

  if (authLoading || loading) return <Skeleton className="h-96" />

  const rateColor = (rate: number) => {
    if (rate >= 80) return "text-tertiary"
    if (rate >= 60) return "text-[#b54708]"
    return "text-error"
  }

  const rateBadge = (rate: number) => {
    if (rate >= 80) return <Badge variant="success">{rate}%</Badge>
    if (rate >= 60) return <Badge variant="warning">{rate}%</Badge>
    return <Badge variant="danger">{rate}%</Badge>
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ theo nhân viên bán hàng" backHref="/receivables" />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng nợ NPP</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số NVBH có nợ</p>
            <p className="text-xl font-black mt-1">{repsWithDebt}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">NVBH nợ quá hạn nhiều nhất</p>
            <p className="text-xl font-black mt-1">
              {worstRep && worstRep.overdueAmount > 0
                ? `${worstRep.fullName} (${formatCurrency(worstRep.overdueAmount)})`
                : "-"
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-8 w-8 text-muted-foreground" />}
          title="Không có dữ liệu"
          description="Chưa có công nợ nào gắn với nhân viên bán hàng"
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
                      <TableHead>NVBH</TableHead>
                      <TableHead className="text-right">Số KH phụ trách</TableHead>
                      <TableHead className="text-right">Số KH đang nợ</TableHead>
                      <TableHead className="text-right">Tổng nợ</TableHead>
                      <TableHead className="text-right">Quá hạn</TableHead>
                      <TableHead className="text-center">Tỷ lệ thu hồi</TableHead>
                      <TableHead className="text-right">DSO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.userId}
                        className="cursor-pointer"
                        onClick={() => router.push(`/receivables/by-rep/${row.userId}`)}
                      >
                        <TableCell className="font-medium">{row.fullName}</TableCell>
                        <TableCell className="text-right">{row.customerCount}</TableCell>
                        <TableCell className="text-right">{row.customersWithDebt}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(row.totalDebt)}</TableCell>
                        <TableCell className="text-right">
                          {row.overdueAmount > 0 ? (
                            <span className="text-destructive font-semibold">{formatCurrency(row.overdueAmount)}</span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-center">{rateBadge(row.collectionRate)}</TableCell>
                        <TableCell className="text-right">
                          <span className={rateColor(100 - Math.min(row.dso, 100))}>
                            {row.dso > 0 ? `${row.dso} ngày` : "-"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {rows.map((row) => (
              <div
                key={row.userId}
                className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/receivables/by-rep/${row.userId}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight truncate">{row.fullName}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Phụ trách: {row.customerCount} KH • Đang nợ: {row.customersWithDebt} KH
                      </p>
                    </div>
                    <div className="shrink-0">{rateBadge(row.collectionRate)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t text-xs">
                    <div>
                      <p className="text-muted-foreground">Tổng nợ</p>
                      <p className="font-bold">{formatCurrency(row.totalDebt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quá hạn</p>
                      <p className={row.overdueAmount > 0 ? "font-bold text-destructive" : "font-medium"}>
                        {row.overdueAmount > 0 ? formatCurrency(row.overdueAmount) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">DSO</p>
                      <p className={`font-medium ${rateColor(100 - Math.min(row.dso, 100))}`}>
                        {row.dso > 0 ? `${row.dso} ngày` : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
