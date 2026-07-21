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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate, getAgingStatus } from "@/lib/utils"
import { CheckCircle2, AlertTriangle, RotateCcw, Trash2, ShieldCheck, Pencil } from "lucide-react"
import type { Payable, PayablePayment, PayableStatus } from "@/types"

const PAYABLE_STATUS_MAP: Record<PayableStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" | "outline" }> = {
  open: { label: "Chưa trả", variant: "secondary" },
  partial: { label: "Trả một phần", variant: "warning" },
  paid: { label: "Đã trả đủ", variant: "success" },
  overdue: { label: "Quá hạn", variant: "danger" },
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  offset: "Bù trừ",
}

type StatusOverride = "open" | "overdue"

export default function PayableDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const [payable, setPayable] = useState<Payable | null>(null)
  const [payments, setPayments] = useState<PayablePayment[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "transfer", notes: "" })
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ invoice_number: "", due_date: "", notes: "" })
  const [verifyTarget, setVerifyTarget] = useState<PayablePayment | null>(null)
  const [statusConfirm, setStatusConfirm] = useState<{ status: StatusOverride; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [payRes, pmtRes] = await Promise.all([
      supabase
        .from("payables")
        .select("id, invoice_number, amount, paid, due_date, status, notes, created_at, supplier:suppliers(name, code, phone, address, payment_terms)")
        .eq("id", id)
        .single(),
      supabase
        .from("payable_payments")
        .select("id, amount, method, paid_at, verified_at, notes, payer:users!payable_payments_paid_by_fkey(full_name, role), verifier:users!payable_payments_verified_by_fkey(full_name, role)")
        .eq("payable_id", id)
        .order("paid_at", { ascending: false }),
    ])
    if (payRes.data) {
      const p = payRes.data as unknown as Payable
      setPayable(p)
      setEditForm({
        invoice_number: p.invoice_number || "",
        due_date: p.due_date || "",
        notes: p.notes || "",
      })
    }
    setPayments((pmtRes.data as unknown as PayablePayment[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const recalcStatus = (rec: Payable, newPaid: number): PayableStatus => {
    if (newPaid >= rec.amount) return "paid"
    if (newPaid > 0) return "partial"
    if (rec.due_date) {
      const aging = getAgingStatus(rec.due_date)
      if (aging !== "current") return "overdue"
    }
    return "open"
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payable || !user) return
    const amt = parseFloat(paymentForm.amount)
    if (!amt || amt <= 0) {
      toast({ title: "Số tiền không hợp lệ", variant: "destructive" })
      return
    }
    const remaining = payable.amount - payable.paid
    if (amt > remaining) {
      toast({ title: "Số tiền vượt quá công nợ còn lại", description: `Còn nợ ${formatCurrency(remaining)}`, variant: "destructive" })
      return
    }
    setActionLoading(true)
    try {
      const { error: payErr } = await supabase.from("payable_payments").insert({
        payable_id: payable.id,
        paid_by: user.id,
        amount: amt,
        method: paymentForm.method,
        notes: paymentForm.notes.trim() || null,
      })
      if (payErr) throw payErr

      const newPaid = payable.paid + amt
      const newStatus = recalcStatus(payable, newPaid)
      const { error: updErr } = await supabase
        .from("payables")
        .update({ paid: newPaid, status: newStatus })
        .eq("id", payable.id)
      if (updErr) throw updErr

      toast({ title: `Đã ghi nhận thanh toán ${formatCurrency(amt)}` })
      setPaymentForm({ amount: "", method: "transfer", notes: "" })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleVerifyPayment = async () => {
    if (!verifyTarget || !user) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("payable_payments")
        .update({
          verified_by: user.id,
          verified_at: new Date().toISOString(),
        })
        .eq("id", verifyTarget.id)
      if (error) throw error
      toast({ title: "Đã xác nhận thanh toán" })
      setVerifyTarget(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!payable) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("payables")
        .update({
          invoice_number: editForm.invoice_number.trim() || null,
          due_date: editForm.due_date || null,
          notes: editForm.notes.trim() || null,
        })
        .eq("id", payable.id)
      if (error) throw error
      toast({ title: "Đã cập nhật thông tin" })
      setEditing(false)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleStatusOverride = async (newStatus: StatusOverride) => {
    if (!payable) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("payables")
        .update({ status: newStatus })
        .eq("id", payable.id)
      if (error) throw error
      toast({ title: `Đã chuyển trạng thái: ${PAYABLE_STATUS_MAP[newStatus].label}` })
      setStatusConfirm(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!payable) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("payables").delete().eq("id", payable.id)
      if (error) throw error
      toast({ title: "Đã xóa công nợ NCC" })
      router.push("/payables")
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!payable) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy công nợ</div>

  const balance = payable.amount - payable.paid
  const statusConfig = PAYABLE_STATUS_MAP[payable.status as PayableStatus] || { label: payable.status, variant: "outline" as const }

  const canRecordPayment = user && ["owner", "accountant"].includes(user.role) && payable.status !== "paid"
  const canVerify = user && ["owner", "accountant"].includes(user.role)
  const canEdit = user && ["owner", "accountant"].includes(user.role)
  const canOverrideStatus = user && ["owner", "accountant"].includes(user.role)
  const canDelete = user && user.role === "owner" && hasPermission(user.role, "receivables", "delete") && payable.paid === 0

  const overrides: { status: StatusOverride; label: string; icon: React.ComponentType<{ className?: string }>; show: boolean }[] = [
    { status: "overdue", label: "Đánh dấu quá hạn", icon: AlertTriangle, show: ["open", "partial"].includes(payable.status) },
    { status: "open", label: "Đặt lại trạng thái mở", icon: RotateCcw, show: payable.status !== "open" && payable.status !== "paid" },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${payable.supplier?.name || "NCC"} ${payable.invoice_number ? `- ${payable.invoice_number}` : ""}`}
        description={`Tạo: ${formatDate(payable.created_at)}${payable.due_date ? ` | Hạn: ${formatDate(payable.due_date)}` : ""}`}
        backHref="/payables"
      >
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - main info + payments */}
        <div className="space-y-4 lg:col-span-2">
          {/* Payable summary */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin công nợ</CardTitle>
              {canEdit && !editing && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phải trả</Label>
                  <p className="font-bold text-lg">{formatCurrency(payable.amount)}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Đã trả</Label>
                  <p className="font-bold text-lg text-tertiary">{formatCurrency(payable.paid)}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Còn lại</Label>
                  <p className="font-bold text-lg text-error">{formatCurrency(balance)}</p>
                </div>
              </div>

              {editing ? (
                <div className="border-t border-border/40 pt-3 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Mã hóa đơn</Label>
                      <Input
                        value={editForm.invoice_number}
                        onChange={(e) => setEditForm({ ...editForm, invoice_number: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hạn thanh toán</Label>
                      <Input
                        type="date"
                        value={editForm.due_date}
                        onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Ghi chú</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Hủy</Button>
                    <Button size="sm" disabled={actionLoading} onClick={handleSaveEdit}>
                      {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {payable.invoice_number && (
                    <div className="border-t border-border/40 pt-3 text-sm">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mã hóa đơn</Label>
                      <p className="font-mono font-bold">{payable.invoice_number}</p>
                    </div>
                  )}
                  {payable.notes && (
                    <div className="border-t border-border/40 pt-3 text-sm">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                      <p>{payable.notes}</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Payment history */}
          <Card>
            <CardHeader>
              <CardTitle>Lịch sử thanh toán ({payments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ngày trả</TableHead>
                      <TableHead>Người trả</TableHead>
                      <TableHead>Hình thức</TableHead>
                      <TableHead className="text-right">Số tiền</TableHead>
                      <TableHead>Ghi chú</TableHead>
                      <TableHead>Xác nhận</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => {
                      const isUnverified = !p.verified_at
                      return (
                        <TableRow
                          key={p.id}
                          className={isUnverified && canVerify ? "cursor-pointer hover:bg-muted/50" : ""}
                          onClick={() => isUnverified && canVerify && setVerifyTarget(p)}
                        >
                          <TableCell className="text-sm">{formatDate(p.paid_at)}</TableCell>
                          <TableCell>{p.payer?.full_name || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{PAYMENT_METHOD_LABEL[p.method] || p.method}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.notes || "-"}</TableCell>
                          <TableCell>
                            {p.verified_at ? (
                              <Badge variant="success">Đã xác nhận</Badge>
                            ) : canVerify ? (
                              <Badge variant="warning">Chờ xác nhận</Badge>
                            ) : (
                              <Badge variant="secondary">Chờ xác nhận</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {payments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          Chưa có thanh toán
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {payments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6 text-sm">Chưa có thanh toán</p>
                ) : (
                  payments.map((p) => {
                    const isUnverified = !p.verified_at
                    const clickable = isUnverified && canVerify
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border bg-muted/20 p-3 ${clickable ? "cursor-pointer active:scale-[0.99] transition-transform" : ""}`}
                        onClick={() => clickable && setVerifyTarget(p)}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">{formatDate(p.paid_at)}</p>
                            <p className="text-sm font-medium mt-0.5 truncate">{p.payer?.full_name || "-"}</p>
                            <Badge variant="secondary" className="mt-1">
                              {PAYMENT_METHOD_LABEL[p.method] || p.method}
                            </Badge>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-sm">{formatCurrency(p.amount)}</p>
                            <Badge
                              variant={p.verified_at ? "success" : canVerify ? "warning" : "secondary"}
                              className="mt-1"
                            >
                              {p.verified_at ? "Đã xác nhận" : "Chờ xác nhận"}
                            </Badge>
                          </div>
                        </div>
                        {p.notes && (
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{p.notes}</p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {canVerify && payments.some((p) => !p.verified_at) && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Bấm vào dòng thanh toán chưa xác nhận để xác nhận.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Record new payment */}
          {canRecordPayment && (
            <Card>
              <CardHeader>
                <CardTitle>Ghi nhận thanh toán</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRecordPayment} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Số tiền trả *</Label>
                      <Input
                        type="number"
                        min={1}
                        max={balance}
                        value={paymentForm.amount}
                        onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                        required
                        placeholder="Nhập số tiền"
                      />
                      <p className="text-xs text-muted-foreground">Còn nợ: {formatCurrency(balance)}</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Hình thức *</Label>
                      <Select
                        value={paymentForm.method}
                        onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Tiền mặt</SelectItem>
                          <SelectItem value="transfer">Chuyển khoản</SelectItem>
                          <SelectItem value="offset">Bù trừ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ghi chú</Label>
                      <Input
                        value={paymentForm.notes}
                        onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                        placeholder="Ghi chú thanh toán"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={actionLoading}>
                      {actionLoading ? "Đang lưu..." : "Ghi nhận thanh toán"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right - supplier + actions */}
        <div className="space-y-4">
          {/* Supplier */}
          <Card>
            <CardHeader><CardTitle>Nhà cung cấp</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-mono text-xs text-primary font-bold">{payable.supplier?.code}</p>
              <p className="font-bold">{payable.supplier?.name || "-"}</p>
              {payable.supplier?.phone && <p>{payable.supplier.phone}</p>}
              {payable.supplier?.address && <p className="text-muted-foreground">{payable.supplier.address}</p>}
              {payable.supplier?.payment_terms && (
                <p className="pt-2 border-t border-border/40 mt-2">
                  <span className="text-muted-foreground">Điều khoản: </span>
                  <span className="font-semibold">{payable.supplier.payment_terms}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {(canOverrideStatus || canDelete) && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {canOverrideStatus && overrides.filter((o) => o.show).map((o) => {
                  const Icon = o.icon
                  const isDestructive = o.status === "overdue"
                  return (
                    <Button
                      key={o.status}
                      variant={isDestructive ? "destructive" : "default"}
                      className="w-full justify-start"
                      onClick={() => setStatusConfirm({ status: o.status, label: o.label })}
                    >
                      <Icon className="h-4 w-4 mr-2" /> {o.label}
                    </Button>
                  )
                })}
                {payable.status === "paid" && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Công nợ đã trả đủ
                  </p>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa công nợ
                  </Button>
                )}
                {!canDelete && payable.paid > 0 && user?.role === "owner" && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    Không thể xóa công nợ đã có thanh toán
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Verify payment dialog */}
      <ConfirmDialog
        open={!!verifyTarget}
        onOpenChange={(open) => !open && setVerifyTarget(null)}
        title="Xác nhận thanh toán?"
        description={
          verifyTarget
            ? `Xác nhận đã trả ${formatCurrency(verifyTarget.amount)} (${PAYMENT_METHOD_LABEL[verifyTarget.method]}) bởi ${verifyTarget.payer?.full_name || "NV"}.`
            : ""
        }
        variant="default"
        confirmLabel="Xác nhận"
        onConfirm={handleVerifyPayment}
        loading={actionLoading}
      />

      {/* Status override dialog */}
      <ConfirmDialog
        open={!!statusConfirm}
        onOpenChange={(open) => !open && setStatusConfirm(null)}
        title={statusConfirm?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${statusConfirm?.label}" cho công nợ này`}
        variant={statusConfirm?.status === "overdue" ? "destructive" : "default"}
        onConfirm={() => statusConfirm && handleStatusOverride(statusConfirm.status)}
        loading={actionLoading}
      />

      {/* Delete dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn công nợ NCC?"
        description="Công nợ này sẽ bị xóa khỏi hệ thống. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      {/* Helper hints */}
      {!canRecordPayment && !canVerify && !canOverrideStatus && !canDelete && payable.status !== "paid" && (
        <p className="text-xs text-center text-muted-foreground">
          <ShieldCheck className="h-3 w-3 inline mr-1" />
          Bạn chưa có quyền thao tác trên công nợ này
        </p>
      )}
      {payable.status === "paid" && (
        <div className="flex items-center justify-center gap-2 text-sm text-tertiary font-semibold">
          <CheckCircle2 className="h-4 w-4" /> Công nợ đã trả đủ
        </div>
      )}
    </div>
  )
}
