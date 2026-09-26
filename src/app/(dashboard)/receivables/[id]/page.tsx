"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "@/components/ui/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { CheckCircle2, AlertTriangle, RotateCcw, Trash2, ShieldCheck } from "lucide-react"
import type { Receivable, Payment, ReceivableStatus } from "@/types"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { createCashReceipt } from "@/lib/finance/cash-receipt"

const RECEIVABLE_STATUS_MAP: Record<ReceivableStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" | "outline" }> = {
  open: { label: "Chưa thu", variant: "secondary" },
  partial: { label: "Thu một phần", variant: "warning" },
  paid: { label: "Đã thu đủ", variant: "success" },
  overdue: { label: "Quá hạn", variant: "danger" },
}

type StatusOverride = "open" | "overdue"

export default function ReceivableDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivable, setReceivable] = useState<Receivable | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "cash" })
  const [verifyTarget, setVerifyTarget] = useState<Payment | null>(null)
  const [statusConfirm, setStatusConfirm] = useState<{ status: StatusOverride; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [recRes, payRes] = await Promise.all([
      supabase
        .from("receivables")
        .select("id, org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status, opening_balance, created_at, invoice_id, customer:customers(*), sales_user:users!receivables_sales_user_id_fkey(*), order:sales_orders(order_code, total), invoice:sales_invoices(id, invoice_code, invoice_date)")
        .eq("id", id)
        .single(),
      supabase
        .from("payments")
        .select("id, receivable_id, collected_by, amount, method, collected_at, verified_by, verified_at, collector:users!payments_collected_by_fkey(full_name, role), verifier:users!payments_verified_by_fkey(full_name, role)")
        .eq("receivable_id", id)
        .order("collected_at", { ascending: false }),
    ])
    const qErr = ([recRes, payRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[receivables/id] truy vấn lỗi:", qErr.message)
    if (recRes.data) setReceivable(recRes.data as unknown as Receivable)
    setPayments((payRes.data as unknown as Payment[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  /*
   * ⚠ BỎ `recalcStatus`. Trạng thái công nợ nay do `create_cash_receipt`
   *   quyết trong cùng giao dịch với số tiền. Giữ một bản tính song song
   *   ở trình duyệt là dựng sẵn chỗ cho hai luật lệch nhau, mà bên lệch
   *   sẽ là bên người dùng nhìn thấy.
   */

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!receivable || !user) return
    const amt = parseInt(paymentForm.amount)
    if (!amt || amt <= 0) {
      toast({ title: "Số tiền không hợp lệ", variant: "destructive" })
      return
    }
    const remaining = receivable.amount - receivable.paid
    if (amt > remaining) {
      toast({ title: "Số tiền vượt quá công nợ còn lại", description: `Còn nợ ${formatCurrency(remaining)}`, variant: "destructive" })
      return
    }
    setActionLoading(true)
    try {
      /**
       * ⚠ LẬP PHIẾU THU QUA RPC, KHÔNG GHI THẲNG HAI BẢNG — xem chú
       *   thích dài ở `/receivables/collect`. Tóm tắt: chính sách cho
       *   `sales`/`driver` CHÈN `payments` nhưng chỉ cho
       *   `owner`/`accountant` SỬA `receivables`, mà RLS từ chối là LỌC
       *   chứ không ném. Đã đo: NVBH ghi phiếu thu được, trừ công nợ ra
       *   0 dòng không lỗi, màn hình báo "Đã ghi nhận thanh toán" và
       *   khách vẫn nợ nguyên số vừa trả.
       *
       * `create_cash_receipt` làm cả hai việc trong MỘT giao dịch và
       * chặn thu vượt số còn nợ.
       */
      await createCashReceipt(supabase, {
        customer_id: receivable.customer_id,
        method: paymentForm.method,
        lines: [{ receivable_id: receivable.id, amount: amt }],
      })

      toast({ title: `Đã ghi nhận thanh toán ${formatCurrency(amt)}` })
      setPaymentForm({ amount: "", method: "cash" })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleVerifyPayment = async () => {
    if (!verifyTarget || !user) return
    setActionLoading(true)
    try {
      await ghiPhaiTrungDong(
        supabase
          .from("payments")
          .update({
            verified_by: user.id,
            verified_at: new Date().toISOString(),
          })
          .eq("id", verifyTarget.id)
      )
      toast({ title: "Đã xác nhận thanh toán" })
      setVerifyTarget(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleStatusOverride = async (newStatus: StatusOverride) => {
    if (!receivable) return
    setActionLoading(true)
    try {
      await ghiPhaiTrungDong(
        supabase
          .from("receivables")
          .update({ status: newStatus })
          .eq("id", receivable.id)
      )
      toast({ title: `Đã chuyển trạng thái: ${RECEIVABLE_STATUS_MAP[newStatus].label}` })
      setStatusConfirm(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!receivable) return
    setActionLoading(true)
    try {
      await ghiPhaiTrungDong(supabase.from("receivables").delete().eq("id", receivable.id))
      toast({ title: "Đã xóa công nợ" })
      router.push("/receivables")
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!receivable) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy công nợ</div>

  const balance = receivable.amount - receivable.paid
  /**
   * Số dư ÂM = đã thu nhiều hơn số phải thu.
   *
   * Xảy ra thật: thu dư, hoặc giảm trừ (hàng trả lại làm `amount` giảm
   * xuống dưới số đã thu). Bốn trạng thái trong enum không có chỗ nào cho
   * tình huống này, nên dòng đó hiện "Đã thu đủ" hoặc "Chưa thu" trong khi
   * thực tế là CÔNG TY ĐANG NỢ LẠI KHÁCH. Đã đọc mã: không có nhánh nào xử
   * lý số âm ở đây (`balance` chỉ dùng để hiển thị).
   * Không thêm trạng thái mới vào enum (phải đổi CHECK constraint và mọi
   * chỗ đọc) — chỉ nói rõ ra để kế toán biết mà xử.
   */
  const isOverpaid = balance < 0
  const statusConfig = isOverpaid
    ? { label: "Thu dư — cần xử lý", variant: "warning" as const }
    : RECEIVABLE_STATUS_MAP[receivable.status] || { label: receivable.status, variant: "outline" as const }

  const canRecordPayment = user && ["owner", "accountant", "sales", "driver"].includes(user.role) && receivable.status !== "paid"
  const canVerify = user && ["owner", "accountant"].includes(user.role)
  const canOverrideStatus = user && ["owner", "accountant"].includes(user.role)
  /**
   * ⚠ GÀI ĐÚNG THEO CHÍNH SÁCH DATABASE, KHÔNG RỘNG HƠN. Chính sách
   *   `Accountant can delete opening receivables` (mig 102) chỉ cho xoá
   *   công nợ `opening_balance` — số dư đầu kỳ NHẬP TAY từ sổ cũ. Công
   *   nợ sinh từ hóa đơn thì không xoá được, và đó là ĐÚNG: xoá nó là
   *   hóa đơn còn đó mà khoản phải thu biến mất.
   *
   * ⚠ CHỦ NHÀ BÁO KIỂU KHÁC: màn hình mời bấm, database từ chối, app
   *   báo "Đã xóa công nợ" rồi đẩy về danh sách — công nợ vẫn nằm đó.
   *   Đã đo trên Postgres 16, đăng nhập bằng chủ NPP, công nợ thường:
   *     DELETE trả về 0 dòng, KHÔNG ném lỗi · công nợ còn trong sổ? 1
   *   RLS từ chối là LỌC chứ không ném. Hai chỗ cùng phải sửa: nút này
   *   đừng mời, và `handleDelete` đừng tin vào sự im lặng.
   */
  const laSoDuDauKy = receivable.opening_balance === true
  const canDelete =
    user &&
    user.role === "owner" &&
    hasPermission(user.role, "receivables", "delete") &&
    receivable.paid === 0 &&
    laSoDuDauKy

  // Available status overrides
  const overrides: { status: StatusOverride; label: string; icon: React.ComponentType<{ className?: string }>; show: boolean }[] = [
    { status: "overdue", label: "Đánh dấu quá hạn", icon: AlertTriangle, show: ["open", "partial"].includes(receivable.status) },
    // ⚠ Đã thu / đã trả một phần thì "mở" là sai: trạng thái phải là
    //   `partial`. Chỉ cho đặt lại khi chưa có đồng nào (paid = 0).
    { status: "open", label: "Đặt lại trạng thái mở", icon: RotateCcw, show: receivable.status !== "open" && receivable.status !== "paid" && Number(receivable.paid || 0) === 0 },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Công nợ #${receivable.id.slice(0, 8)}`}
        description={`Tạo: ${formatDate(receivable.created_at)}${receivable.due_date ? ` • Hạn: ${formatDate(receivable.due_date)}` : ""}${receivable.invoice?.invoice_code ? ` • Hóa đơn: ${receivable.invoice.invoice_code}` : receivable.order?.order_code ? ` • Đơn: ${receivable.order.order_code}` : ""}`}
        backHref="/receivables"
      >
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </PageHeader>

      {isOverpaid && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Đã thu {formatCurrency(receivable.paid)} trên khoản phải thu{" "}
            {formatCurrency(receivable.amount)} — thu dư{" "}
            {formatCurrency(Math.abs(balance))}.
          </p>
          <p className="mt-1 text-[13px]">
            Thường do thu dư tiền, hoặc hàng trả lại làm giảm khoản phải thu
            sau khi đã thu. Hệ thống chưa có đường xử lý tự động: cần hoàn trả
            khách hoặc cấn trừ sang đơn sau, rồi sửa lại số ở đây.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - main info + payments */}
        <div className="space-y-4 lg:col-span-2">
          {/* Receivable summary */}
          <Card>
            <CardHeader>
              <CardTitle>Thông tin công nợ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phải thu</Label>
                  <p className="font-bold text-lg">{formatCurrency(receivable.amount)}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Đã thu</Label>
                  <p className="font-bold text-lg text-tertiary">{formatCurrency(receivable.paid)}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Còn lại</Label>
                  <p className="font-bold text-lg text-error">{formatCurrency(balance)}</p>
                </div>
              </div>
              {/* ⚠ Công nợ tính theo HÓA ĐƠN (chủ nhà 24/09/2026) — chứng từ gốc là hóa đơn. */}
              {receivable.invoice?.invoice_code && (
                <div className="border-t border-border/40 pt-3 text-sm">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hóa đơn</Label>
                  <p>
                    <Link href={`/sales-invoices/${receivable.invoice_id}`} className="font-mono text-primary font-bold hover:underline">
                      {receivable.invoice.invoice_code}
                    </Link>
                    {receivable.order?.order_code && (
                      <span className="ml-2 text-muted-foreground">· từ đơn {receivable.order.order_code}</span>
                    )}
                  </p>
                </div>
              )}
              {!receivable.invoice?.invoice_code && receivable.order?.order_code && (
                <div className="border-t border-border/40 pt-3 text-sm">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Đơn hàng</Label>
                  <p>
                    <Link href={`/orders/${receivable.order_id}`} className="font-mono text-primary font-bold hover:underline">
                      {receivable.order.order_code}
                    </Link>
                  </p>
                </div>
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
                      <TableHead>Ngày thu</TableHead>
                      <TableHead>Người thu</TableHead>
                      <TableHead>Hình thức</TableHead>
                      <TableHead className="text-right">Số tiền</TableHead>
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
                          <TableCell className="text-sm">{formatDate(p.collected_at)}</TableCell>
                          <TableCell>{p.collector?.full_name || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{PAYMENT_METHOD_LABEL[p.method] || p.method}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                          <TableCell>
                            {p.verified_at ? (
                              <Badge variant="success">
                                Đã xác nhận
                              </Badge>
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
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
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
                            <p className="text-xs text-muted-foreground">{formatDate(p.collected_at)}</p>
                            <p className="text-sm font-medium mt-0.5 truncate">{p.collector?.full_name || "-"}</p>
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
                <CardTitle>Ghi nhận thanh toán mới</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRecordPayment} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Số tiền thu *</Label>
                      <MoneyInput
                        value={paymentForm.amount}
                        onChange={(n) => setPaymentForm({ ...paymentForm, amount: n > 0 ? String(n) : "" })}
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
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

        {/* Right - customer + actions */}
        <div className="space-y-4">
          {/* Customer */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{receivable.customer?.store_name || "-"}</p>
              <p className="text-muted-foreground">{receivable.customer?.owner_name}</p>
              <p>{receivable.customer?.phone}</p>
              <p className="text-muted-foreground">{receivable.customer?.address}</p>
              {receivable.sales_user && (
                <p className="pt-2 border-t border-border/40 mt-2">
                  <span className="text-muted-foreground">NV phụ trách: </span>
                  <span className="font-semibold">{receivable.sales_user.full_name}</span>
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
                {receivable.status === "paid" && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Công nợ đã thu đủ
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
                {/* ⚠ NÓI RA LÝ DO, VÀ CHỈ ĐƯỜNG. Ẩn nút mà im lặng thì chủ
                    NPP đi tìm nút Xoá không thấy và không biết vì sao. */}
                {!canDelete && user?.role === "owner" && receivable.paid > 0 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    Không thể xóa công nợ đã có thanh toán
                  </p>
                )}
                {!canDelete && user?.role === "owner" && receivable.paid === 0 && !laSoDuDauKy && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    Công nợ này sinh từ hóa đơn nên không xoá rời được — huỷ tờ hóa đơn
                    ấy thì công nợ tự mất theo. Chỉ số dư đầu kỳ nhập tay mới xoá được.
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
            ? `Xác nhận đã nhận ${formatCurrency(verifyTarget.amount)} (${PAYMENT_METHOD_LABEL[verifyTarget.method]}) từ ${verifyTarget.collector?.full_name || "NV"}.`
            : ""
        }
        variant="default"
        confirmLabel="Xác nhận đã nhận"
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
        title="Xóa vĩnh viễn công nợ?"
        description="Công nợ này sẽ bị xóa khỏi hệ thống. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      {/* Helper hint when no actions available */}
      {!canRecordPayment && !canVerify && !canOverrideStatus && !canDelete && receivable.status !== "paid" && (
        <p className="text-xs text-center text-muted-foreground">
          <ShieldCheck className="h-3 w-3 inline mr-1" />
          Bạn chưa có quyền thao tác trên công nợ này
        </p>
      )}
      {/* Quick visual when paid */}
      {receivable.status === "paid" && (
        <div className="flex items-center justify-center gap-2 text-sm text-tertiary font-semibold">
          <CheckCircle2 className="h-4 w-4" /> Công nợ đã thu đủ
        </div>
      )}
    </div>
  )
}
