"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { FileText, Plus, Search, ExternalLink, CheckCircle2, Clock, AlertCircle } from "lucide-react"
import type { Invoice } from "@/types"

type InvoiceRow = Pick<
  Invoice,
  | "id"
  | "invoice_number"
  | "customer_name"
  | "total"
  | "status"
  | "created_at"
  | "issued_at"
  | "misa_status"
  | "misa_invoice_id"
  | "misa_invoice_url"
>

const MISA_BADGE: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" | "secondary" }> = {
  signed: { label: "Đã ký số", variant: "success" },
  sent: { label: "Đã gửi MISA", variant: "default" },
  pending: { label: "Chờ gửi", variant: "warning" },
  error: { label: "Lỗi", variant: "danger" },
}

export default function InvoicesPage() {
  const { user, loading: authLoading } = useRoleGuard("invoices")
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [misaFilter, setMisaFilter] = useState("all")
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, customer_name, total, status, created_at, issued_at, misa_status, misa_invoice_id, misa_invoice_url"
        )
        .order("created_at", { ascending: false })
      setInvoices((data as InvoiceRow[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const statusVariant = (s: string): "default" | "success" | "danger" | "secondary" => {
    switch (s) { case "issued": return "success"; case "cancelled": return "danger"; default: return "secondary" }
  }
  const statusLabel = (s: string) => {
    switch (s) { case "issued": return "Đã phát hành"; case "cancelled": return "Đã hủy"; default: return "Nháp" }
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch = !search.trim() ||
      (inv.invoice_number || "").toLowerCase().includes(search.toLowerCase()) ||
      inv.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      (inv.misa_invoice_id || "").toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === "all" || inv.status === statusFilter
    const matchMisa = misaFilter === "all" ||
      (misaFilter === "signed" && inv.misa_status === "signed") ||
      (misaFilter === "pending" && (!inv.misa_status || inv.misa_status === "pending")) ||
      (misaFilter === "error" && inv.misa_status === "error")
    return matchSearch && matchStatus && matchMisa
  })

  // Stats
  const totalInvoices = invoices.length
  const signedCount = invoices.filter((i) => i.misa_status === "signed").length
  const pendingCount = invoices.filter((i) => !i.misa_status || i.misa_status === "pending").length
  const errorCount = invoices.filter((i) => i.misa_status === "error").length

  return (
    <div className="space-y-6">
      <PageHeader title="Hóa đơn điện tử" description={`${totalInvoices} hóa đơn`}>
        {user && hasPermission(user.role, "invoices", "create") && (
          <Button onClick={() => router.push("/invoices/new")}><Plus className="mr-2 h-4 w-4" /> Tạo hóa đơn</Button>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <p className="text-xs text-muted-foreground font-medium">Tổng hóa đơn</p>
          <p className="text-xl font-bold mt-1">{totalInvoices}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Đã ký số MISA
          </div>
          <p className="text-xl font-bold mt-1 text-emerald-600">{signedCount}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-amber-600 font-medium">
            <Clock className="h-3.5 w-3.5" /> Chờ gửi
          </div>
          <p className="text-xl font-bold mt-1 text-amber-600">{pendingCount}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-red-600 font-medium">
            <AlertCircle className="h-3.5 w-3.5" /> Lỗi
          </div>
          <p className="text-xl font-bold mt-1 text-red-600">{errorCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm số HĐ, khách hàng, mã MISA..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="draft">Nháp</SelectItem>
            <SelectItem value="issued">Đã phát hành</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
          </SelectContent>
        </Select>
        <Select value={misaFilter} onValueChange={setMisaFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">MISA: Tất cả</SelectItem>
            <SelectItem value="signed">Đã ký số</SelectItem>
            <SelectItem value="pending">Chờ gửi</SelectItem>
            <SelectItem value="error">Lỗi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title={invoices.length === 0 ? "Chưa có hóa đơn" : "Không tìm thấy hóa đơn"}
          description={invoices.length === 0 ? "Hóa đơn được tạo từ đơn hàng đã giao" : "Thử đổi bộ lọc"}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Số HĐ</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead className="text-right">Tổng tiền</TableHead>
                  <TableHead>Ngày</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>MISA</TableHead>
                  <TableHead>Tra cứu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => {
                  const misa = inv.misa_status ? MISA_BADGE[inv.misa_status] : null
                  return (
                    <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <TableCell className="font-mono text-sm font-medium">
                        {inv.misa_invoice_id || inv.invoice_number || "-"}
                      </TableCell>
                      <TableCell className="font-medium">{inv.customer_name}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(inv.total)}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.issued_at ? formatDate(inv.issued_at) : inv.created_at ? formatDate(inv.created_at) : "-"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        {misa ? (
                          <Badge variant={misa.variant}>{misa.label}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {inv.misa_invoice_url ? (
                          <a
                            href={inv.misa_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline text-xs flex items-center gap-1"
                          >
                            Xem HĐ <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((inv) => {
              const misa = inv.misa_status ? MISA_BADGE[inv.misa_status] : null
              return (
                <div
                  key={inv.id}
                  className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-primary">
                          {inv.misa_invoice_id || inv.invoice_number || "-"}
                        </p>
                        <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                          {inv.customer_name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {inv.issued_at ? formatDate(inv.issued_at) : inv.created_at ? formatDate(inv.created_at) : "-"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
                        {misa && <Badge variant={misa.variant}>{misa.label}</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                      <span className="text-xs text-muted-foreground">Tổng tiền</span>
                      <span className="font-bold text-base">{formatCurrency(inv.total)}</span>
                    </div>
                    {inv.misa_invoice_url && (
                      <a
                        href={inv.misa_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline text-xs flex items-center gap-1 mt-2"
                      >
                        Xem HĐ trên MISA <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
