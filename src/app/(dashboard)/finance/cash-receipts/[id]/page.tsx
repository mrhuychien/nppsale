"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useOrg } from "@/hooks/use-org"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import {
  Receipt,
  CheckCircle2,
  XCircle,
  Wallet,
  Printer,
  AlertTriangle,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PaymentReceiptTT200 } from "@/components/printing/payment-receipt-tt200"
import type { CashReceipt, CashReceiptLine } from "@/types"

const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary"> = {
  pending: "warning",
  received: "success",
  voided: "secondary",
}
const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  received: "Đã nhận",
  voided: "Đã hủy",
}

type ReceiptLineWithOrder = CashReceiptLine & {
  order?: {
    id?: string
    order_code?: string
    customer?: { store_name?: string | null; phone?: string | null } | null
  } | null
}

export default function CashReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = createClient()
  const { toast } = useToast()

  const [receipt, setReceipt] = useState<CashReceipt | null>(null)
  const [lines, setLines] = useState<ReceiptLineWithOrder[]>([])
  const [delivery, setDelivery] = useState<{ id: string; route_name: string | null } | null>(null)
  const { org } = useOrg()
  const orgName = org?.name ?? ""
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: r, error: rErr } = await supabase
      .from("cash_receipts")
      .select(
        "id, receipt_code, receipt_date, status, source_type, source_id, expected_amount, submitted_amount, received_at, notes, collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name), receiver:users!cash_receipts_received_by_fkey(full_name)"
      )
      .eq("id", id)
      .single()
    if (rErr) console.error("[cash-receipts/id] truy vấn lỗi:", rErr.message)
    setReceipt((r as unknown as CashReceipt) || null)

    const { data: ls } = await supabase
      .from("cash_receipt_lines")
      .select(
        "id, payment_id, amount, order:sales_orders(id, order_code, customer:customers(store_name, phone))"
      )
      .eq("receipt_id", id)
    setLines((ls as unknown as ReceiptLineWithOrder[]) || [])

    // Resolve linked delivery — used for "Chi tiết chuyến" link in
    // the chuyến giao section + reason text on the TT200 receipt.
    // Two source paths:
    //   - source_type='delivery_settle' → source_id IS the delivery_id
    //   - source_type='manual' (self-deliver flow) → source_id is the
    //     stock_entry_id; lookup deliveries.source_stock_entry_id (mig 056).
    const sourceType = (r as { source_type?: string } | null)?.source_type
    const sourceId = (r as { source_id?: string } | null)?.source_id
    if (sourceType === "delivery_settle" && sourceId) {
      const { data: d, error: dErr } = await supabase
        .from("deliveries")
        .select("id, route_name")
        .eq("id", sourceId)
        .maybeSingle()
      if (dErr) console.error("[cash-receipts/id] truy vấn lỗi:", dErr.message)
      setDelivery((d as { id: string; route_name: string | null } | null) || null)
    } else if (sourceType === "manual" && sourceId) {
      // Self-deliver flow — receipt source_id is stock_entry.id.
      const { data: d } = await supabase
        .from("deliveries")
        .select("id, route_name")
        .eq("source_stock_entry_id", sourceId)
        .maybeSingle()
      setDelivery((d as { id: string; route_name: string | null } | null) || null)
    } else {
      setDelivery(null)
    }

    setLoading(false)
  }, [id, user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const canConfirm =
    !!user && ["owner", "manager", "accountant"].includes(user.role) && receipt?.status === "pending"

  const handleConfirm = async () => {
    if (!receipt || !user) return
    setActionLoading(true)
    try {
      // Mark all linked payments as verified
      const paymentIds = lines.map((l) => l.payment_id).filter(Boolean) as string[]
      if (paymentIds.length > 0) {
        // Phải dừng nếu hỏng: phiếu thu chuyển sang "đã nhận" ở dưới, nhưng
        // các payment vẫn chưa được đánh dấu đã đối chiếu → lệch sổ quỹ.
        await supabase
          .from("payments")
          .update({ verified_at: new Date().toISOString(), verified_by: user.id })
          .in("id", paymentIds)
          .throwOnError()
      }
      const { error } = await supabase
        .from("cash_receipts")
        .update({
          status: "received",
          received_by: user.id,
          received_at: new Date().toISOString(),
        })
        .eq("id", receipt.id)
      if (error) throw error
      toast({ title: "Đã xác nhận đã nhận tiền" })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleVoid = async () => {
    if (!receipt || !user) return
    if (!confirm(`Hủy phiếu thu ${receipt.receipt_code}?`)) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("cash_receipts")
        .update({ status: "voided" })
        .eq("id", receipt.id)
      if (error) throw error
      toast({ title: "Đã hủy phiếu thu" })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!receipt) {
    return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu thu</div>
  }

  const submitted = Number(receipt.submitted_amount || 0)
  const expected = Number(receipt.expected_amount || 0)
  const diff = submitted - expected
  const isMatch = Math.abs(diff) < 1
  const isShort = diff < -0.5
  const linesSum = lines.reduce((s, l) => s + Number(l.amount || 0), 0)

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
      <PageHeader
        title={`Phiếu thu ${receipt.receipt_code}`}
        description={`Ngày ${formatDate(receipt.receipt_date)}`}
        backHref="/finance/cash-receipts"
      >
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[receipt.status] || "secondary"}>
            {STATUS_LABEL[receipt.status] || receipt.status}
          </Badge>
          {/* T-08 — Phiếu thu mẫu 01-TT (TT200). Print-only block below. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const html = document.documentElement
              html.setAttribute("data-print-mode", "receipt-tt200")
              requestAnimationFrame(() => {
                window.print()
                setTimeout(() => {
                  html.removeAttribute("data-print-mode")
                }, 200)
              })
            }}
          >
            <Printer className="h-4 w-4 mr-2" /> In phiếu thu (TT200)
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: receipt lines */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Chi tiết theo đơn ({lines.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Phiếu thu không có dòng chi tiết.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Đơn hàng</th>
                      <th className="text-left px-3 py-2 font-semibold">Khách hàng</th>
                      <th className="text-right px-3 py-2 font-semibold w-32">Đã thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-2">
                          {l.order?.order_code ? (
                            <Link
                              href={`/orders/${l.order.id}`}
                              className="font-mono text-xs font-bold text-primary hover:underline"
                            >
                              {l.order.order_code}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{l.order?.customer?.store_name || "-"}</p>
                          <p className="text-xs text-muted-foreground">{l.order?.customer?.phone || ""}</p>
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          {formatCurrency(Number(l.amount || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/20">
                      <td colSpan={2} className="px-3 py-2 text-right font-bold">
                        Tổng cộng
                      </td>
                      <td className="px-3 py-2 text-right font-black text-base">
                        {formatCurrency(linesSum)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: meta + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Tổng quan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Tài xế nộp
                </Label>
                <p className="text-2xl font-black">{formatCurrency(submitted)}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Tổng cần nộp
                </Label>
                <p className="font-semibold">{formatCurrency(expected)}</p>
              </div>
              {Math.abs(diff) > 0.5 && (
                <div
                  className={`rounded-lg p-2.5 border text-sm ${
                    isShort
                      ? "bg-error-container border-error/40 text-error"
                      : "bg-[#fff4ed] border-[#fdb022]/40 text-[#b54708]"
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    {isShort ? "Thiếu" : "Dư"} {formatCurrency(Math.abs(diff))}
                  </div>
                </div>
              )}
              {isMatch && submitted > 0 && (
                <div className="rounded-lg p-2.5 border bg-[#ecfdf3] border-tertiary/40 text-tertiary text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4" /> Số tiền khớp
                  </div>
                </div>
              )}

              <div className="border-t pt-3 space-y-2">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Lái xe
                  </Label>
                  <p className="font-semibold">{receipt.collector?.full_name || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Người lập
                  </Label>
                  <p className="font-semibold">{receipt.creator?.full_name || "-"}</p>
                </div>
                {delivery && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Chuyến giao
                    </Label>
                    <Link
                      href={`/deliveries/${delivery.id}`}
                      className="font-semibold text-primary hover:underline block"
                    >
                      {delivery.route_name || "Chi tiết chuyến"}
                    </Link>
                  </div>
                )}
                {receipt.received_at && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Đã nhận lúc
                    </Label>
                    <p className="font-semibold">{formatDate(receipt.received_at)}</p>
                    <p className="text-xs text-muted-foreground">
                      Bởi {receipt.receiver?.full_name || "-"}
                    </p>
                  </div>
                )}
                {receipt.notes && (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Ghi chú
                    </Label>
                    <p className="whitespace-pre-wrap">{receipt.notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {canConfirm && (
            <Card className="border-tertiary/40 bg-[#ecfdf3]/40">
              <CardContent className="pt-6 space-y-2">
                <Button
                  className="w-full h-11 bg-tertiary hover:bg-tertiary/90"
                  onClick={handleConfirm}
                  disabled={actionLoading}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {actionLoading ? "Đang xử lý..." : "Xác nhận đã nhận tiền"}
                </Button>
                <p className="text-xs text-tertiary">
                  Sau khi xác nhận, các khoản thu sẽ được đánh dấu đã đối soát (verified).
                </p>
                <Button
                  variant="ghost"
                  className="w-full text-error hover:bg-error-container"
                  onClick={handleVoid}
                  disabled={actionLoading}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Hủy phiếu
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </div>{/* /.no-print wrapper */}

      {/* T-08: TT200 print-only — toggled by data-print-mode='receipt-tt200'. */}
      <div className="print-receipt-tt200-only">
        <PaymentReceiptTT200
          organizationName={orgName || "—"}
          receiptNo={receipt.receipt_code}
          date={new Date(receipt.receipt_date)}
          payerName={
            (receipt.collector as unknown as { full_name?: string } | undefined)?.full_name ||
            "—"
          }
          reason={
            delivery?.route_name
              ? `Thu tiền giao hàng chuyến ${delivery.route_name} ngày ${formatDate(receipt.receipt_date)}`
              : `Thu tiền giao hàng theo phiếu ${receipt.receipt_code}`
          }
          amount={Number(receipt.submitted_amount ?? 0)}
          evidenceCount={lines.length}
        />
      </div>
    </div>
  )
}
