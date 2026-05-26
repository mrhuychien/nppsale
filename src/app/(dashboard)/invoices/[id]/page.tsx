"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CheckCircle2, XCircle, Pencil, Trash2, X, ExternalLink, Printer, AlertCircle, FileText } from "lucide-react"
import type { Invoice, InvoiceStatus } from "@/types"

type NextStatus = {
  value: InvoiceStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

const STATUS_FLOW: Record<InvoiceStatus, NextStatus[]> = {
  draft: [
    { value: "issued", label: "Phát hành hóa đơn", icon: CheckCircle2, roles: ["owner", "manager", "accountant"] },
    { value: "cancelled", label: "Hủy hóa đơn", icon: XCircle, roles: ["owner", "manager", "accountant"] },
  ],
  issued: [
    { value: "cancelled", label: "Hủy hóa đơn", icon: XCircle, roles: ["owner"] },
  ],
  cancelled: [],
}

const statusVariant = (s: string): "default" | "success" | "danger" | "secondary" => {
  switch (s) { case "issued": return "success"; case "cancelled": return "danger"; default: return "secondary" }
}
const statusLabel = (s: string) => { switch (s) { case "issued": return "Đã phát hành"; case "cancelled": return "Đã hủy"; default: return "Nháp" } }

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("invoices")
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{ status: InvoiceStatus; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    customer_name: "",
    customer_address: "",
    customer_tax_code: "",
    subtotal: 0,
    vat: 0,
    total: 0,
  })
  const [actionLoading, setActionLoading] = useState(false)
  const [misaLoading, setMisaLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from("invoices").select("*").eq("id", id).single()
    if (data) {
      const inv = data as Invoice
      setInvoice(inv)
      setEditForm({
        customer_name: inv.customer_name || "",
        customer_address: inv.customer_address || "",
        customer_tax_code: inv.customer_tax_code || "",
        subtotal: inv.subtotal || 0,
        vat: inv.vat || 0,
        total: inv.total || 0,
      })
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleChangeStatus = async (newStatus: InvoiceStatus) => {
    if (!invoice || !user) return
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === "issued") {
        updates.issued_at = new Date().toISOString()
      }
      const { error } = await supabase.from("invoices").update(updates).eq("id", invoice.id)
      if (error) throw error
      toast({ title: `Đã chuyển trạng thái: ${statusLabel(newStatus)}` })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!invoice) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("invoices").delete().eq("id", invoice.id)
      if (error) throw error
      toast({ title: "Đã xóa hóa đơn" })
      router.push("/invoices")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!invoice) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("invoices")
        .update({
          customer_name: editForm.customer_name,
          customer_address: editForm.customer_address || null,
          customer_tax_code: editForm.customer_tax_code || null,
          subtotal: editForm.subtotal,
          vat: editForm.vat,
          total: editForm.total,
        })
        .eq("id", invoice.id)
      if (error) throw error
      toast({ title: "Đã cập nhật hóa đơn" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  // Phát hành hoá đơn điện tử qua MISA meInvoice (Layer 3 — /api/einvoice/publish).
  const handleEinvoicePublish = async (mode: "as_sold" | "box" = "as_sold") => {
    if (!invoice) return
    setMisaLoading(true)
    try {
      const res = await fetch("/api/einvoice/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Phát hành MISA thất bại")
      toast({
        title: data.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${data.inv_no ? `Số HĐ: ${data.inv_no} · ` : ""}Mã tra cứu: ${data.lookup_code || "—"}${data.sandbox ? " (sandbox)" : ""}`,
      })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setMisaLoading(false)
    }
  }

  const recalcTotal = (newSubtotal: number, newVat: number) => {
    setEditForm({ ...editForm, subtotal: newSubtotal, vat: newVat, total: newSubtotal + newVat })
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy hóa đơn</div>

  const availableTransitions = STATUS_FLOW[invoice.status] || []
  const canEdit = user && hasPermission(user.role, "invoices", "update") && invoice.status === "draft"
  const canDelete = user && user.role === "owner" && invoice.status === "draft"

  return (
    <div className="space-y-4">
      <PageHeader
        title={invoice.invoice_number || "Hóa đơn"}
        description={`Tạo: ${formatDate(invoice.created_at)}${invoice.issued_at ? ` • Phát hành: ${formatDate(invoice.issued_at)}` : ""}`}
        backHref="/invoices"
      >
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(invoice.status)}>{statusLabel(invoice.status)}</Badge>
          {(invoice.status === "draft" || invoice.status === "issued") && (
            <Link href={`/invoices/${id}/print`}>
              <Button size="sm" variant="outline">
                <Printer className="h-4 w-4 mr-1" /> Xuất hóa đơn VAT
              </Button>
            </Link>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Thông tin hóa đơn</CardTitle>
            {canEdit && !editMode && (
              <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                <Pencil className="h-4 w-4 mr-1" /> Sửa
              </Button>
            )}
            {editMode && (
              <Button size="sm" variant="ghost" onClick={() => {
                setEditMode(false)
                setEditForm({
                  customer_name: invoice.customer_name || "",
                  customer_address: invoice.customer_address || "",
                  customer_tax_code: invoice.customer_tax_code || "",
                  subtotal: invoice.subtotal || 0,
                  vat: invoice.vat || 0,
                  total: invoice.total || 0,
                })
              }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!editMode ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Số hóa đơn</Label>
                    <p className="font-mono font-bold">{invoice.invoice_number || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mã số thuế</Label>
                    <p>{invoice.customer_tax_code || <span className="text-muted-foreground">Không có</span>}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tên khách hàng</Label>
                  <p className="font-semibold">{invoice.customer_name}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Địa chỉ</Label>
                  <p className="whitespace-pre-wrap">{invoice.customer_address || <span className="text-muted-foreground">Không có</span>}</p>
                </div>
                <div className="grid gap-2 border-t border-border/40 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tạm tính:</span>
                    <span>{formatCurrency(invoice.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">VAT:</span>
                    <span>{formatCurrency(invoice.vat)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-black border-t border-border/40 pt-2">
                    <span>Tổng cộng:</span>
                    <span>{formatCurrency(invoice.total)}</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Tên khách hàng *</Label>
                    <Input
                      value={editForm.customer_name}
                      onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mã số thuế</Label>
                    <Input
                      value={editForm.customer_tax_code}
                      onChange={(e) => setEditForm({ ...editForm, customer_tax_code: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Địa chỉ</Label>
                  <Input
                    value={editForm.customer_address}
                    onChange={(e) => setEditForm({ ...editForm, customer_address: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3 border-t border-border/40 pt-4">
                  <div className="space-y-1">
                    <Label>Tạm tính</Label>
                    <Input
                      type="number"
                      value={editForm.subtotal}
                      onChange={(e) => recalcTotal(parseFloat(e.target.value) || 0, editForm.vat)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>VAT</Label>
                    <Input
                      type="number"
                      value={editForm.vat}
                      onChange={(e) => recalcTotal(editForm.subtotal, parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Tổng cộng</Label>
                    <Input type="number" value={editForm.total} disabled className="font-bold" />
                  </div>
                </div>
                <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                  {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right column - linked order + actions */}
        <div className="space-y-4">
          {/* Linked order */}
          <Card>
            <CardHeader><CardTitle>Liên kết</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {invoice.order_id ? (
                <Link
                  href={`/orders/${invoice.order_id}`}
                  className="flex items-center gap-2 text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  Xem đơn hàng gốc
                </Link>
              ) : (
                <p className="text-muted-foreground">Không liên kết với đơn hàng</p>
              )}
              <div className="pt-2 border-t border-border/40">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày tạo</Label>
                <p>{formatDate(invoice.created_at)}</p>
              </div>
              {invoice.issued_at && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày phát hành</Label>
                  <p>{formatDate(invoice.issued_at)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Hoá đơn điện tử MISA meInvoice */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Hoá đơn điện tử (MISA)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invoice.misa_status && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Trạng thái</span>
                  <Badge variant={
                    invoice.misa_status === "signed" ? "success"
                    : invoice.misa_status === "error" ? "danger"
                    : invoice.misa_status === "sent" ? "default"
                    : "warning"
                  }>
                    {invoice.misa_status === "signed" ? "Đã phát hành"
                    : invoice.misa_status === "error" ? "Lỗi"
                    : invoice.misa_status === "sent" ? "Đã gửi"
                    : "Đang xử lý"}
                  </Badge>
                </div>
              )}
              {invoice.misa_invoice_id && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Số HĐ MISA</span>
                  <span className="font-mono font-bold text-sm">{invoice.misa_invoice_id}</span>
                </div>
              )}
              {invoice.misa_lookup_code && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Mã tra cứu</span>
                  <span className="font-mono text-sm">{invoice.misa_lookup_code}</span>
                </div>
              )}
              {invoice.misa_published_at && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Phát hành lúc</span>
                  <span className="text-sm">{formatDate(invoice.misa_published_at)}</span>
                </div>
              )}
              {invoice.misa_invoice_url && (
                <a
                  href={invoice.misa_invoice_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary font-semibold hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Tra cứu hóa đơn
                </a>
              )}

              {invoice.misa_status === "error" && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{invoice.misa_error || "Lỗi không xác định"}</span>
                </div>
              )}

              {/* Nút phát hành — chỉ khi chưa có mã tra cứu */}
              {!invoice.misa_lookup_code ? (
                <div className="space-y-2 pt-1">
                  {invoice.status !== "issued" && (
                    <p className="text-[11px] text-amber-600">
                      Nên phát hành hóa đơn (chuyển sang &ldquo;Đã phát hành&rdquo;) trước khi đẩy lên MISA.
                    </p>
                  )}
                  {(user?.role === "owner" || user?.role === "accountant" || user?.role === "manager") && (
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => handleEinvoicePublish("as_sold")}
                        disabled={misaLoading}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        {misaLoading ? "Đang phát hành..." : invoice.misa_status === "error" ? "Phát hành lại lên MISA" : "Phát hành lên MISA"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => handleEinvoicePublish("box")}
                        disabled={misaLoading}
                      >
                        Phát hành theo hộp (quy đổi)
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Cần cấu hình tài khoản tại{" "}
                    <Link href="/settings/einvoice" className="text-primary hover:underline">
                      Cài đặt → Hoá đơn điện tử
                    </Link>.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Hoá đơn đã phát hành lên MISA — không phát hành lại để tránh trùng.
                </p>
              )}
            </CardContent>
          </Card>

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
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa hóa đơn
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Status change confirm */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho hóa đơn ${invoice.invoice_number || ""}`}
        variant={confirmOpen?.status === "cancelled" ? "destructive" : "default"}
        onConfirm={() => confirmOpen && handleChangeStatus(confirmOpen.status)}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn hóa đơn?"
        description={`Hóa đơn ${invoice.invoice_number || ""} sẽ bị xóa vĩnh viễn. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
