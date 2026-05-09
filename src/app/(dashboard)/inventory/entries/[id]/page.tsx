"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatDate, formatCurrency } from "@/lib/utils"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import { Pencil, Trash2, X, Package, Truck, Printer } from "lucide-react"
import { PrintButton } from "@/components/ui/print-button"
import { DriverList, type DriverListOrder } from "@/components/printing/driver-list"
import type { StockEntry, StockEntryLine } from "@/types"

export default function StockEntryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [entry, setEntry] = useState<StockEntry | null>(null)
  const [lines, setLines] = useState<StockEntryLine[]>([])
  // T-12: hàng đem đi đổi attached to this entry. Rendered in its own
  // table on the print slip.
  const [swapItems, setSwapItems] = useState<
    Array<{
      id: string
      product_id: string
      qty: number
      unit_name: string
      qty_in_base_uom: number
      reason: string | null
      product?: { name: string; sku: string } | null
    }>
  >([])
  const [refOrders, setRefOrders] = useState<Array<{
    id: string
    order_code: string
    order_date?: string | null
    total?: number | null
    subtotal?: number | null
    vat?: number | null
    payment_terms?: string | null
    notes?: string | null
    customer?: {
      store_name?: string | null
      phone?: string | null
      address?: string | null
      ward?: string | null
      district?: string | null
      province?: string | null
    } | null
    lines?: Array<{
      product_id: string
      unit_name: string
      quantity: number
      unit_price?: number | null
      line_total?: number | null
      note?: string | null
      product?: { name: string; sku: string } | null
    }>
    returns?: Array<{
      id: string
      status?: string | null
      reason?: string | null
      credit_note_amount?: number | null
      notes?: string | null
      lines: Array<{
        product_id: string
        unit_name: string
        quantity: number
        unit_price: number
        line_total: number
        note?: string | null
        is_exchange?: boolean | null
        product?: { name: string; sku: string } | null
      }>
    }>
  }>>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editNotes, setEditNotes] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [selfDelivering, setSelfDelivering] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [entryRes, linesRes, swapRes] = await Promise.all([
      supabase
        .from("stock_entries")
        .select("*, creator:users!stock_entries_created_by_fkey(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("stock_entry_lines")
        .select("*, product:products(*), batch:batches(*)")
        .eq("entry_id", id),
      // T-12 — swap items linked to this stock_entry.
      supabase
        .from("swap_stock_movements")
        .select(
          "id, product_id, qty, unit_name, qty_in_base_uom, reason, product:products(name, sku)"
        )
        .eq("stock_entry_id", id),
    ])
    setSwapItems(
      ((swapRes.data as unknown) as typeof swapItems) || []
    )
    let entryData: StockEntry | null = null
    if (entryRes.data) {
      const e = entryRes.data as StockEntry
      entryData = e
      setEntry(e)
      setEditNotes(e.notes || "")
    }
    setLines((linesRes.data as StockEntryLine[]) || [])

    // For export entries that wrap multiple orders, load the source orders
    // with their lines so the warehouse can see how to split the aggregate.
    type RefOrder = typeof refOrders extends Array<infer U> ? U : never
    const refOrderIds =
      (entryData?.type === "export" && Array.isArray(entryData.ref_order_ids))
        ? (entryData.ref_order_ids as string[])
        : []
    if (refOrderIds.length > 0) {
      const [{ data: orderRows }, { data: returnRows }] = await Promise.all([
        supabase
          .from("sales_orders")
          .select(
            "id, order_code, order_date, subtotal, vat, total, payment_terms, notes, customer:customers(store_name, phone, address, ward, district, province), lines:sales_order_lines(product_id, unit_name, quantity, unit_price, line_total, note, conversion_factor, product:products(name, sku))"
          )
          .in("id", refOrderIds),
        // Hàng trả về kèm theo các đơn này — in cả pending/approved/
        // completed lên phiếu giao để lái xe biết các yêu cầu trả
        // (nếu khách có thay đổi tại điểm giao). Chỉ loại bỏ phiếu
        // đã bị từ chối hoặc hủy.
        supabase
          .from("returns")
          .select(
            "id, order_id, status, reason, credit_note_amount, notes, lines:return_lines(product_id, unit_name, quantity, unit_price, line_total, note, is_exchange, product:products(name, sku))"
          )
          .in("order_id", refOrderIds)
          .in("status", ["pending", "approved", "completed"]),
      ])
      type ReturnRow = {
        id: string
        order_id: string
        status?: string | null
        reason?: string | null
        credit_note_amount?: number | null
        notes?: string | null
        lines: Array<{
          product_id: string
          unit_name: string
          quantity: number
          unit_price: number
          line_total: number
          product?: { name: string; sku: string } | null
        }>
      }
      const returnsByOrder = new Map<string, ReturnRow[]>()
      for (const r of ((returnRows as unknown) as ReturnRow[]) || []) {
        const arr = returnsByOrder.get(r.order_id) || []
        arr.push(r)
        returnsByOrder.set(r.order_id, arr)
      }
      const merged = (((orderRows as unknown) as RefOrder[]) || []).map((o) => ({
        ...o,
        returns: (returnsByOrder.get(o.id) || []).map((r) => ({
          id: r.id,
          status: r.status,
          reason: r.reason,
          credit_note_amount: r.credit_note_amount,
          notes: r.notes,
          lines: r.lines || [],
        })),
      }))
      setRefOrders(merged)
    } else {
      setRefOrders([])
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  /**
   * "Tự giao hàng": chủ xe / NPP giao trực tiếp khi lái xe không dùng
   * phần mềm. Bỏ qua bước tạo delivery + driver xác nhận:
   *   - FEFO trừ batches + stamp unit_cost trung bình lên entry_lines
   *   - Stock entry → posted (posted_at = now)
   *   - Đơn → delivered
   *   - Tạo receivable cho từng đơn
   *   - Chuyển sang trang thu tiền /inventory/stock-out/collect/{entryId}
   */
  const handleSelfDeliver = async () => {
    if (!entry || !user) return
    const orderIds = (entry.ref_order_ids || []) as string[]
    if (orderIds.length === 0) {
      toast({
        title: "Phiếu này không có đơn tham chiếu",
        description: "Không thể tự giao do thiếu liên kết với đơn hàng.",
        variant: "destructive",
      })
      return
    }
    setSelfDelivering(true)
    try {
      // 1) FEFO trừ batches + stamp unit_cost lên từng line.
      // T-01 — consume in BASE UOM (qty_in_base_uom) so 4 thùng x 10 hộp
      // deducts 40 hộp from batches.qty_on_hand, not 4.
      for (const l of lines) {
        const lineWithBase = l as unknown as { qty_in_base_uom?: number; quantity: number }
        let remaining = Number(lineWithBase.qty_in_base_uom ?? lineWithBase.quantity ?? 0)
        if (remaining <= 0) continue
        const { data: prodBatches } = await supabase
          .from("batches")
          .select("id, qty_on_hand, unit_cost")
          .eq("product_id", l.product_id)
          .gt("qty_on_hand", 0)
          .order("expires_at", { ascending: true })
        let costSum = 0
        let qtyTaken = 0
        for (const b of (prodBatches as Array<{
          id: string
          qty_on_hand: number
          unit_cost: number
        }>) || []) {
          if (remaining <= 0) break
          const take = Math.min(remaining, Number(b.qty_on_hand))
          await supabase
            .from("batches")
            .update({ qty_on_hand: Number(b.qty_on_hand) - take })
            .eq("id", b.id)
          costSum += take * Number(b.unit_cost || 0)
          qtyTaken += take
          remaining -= take
        }
        const avgCost = qtyTaken > 0 ? costSum / qtyTaken : 0
        if (avgCost > 0) {
          await supabase
            .from("stock_entry_lines")
            .update({ unit_cost: avgCost })
            .eq("id", l.id)
        }
        if (remaining > 0) {
          console.warn(
            `[self-deliver] không đủ tồn cho product ${l.product_id}: thiếu ${remaining}`
          )
        }
      }

      // 2) Post phiếu xuất
      await supabase
        .from("stock_entries")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", entry.id)

      // 3) Đơn → delivering. Lái xe / chủ xe đang trên đường giao;
      // trạng thái sẽ chuyển sang 'delivered' sau khi nộp tiền ở trang
      // /inventory/stock-out/collect/{entryId}.
      await supabase
        .from("sales_orders")
        .update({ status: "delivering" })
        .in("id", orderIds)

      // 4) Tạo receivable cho từng đơn (idempotent)
      const { ensureReceivableForOrder } = await import("@/lib/receivables")
      for (const orderId of orderIds) {
        await ensureReceivableForOrder(supabase, orderId)
      }

      toast({
        title: `Đã chuyển ${orderIds.length} đơn sang "Đang giao"`,
        description: "Đã trừ kho. Tiếp tục bước thu tiền để chuyển sang 'Đã giao'.",
      })
      router.push(`/inventory/stock-out/collect/${entry.id}`)
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSelfDelivering(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!entry) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("stock_entries")
        .update({ notes: editNotes || null })
        .eq("id", entry.id)
      if (error) throw error
      toast({ title: "Đã cập nhật phiếu kho" })
      setEditMode(false)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!entry) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("stock_entries").delete().eq("id", entry.id)
      if (error) throw error
      toast({ title: "Đã xóa phiếu kho" })
      router.push("/inventory/entries")
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!entry) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu kho</div>

  const typeLabel = STOCK_ENTRY_TYPES.find((t) => t.value === entry.type)?.label || entry.type
  const typeVariant: "default" | "success" | "warning" | "secondary" =
    entry.type === "import" ? "success" :
    entry.type === "export" ? "warning" :
    entry.type === "transfer" ? "default" : "secondary"
  const canEdit = user && hasPermission(user.role, "inventory", "update")
  const canDelete = user && hasPermission(user.role, "inventory", "delete")

  const totalQty = lines.reduce((sum, l) => sum + Number(l.quantity || 0), 0)

  // Aggregate exchange / refund return-lines across all ref-orders.
  // Đem về để đổi: items the rep collects from customer to swap. Đem
  // về để trả: items collected for refund (deducts from công nợ).
  const exchangeAgg = new Map<string, { name: string; sku: string; unit: string; qty: number; value: number }>()
  const refundAgg = new Map<string, { name: string; sku: string; unit: string; qty: number; value: number }>()
  for (const o of refOrders) {
    for (const r of o.returns || []) {
      for (const l of r.lines || []) {
        const target = l.is_exchange ? exchangeAgg : refundAgg
        const key = `${l.product_id}::${l.unit_name}`
        const prev = target.get(key)
        const qty = Number(l.quantity || 0)
        const value = Number(l.line_total ?? Number(l.unit_price || 0) * qty)
        if (prev) {
          prev.qty += qty
          prev.value += value
        } else {
          target.set(key, {
            name: l.product?.name || "—",
            sku: l.product?.sku || "—",
            unit: l.unit_name,
            qty,
            value,
          })
        }
      }
    }
  }
  const exchangeRows = Array.from(exchangeAgg.values())
  const refundRows = Array.from(refundAgg.values())

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
      <PageHeader
        title={entry.entry_code}
        description={`${typeLabel} • Ngày tạo: ${formatDate(entry.created_at)}`}
        backHref="/inventory/entries"
      >
        <Badge variant={typeVariant}>{typeLabel}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - lines */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Chi tiết sản phẩm ({lines.length})</CardTitle>
            {/* T-10: secondary "khổ giấy" trigger; primary actions are
                in the right-rail Hành động phiếu card. */}
            {entry.type !== "export" && <PrintButton label="In phiếu" />}
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Phiếu chưa có chi tiết sản phẩm
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sản phẩm</TableHead>
                        <TableHead>Lô / SKU</TableHead>
                        <TableHead>ĐVT</TableHead>
                        <TableHead className="text-right">Số lượng</TableHead>
                        <TableHead>Ghi chú</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => {
                        const lineExt = line as unknown as {
                          qty_in_base_uom?: number
                          qty_in_transaction_uom?: number
                          conversion_factor_snapshot?: number
                        }
                        const factor = Number(lineExt.conversion_factor_snapshot ?? 1) || 1
                        const txQty = Number(lineExt.qty_in_transaction_uom ?? line.quantity) || 0
                        const baseQty = Number(lineExt.qty_in_base_uom ?? line.quantity * factor) || 0
                        const baseUnit = line.product?.base_unit || ""
                        const showBase = factor > 1 && baseUnit && baseUnit !== line.unit_name
                        const noteRaw = line.notes || ""
                        const isExchange = noteRaw.startsWith("[Exchange]")
                        const isSwap = noteRaw.startsWith("[Swap]")
                        const cleanNote = noteRaw
                          .replace(/^\[Exchange\]\s*/, "")
                          .replace(/^\[Swap\]\s*/, "")
                          .replace(/^Vị trí:\s*/, "")
                        const rowBg = isExchange
                          ? "bg-blue-50/40"
                          : isSwap
                            ? "bg-amber-50/40"
                            : undefined
                        return (
                          <TableRow key={line.id} className={rowBg}>
                            <TableCell>
                              <div className="font-semibold flex items-center gap-1.5">
                                {isExchange && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                                    ĐỔI
                                  </span>
                                )}
                                {isSwap && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                    DỰ PHÒNG
                                  </span>
                                )}
                                <span>{line.product?.name || "-"}</span>
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                SKU: {line.product?.sku}
                              </div>
                            </TableCell>
                            <TableCell>
                              {line.batch?.batch_code ? (
                                <span className="font-mono text-xs bg-surface-container px-2 py-1 rounded">
                                  {line.batch.batch_code}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">-</span>
                              )}
                            </TableCell>
                            <TableCell>{line.unit_name}</TableCell>
                            <TableCell className="text-right font-bold">
                              {txQty}
                              {showBase && (
                                <span className="ml-1 font-normal text-muted-foreground text-xs">
                                  ({baseQty} {baseUnit})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                              {cleanNote || "-"}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden space-y-2">
                  {lines.map((line) => {
                    const lineExt = line as unknown as {
                      qty_in_base_uom?: number
                      qty_in_transaction_uom?: number
                      conversion_factor_snapshot?: number
                    }
                    const factor = Number(lineExt.conversion_factor_snapshot ?? 1) || 1
                    const txQty = Number(lineExt.qty_in_transaction_uom ?? line.quantity) || 0
                    const baseQty = Number(lineExt.qty_in_base_uom ?? line.quantity * factor) || 0
                    const baseUnit = line.product?.base_unit || ""
                    const showBase = factor > 1 && baseUnit && baseUnit !== line.unit_name
                    const noteRaw = line.notes || ""
                    const isExchange = noteRaw.startsWith("[Exchange]")
                    const isSwap = noteRaw.startsWith("[Swap]")
                    const cleanNote = noteRaw
                      .replace(/^\[Exchange\]\s*/, "")
                      .replace(/^\[Swap\]\s*/, "")
                      .replace(/^Vị trí:\s*/, "")
                    const cardBg = isExchange
                      ? "bg-blue-50/40 border-blue-200"
                      : isSwap
                        ? "bg-amber-50/40 border-amber-200"
                        : "bg-muted/20"
                    return (
                    <div key={line.id} className={`rounded-xl border p-3 ${cardBg}`}>
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isExchange && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                                ĐỔI
                              </span>
                            )}
                            {isSwap && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                DỰ PHÒNG
                              </span>
                            )}
                            <p className="font-semibold text-sm leading-tight">
                              {line.product?.name || "-"}
                            </p>
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">
                            SKU: {line.product?.sku}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold text-base">
                          {txQty} {line.unit_name}
                          {showBase && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({baseQty} {baseUnit})
                            </span>
                          )}
                        </span>
                      </div>
                      {line.batch?.batch_code && (
                        <span className="font-mono text-xs bg-surface-container px-2 py-0.5 rounded inline-block">
                          Lô: {line.batch.batch_code}
                        </span>
                      )}
                      {cleanNote && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{cleanNote}</p>
                      )}
                    </div>
                    )
                  })}
                </div>
              </>
            )}
            <div className="mt-4 pt-4 border-t border-border/40 flex justify-between text-sm">
              <span className="text-muted-foreground">Tổng số lượng</span>
              <span className="font-black text-lg">{totalQty}</span>
            </div>

            {/* Hàng đem về (return / exchange) — show two distinct
                buckets so warehouse + driver know what to collect AND
                that exchange items don't reduce công nợ. */}
            {(exchangeRows.length > 0 || refundRows.length > 0) && (
              <div className="mt-4 pt-4 border-t border-border/40 space-y-3">
                {exchangeRows.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                        ĐỔI
                      </span>
                      <h3 className="font-semibold text-sm">
                        Hàng đổi đem về ({exchangeRows.length})
                      </h3>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Không trừ công nợ
                      </span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {exchangeRows.map((r, i) => (
                        <li key={i} className="flex justify-between gap-2 py-1 border-b border-border/30 last:border-0">
                          <span className="font-medium">{r.name}</span>
                          <span className="font-bold tabular-nums">
                            {r.qty} {r.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {refundRows.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                        TRẢ
                      </span>
                      <h3 className="font-semibold text-sm">
                        Hàng trả đem về ({refundRows.length})
                      </h3>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Trừ {formatCurrency(refundRows.reduce((s, r) => s + r.value, 0))} công nợ
                      </span>
                    </div>
                    <ul className="space-y-1 text-sm">
                      {refundRows.map((r, i) => (
                        <li key={i} className="flex justify-between gap-2 py-1 border-b border-border/30 last:border-0">
                          <span className="font-medium">{r.name}</span>
                          <span className="font-bold tabular-nums">
                            {r.qty} {r.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-order breakdown (warehouse splits the aggregate by order) */}
        {refOrders.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Chi tiết theo đơn ({refOrders.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Dùng để chia hàng đã gộp theo từng khách hàng khi bàn giao.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {refOrders.map((o) => (
                <div key={o.id} className="rounded-xl border bg-muted/10 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <a
                        href={`/orders/${o.id}`}
                        className="font-mono text-sm font-bold text-primary hover:underline"
                      >
                        {o.order_code}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {o.customer?.store_name || "-"}
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left py-1 font-semibold">SKU</th>
                          <th className="text-left py-1 font-semibold">Sản phẩm</th>
                          <th className="text-right py-1 font-semibold w-24">SL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(o.lines || []).map((l, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="py-1.5 font-mono">{l.product?.sku || "-"}</td>
                            <td className="py-1.5">
                              <div>{l.product?.name || "-"}</div>
                              {l.note && (
                                <div className="text-[10px] italic text-muted-foreground mt-0.5">
                                  ✏ {l.note}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 text-right font-semibold">
                              {(() => {
                                // T-01: show "4 thùng (40 hộp)" when factor > 1.
                                const factor = Number(
                                  (l as unknown as { conversion_factor?: number }).conversion_factor ?? 1
                                )
                                const qty = Number(l.quantity || 0)
                                const baseQty = qty * factor
                                if (factor > 1) {
                                  return (
                                    <>
                                      {qty} {l.unit_name}
                                      <span className="text-[10px] text-muted-foreground ml-1">
                                        ({baseQty})
                                      </span>
                                    </>
                                  )
                                }
                                return `${qty} ${l.unit_name}`
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Right - info + actions */}
        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          {/* T-10: 3 picking actions stacked vertically per spec.
              Visible for export entries; "Tự giao hàng" only for draft. */}
          {entry.type === "export" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Hành động phiếu</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <Button
                  variant="outline"
                  className="w-full h-11 justify-start"
                  onClick={() => {
                    const html = document.documentElement
                    html.removeAttribute("data-print-mode")
                    requestAnimationFrame(() => window.print())
                  }}
                >
                  <Printer className="h-4 w-4 mr-2" /> IN PHIẾU XUẤT &amp; GIAO HÀNG
                </Button>
                {refOrders.length > 0 && (
                  <Button
                    variant="outline"
                    className="w-full h-11 justify-start"
                    onClick={() => {
                      const html = document.documentElement
                      html.setAttribute("data-print-mode", "driver-list")
                      requestAnimationFrame(() => {
                        window.print()
                        setTimeout(() => {
                          html.removeAttribute("data-print-mode")
                        }, 200)
                      })
                    }}
                  >
                    <Printer className="h-4 w-4 mr-2" /> IN DANH SÁCH GIAO
                  </Button>
                )}
                {entry.status === "draft" && (
                  <Button
                    className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white justify-start"
                    onClick={handleSelfDeliver}
                    disabled={selfDelivering || lines.length === 0}
                  >
                    <Truck className="h-4 w-4 mr-2" />
                    {selfDelivering
                      ? "Đang xử lý..."
                      : "TỰ GIAO HÀNG & THU TIỀN"}
                  </Button>
                )}
                {entry.status === "draft" && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Tự giao hàng = NPP / chủ xe trực tiếp giao. Tồn kho sẽ trừ ngay,
                    đơn chuyển sang trạng thái <strong>đã giao</strong> rồi mở trang thu tiền.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {entry.type === "export" && entry.status === "posted" && (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardContent className="pt-6 text-sm">
                <div className="flex items-center gap-2 font-semibold text-emerald-700">
                  <Truck className="h-4 w-4" />
                  Đã bàn giao cho lái xe
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Phiếu này đã được post. Tồn kho đã trừ.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin phiếu</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditNotes(entry.notes || "")
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mã phiếu</Label>
                <p className="font-mono font-semibold">{entry.entry_code}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Loại</Label>
                <p><Badge variant={typeVariant}>{typeLabel}</Badge></p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người tạo</Label>
                <p className="font-semibold">{entry.creator?.full_name || "-"}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày tạo</Label>
                <p className="font-semibold">{formatDate(entry.created_at)}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                {!editMode ? (
                  <p className="whitespace-pre-wrap">
                    {entry.notes || <span className="text-muted-foreground">Không có</span>}
                  </p>
                ) : (
                  <>
                    <Textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={3}
                      className="mt-1"
                    />
                    <Button
                      onClick={handleSaveEdit}
                      disabled={actionLoading}
                      className="w-full mt-2"
                    >
                      {actionLoading ? "Đang lưu..." : "Lưu ghi chú"}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa phiếu kho
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Xóa phiếu sẽ xóa toàn bộ dòng chi tiết (không thể khôi phục).
                </p>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa phiếu kho?"
        description={`Phiếu ${entry.entry_code} và ${lines.length} dòng chi tiết sẽ bị xóa vĩnh viễn.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
      </div>

      {/* Print-only section: 1 trang phiếu xuất tổng + 1 trang/đơn chi tiết */}
      <div className="print-only">
        {/* Page 1: aggregate stock entry — A5 portrait, tiết kiệm giấy. */}
        <div className="print-page a5-doc p-4">
          <h1 className="text-center font-bold uppercase mb-2" style={{ fontSize: "11pt" }}>
            {entry.type === "export" ? "Phiếu xuất kho" : entry.type === "import" ? "Phiếu nhập kho" : entry.type === "transfer" ? "Phiếu chuyển kho" : "Phiếu kiểm kê"}
          </h1>

          {/* Compact 2-col header (1 block, 4 fields total). */}
          <div className="grid grid-cols-2 gap-x-4 mb-2 text-[8pt]">
            <p>
              <span className="text-gray-500">Mã phiếu:</span>{" "}
              <span className="font-bold font-mono">{entry.entry_code}</span>
              <span className="text-gray-500 ml-3">Ngày:</span>{" "}
              <span className="font-semibold">{formatDate(entry.created_at)}</span>
            </p>
            <p>
              <span className="text-gray-500">Người lập:</span>{" "}
              <span className="font-semibold">{entry.creator?.full_name || "-"}</span>
              {refOrders.length > 0 && (
                <>
                  <span className="text-gray-500 ml-3">Số đơn gộp:</span>{" "}
                  <span className="font-semibold">{refOrders.length}</span>
                </>
              )}
            </p>
            {entry.notes && (
              <p className="col-span-2">
                <span className="text-gray-500">Ghi chú:</span> {entry.notes}
              </p>
            )}
          </div>

          {/* Section A: HÀNG GIAO KHÁCH = hàng bán + hàng đổi cho khách
              gộp 1 bảng có cột Loại. swap (dự phòng) tách section riêng. */}
          {(() => {
            // Sell rows = lines that aren't tagged. [Swap] = T-12 dự
            // phòng (separate dashed section). [Exchange] = đem đi đổi
            // cho khách — hiển thị qua exchangeRows (đến từ returns
            // table) để có thêm thông tin link với phiếu trả gốc.
            const sellRows = lines.filter((l) => {
              const n = l.notes || ""
              return !n.startsWith("[Swap]") && !n.startsWith("[Exchange]")
            })
            const totalRowCount = sellRows.length + exchangeRows.length
            return (
              <>
                <h2 className="font-bold mb-1" style={{ fontSize: "9pt" }}>
                  HÀNG GIAO KHÁCH ({totalRowCount} dòng)
                </h2>
                <table
                  className="w-full border-collapse mb-3"
                  style={{ fontSize: "8pt" }}
                >
                  <colgroup>
                    <col style={{ width: "8mm" }} />
                    <col style={{ width: "12mm" }} />
                    <col />
                    <col style={{ width: "20mm" }} />
                    <col style={{ width: "12mm" }} />
                    <col style={{ width: "20mm" }} />
                    <col style={{ width: "26mm" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-400">
                      <th className="py-0.5 text-left font-bold">STT</th>
                      <th className="py-0.5 text-left font-bold">Loại</th>
                      <th className="py-0.5 text-left font-bold">Sản phẩm</th>
                      <th className="py-0.5 text-left font-bold">SKU</th>
                      <th className="py-0.5 text-center font-bold">ĐVT</th>
                      <th className="py-0.5 text-right font-bold">Số lượng</th>
                      <th className="py-0.5 text-left font-bold">Vị trí / Lô</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellRows.map((line, index) => {
                      const lineExt = line as unknown as {
                        qty_in_base_uom?: number
                        qty_in_transaction_uom?: number
                        conversion_factor_snapshot?: number
                      }
                      const factor = Number(lineExt.conversion_factor_snapshot ?? 1) || 1
                      const txQty =
                        Number(lineExt.qty_in_transaction_uom ?? line.quantity) || 0
                      const baseQty =
                        Number(lineExt.qty_in_base_uom ?? line.quantity * factor) || 0
                      const baseUnit = line.product?.base_unit || ""
                      const showBase =
                        factor > 1 && baseUnit && baseUnit !== line.unit_name
                      // Notes thường có dạng "Vị trí: Kho Tân Bình - Kệ A1".
                      // Bỏ prefix "Vị trí: " để tiết kiệm chữ.
                      const note = (line.notes || "").replace(/^Vị trí:\s*/, "")
                      return (
                        <tr key={line.id} className="border-b border-gray-200">
                          <td className="py-0.5">{index + 1}</td>
                          <td className="py-0.5">Bán</td>
                          <td className="py-0.5 font-medium">{line.product?.name || "-"}</td>
                          <td className="py-0.5 font-mono">{line.product?.sku || "-"}</td>
                          <td className="py-0.5 text-center">{line.unit_name}</td>
                          <td className="py-0.5 text-right font-semibold">
                            {txQty}
                            {showBase && (
                              <span className="ml-1 font-normal text-gray-600">
                                ({baseQty} {baseUnit})
                              </span>
                            )}
                          </td>
                          <td className="py-0.5">
                            {line.batch?.batch_code
                              ? `${line.batch.batch_code} ${note ? "· " + note : ""}`
                              : note || "-"}
                          </td>
                        </tr>
                      )
                    })}
                    {exchangeRows.map((r, idx) => (
                      <tr
                        key={`ex-${r.sku}`}
                        className="border-b border-gray-200 bg-gray-50"
                      >
                        <td className="py-0.5">{sellRows.length + idx + 1}</td>
                        <td className="py-0.5 font-semibold">Đổi</td>
                        <td className="py-0.5 font-medium">{r.name}</td>
                        <td className="py-0.5 font-mono">{r.sku}</td>
                        <td className="py-0.5 text-center">{r.unit}</td>
                        <td className="py-0.5 text-right font-semibold">{r.qty}</td>
                        <td className="py-0.5 italic">Đem đi đổi cho khách</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-400">
                      <td colSpan={5} className="py-0.5 text-right font-bold">
                        Tổng cộng:
                      </td>
                      <td className="py-0.5 text-right font-bold">
                        {sellRows.reduce((s, l) => s + Number(l.quantity || 0), 0) +
                          exchangeRows.reduce((s, r) => s + r.qty, 0)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )
          })()}

          {/* T-12 Section B: hàng đem đi đổi DỰ PHÒNG (swap_stock_movements)
              — kept separate because these are spare items, not tied to
              a specific customer return. */}
          {swapItems.length > 0 && (
            <div className="border border-dashed border-gray-400 p-2 mb-3">
              <h2 className="font-bold mb-1" style={{ fontSize: "9pt" }}>
                HÀNG ĐEM ĐI ĐỔI DỰ PHÒNG ({swapItems.length})
              </h2>
              <table className="w-full border-collapse" style={{ fontSize: "8pt" }}>
                <colgroup>
                  <col style={{ width: "8mm" }} />
                  <col />
                  <col style={{ width: "20mm" }} />
                  <col style={{ width: "12mm" }} />
                  <col style={{ width: "16mm" }} />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-400">
                    <th className="py-0.5 text-left font-bold">STT</th>
                    <th className="py-0.5 text-left font-bold">Sản phẩm</th>
                    <th className="py-0.5 text-left font-bold">SKU</th>
                    <th className="py-0.5 text-center font-bold">ĐVT</th>
                    <th className="py-0.5 text-right font-bold">SL</th>
                    <th className="py-0.5 text-left font-bold">Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {swapItems.map((s, i) => {
                    const factor =
                      Number(s.qty) > 0
                        ? Number(s.qty_in_base_uom || 0) / Number(s.qty || 1)
                        : 1
                    return (
                      <tr key={s.id} className="border-b border-gray-200">
                        <td className="py-0.5">{i + 1}</td>
                        <td className="py-0.5 font-medium">{s.product?.name || "-"}</td>
                        <td className="py-0.5 font-mono">{s.product?.sku || "-"}</td>
                        <td className="py-0.5 text-center">{s.unit_name}</td>
                        <td className="py-0.5 text-right font-semibold">
                          {s.qty}
                          {factor > 1 && (
                            <span className="ml-1 font-normal text-gray-600">
                              ({s.qty_in_base_uom})
                            </span>
                          )}
                        </td>
                        <td className="py-0.5 italic">{s.reason || "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="italic text-gray-500 mt-1" style={{ fontSize: "7pt" }}>
                Hàng cầm theo dự phòng. Phần chưa dùng nhập lại kho ở bước Bàn giao lại.
              </p>
            </div>
          )}

          {/* Compact signatures — mt-8 + mb-12 instead of mt-16 + mb-20.
              Saves ~3cm vertical space per slip. */}
          <div className="grid grid-cols-3 gap-4 text-center signatures mt-6">
            <div>
              <p className="font-bold" style={{ fontSize: "8pt" }}>Người lập phiếu</p>
              <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
              <div style={{ height: "16mm" }} />
            </div>
            <div>
              <p className="font-bold" style={{ fontSize: "8pt" }}>Thủ kho</p>
              <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
              <div style={{ height: "16mm" }} />
            </div>
            <div>
              <p className="font-bold" style={{ fontSize: "8pt" }}>Người nhận</p>
              <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
              <div style={{ height: "16mm" }} />
            </div>
          </div>
        </div>

        {/* Pages 2..n: per-order delivery slip */}
        {refOrders.map((o, idx) => {
          const orderLines = o.lines || []
          const orderQty = orderLines.reduce((s, l) => s + Number(l.quantity || 0), 0)
          const orderTotal = orderLines.reduce(
            (s, l) => s + Number(l.line_total || Number(l.unit_price || 0) * Number(l.quantity || 0)),
            0
          )
          const fullAddress = [o.customer?.address, o.customer?.ward, o.customer?.district, o.customer?.province]
            .filter(Boolean)
            .join(", ")
          return (
            <div key={o.id} className="print-page a5-doc p-4">
              <div className="flex justify-between items-start mb-1" style={{ fontSize: "7pt", color: "#666" }}>
                <span>Phiếu giao hàng — {entry.entry_code}</span>
                <span>{idx + 1}/{refOrders.length}</span>
              </div>
              <h1 className="text-center font-bold uppercase" style={{ fontSize: "11pt" }}>
                Phiếu giao hàng
              </h1>
              <p className="text-center font-mono font-bold mb-2" style={{ fontSize: "9pt" }}>
                {o.order_code}
              </p>

              <div className="grid grid-cols-2 gap-x-3 mb-2" style={{ fontSize: "8pt" }}>
                <div>
                  <p>
                    <span className="text-gray-500">Khách:</span>{" "}
                    <span className="font-bold">{o.customer?.store_name || "-"}</span>
                  </p>
                  {o.customer?.phone && (
                    <p>
                      <span className="text-gray-500">SĐT:</span>{" "}
                      <span className="font-semibold">{o.customer.phone}</span>
                    </p>
                  )}
                  {fullAddress && (
                    <p>
                      <span className="text-gray-500">Địa chỉ:</span>{" "}
                      <span className="font-semibold">{fullAddress}</span>
                    </p>
                  )}
                </div>
                <div>
                  <p>
                    <span className="text-gray-500">Ngày đặt:</span>{" "}
                    <span className="font-semibold">{o.order_date ? formatDate(o.order_date) : "-"}</span>
                  </p>
                  <p>
                    <span className="text-gray-500">Hình thức:</span>{" "}
                    <span className="font-semibold">{o.payment_terms || "COD"}</span>
                  </p>
                  {o.notes && (
                    <p>
                      <span className="text-gray-500">Ghi chú:</span> {o.notes}
                    </p>
                  )}
                </div>
              </div>

              <table className="w-full border-collapse mb-2" style={{ fontSize: "8pt" }}>
                <colgroup>
                  <col style={{ width: "8mm" }} />
                  <col />
                  <col style={{ width: "20mm" }} />
                  <col style={{ width: "11mm" }} />
                  <col style={{ width: "13mm" }} />
                  <col style={{ width: "20mm" }} />
                  <col style={{ width: "22mm" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-400">
                    <th className="py-0.5 text-left font-bold">STT</th>
                    <th className="py-0.5 text-left font-bold">Sản phẩm</th>
                    <th className="py-0.5 text-left font-bold">SKU</th>
                    <th className="py-0.5 text-center font-bold">ĐVT</th>
                    <th className="py-0.5 text-right font-bold">SL</th>
                    <th className="py-0.5 text-right font-bold">Đơn giá</th>
                    <th className="py-0.5 text-right font-bold">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {orderLines.map((l, i) => {
                    const lineTotal = Number(l.line_total || Number(l.unit_price || 0) * Number(l.quantity || 0))
                    return (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="py-0.5">{i + 1}</td>
                        <td className="py-0.5 font-medium">
                          {l.product?.name || "-"}
                          {l.note && (
                            <span className="italic text-gray-600 ml-1" style={{ fontSize: "7pt" }}>
                              ✏ {l.note}
                            </span>
                          )}
                        </td>
                        <td className="py-0.5 font-mono">{l.product?.sku || "-"}</td>
                        <td className="py-0.5 text-center">{l.unit_name}</td>
                        <td className="py-0.5 text-right font-semibold">{l.quantity}</td>
                        <td className="py-0.5 text-right">
                          {l.unit_price ? formatCurrency(Number(l.unit_price)) : "-"}
                        </td>
                        <td className="py-0.5 text-right font-semibold">
                          {lineTotal ? formatCurrency(lineTotal) : "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-400 font-bold">
                    <td colSpan={4} className="py-0.5 text-right">Tổng cộng:</td>
                    <td className="py-0.5 text-right">{orderQty}</td>
                    <td className="py-0.5"></td>
                    <td className="py-0.5 text-right">
                      {formatCurrency(Number(o.total || orderTotal))}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Hàng trả về — in luôn trên phiếu giao để lái xe nhớ
                  thu hàng trả. Nếu không có phiếu trả nào, vẫn in
                  bảng trống với 3 dòng để ghi tay. */}
              {(() => {
                const allReturnLines = (o.returns || []).flatMap((r) => r.lines || [])
                // Refund-side total only — exchange items don't deduct
                // công nợ on the slip.
                const refundOnly = allReturnLines.filter((l) => !l.is_exchange)
                const totalReturnQty = refundOnly.reduce(
                  (s, l) => s + Number(l.quantity || 0),
                  0
                )
                const totalReturnValue = refundOnly.reduce(
                  (s, l) =>
                    s +
                    Number(
                      l.line_total != null
                        ? l.line_total
                        : Number(l.unit_price || 0) * Number(l.quantity || 0)
                    ),
                  0
                )
                const hasReturns = allReturnLines.length > 0
                return (
                  <div className="mb-2">
                    <h2 className="font-bold mt-2 mb-1" style={{ fontSize: "9pt" }}>
                      Hàng trả về (thu về kho)
                    </h2>
                    <p className="text-gray-500 mb-1" style={{ fontSize: "7pt" }}>
                      {hasReturns
                        ? "Thu lại các SP dưới đây và đối chiếu với khách trước khi rời điểm giao."
                        : "Đơn chưa có yêu cầu trả. Nếu khách trả tại điểm giao, ghi tay vào các dòng trống."}
                    </p>
                    <table className="w-full border-collapse" style={{ fontSize: "8pt" }}>
                      <colgroup>
                        <col style={{ width: "8mm" }} />
                        <col />
                        <col style={{ width: "20mm" }} />
                        <col style={{ width: "11mm" }} />
                        <col style={{ width: "13mm" }} />
                        <col style={{ width: "20mm" }} />
                        <col style={{ width: "22mm" }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-gray-400">
                          <th className="py-0.5 text-left font-bold">STT</th>
                          <th className="py-0.5 text-left font-bold">Sản phẩm</th>
                          <th className="py-0.5 text-left font-bold">SKU</th>
                          <th className="py-0.5 text-center font-bold">ĐVT</th>
                          <th className="py-0.5 text-right font-bold">SL</th>
                          <th className="py-0.5 text-right font-bold">Đơn giá</th>
                          <th className="py-0.5 text-right font-bold">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hasReturns
                          ? allReturnLines.map((l, i) => {
                              const lineTotal = Number(
                                l.line_total != null
                                  ? l.line_total
                                  : Number(l.unit_price || 0) * Number(l.quantity || 0)
                              )
                              return (
                                <tr key={i} className="border-b border-gray-200">
                                  <td className="py-0.5">{i + 1}</td>
                                  <td className="py-0.5 font-medium">
                                    {l.product?.name || "-"}
                                    {l.is_exchange && (
                                      <span
                                        className="font-bold uppercase px-1 ml-1 rounded bg-blue-100 text-blue-800 border border-blue-300"
                                        style={{ fontSize: "7pt" }}
                                      >
                                        ĐỔI
                                      </span>
                                    )}
                                    {l.note && (
                                      <span
                                        className="italic text-gray-600 ml-1"
                                        style={{ fontSize: "7pt" }}
                                      >
                                        ✏ {l.note}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-0.5 font-mono">{l.product?.sku || "-"}</td>
                                  <td className="py-0.5 text-center">{l.unit_name}</td>
                                  <td className="py-0.5 text-right font-semibold">
                                    {l.quantity}
                                  </td>
                                  <td className="py-0.5 text-right">
                                    {l.is_exchange
                                      ? <span className="text-blue-700 font-semibold">đổi</span>
                                      : l.unit_price
                                        ? formatCurrency(Number(l.unit_price))
                                        : "-"}
                                  </td>
                                  <td className="py-0.5 text-right font-semibold">
                                    {l.is_exchange
                                      ? <span className="text-blue-700">—</span>
                                      : lineTotal
                                        ? formatCurrency(lineTotal)
                                        : "-"}
                                  </td>
                                </tr>
                              )
                            })
                          : Array.from({ length: 3 }, (_, i) => (
                              <tr key={`blank-${i}`} className="border-b border-gray-300">
                                <td style={{ height: "5mm" }}>{i + 1}</td>
                                <td></td>
                                <td></td>
                                <td className="text-center"></td>
                                <td className="text-right"></td>
                                <td className="text-right"></td>
                                <td className="text-right"></td>
                              </tr>
                            ))}
                      </tbody>
                      {hasReturns ? (
                        <tfoot>
                          <tr className="border-t border-gray-400 font-bold">
                            <td colSpan={4} className="py-0.5 text-right">
                              Tổng trả (trừ công nợ):
                            </td>
                            <td className="py-0.5 text-right">{totalReturnQty}</td>
                            <td className="py-0.5"></td>
                            <td className="py-0.5 text-right">
                              {formatCurrency(totalReturnValue)}
                            </td>
                          </tr>
                          {allReturnLines.some((l) => l.is_exchange) && (
                            <tr>
                              <td
                                colSpan={7}
                                className="italic text-blue-700"
                                style={{ fontSize: "7pt" }}
                              >
                                * ĐỔI = thu về kho, KHÔNG trừ công nợ.
                              </td>
                            </tr>
                          )}
                        </tfoot>
                      ) : (
                        <tfoot>
                          <tr className="border-t border-gray-400 font-bold">
                            <td colSpan={4} className="py-0.5 text-right">
                              Tổng trả (ghi tay):
                            </td>
                            <td className="py-0.5 text-right">_______</td>
                            <td className="py-0.5"></td>
                            <td className="py-0.5 text-right">_______</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                    {(o.returns || []).map((r, ri) => {
                      const reasonText = r.reason
                        ? ({
                            damaged: "Hỏng/vỡ",
                            wrong_item: "Sai hàng",
                            near_expiry: "Cận date",
                            expired: "Hết hạn",
                            refused: "Khách từ chối",
                          } as Record<string, string>)[r.reason] || r.reason
                        : "—"
                      const statusText = r.status
                        ? ({
                            pending: "Chờ duyệt",
                            approved: "Đã duyệt",
                            completed: "Hoàn tất",
                          } as Record<string, string>)[r.status] || r.status
                        : ""
                      return (
                        <p
                          key={r.id}
                          className="text-gray-600 mt-0.5"
                          style={{ fontSize: "7pt" }}
                        >
                          <span className="font-semibold">Phiếu trả {ri + 1}:</span>{" "}
                          {statusText ? `[${statusText}] ` : ""}Lý do: {reasonText}
                          {r.credit_note_amount != null
                            ? ` • Credit note: ${formatCurrency(Number(r.credit_note_amount))}`
                            : ""}
                          {r.notes ? ` • ${r.notes}` : ""}
                        </p>
                      )
                    })}
                    {(() => {
                      const netDue =
                        Number(o.total || orderTotal) - totalReturnValue
                      return (
                        <div
                          className="mt-1 flex items-center justify-end gap-2 border-t border-gray-400 pt-1"
                          style={{ fontSize: "9pt" }}
                        >
                          <span className="text-gray-500">
                            {hasReturns ? "Còn phải thu:" : "Số phải thu:"}
                          </span>
                          <span className="font-bold" style={{ fontSize: "10pt" }}>
                            {formatCurrency(Math.max(0, netDue))}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              <div className="grid grid-cols-3 gap-3 text-center signatures mt-4">
                <div>
                  <p className="font-bold" style={{ fontSize: "8pt" }}>Thủ kho</p>
                  <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
                  <div style={{ height: "16mm" }} />
                </div>
                <div>
                  <p className="font-bold" style={{ fontSize: "8pt" }}>Lái xe / Giao hàng</p>
                  <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
                  <div style={{ height: "16mm" }} />
                </div>
                <div>
                  <p className="font-bold" style={{ fontSize: "8pt" }}>Khách hàng</p>
                  <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
                  <div style={{ height: "16mm" }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* T-10: alternate print section — danh sách giao (A5 portrait).
          Active when html[data-print-mode='driver-list']. */}
      <div className="print-driver-list-only">
        <DriverList
          shipmentCode={entry.entry_code}
          shipmentDate={entry.posted_at || entry.created_at}
          orders={refOrders.map<DriverListOrder>((o) => ({
            id: o.id,
            orderCode: o.order_code,
            customerName: o.customer?.store_name || "—",
            deliveryAddress:
              [
                o.customer?.address,
                o.customer?.ward,
                o.customer?.district,
                o.customer?.province,
              ]
                .filter(Boolean)
                .join(", ") || null,
            totalToCollect: Number(o.total || 0),
          }))}
        />
      </div>
    </div>
  )
}
