"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  CheckCircle2,
  CreditCard,
  XCircle,
  Pencil,
  Trash2,
  X,
  ExternalLink,
} from "lucide-react"
import Link from "next/link"
import type { PurchaseInvoice, PurchaseInvoiceStatus } from "@/types"

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    invoice_number: "",
    notes: "",
  })
  const [confirmOpen, setConfirmOpen] = useState<{
    action: string
    label: string
  } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("purchase_invoices")
      .select(
        "*, supplier:suppliers(*), purchase_order:purchase_orders(po_code)"
      )
      .eq("id", id)
      .single()
    if (data) {
      const inv = data as PurchaseInvoice
      setInvoice(inv)
      setEditForm({
        invoice_number: inv.invoice_number || "",
        notes: inv.notes || "",
      })
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleStatusChange = async (newStatus: PurchaseInvoiceStatus) => {
    if (!invoice || !user) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("purchase_invoices")
        .update({ status: newStatus })
        .eq("id", invoice.id)
      if (error) throw error
      toast({ title: `Đã chuyển trạng thái hóa đơn` })
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

  const handleCreatePayable = async () => {
    if (!invoice || !user) return
    setActionLoading(true)
    try {
      // Create payable
      const { data: payable, error: payErr } = await supabase
        .from("payables")
        .insert({
          org_id: invoice.org_id,
          supplier_id: invoice.supplier_id,
          invoice_number: invoice.invoice_number,
          amount: invoice.total,
          paid: 0,
          status: "open",
          notes: `Từ hóa đơn mua ${invoice.invoice_number || invoice.id}`,
        })
        .select()
        .single()
      if (payErr) throw payErr

      // Link payable to invoice
      await supabase
        .from("purchase_invoices")
        .update({ payable_id: payable.id, status: "confirmed" })
        .eq("id", invoice.id)

      toast({ title: "Đã ghi nhận công nợ nhà cung cấp" })
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

  const handleAction = (action: string) => {
    if (action === "create_payable") {
      handleCreatePayable()
    } else {
      handleStatusChange(action as PurchaseInvoiceStatus)
    }
  }

  const handleSaveEdit = async () => {
    if (!invoice) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("purchase_invoices")
        .update({
          invoice_number: editForm.invoice_number || null,
          notes: editForm.notes || null,
        })
        .eq("id", invoice.id)
      if (error) throw error
      toast({ title: "Đã cập nhật hóa đơn" })
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

  const handleDelete = async () => {
    if (!invoice) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("purchase_invoices")
        .delete()
        .eq("id", invoice.id)
      if (error) throw error
      toast({ title: "Đã xóa hóa đơn mua hàng" })
      router.push("/purchasing/invoices")
    } catch (error) {
      toast({
        title: "Lỗi",
        description: (error as Error).message,
        variant: "destructive",
      })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!invoice)
    return (
      <div className="text-center py-12 text-muted-foreground">
        Không tìm thấy hóa đơn mua hàng
      </div>
    )

  const canEdit =
    user &&
    hasPermission(user.role, "receivables", "update") &&
    invoice.status === "draft"
  const canDelete =
    user &&
    hasPermission(user.role, "receivables", "delete") &&
    ["draft", "cancelled"].includes(invoice.status)

  // Build available actions based on status
  const actions: {
    value: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    roles: string[]
    variant?: "default" | "destructive"
  }[] = []

  if (invoice.status === "draft") {
    actions.push({
      value: "confirmed",
      label: "Xác nhận hóa đơn",
      icon: CheckCircle2,
      roles: ["owner", "manager", "accountant"],
    })
    if (!invoice.payable_id) {
      actions.push({
        value: "create_payable",
        label: "Ghi nhận công nợ NCC",
        icon: CreditCard,
        roles: ["owner", "manager", "accountant"],
      })
    }
    actions.push({
      value: "cancelled",
      label: "Hủy hóa đơn",
      icon: XCircle,
      roles: ["owner"],
      variant: "destructive",
    })
  }
  if (invoice.status === "confirmed") {
    if (!invoice.payable_id) {
      actions.push({
        value: "create_payable",
        label: "Ghi nhận công nợ NCC",
        icon: CreditCard,
        roles: ["owner", "manager", "accountant"],
      })
    }
    actions.push({
      value: "paid",
      label: "Đánh dấu đã thanh toán",
      icon: CheckCircle2,
      roles: ["owner", "accountant"],
    })
    actions.push({
      value: "cancelled",
      label: "Hủy hóa đơn",
      icon: XCircle,
      roles: ["owner"],
      variant: "destructive",
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={invoice.invoice_number || "Hóa đơn mua hàng"}
        description={`Ngày: ${formatDate(invoice.invoice_date)}`}
        backHref="/purchasing/invoices"
      >
        <StatusBadge status={invoice.status} type="purchase_invoice" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Thông tin hóa đơn</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Số hóa đơn
                </Label>
                <p className="font-mono font-bold">
                  {invoice.invoice_number || "Chưa có"}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ngày hóa đơn
                </Label>
                <p className="font-semibold">
                  {formatDate(invoice.invoice_date)}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Nhà cung cấp
                </Label>
                <p className="font-semibold">
                  {invoice.supplier?.name || "-"}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Liên kết PO
                </Label>
                {invoice.purchase_order?.po_code ? (
                  <Link
                    href={`/purchasing/orders/${invoice.po_id}`}
                    className="text-primary font-mono font-bold hover:underline block"
                  >
                    {invoice.purchase_order.po_code}
                  </Link>
                ) : (
                  <p className="text-muted-foreground">Không có</p>
                )}
              </div>
            </div>

            <div className="border-t border-border/40 pt-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Tạm tính</span>
                <span className="font-medium">
                  {formatCurrency(invoice.subtotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">VAT</span>
                <span className="font-medium">
                  {formatCurrency(invoice.vat)}
                </span>
              </div>
              <div className="flex justify-between text-lg border-t border-border/40 pt-2">
                <span className="font-bold">Tổng cộng</span>
                <span className="font-black">
                  {formatCurrency(invoice.total)}
                </span>
              </div>
            </div>

            {invoice.notes && (
              <div className="border-t border-border/40 pt-4">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú
                </Label>
                <p className="text-sm whitespace-pre-wrap mt-1">
                  {invoice.notes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Payable link */}
          {invoice.payable_id && (
            <Card>
              <CardHeader>
                <CardTitle>Công nợ NCC</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/payables/${invoice.payable_id}`}
                  className="flex items-center justify-between rounded-lg bg-surface-low p-3 hover:bg-surface-container transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-primary" />
                    <div className="text-sm">
                      <p className="font-semibold">Đã ghi nhận công nợ</p>
                      <p className="text-xs text-muted-foreground">
                        Nhấn để xem chi tiết
                      </p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Edit panel */}
          {canEdit && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Chỉnh sửa</CardTitle>
                {!editMode ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditMode(true)}
                  >
                    <Pencil className="h-4 w-4 mr-1" /> Sửa
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditMode(false)
                      setEditForm({
                        invoice_number: invoice.invoice_number || "",
                        notes: invoice.notes || "",
                      })
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </CardHeader>
              {editMode && (
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Số hóa đơn
                    </Label>
                    <Input
                      value={editForm.invoice_number}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          invoice_number: e.target.value,
                        })
                      }
                      placeholder="Nhập số hóa đơn"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Ghi chú
                    </Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm({ ...editForm, notes: e.target.value })
                      }
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={actionLoading}
                    className="w-full"
                  >
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </CardContent>
              )}
            </Card>
          )}

          {/* Actions */}
          {(actions.length > 0 || canDelete) && (
            <Card>
              <CardHeader>
                <CardTitle>Thao tác</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {actions.map((action) => {
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
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa hóa đơn
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}"?`}
        variant={
          confirmOpen?.action === "cancelled" ? "destructive" : "default"
        }
        onConfirm={() => confirmOpen && handleAction(confirmOpen.action)}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn hóa đơn mua hàng?"
        description="Hóa đơn sẽ bị xóa. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
