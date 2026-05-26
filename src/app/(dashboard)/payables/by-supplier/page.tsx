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
import { Factory, Search } from "lucide-react"
import type { Payable } from "@/types"

interface SupplierDebtRow {
  supplierId: string
  supplierName: string
  supplierCode: string
  invoiceCount: number
  totalDebt: number
  totalPaid: number
  remaining: number
  overdueCount: number
}

export default function PayablesBySupplierPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [payables, setPayables] = useState<Payable[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetchData() {
      const { data } = await supabase
        .from("payables")
        .select("*, supplier:suppliers(name, code)")
        .neq("status", "paid")
      setPayables((data as Payable[]) || [])
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: SupplierDebtRow[] = useMemo(() => {
    const map = new Map<string, SupplierDebtRow>()

    payables.forEach((p) => {
      const existing = map.get(p.supplier_id)
      const remaining = p.amount - p.paid
      const isOverdue = p.status === "overdue"

      if (existing) {
        existing.invoiceCount += 1
        existing.totalDebt += p.amount
        existing.totalPaid += p.paid
        existing.remaining += remaining
        if (isOverdue) existing.overdueCount += 1
      } else {
        map.set(p.supplier_id, {
          supplierId: p.supplier_id,
          supplierName: p.supplier?.name || "-",
          supplierCode: p.supplier?.code || "-",
          invoiceCount: 1,
          totalDebt: p.amount,
          totalPaid: p.paid,
          remaining,
          overdueCount: isOverdue ? 1 : 0,
        })
      }
    })

    const result = Array.from(map.values())
    result.sort((a, b) => b.remaining - a.remaining)
    return result
  }, [payables])

  const filteredRows = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(
      (r) => r.supplierName.toLowerCase().includes(q) || r.supplierCode.toLowerCase().includes(q)
    )
  }, [rows, search])

  const totalOutstanding = rows.reduce((s, r) => s + r.remaining, 0)
  const supplierCount = rows.length
  const topSupplier = rows.length > 0 ? rows[0] : null

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ theo nhà cung cấp" backHref="/payables" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng phải trả</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số NCC</p>
            <p className="text-xl font-black mt-1">{supplierCount}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Top NCC nợ nhiều nhất</p>
            <p className="text-base font-black mt-1 truncate">
              {topSupplier ? `${topSupplier.supplierName} (${formatCurrency(topSupplier.remaining)})` : "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm theo tên, mã NCC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {filteredRows.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title="Không có dữ liệu"
          description={search ? "Thử thay đổi từ khóa tìm kiếm" : "Chưa có NCC nào đang nợ"}
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
                      <TableHead>Mã NCC</TableHead>
                      <TableHead>Nhà cung cấp</TableHead>
                      <TableHead className="text-right">Số HĐ</TableHead>
                      <TableHead className="text-right">Tổng nợ</TableHead>
                      <TableHead className="text-right">Đã trả</TableHead>
                      <TableHead className="text-right">Còn lại</TableHead>
                      <TableHead className="text-right">QH</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={row.supplierId}
                        className="cursor-pointer"
                        onClick={() => router.push(`/payables?supplier=${row.supplierId}`)}
                      >
                        <TableCell className="font-mono text-xs text-primary font-bold">{row.supplierCode}</TableCell>
                        <TableCell className="font-medium">{row.supplierName}</TableCell>
                        <TableCell className="text-right">{row.invoiceCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalDebt)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.totalPaid)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(row.remaining)}</TableCell>
                        <TableCell className="text-right">
                          {row.overdueCount > 0 ? (
                            <Badge variant="danger">{row.overdueCount}</Badge>
                          ) : (
                            <Badge variant="success">0</Badge>
                          )}
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
            {filteredRows.map((row) => (
              <div
                key={row.supplierId}
                className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/payables?supplier=${row.supplierId}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-primary">{row.supplierCode}</p>
                      <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                        {row.supplierName}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.invoiceCount} hóa đơn
                      </p>
                    </div>
                    <div className="shrink-0">
                      {row.overdueCount > 0 ? (
                        <Badge variant="danger">{row.overdueCount} QH</Badge>
                      ) : (
                        <Badge variant="success">Đúng hạn</Badge>
                      )}
                    </div>
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
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
