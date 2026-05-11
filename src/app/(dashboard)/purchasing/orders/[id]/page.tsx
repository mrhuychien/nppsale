"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  X,
  Boxes,
  FileText,
} from "lucide-react"
import Link from "next/link"
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
} from "@/types"

type NextAction = {
  value: PurchaseOrderStatus | "stock_in" | "create_invoice"
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  variant?: "default" | "destructive"
}

const STATUS_ACTIONS: Record<string, NextAction[]> = {
  draft: [
    {
      value: "confirmed",
      label: "Duyệt đơn mua",
      icon: CheckCircle2,
      roles: ["owner", "manager"],
    },
    {
      value: "cancelled",
      label: "Hủy đơn",
      icon: XCircle,
      roles: ["owner", "manager"],
      variant: "destructive",
    },
  ],
  confirmed: [
    {
      value: "stock_in",
      label: "Nhập kho",
      icon: Boxes,
      roles: ["owner", "manager", "warehouse"],
    },
    {
      value: "create_invoice",
      label: "Tạo hóa đơn mua",
      icon: FileText,
      roles: ["owner", "manager", "accountant"],
    },
    {
      value: "cancelled",
      label: "Hủy đơn",
      icon: XCircle,
      roles: ["owner", "manager"],
      variant: "destructive",
    },
  ],
  partial: [
    {
      value: "stock_in",
      label: "Nhập thêm kho",
      icon: Boxes,
      roles: ["owner", "manager", "warehouse"],
    },
    {
      value: "create_invoice",
      label: "Tạo hóa đơn mua",
      icon: FileText,
      roles: ["owner", "manager", "accountant"],
    },
  ],
  received: [
    {
      value: "create_invoice",
      label: "Tạo hóa đơn mua",
      icon: FileText,
      roles: ["owner", "manager", "accountant"],
    },
  ],
  cancelled: [],
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<PurchaseOrderLine[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{
    action: string
    label: string
  } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editNotes, setEditNotes] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [orderRes, linesRes] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("*, supplier:suppliers(*), creator:users!purchase_orders_created_by_fkey(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("purchase_order_lines")
        .select("*, product:products(*)")
        .eq("po_id", id),
    ])
    if (orderRes.data) {
      const o = orderRes.data as PurchaseOrder
      setOrder(o)
      setEditNotes(o.notes || "")
    }
    setLines((linesRes.data as PurchaseOrderLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleStatusChange = async (newStatus: PurchaseOrderStatus) => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === "confirmed") {
        updates.approved_by = user.id
        updates.approved_at = new Date().toISOString()
      }
      const { error } = await supabase
        .from("purchase_orders")
        .update(updates)
        .eq("id", order.id)
      if (error) throw error
      toast({ title: `Đã chuyển trạng thái: ${newStatus}` })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({
        title: "Lỗi",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleStockIn = async () => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      // Create stock entry
      const entryCode = `SE-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`
      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert({
          org_id: order.org_id,
          entry_code: entryCode,
          type: "import",
          supplier_id: order.supplier_id,
          created_by: user.id,
          notes: `Nhập kho từ PO ${order.po_code}`,
        })
        .select()
        .single()
      if (entryErr) throw entryErr

      // Create stock entry lines from PO lines
      const entryLines = lines.map((l) => ({
        entry_id: entry.id,
        product_id: l.product_id,
        unit_name: l.unit_name,
        quantity: l.quantity - l.received_qty,
        notes: `Từ PO ${order.po_code}`,
      }))
      const validLines = entryLines.filter((l) => l.quantity > 0)
      if (validLines.length === 0) {
        toast({ title: "Tất cả sản phẩm đã nhập đủ", variant: "destructive" })
        setActionLoading(false)
        setConfirmOpen(null)
        return
      }

      const { error: lineErr } = await supabase
        .from("stock_entry_lines")
        .insert(validLines)
      if (lineErr) throw lineErr

      // Update received_qty on PO lines
      for (const l of lines) {
        const newReceivedQty = l.quantity // Full receive
        await supabase
          .from("purchase_order_lines")
          .update({ received_qty: newReceivedQty })
          .eq("id", l.id)
      }

      // Check if all lines fully received
      const allReceived = lines.every(
        (l) => l.quantity <= l.quantity // full stock-in
      )

      await supabase
        .from("purchase_orders")
        .update({ status: allReceived ? "received" : "partial" })
        .eq("id", order.id)

      toast({
        title: `Đã nhập kho thành công`,
        description: `Phiếu nhập: ${entryCode}`,
      })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({
        title: "Lỗi nhập kho",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCreateInvoice = async () => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      const { data: inv, error: invErr } = await supabase
        .from("purchase_invoices")
        .insert({
          org_id: order.org_id,
          po_id: order.id,
          supplier_id: order.supplier_id,
          subtotal: order.subtotal,
          vat: order.vat,
          total: order.total,
          notes: `Từ PO ${order.po_code}`,
          status: "draft",
          created_by: user.id,
        })
        .select()
        .single()
      if (invErr) throw invErr
      // Copy các dòng từ PO sang hoá đơn nhập (nháp) để không phải nhập lại.
      const { data: poLines } = await supabase
        .from("purchase_order_lines")
        .select("product_id, unit_name, quantity, unit_price, vat_rate, line_total")
        .eq("po_id", order.id)
      if (poLines && poLines.length > 0) {
        await supabase.from("purchase_invoice_lines").insert(
          (poLines as Array<{ product_id: string; unit_name: string; quantity: number; unit_price: number; vat_rate: number; line_total: number }>).map((l) => ({
            invoice_id: inv.id,
            product_id: l.product_id,
            unit_name: l.unit_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            vat_rate: l.vat_rate ?? 0,
            conversion_factor: 1,
            line_total: l.line_total ?? Number(l.quantity || 0) * Number(l.unit_price || 0),
          }))
        )
      }
      toast({ title: "Đã tạo hoá đơn nhập (nháp) từ PO" })
      setConfirmOpen(null)
      router.push(`/purchasing/invoices/${inv.id}`)
    } catch (error) {
      toast({
        title: "Lỗi",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleAction = (action: string) => {
    if (action === "stock_in") {
      handleStockIn()
    } else if (action === "create_invoice") {
      handleCreateInvoice()
    } else {
      handleStatusChange(action as PurchaseOrderStatus)
    }
  }

  const handleDelete = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã xóa đơn mua hàng" })
      router.push("/purchasing/orders")
    } catch (error) {
      toast({
        title: "Lỗi",
        description: (error as Error).message,
        variant: "destructive",
      })
      setActionLoading(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ notes: editNotes || null })
        .eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã cập nhật ghi chú" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({
        title: "Lỗi",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!order)
    return (
      <div className="text-center py-12 text-muted-foreground">
        Không tìm thấy đơn mua hàng
      </div>
    )

  const availableActions = STATUS_ACTIONS[order.status] || []
  const canEdit =
    user &&
    hasPermission(user.role, "inventory", "update") &&
    order.status === "draft"
  const canDelete =
    user &&
    hasPermission(user.role, "inventory", "delete") &&
    ["draft", "cancelled"].includes(order.status)

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.po_code}
        description={`Ngày đặt: ${formatDate(order.order_date)}${order.approved_at ? ` | Duyệt: ${formatDate(order.approved_at)}` : ""}`}
        backHref="/purchasing/orders"
      >
        <StatusBadge status={order.status} type="po" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - line items */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chi tiết sản phẩm</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sản phẩm</TableHead>
                    <TableHead>ĐVT</TableHead>
                    <TableHead className="text-right">SL đặt</TableHead>
                    <TableHead className="text-right">SL nhận</TableHead>
                    <TableHead className="text-right">Đơn giá</TableHead>
                    <TableHead className="text-right">Thành tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">
                        {line.product?.name || "-"}
                      </TableCell>
                      <TableCell>{line.unit_name}</TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            line.received_qty >= line.quantity
                              ? "text-green-600 font-semibold"
                              : line.received_qty > 0
                                ? "text-amber-600 font-semibold"
                                : "text-muted-foreground"
                          }
                        >
                          {line.received_qty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(line.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(line.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-6"
                      >
                        Chưa có sản phẩm
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {lines.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">Chưa có sản phẩm</p>
              ) : (
                lines.map((line) => {
                  const receivedColor =
                    line.received_qty >= line.quantity
                      ? "text-green-600"
                      : line.received_qty > 0
                        ? "text-amber-600"
                        : "text-muted-foreground"
                  return (
                    <div key={line.id} className="rounded-xl border bg-muted/20 p-3">
                      <p className="font-semibold text-sm leading-tight">{line.product?.name || "-"}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">SL đặt ({line.unit_name})</p>
                          <p className="font-medium">{line.quantity}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">SL nhận</p>
                          <p className={`font-semibold ${receivedColor}`}>{line.received_qty}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Đơn giá</p>
                          <p className="font-medium">{formatCurrency(line.unit_price)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Thành tiền</p>
                          <p className="font-bold">{formatCurrency(line.line_total)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="mt-4 space-y-1 text-right border-t border-border/40 pt-4">
              <p className="text-sm">
                Tạm tính: {formatCurrency(order.subtotal)}
              </p>
              <p className="text-sm">VAT: {formatCurrency(order.vat)}</p>
              <p className="text-lg font-black">
                Tổng: {formatCurrency(order.total)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Right column - info + actions */}
        <div className="space-y-4">
          {/* Supplier info */}
          <Card>
            <CardHeader>
              <CardTitle>Nhà cung cấp</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{order.supplier?.name}</p>
              <p className="text-muted-foreground">
                {order.supplier?.contact_name}
              </p>
              {order.supplier?.phone && <p>{order.supplier.phone}</p>}
              {order.supplier?.address && (
                <p className="text-muted-foreground">
                  {order.supplier.address}
                </p>
              )}
              <div className="pt-2 border-t border-border/40 mt-2">
                <Link
                  href={`/suppliers/${order.supplier_id}`}
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  Xem nhà cung cấp
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Order info / notes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin đơn</CardTitle>
              {canEdit && !editMode && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditMode(true)}
                >
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditMode(false)
                    setEditNotes(order.notes || "")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Điều khoản TT
                </Label>
                <p className="font-semibold">
                  {order.payment_terms || "-"}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ngày giao dự kiến
                </Label>
                <p className="font-semibold">
                  {order.expected_delivery
                    ? formatDate(order.expected_delivery)
                    : "-"}
                </p>
              </div>
              {!editMode ? (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Ghi chú
                  </Label>
                  <p className="whitespace-pre-wrap">
                    {order.notes || (
                      <span className="text-muted-foreground">Không có</span>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Ghi chú
                    </Label>
                    <Textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={handleSaveNotes}
                    disabled={actionLoading}
                    className="w-full"
                  >
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
              {order.creator && (
                <div className="pt-2 border-t border-border/40">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Người tạo
                  </Label>
                  <p className="font-semibold">{order.creator.full_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {(availableActions.length > 0 || canDelete) && (
            <Card>
              <CardHeader>
                <CardTitle>Thao tác</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {availableActions.map((action) => {
                  if (!user || !action.roles.includes(user.role)) return null
                  const Icon = action.icon
                  return (
                    <Button
                      key={action.value}
                      variant={
                        action.variant === "destructive"
                          ? "destructive"
                          : "default"
                      }
                      className="w-full justify-start"
                      onClick={() =>
                        setConfirmOpen({
                          action: action.value,
                          label: action.label,
                        })
                      }
                    >
                      <Icon className="h-4 w-4 mr-2" /> {action.label}
                    </Button>
                  )
                })}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa đơn mua hàng
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Confirm action */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho đơn ${order.po_code}`}
        variant={
          confirmOpen?.action === "cancelled" ? "destructive" : "default"
        }
        onConfirm={() => confirmOpen && handleAction(confirmOpen.action)}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn đơn mua hàng?"
        description={`Đơn ${order.po_code} sẽ bị xóa cùng toàn bộ chi tiết. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
