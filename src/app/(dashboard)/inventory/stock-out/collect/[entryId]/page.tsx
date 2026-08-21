"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Banknote,
  CreditCard,
  ChevronLeft,
  HandCoins,
  Smartphone,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowSession } from "@/hooks/use-workflow-session"

type PaymentMethod = "cash" | "transfer" | "ewallet"

interface StockEntryRow {
  id: string
  org_id: string
  entry_code: string
  type: string
  status: string
  notes: string | null
  ref_order_ids: string[]
  posted_at: string | null
}

interface OrderRow {
  id: string
  org_id: string
  order_code: string
  customer_id: string
  total: number
  order_date: string
  payment_terms: string | null
}

interface CustomerRow {
  id: string
  store_name: string
  phone: string | null
  address: string | null
}

interface ReceivableRow {
  id: string
  order_id: string | null
  customer_id: string
  amount: number
  paid: number
  status: string
}

interface CollectRow {
  orderId: string
  orderCode: string
  orderDate: string
  customerId: string
  customerName: string
  customerPhone: string | null
  total: number
  alreadyPaid: number
  outstanding: number
  receivableId: string | null
  /** Số tiền user nhập để thu trong lượt này. */
  collect: string
  method: PaymentMethod
}

function generateReceiptCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(1 + Math.random() * 9999).toString().padStart(4, "0")
  return `PT-${yy}${mm}${dd}-${rand}`
}

