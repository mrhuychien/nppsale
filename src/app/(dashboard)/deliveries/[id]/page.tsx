"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Play, XCircle, Trash2,
  PackageCheck, Wallet,
  Eye,
  Link as LinkIcon, ArrowDownToLine, ArrowUpFromLine, Receipt, FileText,
  Truck, CheckCircle2, Banknote,
} from "lucide-react"
import type { Delivery, DeliveryLine, DeliveryStatus, SalesOrder, SalesOrderLine } from "@/types"

type OrderDetail = SalesOrder & {
  customer?: SalesOrder["customer"] & { address?: string | null; ward?: string | null; district?: string | null; province?: string | null }
  lines?: (SalesOrderLine & { product?: { name?: string; sku?: string; base_unit?: string } })[]
}

type RelatedStockEntry = { id: string; entry_code: string; type: "import" | "export"; status: string; created_at: string; notes: string | null }
type RelatedCashReceipt = { id: string; receipt_code: string; status: string; total_amount: number; received_at: string | null; created_at: string }

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [lines, setLines] = useState<DeliveryLine[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmStart, setConfirmStart] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [orderDetailOpen, setOrderDetailOpen] = useState(false)
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null)
  const [orderDetailLoading, setOrderDetailLoading] = useState(false)

  const [sourceEntry, setSourceEntry] = useState<RelatedStockEntry | null>(null)
  const [handoverEntries, setHandoverEntries] = useState<RelatedStockEntry[]>([])
  const [cashReceipts, setCashReceipts] = useState<RelatedCashReceipt[]>([])

  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [delRes, linesRes] = await Promise.all([
      supabase
        .from("deliveries")
        .select(
          "*, driver:users!deliveries_driver_id_fkey(*), warehouse_confirmer:users!deliveries_warehouse_confirmed_by_fkey(*), driver_confirmer:users!deliveries_driver_confirmed_by_fkey(*)"
        )
        .eq("id", id)
        .single(),
      supabase
        .from("delivery_lines")
        .select("*, order:sales_orders(order_code, total, status, customer:customers(store_name, phone, address))")
        .eq("delivery_id", id),
    ])
    let d: Delivery | null = null
    if (delRes.data) {
      d = delRes.data as Delivery
      setDelivery(d)
    }
    setLines((linesRes.data as DeliveryLine[]) || [])

    if (d) {
      const sourceQuery = d.source_stock_entry_id
        ? supabase
            .from("stock_entries")
            .select("id, entry_code, type, status, created_at, notes")
            .eq("id", d.source_stock_entry_id)
            .maybeSingle()
        : Promise.resolve({ data: null })

      const [sourceRes, handoverRes, receiptsRes] = await Promise.all([
        sourceQuery,
        supabase
          .from("stock_entries")
          .select("id, entry_code, type, status, created_at, notes")
          .eq("type", "import")
          .ilike("notes", `%${d.id}%`)
          .order("created_at", { ascending: false }),
        supabase
          .from("cash_receipts")
          .select("id, receipt_code, status, total_amount, received_at, created_at")
          .eq("source_type", "delivery_settle")
          .eq("source_id", d.id)
          .order("created_at", { ascending: false }),
      ])
      setSourceEntry((sourceRes.data as RelatedStockEntry | null) || null)
      setHandoverEntries((handoverRes.data as RelatedStockEntry[] | null) || [])
      setCashReceipts((receiptsRes.data as RelatedCashReceipt[] | null) || [])
    } else {
      setSourceEntry(null)
      setHandoverEntries([])
      setCashReceipts([])
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleStartTrip = async () => {
    if (!delivery) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("deliveries")
        .update({
          status: "in_transit" as DeliveryStatus,
          started_at: new Date().toISOString(),
        })
        .eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Đã chuyển sang Đang giao hàng" })
      setConfirmStart(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelTrip = async () => {
    if (!delivery) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("deliveries")
        .update({ status: "cancelled" as DeliveryStatus })
        .eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Đã huỷ chuyến giao" })
      setConfirmCancel(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!delivery) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("deliveries").delete().eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Đã xoá phiếu giao" })
      router.push("/deliveries")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const openOrderDetail = async (orderId: string) => {
    setOrderDetailOpen(true)
    setOrderDetail(null)
    setOrderDetailLoading(true)
    try {
      const { data } = await supabase
        .from("sales_orders")
        .select(
          "*, customer:customers(*), lines:sales_order_lines(*, product:products(name, sku, base_unit))"
        )
        .eq("id", orderId)
        .single()
      setOrderDetail((data as unknown as OrderDetail) || null)
    } finally {
      setOrderDetailLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy chuyến giao</div>

  const isSelfDeliver = !!delivery.source_stock_entry_id
  const alreadySettled = !!delivery.settled_at

  // Derived workflow state
  const stage: "pending" | "in_transit" | "completed" | "settled" | "cancelled" =
    delivery.status === "cancelled"
      ? "cancelled"
      : alreadySettled
        ? "settled"
        : delivery.status === "completed"
          ? "completed"
          : delivery.status === "in_transit"
            ? "in_transit"
            : "pending"

  const statusConfig = DELIVERY_STATUS_MAP[delivery.status] || { label: delivery.status, variant: "outline" as const }

  // Aggregated payment summary (read-only, populated by /settle step)
  const totalCollected = lines.reduce((s, l) => s + Number(l.amount_collected || 0), 0)
  const deliveredCount = lines.filter((l) => l.status === "delivered").length
  const failedCount = lines.filter((l) => l.status === "failed").length
  const pendingCount = lines.filter((l) => l.status === "pending").length
  const partialCount = lines.filter((l) => l.status === "partial").length

  // Permissions
  const canStart =
    user && hasPermission(user.role, "deliveries", "update") && stage === "pending"
  const canCancel =
    user && hasPermission(user.role, "deliveries", "update") &&
    (stage === "pending" || stage === "in_transit")
  const canDelete =
    user && hasPermission(user.role, "deliveries", "delete") &&
    (stage === "pending" || stage === "cancelled")

  const settleHref = isSelfDeliver
    ? `/inventory/stock-out/collect/${delivery.source_stock_entry_id}`
    : `/deliveries/${delivery.id}/settle`

  return (
    <div className="space-y-4">
      <PageHeader
        title={delivery.route_name || (isSelfDeliver ? "Phiếu tự giao" : "Chi tiết chuyến giao")}
        description={
          [
            `Tạo: ${formatDate(delivery.created_at)}`,
            delivery.started_at ? `Xuất phát: ${formatDate(delivery.started_at)}` : null,
            delivery.completed_at ? `Hoàn tất: ${formatDate(delivery.completed_at)}` : null,
            delivery.settled_at ? `Quyết toán: ${formatDate(delivery.settled_at)}` : null,
          ]
            .filter(Boolean)
            .join(" • ")
        }
        backHref="/deliveries"
      >
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
        {isSelfDeliver && <Badge variant="secondary">Tự giao</Badge>}
      </PageHeader>

      {/* Big status-driven CTA */}
      {stage === "in_transit" && (
        <Card className="border-amber-500/40 bg-amber-50/60">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Truck className="h-8 w-8 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">Đang giao hàng</p>
                <p className="text-xs text-amber-800/80">
                  Lái xe đang trên đường giao. Khi lái xe quay về, bấm để nhận bàn giao lại + nhập kho hàng trả về.
                </p>
              </div>
            </div>
            <Button asChild className="h-11 sm:min-w-[260px]">
              <Link href={`/deliveries/${delivery.id}/handover`}>
                <PackageCheck className="h-4 w-4 mr-2" />
                Nhận bàn giao lại từ tài xế
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {stage === "completed" && (
        <Card className="border-emerald-500/40 bg-emerald-50/60">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-900">Đã giao hàng</p>
                <p className="text-xs text-emerald-800/80">
                  Đã nhận bàn giao từ tài xế. Tiếp tục lập phiếu thu / nộp tiền để hoàn tất chuyến.
                </p>
              </div>
            </div>
            <Button asChild className="h-11 sm:min-w-[260px]">
              <Link href={settleHref}>
                <Banknote className="h-4 w-4 mr-2" />
                Nộp tiền
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {stage === "settled" && (
        <Card className="border-emerald-500/40 bg-emerald-50/60">
          <CardContent className="flex items-center gap-3 p-4">
            <Wallet className="h-7 w-7 text-emerald-600 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-900">Đã quyết toán</p>
              <p className="text-xs text-emerald-800/80">
                Chuyến giao đã hoàn tất {delivery.settled_at && `lúc ${formatDate(delivery.settled_at)}`}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "cancelled" && (
        <Card className="border-rose-300 bg-rose-50/60">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-7 w-7 text-rose-600 shrink-0" />
            <div>
              <p className="font-semibold text-rose-900">Chuyến đã huỷ</p>
              <p className="text-xs text-rose-800/80">Phiếu giao đã được huỷ, không còn trong flow xử lý đơn hàng.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {stage === "pending" && (
        <Card className="border-slate-300 bg-slate-50/60">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Truck className="h-7 w-7 text-slate-600 shrink-0" />
              <div>
                <p className="font-semibold text-slate-900">Đang chuẩn bị giao</p>
                <p className="text-xs text-slate-700">
                  Phiếu vừa tạo, chưa xuất phát. Khi lái xe nhận hàng và lên đường, chuyển sang Đang giao hàng.
                </p>
              </div>
            </div>
            {canStart && (
              <Button onClick={() => setConfirmStart(true)} className="h-10 sm:min-w-[200px]">
                <Play className="h-4 w-4 mr-2" /> Bắt đầu giao
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column — order list */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Danh sách đơn hàng ({lines.length})</span>
              <span className="flex flex-wrap gap-1.5 text-xs font-normal">
                {deliveredCount > 0 && <Badge variant="success">Giao OK: {deliveredCount}</Badge>}
                {partialCount > 0 && <Badge variant="warning">1 phần: {partialCount}</Badge>}
                {failedCount > 0 && <Badge variant="danger">Thất bại: {failedCount}</Badge>}
                {pendingCount > 0 && <Badge variant="secondary">Chờ: {pendingCount}</Badge>}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Trạng thái giao</TableHead>
                    <TableHead className="text-right tabular-nums">Tổng đơn</TableHead>
                    <TableHead className="text-right tabular-nums">Đã thu</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const lineStatusLabel =
                      line.status === "delivered" ? "Đã giao" :
                      line.status === "failed" ? "Thất bại" :
                      line.status === "partial" ? "Giao 1 phần" : "Chờ giao"
                    const lineStatusVariant: "success" | "danger" | "warning" | "secondary" =
                      line.status === "delivered" ? "success" :
                      line.status === "failed" ? "danger" :
                      line.status === "partial" ? "warning" : "secondary"
                    const orderTotal = Number(line.order?.total || 0)
                    const collected = Number(line.amount_collected || 0)
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Link
                            href={`/orders/${line.order_id}`}
                            className="font-mono text-xs text-primary font-bold hover:underline"
                          >
                            {line.order?.order_code || line.order_id.slice(0, 8)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-sm">{line.order?.customer?.store_name || "—"}</p>
                            {line.order?.customer?.phone && (
                              <p className="text-xs text-muted-foreground">{line.order.customer.phone}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={lineStatusVariant}>{lineStatusLabel}</Badge>
                          {line.notes && (
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 max-w-[220px]">
                              {line.notes}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatCurrency(orderTotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {collected > 0 ? (
                            <span className="font-semibold text-emerald-700">{formatCurrency(collected)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openOrderDetail(line.order_id)}
                            title="Xem chi tiết đơn"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Chưa có đơn hàng trong chuyến giao này.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Trip info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thông tin chuyến</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tuyến</Label>
                <p className="font-semibold">{delivery.route_name || "—"}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lái xe</Label>
                <p className="font-semibold">{delivery.driver?.full_name || "Chưa gán"}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phương tiện</Label>
                <p className="font-semibold">{delivery.vehicle || "—"}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Số đơn</Label>
                <p className="font-semibold">{lines.length} đơn</p>
              </div>
            </CardContent>
          </Card>

          {/* Delivery summary (handover result, populated after handover step) */}
          {(stage === "completed" || stage === "settled") && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PackageCheck className="h-4 w-4" /> Chi tiết giao hàng
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {deliveredCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Giao thành công</span>
                    <span className="font-semibold text-emerald-700">{deliveredCount} đơn</span>
                  </div>
                )}
                {partialCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Giao 1 phần</span>
                    <span className="font-semibold text-amber-700">{partialCount} đơn</span>
                  </div>
                )}
                {failedCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Giao thất bại</span>
                    <span className="font-semibold text-rose-700">{failedCount} đơn</span>
                  </div>
                )}
                {delivery.completed_at && (
                  <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
                    <span>Bàn giao xong</span>
                    <span>{formatDate(delivery.completed_at)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment summary (populated after settle step) */}
          {(stage === "completed" || stage === "settled") && totalCollected > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-4 w-4" /> Chi tiết thanh toán
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Đã thu (tổng)</span>
                  <span className="font-bold text-emerald-700">{formatCurrency(totalCollected)}</span>
                </div>
                {delivery.settled_at && (
                  <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
                    <span>Quyết toán</span>
                    <span>{formatDate(delivery.settled_at)}</span>
                  </div>
                )}
                {cashReceipts.length > 0 && (
                  <p className="text-[11px] text-muted-foreground italic">
                    Xem chi tiết phiếu thu ở mục Liên kết chứng từ bên dưới.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Cross-links */}
          {(sourceEntry || handoverEntries.length > 0 || cashReceipts.length > 0 || lines.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LinkIcon className="h-4 w-4" /> Liên kết chứng từ
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Tra cứu chéo các chứng từ liên quan đến chuyến giao này.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {sourceEntry && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ArrowUpFromLine className="h-3 w-3" /> Phiếu xuất kho
                    </Label>
                    <Link
                      href={`/inventory/entries/${sourceEntry.id}`}
                      className="font-mono text-primary font-bold hover:underline text-sm block"
                    >
                      {sourceEntry.entry_code}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(sourceEntry.created_at)} • {sourceEntry.status}
                    </p>
                  </div>
                )}

                {handoverEntries.length > 0 && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <ArrowDownToLine className="h-3 w-3" /> Phiếu nhập kho (bàn giao lại)
                    </Label>
                    <div className="space-y-1">
                      {handoverEntries.map((e) => (
                        <div key={e.id} className="flex justify-between items-baseline">
                          <Link
                            href={`/inventory/entries/${e.id}`}
                            className="font-mono text-primary font-bold hover:underline text-sm"
                          >
                            {e.entry_code}
                          </Link>
                          <span className="text-[11px] text-muted-foreground">{formatDate(e.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {cashReceipts.length > 0 && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Receipt className="h-3 w-3" /> Phiếu thu
                    </Label>
                    <div className="space-y-1">
                      {cashReceipts.map((r) => (
                        <div key={r.id} className="flex justify-between items-baseline gap-2">
                          <Link
                            href={`/finance/cash-receipts/${r.id}`}
                            className="font-mono text-primary font-bold hover:underline text-sm"
                          >
                            {r.receipt_code}
                          </Link>
                          <span className="text-[11px] font-semibold text-emerald-700">
                            {formatCurrency(Number(r.total_amount || 0))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {lines.length > 0 && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Đơn hàng trong chuyến ({lines.length})
                    </Label>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {lines.map((l) => (
                        <Link
                          key={l.id}
                          href={`/orders/${l.order_id}`}
                          className="flex justify-between items-baseline gap-2 hover:bg-muted/40 rounded px-1 -mx-1"
                        >
                          <span className="font-mono text-primary font-bold text-xs">
                            {l.order?.order_code || l.order_id.slice(0, 8)}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            {l.order?.customer?.store_name || ""}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Admin actions: huỷ / xoá. KHÔNG có inline thu tiền / mark giao OK,
             các thao tác đó nằm trong flow handover + settle / collect. */}
          {(canCancel || canDelete) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Thao tác quản trị</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {canCancel && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-rose-700 hover:bg-rose-50"
                    onClick={() => setConfirmCancel(true)}
                  >
                    <XCircle className="h-4 w-4 mr-2" /> Huỷ chuyến
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xoá phiếu giao
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Order detail modal — read-only */}
      <Dialog open={orderDetailOpen} onOpenChange={setOrderDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{orderDetail ? `Đơn ${orderDetail.order_code}` : "Chi tiết đơn"}</DialogTitle>
            {orderDetail && (
              <DialogDescription>
                Khách: {orderDetail.customer?.store_name || "—"}
                {orderDetail.customer?.phone ? ` • ${orderDetail.customer.phone}` : ""}
              </DialogDescription>
            )}
          </DialogHeader>
          {orderDetailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-32" />
            </div>
          ) : orderDetail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Ngày đặt</p>
                  <p className="font-semibold">{formatDate(orderDetail.order_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Thanh toán</p>
                  <p className="font-semibold">{orderDetail.payment_terms || "COD"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Địa chỉ giao</p>
                  <p className="font-medium">
                    {[orderDetail.customer?.address, orderDetail.customer?.ward, orderDetail.customer?.district, orderDetail.customer?.province]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                </div>
                {orderDetail.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Ghi chú đơn</p>
                    <p className="whitespace-pre-wrap">{orderDetail.notes}</p>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold">SKU</th>
                      <th className="text-left px-2 py-2 font-semibold">Sản phẩm</th>
                      <th className="text-center px-2 py-2 font-semibold w-12">ĐVT</th>
                      <th className="text-right px-2 py-2 font-semibold w-12">SL</th>
                      <th className="text-right px-2 py-2 font-semibold w-24">Đơn giá</th>
                      <th className="text-right px-2 py-2 font-semibold w-28">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(orderDetail.lines || []).map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-2 py-1.5 font-mono">{l.product?.sku || "—"}</td>
                        <td className="px-2 py-1.5">{l.product?.name || "—"}</td>
                        <td className="px-2 py-1.5 text-center">{l.unit_name}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{l.quantity}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(Number(l.unit_price || 0))}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(Number(l.line_total || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-6 text-sm border-t pt-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Tạm tính</p>
                  <p className="font-semibold">{formatCurrency(Number(orderDetail.subtotal || 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">VAT</p>
                  <p className="font-semibold">{formatCurrency(Number(orderDetail.vat || 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Tổng</p>
                  <p className="text-lg font-black text-primary">{formatCurrency(Number(orderDetail.total || 0))}</p>
                </div>
              </div>
              <DialogFooter>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/orders/${orderDetail.id}`}>Mở trang đơn</Link>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Không tìm thấy đơn.</p>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title="Bắt đầu giao?"
        description={`Chuyến ${delivery.route_name || ""} sẽ chuyển sang Đang giao hàng. Sau đó bạn có thể nhận bàn giao lại từ tài xế khi xe quay về.`}
        onConfirm={handleStartTrip}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Huỷ chuyến giao?"
        description="Phiếu giao sẽ được đánh dấu đã huỷ. Hành động này thường dùng khi chuyến không thể thực hiện."
        variant="destructive"
        confirmLabel="Huỷ chuyến"
        onConfirm={handleCancelTrip}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá vĩnh viễn phiếu giao?"
        description="Phiếu giao này sẽ bị xoá cùng toàn bộ dữ liệu liên quan. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xoá vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
