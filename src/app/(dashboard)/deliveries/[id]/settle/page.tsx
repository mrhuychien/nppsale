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
    driver?: { full_name: string } | null
  } | null>(null)
  const [lines, setLines] = useState<SettleLine[]>([])
  const [loading, setLoading] = useState(true)
  const [submittedAmount, setSubmittedAmount] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [delRes, linesRes] = await Promise.all([
      supabase
        .from("deliveries")
        .select("id, route_name, status, settled_at, settled_amount, driver:users!deliveries_driver_id_fkey(full_name)")
        .eq("id", id)
        .single(),
      supabase
        .from("delivery_lines")
        .select(
          "id, order_id, status, payment_method, amount_collected, order:sales_orders(id, order_code, total, payment_terms, customer:customers(store_name, phone))"
        )
        .eq("delivery_id", id),
    ])
    if (delRes.data) setDelivery(delRes.data as unknown as typeof delivery)
    setLines(((linesRes.data as unknown) as SettleLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Expected = sum of (amount_collected if set, else order.total) for delivered lines on COD terms
  const summary = useMemo(() => {
    let expected = 0
    let totalDelivered = 0
    let codCount = 0
    let creditCount = 0
    const rows = lines.map((l) => {
      const o = l.order
      const orderTotal = Number(o?.total || 0)
      const cod = isCodTerms(o?.payment_terms)
      const delivered = l.status === "delivered"
      const collected = Number(l.amount_collected || 0)
      const expectedForLine = cod ? (collected > 0 ? collected : orderTotal) : 0
      if (delivered) totalDelivered += orderTotal
      if (delivered && cod) {
        expected += expectedForLine
        codCount += 1
      }
      if (delivered && !cod) creditCount += 1
      return { ...l, cod, delivered, expectedForLine, orderTotal }
    })
    return { expected, totalDelivered, codCount, creditCount, rows }
  }, [lines])

  const submittedNum = parseFloat(submittedAmount || "0") || 0
  const diff = submittedNum - summary.expected
  const isMatch = Math.abs(diff) < 1
  const isShort = diff < -0.5

  const alreadySettled = !!delivery?.settled_at

  const handleSettle = async () => {
    if (!delivery || !user) return
    if (alreadySettled) return
    if (summary.codCount === 0) {
      toast({
        title: "Không có đơn COD",
        description: "Chuyến này chỉ có công nợ. Không cần nộp tiền.",
      })
      return
    }
    setSubmitting(true)
    try {
      // 1) For each delivered COD line, ensure receivable exists, then create payment
      for (const r of summary.rows) {
        if (!r.delivered || !r.cod || !r.order) continue
        const amountForLine = r.expectedForLine
        if (amountForLine <= 0) continue

        // ensure receivable
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

        await supabase.from("payments").insert({
          receivable_id: rec.id,
          collected_by: user.id,
          amount: amountForLine,
          method,
          collected_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
        })

        await supabase
          .from("receivables")
          .update({ paid: newPaid, status })
          .eq("id", rec.id)
      }

      // 2) Mark delivery as settled
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
          ? "Số tiền lái xe nộp khớp với tổng đơn COD."
          : isShort
            ? `Thiếu ${formatCurrency(Math.abs(diff))}. Đã ghi nhận theo số nộp.`
            : `Dư ${formatCurrency(diff)}. Đã ghi nhận theo số nộp.`,
      })
      router.push(`/deliveries/${delivery.id}`)
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
        {/* Left: orders list */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Danh sách đơn ({summary.rows.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Chỉ đơn COD được tính vào số tiền tài xế nộp. Đơn công nợ chỉ ghi nhận giao thành công.
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Link
                              href={`/orders/${o?.id || ""}`}
                              className="font-mono text-xs font-bold text-primary hover:underline"
                            >
                              {o?.order_code}
                            </Link>
                            {r.cod ? (
                              <Badge variant="success" className="text-[10px]">
                                COD
                              </Badge>
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
                          <p className="text-sm font-bold">
                            {formatCurrency(r.orderTotal)}
                          </p>
                          {r.cod && r.delivered && (
                            <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mt-0.5">
                              Tài xế nộp
                            </p>
                          )}
                          {r.delivered && r.amount_collected != null &&
                            Number(r.amount_collected) > 0 &&
                            Number(r.amount_collected) !== r.orderTotal && (
                              <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                                Đã thu: {formatCurrency(Number(r.amount_collected))}
                              </p>
                            )}
                        </div>
                      </div>
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
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-white/60 p-2.5 border">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Số đơn COD
                  </p>
                  <p className="text-xl font-black mt-0.5">{summary.codCount}</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2.5 border">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Đơn công nợ
                  </p>
                  <p className="text-xl font-black mt-0.5">{summary.creditCount}</p>
                </div>
              </div>

              <div className="rounded-lg bg-white/60 p-3 border">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Tổng đơn COD cần nộp
                </p>
                <p className="text-2xl font-black mt-1 text-primary">
                  {formatCurrency(summary.expected)}
                </p>
              </div>

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
              ) : (
                <Button
                  className="w-full h-11"
                  onClick={handleSettle}
                  disabled={submitting || submittedAmount === "" || summary.codCount === 0}
                >
                  <ArrowRightCircle className="h-4 w-4 mr-2" />
                  {submitting ? "Đang xử lý..." : "Xác nhận quyết toán"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