export default function CollectPaymentPage() {
  const { entryId } = useParams<{ entryId: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [entry, setEntry] = useState<StockEntryRow | null>(null)
  const [rows, setRows] = useState<CollectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState("")

  // T-05: workflow session — surface this in-progress collection on the
  // dashboard widget so the user can return to it from another tab.
  const { saveDraft, closeSession } = useWorkflowSession({
    entityType: "stock_entry",
    entityId: entryId,
    stage: "collecting_payment",
    lastUrl: `/inventory/stock-out/collect/${entryId}`,
    entityLabel: entry ? `Phiếu xuất ${entry.entry_code}` : undefined,
    enabled: !!entryId && !!user,
  })

  const fetchData = useCallback(async () => {
    if (!entryId || !user?.org_id) return
    setLoading(true)
    const { data: ent, error: entErr } = await supabase
      .from("stock_entries")
      .select("id, org_id, entry_code, type, status, notes, ref_order_ids, posted_at")
      .eq("id", entryId)
      .single()
    if (entErr || !ent) {
      toast({ title: "Không tìm thấy phiếu xuất kho", variant: "destructive" })
      setLoading(false)
      return
    }
    const e = ent as StockEntryRow
    setEntry(e)
    const orderIds = (e.ref_order_ids || []) as string[]
    if (orderIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const [ordersRes, customersRes, receivablesRes] = await Promise.all([
      supabase
        .from("sales_orders")
        .select("id, org_id, order_code, customer_id, total, order_date, payment_terms, status")
        // User feedback: bàn giao trước thu tiền → đơn cancelled (failed
        // handover) không hiển thị ở list thu tiền.
        .in("id", orderIds)
        .neq("status", "cancelled"),
      supabase
        .from("customers")
        .select("id, store_name, phone, address")
        .eq("org_id", user.org_id),
      supabase
        .from("receivables")
        .select("id, order_id, customer_id, amount, paid, status")
        .in("order_id", orderIds),
    ])

    const orders = (ordersRes.data as OrderRow[]) || []
    const customers = (customersRes.data as CustomerRow[]) || []
    const receivables = (receivablesRes.data as ReceivableRow[]) || []
    const customerMap = new Map<string, CustomerRow>()
    for (const c of customers) customerMap.set(c.id, c)
    const recvByOrder = new Map<string, ReceivableRow>()
    for (const r of receivables) {
      if (r.order_id) recvByOrder.set(r.order_id, r)
    }

    const collected: CollectRow[] = orders.map((o) => {
      const recv = recvByOrder.get(o.id)
      const cust = customerMap.get(o.customer_id)
      const amount = Number(recv?.amount ?? o.total ?? 0)
      const alreadyPaid = Number(recv?.paid ?? 0)
      const outstanding = Math.max(0, amount - alreadyPaid)
      return {
        orderId: o.id,
        orderCode: o.order_code,
        orderDate: o.order_date,
        customerId: o.customer_id,
        customerName: cust?.store_name || "—",
        customerPhone: cust?.phone || null,
        total: Number(o.total || 0),
        alreadyPaid,
        outstanding,
        receivableId: recv?.id ?? null,
        // default: thu hết outstanding
        collect: outstanding.toString(),
        method: "cash",
      }
    })
    // Sort by customer name then order code for predictability
    collected.sort((a, b) =>
      a.customerName.localeCompare(b.customerName) || a.orderCode.localeCompare(b.orderCode)
    )
    setRows(collected)
    setLoading(false)
  }, [entryId, user?.org_id, supabase, toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // T-05: persist form draft (rows + notes) so a reload restores state.
  useEffect(() => {
    if (loading) return
    saveDraft({ rows, notes })
  }, [rows, notes, loading, saveDraft])

  const totals = useMemo(() => {
    let outstanding = 0
    let collect = 0
    let leftover = 0
    for (const r of rows) {
      const c = Math.max(0, Math.min(parseFloat(r.collect) || 0, r.outstanding))
      outstanding += r.outstanding
      collect += c
      leftover += r.outstanding - c
    }
    return { outstanding, collect, leftover }
  }, [rows])

  const setRowField = <K extends keyof CollectRow>(idx: number, key: K, value: CollectRow[K]) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  const fillAll = (mode: "outstanding" | "zero") => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        collect: mode === "outstanding" ? r.outstanding.toString() : "0",
      }))
    )
  }

  const handleSubmit = async () => {
    if (!user?.org_id || !entry) return
    if (rows.length === 0) {
      toast({ title: "Không có đơn để thu", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      // 1) Phiếu thu tổng (manual). Submit mọi tiền thu được vào 1 phiếu.
      const code = generateReceiptCode()
      const { data: receipt, error: rErr } = await supabase
        .from("cash_receipts")
        .insert({
          org_id: user.org_id,
          receipt_code: code,
          source_type: "manual",
          source_id: entry.id,
          collected_by: user.id,
          submitted_amount: totals.collect,
          expected_amount: totals.outstanding,
          notes:
            notes.trim() ||
            `Thu sau khi tự giao hàng — phiếu xuất ${entry.entry_code}`,
          status: "received",
          received_by: user.id,
          received_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (rErr || !receipt) throw rErr || new Error("Không tạo được phiếu thu")
      const receiptId = (receipt as { id: string }).id

      // 2) Loop từng dòng — chỉ ghi sổ những dòng thu > 0
      for (const r of rows) {
        const amt = Math.max(0, Math.min(parseFloat(r.collect) || 0, r.outstanding))
        if (amt <= 0) continue
        if (!r.receivableId) {
          // Receivable chưa tồn tại — tạo (idempotent)
          const { ensureReceivableForOrder } = await import("@/lib/receivables")
          await ensureReceivableForOrder(supabase, r.orderId)
          const { data: re } = await supabase
            .from("receivables")
            .select("id, amount, paid")
            .eq("order_id", r.orderId)
            .maybeSingle()
          if (!re) continue
          r.receivableId = (re as { id: string }).id
          r.alreadyPaid = Number((re as { paid: number }).paid || 0)
          r.outstanding = Math.max(0, Number((re as { amount: number }).amount || 0) - r.alreadyPaid)
        }

        // Insert payment
        const { data: pay, error: payErr } = await supabase
          .from("payments")
          .insert({
            receivable_id: r.receivableId,
            collected_by: user.id,
            amount: amt,
            method: r.method,
            collected_at: new Date().toISOString(),
          })
          .select("id")
          .single()
        if (payErr || !pay) throw payErr || new Error("Không ghi nhận được thanh toán")

        // Update receivable paid + status
        const newPaid = r.alreadyPaid + amt
        const newOutstanding = Math.max(0, r.outstanding - amt)
        const newStatus =
          newOutstanding === 0
            ? "paid"
            : newPaid > 0
              ? "partial"
              : "open"
        await supabase
          .from("receivables")
          .update({ paid: newPaid, status: newStatus })
          .eq("id", r.receivableId).throwOnError()

        // Insert cash_receipt_line linking everything
        await supabase.from("cash_receipt_lines").insert({
          receipt_id: receiptId,
          order_id: r.orderId,
          receivable_id: r.receivableId,
          payment_id: (pay as { id: string }).id,
          amount: amt,
        })
      }

      // Đẩy tất cả đơn hàng trong lệnh xuất sang trạng thái 'delivered'.
      // Đến bước thu tiền nghĩa là hàng đã đến tay khách — phần thu/chưa
      // thu là trạng thái thanh toán riêng, hiển thị qua badge thanh toán.
      const orderIds = rows.map((r) => r.orderId)
      if (orderIds.length > 0) {
        await supabase
          .from("sales_orders")
          .update({ status: "delivered" })
          .in("id", orderIds).throwOnError()
      }

      toast({
        title: `Đã ghi nhận thu ${formatCurrency(totals.collect)}`,
        description: `${
          totals.leftover > 0
            ? `Đã giao ${rows.length} đơn — còn ${formatCurrency(totals.leftover)} chuyển sang công nợ.`
            : `Đã giao ${rows.length} đơn và thu đủ tiền.`
        }`,
      })
      // T-05: workflow done — close session so it falls off the widget.
      await closeSession()
      // Self-deliver flow: handover làm TRƯỚC collect. Sau khi thu
      // tiền xong → stamp delivery.settled_at + chuyển sang trang
      // phiếu thu để user xem chi tiết + in TT200 nếu cần. Không
      // vòng lại /handover (đã làm rồi).
      const { data: linkedDelivery } = await supabase
        .from("deliveries")
        .select("id")
        .eq("source_stock_entry_id", entry.id)
        .maybeSingle()
      const deliveryId = (linkedDelivery as { id: string } | null)?.id
      if (deliveryId) {
        await supabase
          .from("deliveries")
          .update({
            settled_at: new Date().toISOString(),
            settled_amount: totals.collect,
          })
          .eq("id", deliveryId)
      }
      router.push(`/finance/cash-receipts/${receiptId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!entry) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy phiếu" backHref="/inventory/stock-out" />
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Phiếu xuất kho không tồn tại hoặc đã bị xóa.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Thu tiền sau khi tự giao hàng"
        description={`Phiếu xuất ${entry.entry_code} • ${rows.length} đơn`}
        backHref="/inventory/stock-out"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/inventory/entries/${entry.id}`}>
            <ChevronLeft className="mr-1.5 h-4 w-4" /> Phiếu xuất kho
          </Link>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          icon={Banknote}
          label="Tổng cần thu"
          value={totals.outstanding}
          color="primary"
        />
        <SummaryCard
          icon={HandCoins}
          label="Số tiền thu"
          value={totals.collect}
          color="success"
        />
        <SummaryCard
          icon={CreditCard}
          label="Còn lại → Công nợ"
          value={totals.leftover}
          color={totals.leftover > 0 ? "danger" : "muted"}
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card px-4 py-3 shadow-sm">
        <span className="text-sm font-medium">Thao tác nhanh:</span>
        <Button variant="outline" size="sm" onClick={() => fillAll("outstanding")}>
          Thu hết các đơn
        </Button>
        <Button variant="outline" size="sm" onClick={() => fillAll("zero")}>
          Bỏ trống — chuyển hết sang công nợ
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">
                  Đơn hàng
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">
                  Khách hàng
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  Tổng tiền
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  Đã thu trước
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  Còn cần thu
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  Số tiền thu
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide">
                  Hình thức
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  → Công nợ
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    {(entry?.ref_order_ids?.length || 0) > 0
                      ? "Tất cả đơn trong phiếu xuất đều giao thất bại — không có gì cần thu."
                      : "Phiếu xuất này không có đơn hàng tham chiếu."}
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const collect = Math.max(
                    0,
                    Math.min(parseFloat(r.collect) || 0, r.outstanding)
                  )
                  const leftover = r.outstanding - collect
                  return (
                    <tr key={r.orderId} className="border-b border-border/30">
                      <td className="px-3 py-3">
                        <Link
                          href={`/orders/${r.orderId}`}
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                        >
                          {r.orderCode}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(r.orderDate)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground">{r.customerName}</p>
                        {r.customerPhone ? (
                          <p className="text-[11px] text-muted-foreground">
                            {r.customerPhone}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatCurrency(r.total)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {r.alreadyPaid > 0 ? formatCurrency(r.alreadyPaid) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-primary">
                        {formatCurrency(r.outstanding)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          max={r.outstanding}
                          step="any"
                          value={r.collect}
                          onChange={(e) => setRowField(idx, "collect", e.target.value)}
                          className="h-9 w-32 rounded-md border border-border/60 bg-background px-2 text-right tabular-nums text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <select
                          value={r.method}
                          onChange={(e) =>
                            setRowField(idx, "method", e.target.value as PaymentMethod)
                          }
                          className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
                        >
                          <option value="cash">Tiền mặt</option>
                          <option value="transfer">Chuyển khoản</option>
                          <option value="ewallet">Ví điện tử</option>
                        </select>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          leftover > 0
                            ? "font-semibold text-error"
                            : "text-muted-foreground"
                        )}
                      >
                        {leftover > 0 ? formatCurrency(leftover) : "—"}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border/40 bg-[#fff4ed] font-bold print:bg-[#fff4ed]">
                  <td className="px-3 py-3" colSpan={4}>
                    Tổng {rows.length} đơn
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-primary">
                    {formatCurrency(totals.outstanding)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-tertiary">
                    {formatCurrency(totals.collect)}
                  </td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-right tabular-nums text-error">
                    {formatCurrency(totals.leftover)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {/* Notes + submit */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1">
          <label className="mb-1.5 block text-xs font-semibold text-foreground">
            Ghi chú phiếu thu (tùy chọn)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`Thu sau tự giao — ${entry.entry_code}`}
            className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => router.push(`/inventory/entries/${entry.id}`)}>
            Bỏ qua
          </Button>
          {rows.length === 0 ? (
            <Button
              onClick={() => router.push(`/inventory/entries/${entry.id}`)}
              disabled={saving}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Hoàn tất — Không có gì cần thu
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {saving ? "Đang lưu..." : `Xác nhận thu ${formatCurrency(totals.collect)}`}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="flex items-start gap-2">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold text-foreground">Lưu ý:</span> Đơn nào để
            <span className="font-medium"> 0</span> hoặc nhập số nhỏ hơn &quot;Còn cần thu&quot;
            sẽ tự động chuyển phần còn lại sang công nợ khách hàng (xem ở mục
            <Link href="/receivables" className="ml-1 font-medium text-primary hover:underline">
              Công nợ
            </Link>
            ).
          </span>
        </p>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Banknote
  label: string
  value: number
  color: "primary" | "success" | "danger" | "muted"
}) {
  const tone =
    color === "primary"
      ? "border-l-primary text-primary"
      : color === "success"
        ? "border-l-emerald-500 text-tertiary"
        : color === "danger"
          ? "border-l-error-container0 text-error"
          : "border-l-border/60 text-muted-foreground"
  const iconBg =
    color === "primary"
      ? "bg-primary/10 text-primary"
      : color === "success"
        ? "bg-tertiary/10 text-tertiary"
        : color === "danger"
          ? "bg-error/10 text-error"
          : "bg-muted/40 text-muted-foreground"
  return (
    <div className={cn("rounded-xl border border-l-4 border-border/40 bg-card p-4 shadow-sm", tone)}>
      <div className="flex items-start justify-between">
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md", iconBg)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone)}>{formatCurrency(value)}</p>
    </div>
  )
}
