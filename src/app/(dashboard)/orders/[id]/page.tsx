"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ApprovalBadge } from "@/components/orders/approval-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ensureReceivableForOrder } from "@/lib/receivables"
import { APPROVAL_THRESHOLDS, ORDER_STATUS_MAP, PAYMENT_TERMS } from "@/lib/constants"
import { CheckCircle2, Package2, Truck, CircleCheck, XCircle, Pencil, Trash2, X, CreditCard, ExternalLink, Clock } from "lucide-react"
import Link from "next/link"
import type { SalesOrder, SalesOrderLine, OrderStatus, OrderStatusHistory } from "@/types"

type NextStatus = {
  value: OrderStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

const STATUS_FLOW: Record<OrderStatus, NextStatus[]> = {
  draft: [
    { value: "confirmed", label: "Duyệt đơn", icon: CheckCircle2, roles: ["owner", "manager"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager", "sales"] },
  ],
  confirmed: [
    { value: "picking", label: "Bắt đầu lấy hàng", icon: Package2, roles: ["owner", "manager", "warehouse"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager"] },
  ],
  picking: [
    { value: "delivering", label: "Xuất kho giao hàng", icon: Truck, roles: ["owner", "manager", "warehouse", "driver"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager"] },
  ],
  delivering: [
    { value: "delivered", label: "Xác nhận đã giao", icon: CircleCheck, roles: ["owner", "manager", "warehouse", "driver"] },
  ],
  delivered: [],
  cancelled: [],
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [receivableId, setReceivableId] = useState<string | null>(null)
  const [statusHistory, setStatusHistory] = useState<OrderStatusHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{ status: OrderStatus; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ notes: "", payment_terms: "COD", expected_delivery: "" })
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [orderRes, linesRes, recRes, historyRes] = await Promise.all([
      supabase.from("sales_orders").select("*, customer:customers(*), sales_user:users!sales_orders_sales_user_id_fkey(*)").eq("id", id).single(),
      supabase.from("sales_order_lines").select("*, product:products(*)").eq("order_id", id),
      supabase.from("receivables").select("id").eq("order_id", id).maybeSingle(),
      supabase.from("order_status_history").select("*, changer:users!order_status_history_changed_by_fkey(full_name)").eq("order_id", id).order("changed_at", { ascending: false }),
    ])
    if (orderRes.data) {
      const o = orderRes.data as SalesOrder
      setOrder(o)
      setEditForm({
        notes: o.notes || "",
        payment_terms: o.payment_terms || "COD",
        expected_delivery: o.expected_delivery || "",
      })
    }
    setLines((linesRes.data as SalesOrderLine[]) || [])
    setReceivableId(recRes.data?.id || null)
    setStatusHistory((historyRes.data as unknown as OrderStatusHistory[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateReceivable = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      const { created, error: recErr } = await ensureReceivableForOrder(supabase, order.id)
      if (recErr) throw new Error(recErr)
      toast({
        title: created ? "Đã ghi nhận công nợ" : "Công nợ đã tồn tại",
      })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [fetchData])

  const handleChangeStatus = async (newStatus: OrderStatus) => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }

      // If confirming an order, check threshold and set approval fields
      if (newStatus === "confirmed") {
        const canApprove =
          order.total < APPROVAL_THRESHOLDS.AUTO_APPROVE ||
          (order.total < APPROVAL_THRESHOLDS.MANAGER_APPROVE && ["owner", "manager"].includes(user.role)) ||
          user.role === "owner"

        if (!canApprove) {
          toast({ title: "Không có quyền duyệt đơn này", variant: "destructive" })
          setActionLoading(false)
          return
        }
        updates.approved_by = user.id
        updates.approved_at = new Date().toISOString()
      }

      const { error } = await supabase.from("sales_orders").update(updates).eq("id", order.id)
      if (error) throw error

      // Auto-create receivable when order becomes delivered
      if (newStatus === "delivered") {
        const { created, error: recErr } = await ensureReceivableForOrder(supabase, order.id)
        if (recErr) {
          toast({ title: "Cập nhật công nợ thất bại", description: recErr, variant: "destructive" })
        } else if (created) {
          toast({ title: `Đã chuyển trạng thái: ${newStatus} • Đã ghi nhận công nợ` })
          setConfirmOpen(null)
          fetchData()
          return
        }
      }

      toast({ title: `Đã chuyển trạng thái: ${newStatus}` })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      // Delete order lines first, then order (schema: order_lines has ON DELETE CASCADE so just delete order)
      const { error } = await supabase.from("sales_orders").delete().eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã xóa đơn hàng" })
      router.push("/orders")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      // Build update payload based on order status
      const updates: Record<string, unknown> = {
        notes: editForm.notes || null,
      }
      // Only allow terms + delivery date changes when still editable
      if (order.status === "draft" || order.status === "confirmed") {
        updates.payment_terms = editForm.payment_terms
        updates.expected_delivery = editForm.expected_delivery || null
      }
      const { error } = await supabase
        .from("sales_orders")
        .update(updates)
        .eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã cập nhật đơn hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!order) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy đơn hàng</div>

  const availableTransitions = STATUS_FLOW[order.status] || []
  // Allow edit for all non-terminal statuses. Draft/confirmed get full edit;
  // picking/delivering can edit notes only; delivered/cancelled cannot edit
  const canEdit = !!(user && hasPermission(user.role, "orders", "update") && !["delivered", "cancelled"].includes(order.status))
  const fullEdit = canEdit && ["draft", "confirmed"].includes(order.status)
  const canDelete = user && hasPermission(user.role, "orders", "delete") && ["draft", "cancelled"].includes(order.status)

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.order_code}
        description={`Ngày đặt: ${formatDate(order.order_date)}${order.approved_at ? ` • Duyệt: ${formatDate(order.approved_at)}` : ""}`}
        backHref="/orders"
      >
        <StatusBadge status={order.status} type="order" />
        <ApprovalBadge total={order.total} status={order.status} approvedBy={order.approved_by} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chi tiết sản phẩm</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>ĐVT</TableHead>
                  <TableHead className="text-right">SL</TableHead>
                  <TableHead className="text-right">Đơn giá</TableHead>
                  <TableHead className="text-right">Thành tiền</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.product?.name || "-"}</TableCell>
                    <TableCell>{line.unit_name}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(line.unit_price)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(line.line_total)}</TableCell>
                  </TableRow>
                ))}
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      Chưa có sản phẩm
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="mt-4 space-y-1 text-right border-t border-border/40 pt-4">
              <p className="text-sm">Tạm tính: {formatCurrency(order.subtotal)}</p>
              <p className="text-sm">Chiết khấu: {formatCurrency(order.discount)}</p>
              <p className="text-sm">VAT: {formatCurrency(order.vat)}</p>
              <p className="text-lg font-black">Tổng: {formatCurrency(order.total)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Right column - customer + actions + edit */}
        <div className="space-y-4">
          {/* Customer info */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{order.customer?.store_name}</p>
              <p className="text-muted-foreground">{order.customer?.owner_name}</p>
              <p>{order.customer?.phone}</p>
              <p className="text-muted-foreground">{order.customer?.address}</p>
              {order.sales_user && (
                <p className="pt-2 border-t border-border/40 mt-2">
                  <span className="text-muted-foreground">NV bán: </span>
                  <span className="font-semibold">{order.sales_user.full_name}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin đơn</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    notes: order.notes || "",
                    payment_terms: order.payment_terms || "COD",
                    expected_delivery: order.expected_delivery || "",
                  })
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!editMode ? (
                <>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Điều khoản TT</Label>
                    <p className="font-semibold">{order.payment_terms || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày giao dự kiến</Label>
                    <p className="font-semibold">{order.expected_delivery ? formatDate(order.expected_delivery) : "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <p className="whitespace-pre-wrap">{order.notes || <span className="text-muted-foreground">Không có</span>}</p>
                  </div>
                </>
              ) : (
                <>
                  {fullEdit && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Điều khoản TT</Label>
                        <Select value={editForm.payment_terms} onValueChange={(v) => setEditForm({ ...editForm, payment_terms: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày giao dự kiến</Label>
                        <input
                          type="date"
                          value={editForm.expected_delivery}
                          onChange={(e) => setEditForm({ ...editForm, expected_delivery: e.target.value })}
                          className="flex h-11 w-full rounded-xl border-0 bg-surface-low px-4 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}
                  {!fullEdit && (
                    <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      Đơn đã được duyệt - chỉ cho phép sửa ghi chú. Các trường khác chỉ sửa được khi ở trạng thái nháp hoặc đã duyệt.
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Receivable status */}
          {order.status === "delivered" && (
            <Card>
              <CardHeader><CardTitle>Công nợ</CardTitle></CardHeader>
              <CardContent>
                {receivableId ? (
                  <Link
                    href={`/receivables/${receivableId}`}
                    className="flex items-center justify-between rounded-lg bg-surface-low p-3 hover:bg-surface-container transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-primary" />
                      <div className="text-sm">
                        <p className="font-semibold">Đã ghi nhận công nợ</p>
                        <p className="text-xs text-muted-foreground">Nhấn để xem chi tiết</p>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Đơn đã giao nhưng chưa ghi nhận công nợ.
                    </p>
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={handleCreateReceivable}
                      disabled={actionLoading}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      {actionLoading ? "Đang tạo..." : "Ghi nhận công nợ"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Status transitions */}
          {(availableTransitions.length > 0 || canDelete) && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {availableTransitions.map((trans) => {
                  if (!user || !trans.roles.includes(user.role)) return null
                  const Icon = trans.icon
                  const isDestructive = trans.value === "cancelled"
                  return (
                    <Button
                      key={trans.value}
                      variant={isDestructive ? "destructive" : "default"}
                      className="w-full justify-start"
                      onClick={() => setConfirmOpen({ status: trans.value, label: trans.label })}
                    >
                      <Icon className="h-4 w-4 mr-2" /> {trans.label}
                    </Button>
                  )
                })}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa đơn hàng
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Status History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Lịch sử trạng thái
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có thay đổi trạng thái</p>
          ) : (
            <div className="relative pl-6">
              {/* Vertical line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border" />
              <div className="space-y-4">
                {statusHistory.map((entry) => {
                  const fromLabel = entry.from_status ? (ORDER_STATUS_MAP[entry.from_status]?.label || entry.from_status) : "Mới tạo"
                  const toLabel = ORDER_STATUS_MAP[entry.to_status]?.label || entry.to_status
                  const changerName = (entry.changer as unknown as { full_name: string })?.full_name || "Hệ thống"
                  return (
                    <div key={entry.id} className="relative flex items-start gap-3">
                      {/* Dot */}
                      <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {fromLabel} <span className="text-muted-foreground mx-1">&rarr;</span> {toLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {changerName} &bull; {formatDate(entry.changed_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status change confirm */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho đơn ${order.order_code}`}
        variant={confirmOpen?.status === "cancelled" ? "destructive" : "default"}
        onConfirm={() => confirmOpen && handleChangeStatus(confirmOpen.status)}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn đơn hàng?"
        description={`Đơn ${order.order_code} sẽ bị xóa cùng toàn bộ chi tiết. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
