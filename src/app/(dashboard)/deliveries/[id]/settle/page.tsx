"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ensureReceivableForOrder } from "@/lib/receivables"
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Banknote,
  ArrowRightCircle,
  Receipt,
} from "lucide-react"

type SettleLine = {
  id: string
  order_id: string
  status: string
  payment_method: string | null
  amount_collected: number | null
  order: {
    id: string
    order_code: string
    total: number
    payment_terms: string | null
    customer?: { store_name?: string; phone?: string } | null
  } | null
}

function isCodTerms(terms: string | null | undefined): boolean {
  if (!terms) return true
  const t = terms.trim().toUpperCase()
  return t === "" || t === "COD" || t.startsWith("COD")
}

function generateReceiptCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(1 + Math.random() * 9999).toString().padStart(4, "0")
  return `PT-${yy}${mm}${dd}-${rand}`
}

export default function DeliverySettlePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [delivery, setDelivery] = useState<{
    id: string
    route_name: string | null
    status: string
    settled_at: string | null
    settled_amount: number | null
    driver_id: string | null
    driver?: { full_name: string } | null
  } | null>(null)
  const [lines, setLines] = useState<SettleLine[]>([])
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submittedAmount, setSubmittedAmount] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [delRes, linesRes] = await Promise.all([
      supabase
        .from("deliveries")
        .select(
          "id, route_name, status, settled_at, settled_amount, driver_id, driver:users!deliveries_driver_id_fkey(full_name)"
        )
        .eq("id", id)
        .single(),
      supabase
        .from("delivery_lines")
        .select(
          "id, order_id, status, payment_method, amount_collected, order:sales_orders(id, order_code, total, payment_terms, customer:customers(store_name, phone))"
        )
        .eq("delivery_id", id),
    ])
    const delData = (delRes.data as unknown as typeof delivery) || null
    if (delData) setDelivery(delData)
    const linesData = ((linesRes.data as unknown) as SettleLine[]) || []
    setLines(linesData)

    // A line is considered "delivered" for settlement if:
    //   - it was explicitly marked delivered, OR
    //   - the parent delivery is completed and the line was not failed
    // (the driver may finish the route in one click without per-line marks).
    const deliveryCompleted = delData?.status === "completed"
    const isDelivered = (status: string) =>
      status === "delivered" || (deliveryCompleted && status !== "failed" && status !== "cancelled")

    // Pre-fill editable amounts for delivered COD lines
    const initial: Record<string, string> = {}
    linesData.forEach((l) => {
      const cod = isCodTerms(l.order?.payment_terms)
      const delivered = isDelivered(l.status)
      if (!delivered || !cod) {
        initial[l.id] = ""
        return
      }
      const collected = Number(l.amount_collected || 0)
      initial[l.id] = collected > 0 ? String(collected) : String(l.order?.total ?? "")
    })
    setEditedAmounts(initial)
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Expected = sum of (edited amount) for delivered COD lines.
  // Same "delivered" rule as fetchData so completing a route in one click
  // still flows through to the settle screen.
  const summary = useMemo(() => {
    let expected = 0
    let codCount = 0
    let creditCount = 0
    let totalOrderValue = 0
    let creditValue = 0
    let deliveredCount = 0
    const deliveryCompleted = delivery?.status === "completed"
    const isDelivered = (status: string) =>
      status === "delivered" || (deliveryCompleted && status !== "failed" && status !== "cancelled")
    const rows = lines.map((l) => {
      const o = l.order
      const orderTotal = Number(o?.total || 0)
      const cod = isCodTerms(o?.payment_terms)
      const delivered = isDelivered(l.status)
      const editedRaw = editedAmounts[l.id] ?? ""
      const editedNum = parseFloat(editedRaw || "0") || 0
      const expectedForLine = delivered && cod ? editedNum : 0
      if (delivered) {
        deliveredCount += 1
        totalOrderValue += orderTotal
      }
      if (delivered && cod) {
        expected += expectedForLine
        codCount += 1
      }
      if (delivered && !cod) {
        creditCount += 1
        creditValue += orderTotal
      }
      return { ...l, cod, delivered, editedAmount: editedNum, expectedForLine, orderTotal }
    })
    return {
      expected,
      codCount,
      creditCount,
      creditValue,
      totalOrderValue,
      deliveredCount,
      rows,
    }
  }, [lines, editedAmounts, delivery?.status])

  const submittedNum = parseFloat(submittedAmount || "0") || 0
  const diff = submittedNum - summary.expected
  const isMatch = Math.abs(diff) < 1
  const isShort = diff < -0.5

  const alreadySettled = !!delivery?.settled_at

  const setLineAmount = (lineId: string, value: string) => {
    setEditedAmounts((prev) => ({ ...prev, [lineId]: value }))
  }

  const handleSettle = async () => {
    if (!delivery || !user) return
    if (alreadySettled) return
    setSubmitting(true)
    try {
      // 0 COD orders → just mark the delivery settled, no cash receipt
      if (summary.codCount === 0) {
        await supabase
          .from("deliveries")
          .update({
            settled_at: new Date().toISOString(),
            settled_amount: 0,
          })
          .eq("id", delivery.id)
        toast({
          title: "Đã hoàn tất chuyến",
          description: "Chuyến chỉ có đơn công nợ — không cần lập phiếu thu.",
        })
        router.push(`/deliveries/${delivery.id}`)
        return
      }

      // Persist edited amount_collected back to delivery_lines first
      for (const r of summary.rows) {
        if (!r.delivered || !r.cod) continue
        const newAmt = r.editedAmount
        if (Number(r.amount_collected || 0) !== newAmt) {
          await supabase
            .from("delivery_lines")
            .update({ amount_collected: newAmt })
            .eq("id", r.id)
        }
      }

      // Create cash receipt header
      const receiptCode = generateReceiptCode()
      const { data: receipt, error: receiptErr } = await supabase
        .from("cash_receipts")
        .insert({
          org_id: user.org_id,
          receipt_code: receiptCode,
          source_type: "delivery_settle",
          source_id: delivery.id,
          collected_by: delivery.driver_id || null,
          submitted_amount: submittedNum,
          expected_amount: summary.expected,
          notes: notes.trim() || null,
          status: "pending",
          created_by: user.id,
        })
        .select("id")
        .single()
      if (receiptErr || !receipt) throw receiptErr || new Error("Không tạo được phiếu thu")

      const receiptLineRows: Array<{
        receipt_id: string
        order_id: string
        receivable_id: string | null
        payment_id: string | null
        amount: number
        notes: string | null
      }> = []

      // For each delivered COD line: ensure receivable, create payment, update receivable, queue receipt line
      for (const r of summary.rows) {
        if (!r.delivered || !r.cod || !r.order) continue
        const amountForLine = r.editedAmount
        if (amountForLine <= 0) continue

        await ensureReceivableForOrder(supabase, r.order.id)
        const { data: rec } = await supabase
          .from("receivables")
          .select("id, amount, paid")
          .eq("order_id", r.order.id)
          .maybeSingle()
        if (!rec) continue

        const newPaid = Number(rec.paid || 0) + amountForLine
        const recAmount = Number(rec.amount || 0)
        const status =
          newPaid >= recAmount ? "paid" : newPaid > 0 ? "partial" : "open"
        const method =
          r.payment_method === "cod_transfer" ? "transfer" : "cash"

        const { data: payment } = await supabase
          .from("payments")
          .insert({
            receivable_id: rec.id,
            collected_by: user.id,
            amount: amountForLine,
            method,
            collected_at: new Date().toISOString(),
            verified_at: null,
          })
          .select("id")
          .single()

        await supabase
          .from("receivables")
          .update({ paid: newPaid, status })
          .eq("id", rec.id)

        receiptLineRows.push({
          receipt_id: receipt.id,
          order_id: r.order.id,
          receivable_id: rec.id,
          payment_id: payment?.id || null,
          amount: amountForLine,
          notes: null,
        })
      }

      if (receiptLineRows.length > 0) {
        await supabase.from("cash_receipt_lines").insert(receiptLineRows)
      }

      // Mark delivery as settled
      await supabase
        .from("deliveries")
        .update({
          settled_at: new Date().toISOString(),
          settled_amount: submittedNum,
        })
        .eq("id", delivery.id)

      toast({
        title: "Đã quyết toán",
        description: isMatch
          ? `Đã lập phiếu thu ${receiptCode}. Số tiền khớp.`
          : isShort
            ? `Đã lập phiếu thu ${receiptCode}. Thiếu ${formatCurrency(Math.abs(diff))}.`
            : `Đã lập phiếu thu ${receiptCode}. Dư ${formatCurrency(diff)}.`,
      })
      router.push(`/finance/cash-receipts/${receipt.id}`)
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) {
    return <div className="text-center py-12 text-muted-foreground">Không tìm thấy chuyến giao</div>
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quyết toán chuyến giao"
        description={`${delivery.route_name || "Chuyến giao"} • Lái xe: ${delivery.driver?.full_name || "-"}`}
        backHref={`/deliveries/${delivery.id}`}
      >
        {alreadySettled ? (
          <Badge variant="success">Đã quyết toán</Badge>
        ) : (
          <Badge variant="warning">Chờ trả tiền</Badge>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: orders list with editable đã thu */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Danh sách đơn ({summary.rows.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Có thể chỉnh sửa số tiền đã thu của từng đơn COD trước khi quyết toán. Đơn công nợ chỉ ghi nhận giao thành công.
            </p>
          </CardHeader>
          <CardContent>
            {summary.rows.length === 0 ? (
              <EmptyState
                title="Chưa có đơn"
                description="Chuyến giao này chưa có đơn hàng nào."
              />
            ) : (
              <div className="space-y-2">
                {summary.rows.map((r) => {
                  const o = r.order
                  const editable = !alreadySettled && r.delivered && r.cod
                  const lineDiff = r.editedAmount - r.orderTotal
                  return (
                    <div
                      key={r.id}
                      className={`rounded-xl border p-3 ${
                        !r.delivered ? "opacity-60" : ""
                      } ${
                        r.cod && r.delivered
                          ? "border-emerald-300 bg-emerald-50/40"
                          : "bg-muted/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <Link
                              href={`/orders/${o?.id || ""}`}
                              className="font-mono text-xs font-bold text-primary hover:underline"
                            >
                              {o?.order_code}
                            </Link>
                            {r.cod ? (
                              <Badge variant="success" className="text-[10px]">COD</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                {o?.payment_terms || "Công nợ"}
                              </Badge>
                            )}
                            {!r.delivered && (
                              <Badge variant="outline" className="text-[10px]">
                                {r.status === "failed" ? "Thất bại" : "Chưa giao"}
                              </Badge>
                            )}
                          </div>
                          <p className="font-medium text-sm truncate">
                            {o?.customer?.store_name || "-"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {o?.customer?.phone || ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Tiền đơn
                          </p>
                          <p className="text-sm font-bold">{formatCurrency(r.orderTotal)}</p>
                        </div>
                      </div>

                      {editable && (
                        <div className="flex items-center gap-2 mt-2">
                          <Label className="text-xs text-muted-foreground shrink-0">
                            Đã thu
                          </Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            className="h-9"
                            value={editedAmounts[r.id] ?? ""}
                            onChange={(e) => setLineAmount(r.id, e.target.value)}
                            disabled={submitting}
                          />
                          {lineDiff !== 0 && (
                            <span
                              className={`text-[11px] font-semibold whitespace-nowrap ${
                                lineDiff < 0 ? "text-rose-700" : "text-amber-700"
                              }`}
                            >
                              {lineDiff < 0 ? "Thiếu " : "Dư "}
                              {formatCurrency(Math.abs(lineDiff))}
                            </span>
                          )}
                        </div>
                      )}
                      {!editable && r.delivered && r.cod && (
                        <p className="text-xs mt-1">
                          Đã thu:{" "}
                          <span className="font-semibold">
                            {formatCurrency(Number(r.amount_collected || 0))}
                          </span>
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: settle box */}
        <div className="space-y-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-5 w-5 text-primary" />
                Nộp tiền
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-white/60 p-2.5 border">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Đã giao
                  </p>
                  <p className="text-xl font-black mt-0.5">{summary.deliveredCount}</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2.5 border">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Đơn COD
                  </p>
                  <p className="text-xl font-black mt-0.5">{summary.codCount}</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2.5 border">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Công nợ
                  </p>
                  <p className="text-xl font-black mt-0.5">{summary.creditCount}</p>
                </div>
              </div>

              <div className="rounded-lg bg-white/60 p-3 border">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Tổng giá trị đơn (đã giao)
                </p>
                <p className="text-lg font-bold mt-0.5">
                  {formatCurrency(summary.totalOrderValue)}
                </p>
                {summary.creditCount > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Trong đó công nợ: {formatCurrency(summary.creditValue)}
                  </p>
                )}
              </div>

              <div className="rounded-lg bg-white/60 p-3 border">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Tổng cần nộp (đơn COD)
                </p>
                <p className="text-2xl font-black mt-1 text-primary">
                  {formatCurrency(summary.expected)}
                </p>
              </div>

              {summary.codCount > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="submitted" className="text-xs uppercase tracking-wider text-muted-foreground">
                    <Banknote className="h-3 w-3 inline mr-1" />
                    Số tiền tài xế nộp
                  </Label>
                  <Input
                    id="submitted"
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    className="h-12 text-lg font-bold"
                    value={
                      alreadySettled
                        ? String(delivery.settled_amount || 0)
                        : submittedAmount
                    }
                    onChange={(e) => setSubmittedAmount(e.target.value)}
                    disabled={alreadySettled || submitting}
                  />
                </div>
              )}

              {!alreadySettled && summary.codCount === 0 && summary.creditCount > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3 text-xs">
                  Chuyến này chỉ có đơn công nợ — không cần nộp tiền mặt. Bạn có thể bấm <span className="font-semibold">Hoàn tất chuyến</span> để đánh dấu đã quyết toán.
                </div>
              )}

              {!alreadySettled && (
                <div className="space-y-1.5">
                  <Label htmlFor="notes" className="text-xs uppercase tracking-wider text-muted-foreground">
                    Ghi chú
                  </Label>
                  <Input
                    id="notes"
                    placeholder="vd: Tài xế nộp thiếu 50k vì khách thanh toán chuyển khoản"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              )}

              {!alreadySettled && submittedAmount !== "" && (
                <div
                  className={`rounded-lg p-3 border text-sm ${
                    isMatch
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : isShort
                        ? "bg-rose-50 border-rose-300 text-rose-800"
                        : "bg-amber-50 border-amber-300 text-amber-800"
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {isMatch ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Khớp
                      </>
                    ) : isShort ? (
                      <>
                        <AlertTriangle className="h-4 w-4" />
                        Thiếu {formatCurrency(Math.abs(diff))}
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4" />
                        Dư {formatCurrency(diff)}
                      </>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 opacity-80">
                    Số nộp {formatCurrency(submittedNum)} vs cần {formatCurrency(summary.expected)}
                  </p>
                </div>
              )}

              {alreadySettled ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    Đã quyết toán {formatDate(delivery.settled_at!)}
                  </div>
                </div>
              ) : summary.codCount === 0 ? (
                <Button
                  className="w-full h-11"
                  onClick={handleSettle}
                  disabled={submitting || summary.deliveredCount === 0}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {submitting ? "Đang xử lý..." : "Hoàn tất chuyến"}
                </Button>
              ) : (
                <Button
                  className="w-full h-11"
                  onClick={handleSettle}
                  disabled={submitting || submittedAmount === ""}
                >
                  <ArrowRightCircle className="h-4 w-4 mr-2" />
                  {submitting ? "Đang xử lý..." : "Lập phiếu thu"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
