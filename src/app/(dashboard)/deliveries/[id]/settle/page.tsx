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
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ensureReceivableForOrder } from "@/lib/receivables"
import { useWorkflowSession } from "@/hooks/use-workflow-session"
import { PaymentReceiptTT200 } from "@/components/printing/payment-receipt-tt200"
import {
  Wallet, CheckCircle2, AlertTriangle, Banknote, Printer, ArrowRight,
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
    status: string
    customer?: { store_name?: string; phone?: string } | null
  } | null
}

function generateReceiptCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(1 + Math.random() * 9999).toString().padStart(4, "0")
  return `PT-${yy}${mm}${dd}-${rand}`
}

interface SavedReceipt {
  id: string
  code: string
  amount: number
  date: Date
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
  const [notes, setNotes] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [orgName, setOrgName] = useState<string>("")
  const [saved, setSaved] = useState<SavedReceipt | null>(null)

  const [loading, setLoading] = useState(true)

  const { saveDraft, closeSession } = useWorkflowSession({
    entityType: "delivery",
    entityId: id,
    stage: "collecting_payment",
    lastUrl: `/deliveries/${id}/settle`,
    entityLabel: delivery?.route_name
      ? `Chuyến giao ${delivery.route_name}`
      : undefined,
    enabled: !!id && !!user && delivery?.status !== "settled",
  })

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
          "id, order_id, status, payment_method, amount_collected, order:sales_orders(id, order_code, total, payment_terms, status, customer:customers(store_name, phone))"
        )
        .eq("delivery_id", id),
    ])

    if (delRes.data) {
      setDelivery(delRes.data as unknown as typeof delivery)
    }
    const rawLines = ((linesRes.data as unknown as SettleLine[]) || [])
      // Spec: đơn giao thất bại / huỷ → không vào danh sách thu tiền.
      .filter(
        (l) =>
          l.status !== "failed" &&
          l.status !== "pending" &&
          l.order?.status !== "cancelled"
      )
    setLines(rawLines)

    // Default amount = amount_collected (if set) or order.total
    const initial: Record<string, string> = {}
    for (const l of rawLines) {
      const collected = Number(l.amount_collected || 0)
      const orderTotal = Number(l.order?.total || 0)
      initial[l.id] = String(collected > 0 ? collected : orderTotal)
    }
    setEditedAmounts(initial)

    if (user?.org_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", user.org_id)
        .maybeSingle()
      setOrgName(((org as { name: string } | null)?.name) || "")
    }
    setLoading(false)
  }, [id, user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-save draft to workflow_session
  useEffect(() => {
    if (loading) return
    saveDraft({ editedAmounts, notes })
  }, [editedAmounts, notes, loading, saveDraft])

  const summary = useMemo(() => {
    let totalExpected = 0
    let totalCollected = 0
    for (const l of lines) {
      const orderTotal = Number(l.order?.total || 0)
      const collected = Number(parseFloat(editedAmounts[l.id] || "0")) || 0
      totalExpected += orderTotal
      totalCollected += Math.max(0, collected)
    }
    return { totalExpected, totalCollected, count: lines.length }
  }, [lines, editedAmounts])

  const setLineAmount = (lineId: string, value: string) => {
    setEditedAmounts((prev) => ({ ...prev, [lineId]: value }))
  }

  const setLineToOrderTotal = (line: SettleLine) => {
    setLineAmount(line.id, String(Number(line.order?.total || 0)))
  }

  const setLineToZero = (line: SettleLine) => {
    setLineAmount(line.id, "0")
  }

  const alreadySettled = !!delivery?.settled_at
  const hasNothingToCollect = !alreadySettled && lines.length === 0

  const printTT200 = (delay = 50) => {
    const html = document.documentElement
    html.setAttribute("data-print-mode", "receipt-tt200")
    setTimeout(() => {
      requestAnimationFrame(() => {
        window.print()
        setTimeout(() => {
          html.removeAttribute("data-print-mode")
        }, 200)
      })
    }, delay)
  }

  const finalize = async ({ withPrint }: { withPrint: boolean }) => {
    if (!delivery || !user) return
    if (alreadySettled) return
    setSubmitting(true)
    try {
      // Case 1: tất cả đơn thất bại / chuyến rỗng → phiếu thu = 0,
      // chỉ stamp settled_at, không tạo cash_receipts.
      if (lines.length === 0) {
        await supabase
          .from("deliveries")
          .update({ settled_at: new Date().toISOString(), settled_amount: 0 })
          .eq("id", delivery.id)
        toast({
          title: "Đã hoàn tất chuyến",
          description: "Tất cả đơn giao thất bại — không có tiền cần thu.",
        })
        await closeSession()
        router.push("/orders")
        return
      }

      // Case 2: có ít nhất 1 đơn delivered → tạo phiếu thu (có thể $0
      // nếu user nhập 0 hết).

      // 1) Persist edited amount_collected back to delivery_lines
      for (const l of lines) {
        const newAmt = Math.max(0, Number(parseFloat(editedAmounts[l.id] || "0")) || 0)
        if (Number(l.amount_collected || 0) !== newAmt) {
          await supabase
            .from("delivery_lines")
            .update({ amount_collected: newAmt })
            .eq("id", l.id)
        }
      }

      // 2) Create receipt header
      const receiptCode = generateReceiptCode()
      const submittedTotal = summary.totalCollected
      const { data: receipt, error: receiptErr } = await supabase
        .from("cash_receipts")
        .insert({
          org_id: user.org_id,
          receipt_code: receiptCode,
          source_type: "delivery_settle",
          source_id: delivery.id,
          collected_by: delivery.driver_id || null,
          submitted_amount: submittedTotal,
          expected_amount: summary.totalExpected,
          notes: notes.trim() || null,
          status: "received",
          received_by: user.id,
          received_at: new Date().toISOString(),
          created_by: user.id,
        })
        .select("id")
        .single()
      if (receiptErr || !receipt) {
        throw receiptErr || new Error("Không tạo được phiếu thu")
      }
      const receiptId = (receipt as { id: string }).id

      // 3) For each line: ensure receivable, create payment if amount > 0,
      //    update receivable, queue receipt line.
      const receiptLineRows: Array<{
        receipt_id: string
        order_id: string
        receivable_id: string | null
        payment_id: string | null
        amount: number
        notes: string | null
      }> = []
      for (const l of lines) {
        if (!l.order) continue
        const amt = Math.max(0, Number(parseFloat(editedAmounts[l.id] || "0")) || 0)
        if (amt <= 0) continue

        await ensureReceivableForOrder(supabase, l.order.id)
        const { data: rec } = await supabase
          .from("receivables")
          .select("id, amount, paid")
          .eq("order_id", l.order.id)
          .maybeSingle()
        if (!rec) continue
        const r = rec as { id: string; amount: number | null; paid: number | null }

        const newPaid = Number(r.paid || 0) + amt
        const recAmount = Number(r.amount || 0)
        const status =
          newPaid >= recAmount ? "paid" : newPaid > 0 ? "partial" : "open"
        const method = l.payment_method === "cod_transfer" ? "transfer" : "cash"

        const { data: payment } = await supabase
          .from("payments")
          .insert({
            receivable_id: r.id,
            collected_by: user.id,
            amount: amt,
            method,
            collected_at: new Date().toISOString(),
            verified_at: new Date().toISOString(),
            verified_by: user.id,
          })
          .select("id")
          .single()

        await supabase
          .from("receivables")
          .update({ paid: newPaid, status })
          .eq("id", r.id)

        receiptLineRows.push({
          receipt_id: receiptId,
          order_id: l.order.id,
          receivable_id: r.id,
          payment_id: (payment as { id: string } | null)?.id || null,
          amount: amt,
          notes: null,
        })
      }
      if (receiptLineRows.length > 0) {
        await supabase.from("cash_receipt_lines").insert(receiptLineRows)
      }

      // 4) Mark delivery as settled
      await supabase
        .from("deliveries")
        .update({
          settled_at: new Date().toISOString(),
          settled_amount: submittedTotal,
        })
        .eq("id", delivery.id)

      await closeSession()

      const savedRow: SavedReceipt = {
        id: receiptId,
        code: receiptCode,
        amount: submittedTotal,
        date: new Date(),
      }
      setSaved(savedRow)

      toast({
        title: "Đã lập phiếu thu",
        description: `${receiptCode} • ${formatCurrency(submittedTotal)}`,
      })

      if (withPrint) {
        // Render TT200 first (state set above). After short delay → print.
        // Sau khi print dialog đóng → redirect /orders.
        printTT200(120)
        setTimeout(() => {
          router.push("/orders")
        }, 1500)
      } else {
        router.push("/orders")
      }
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const reprint = () => {
    if (!saved) return
    printTT200(0)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy chuyến giao" backHref="/deliveries" />
      </div>
    )
  }

  const driverName = delivery.driver?.full_name || "—"

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="Nộp tiền chuyến giao"
          description={`${delivery.route_name || "Chuyến giao"} • Lái xe: ${driverName}`}
          backHref={`/deliveries/${delivery.id}`}
        >
          <Badge variant="default">
            <Wallet className="h-3 w-3 mr-1" /> Bước cuối flow xử lý đơn
          </Badge>
        </PageHeader>

        {alreadySettled ? (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-900">
                    Chuyến đã nộp tiền {delivery.settled_at && `• ${formatDate(delivery.settled_at)}`}
                  </p>
                  <p className="text-xs text-emerald-800/80">
                    Đã thu {formatCurrency(Number(delivery.settled_amount || 0))}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link href="/orders">Về quản lý đơn hàng</Link>
              </Button>
            </CardContent>
          </Card>
        ) : hasNothingToCollect ? (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-7 w-7 text-rose-600 shrink-0" />
                <div>
                  <p className="font-semibold text-rose-900">Tất cả đơn giao thất bại</p>
                  <p className="text-xs text-rose-800/80">
                    Không có tiền cần thu trong chuyến này. Phiếu thu = 0.
                  </p>
                </div>
              </div>
              <Button onClick={() => finalize({ withPrint: false })} disabled={submitting}>
                {submitting ? "Đang xử lý…" : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Hoàn tất chuyến
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Banknote className="h-4 w-4" />
                  Danh sách đơn cần thu ({lines.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Đơn giao thất bại / huỷ đã được loại khỏi danh sách. Nhập số
                  thực thu cho từng đơn — tổng tự cập nhật ở cuối bảng.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Đơn hàng</th>
                        <th className="px-3 py-2 text-left font-semibold">Khách hàng</th>
                        <th className="px-3 py-2 text-right font-semibold w-32">Cần thu</th>
                        <th className="px-3 py-2 text-right font-semibold w-44">Thực thu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const orderTotal = Number(l.order?.total || 0)
                        const v = editedAmounts[l.id] ?? "0"
                        const num = Math.max(0, Number(parseFloat(v) || 0))
                        const matched = num === orderTotal
                        return (
                          <tr key={l.id} className="border-t">
                            <td className="px-3 py-2">
                              <Link
                                href={`/orders/${l.order?.id}`}
                                className="font-mono text-xs font-bold text-primary hover:underline"
                              >
                                {l.order?.order_code || "—"}
                              </Link>
                              {l.status === "partial" && (
                                <Badge variant="warning" className="ml-2 text-[10px]">Giao 1 phần</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium">{l.order?.customer?.store_name || "—"}</p>
                              {l.order?.customer?.phone && (
                                <p className="text-xs text-muted-foreground">{l.order.customer.phone}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(orderTotal)}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5 justify-end">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  className={`h-9 w-32 text-right tabular-nums font-semibold ${matched ? "" : "border-amber-400"}`}
                                  value={v}
                                  onChange={(e) => setLineAmount(l.id, e.target.value)}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-1.5 text-[10px]"
                                  onClick={() => setLineToOrderTotal(l)}
                                  title="Đặt = đủ tổng đơn"
                                >
                                  Đủ
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-1.5 text-[10px]"
                                  onClick={() => setLineToZero(l)}
                                  title="Đặt = 0"
                                >
                                  0
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/30">
                        <td colSpan={2} className="px-3 py-3 text-right font-bold">
                          Tổng phiếu thu
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">
                          {formatCurrency(summary.totalExpected)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-2xl font-black text-primary">
                          {formatCurrency(summary.totalCollected)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 p-4">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú phiếu thu
                </Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="VD: Khách KH-A trả 50% chuyển khoản 50% tiền mặt"
                />
              </CardContent>
            </Card>

            {saved ? (
              <Card className="border-emerald-300 bg-emerald-50">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-emerald-900">
                        Đã lập phiếu thu {saved.code} • {formatCurrency(saved.amount)}
                      </p>
                      <p className="text-xs text-emerald-800/80">
                        Đang chuyển về quản lý đơn hàng…
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={reprint}>
                      <Printer className="h-4 w-4 mr-2" /> In lại TT200
                    </Button>
                    <Button asChild>
                      <Link href="/orders">
                        Về đơn hàng <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" asChild>
                  <Link href={`/deliveries/${delivery.id}`}>Huỷ</Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => finalize({ withPrint: false })}
                  disabled={submitting}
                >
                  {submitting ? "Đang xử lý…" : "Lập phiếu thu"}
                </Button>
                <Button
                  onClick={() => finalize({ withPrint: true })}
                  disabled={submitting}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {submitting ? "Đang xử lý…" : "Lập phiếu thu & In TT200"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* TT200 print-only block. Render only after save so receipt code +
         amount reflect actual created row. */}
      {saved && (
        <div className="print-receipt-tt200-only">
          <PaymentReceiptTT200
            organizationName={orgName || "—"}
            receiptNo={saved.code}
            date={saved.date}
            payerName={driverName}
            reason={
              delivery.route_name
                ? `Thu tiền giao hàng chuyến ${delivery.route_name}`
                : `Thu tiền giao hàng theo phiếu ${saved.code}`
            }
            amount={saved.amount}
            evidenceCount={lines.length}
          />
        </div>
      )}
    </div>
  )
}
