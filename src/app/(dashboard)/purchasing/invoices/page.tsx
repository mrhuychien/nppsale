"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Search, FileText, Eye } from "lucide-react"
import Link from "next/link"
import type { PurchaseInvoice } from "@/types"

export default function PurchaseInvoicesPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from("purchase_invoices")
        .select(
          "*, supplier:suppliers(name, code), purchase_order:purchase_orders(po_code)"
        )
        .order("created_at", { ascending: false })
      setInvoices((data as PurchaseInvoice[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      const q = search.toLowerCase()
      const matchSearch =
        inv.invoice_number?.toLowerCase().includes(q) ||
        inv.supplier?.name?.toLowerCase().includes(q) ||
        inv.purchase_order?.po_code?.toLowerCase().includes(q) ||
        false
      const matchStatus =
        statusFilter === "all" || inv.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [invoices, search, statusFilter])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hóa đơn mua hàng"
        description={`${invoices.length} hóa đơn`}
        backHref="/purchasing"
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm số HĐ, NCC, mã PO..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="draft">Nháp</SelectItem>
            <SelectItem value="confirmed">Đã xác nhận</SelectItem>
            <SelectItem value="paid">Đã thanh toán</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có hóa đơn mua hàng"
          description="Hóa đơn mua sẽ được tạo từ đơn mua hàng đã duyệt"
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Số HĐ</TableHead>
                  <TableHead>NCC</TableHead>
                  <TableHead>Liên kết PO</TableHead>
                  <TableHead>Ngày</TableHead>
                  <TableHead className="text-right">Tổng tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/purchasing/invoices/${inv.id}`)
                    }
                  >
                    <TableCell>
                      <Link
                        href={`/purchasing/invoices/${inv.id}`}
                        className="font-mono text-sm text-primary font-bold hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inv.invoice_number || "Chưa có"}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      {inv.supplier?.name || "-"}
                    </TableCell>
                    <TableCell>
                      {inv.purchase_order?.po_code ? (
                        <Link
                          href={`/purchasing/orders/${inv.po_id}`}
                          className="text-sm text-primary hover:underline font-mono"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {inv.purchase_order.po_code}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDate(inv.invoice_date)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(inv.total)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={inv.status}
                        type="purchase_invoice"
                      />
                    </TableCell>
                    <TableCell>
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((inv) => (
              <div
                key={inv.id}
                className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/purchasing/invoices/${inv.id}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-primary">
                        {inv.invoice_number || "Chưa có số HĐ"}
                      </p>
                      <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                        {inv.supplier?.name || "-"}
                      </h3>
                      {inv.purchase_order?.po_code && (
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          PO: {inv.purchase_order.po_code}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(inv.invoice_date)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={inv.status} type="purchase_invoice" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                    <span className="text-xs text-muted-foreground">Tổng tiền</span>
                    <span className="font-bold text-base">{formatCurrency(inv.total)}</span>
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
