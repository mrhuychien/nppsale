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
import { Pencil, Trash2, X, Package, Truck, HandCoins } from "lucide-react"
import { PrintButton } from "@/components/ui/print-button"
import type { StockEntry, StockEntryLine } from "@/types"

export default function StockEntryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [entry, setEntry] = useState<StockEntry | null>(null)
  const [lines, setLines] = useState<StockEntryLine[]>([])
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
    const [entryRes, linesRes] = await Promise.all([
      supabase
        .from("stock_entries")
        .select("*, creator:users!stock_entries_created_by_fkey(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("stock_entry_lines")
        .select("*, product:products(*), batch:batches(*)")
        .eq("entry_id", id),
    ])
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
            "id, order_code, order_date, subtotal, vat, total, payment_terms, notes, customer:customers(store_name, phone, address, ward, district, province), lines:sales_order_lines(product_id, unit_name, quantity, unit_price, line_total, note, product:products(name, sku))"
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
      // 1) FEFO trừ batches + stamp unit_cost lên từng line
      for (const l of lines) {
        let remaining = Number(l.quantity || 0)
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
            <PrintButton />

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
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <div className="font-semibold">{line.product?.name || "-"}</div>
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
                          <TableCell className="text-right font-bold">{line.quantity}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                            {line.notes || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden space-y-2">
                  {lines.map((line) => (
                    <div key={line.id} className="rounded-xl border bg-muted/20 p-3">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm leading-tight">{line.product?.name || "-"}</p>
                          <p className="font-mono text-xs text-muted-foreground mt-0.5">
                            SKU: {line.product?.sku}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold text-base">{line.quantity} {line.unit_name}</span>
                      </div>
                      {line.batch?.batch_code && (
                        <span className="font-mono text-xs bg-surface-container px-2 py-0.5 rounded inline-block">
                          Lô: {line.batch.batch_code}
                        </span>
                      )}
                      {line.notes && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{line.notes}</p>
                      )}
                    </div>
                  ))}
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
                              {l.quantity} {l.unit_name}
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
        <div className="space-y-4">
          {entry.type === "export" && entry.status === "draft" && (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HandCoins className="h-5 w-5 text-emerald-600" />
                  Tự giao hàng
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Dùng khi NPP / chủ xe trực tiếp giao mà lái xe không dùng phần mềm.
                  Sau khi bấm, tồn kho sẽ trừ ngay, đơn chuyển trạng thái{" "}
                  <span className="font-semibold">đã giao</span> rồi chuyển sang trang thu tiền.
                </p>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-600/90 text-white"
                  onClick={handleSelfDeliver}
                  disabled={selfDelivering || lines.length === 0}
                >
                  <HandCoins className="h-4 w-4 mr-2" />
                  {selfDelivering ? "Đang xử lý..." : "Tự giao hàng & thu tiền"}
                </Button>
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
        </div>
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
        {/* Page 1: aggregate stock entry */}
        <div className="print-page p-8">
          <h1 className="text-2xl font-black text-center uppercase mb-6">
            {entry.type === "export" ? "Phiếu xuất kho" : entry.type === "import" ? "Phiếu nhập kho" : entry.type === "transfer" ? "Phiếu chuyển kho" : "Phiếu kiểm kê"}
          </h1>

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p><span className="text-gray-500">Mã phiếu:</span> <span className="font-bold font-mono">{entry.entry_code}</span></p>
              <p><span className="text-gray-500">Ngày tạo:</span> <span className="font-semibold">{formatDate(entry.created_at)}</span></p>
              {refOrders.length > 0 && (
                <p><span className="text-gray-500">Số đơn gộp:</span> <span className="font-semibold">{refOrders.length}</span></p>
              )}
            </div>
            <div>
              <p><span className="text-gray-500">Người lập:</span> <span className="font-semibold">{entry.creator?.full_name || "-"}</span></p>
              {entry.notes && <p><span className="text-gray-500">Ghi chú:</span> {entry.notes}</p>}
            </div>
          </div>

          <table className="w-full text-sm border-collapse mb-8">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="py-2 text-left font-bold w-12">STT</th>
                <th className="py-2 text-left font-bold">Sản phẩm</th>
                <th className="py-2 text-left font-bold w-24">SKU</th>
                <th className="py-2 text-center font-bold w-16">ĐVT</th>
                <th className="py-2 text-right font-bold w-20">Số lượng</th>
                <th className="py-2 text-left font-bold w-28">Lô hàng</th>
                <th className="py-2 text-left font-bold">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id} className="border-b border-gray-200">
                  <td className="py-2">{index + 1}</td>
                  <td className="py-2 font-medium">{line.product?.name || "-"}</td>
                  <td className="py-2 font-mono text-xs">{line.product?.sku || "-"}</td>
                  <td className="py-2 text-center">{line.unit_name}</td>
                  <td className="py-2 text-right font-bold">{line.quantity}</td>
                  <td className="py-2 text-xs">{line.batch?.batch_code || "-"}</td>
                  <td className="py-2 text-xs">{line.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300">
                <td colSpan={4} className="py-2 text-right font-bold">Tổng cộng:</td>
                <td className="py-2 text-right font-black">{totalQty}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>

          <div className="grid grid-cols-3 gap-8 text-center text-sm mt-16">
            <div>
              <p className="font-bold">Người lập phiếu</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
            </div>
            <div>
              <p className="font-bold">Thủ kho</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
            </div>
            <div>
              <p className="font-bold">Người nhận</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
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
            <div key={o.id} className="print-page p-8">
              <div className="flex justify-between items-start mb-4 text-xs text-gray-500">
                <span>Phiếu giao hàng — {entry.entry_code}</span>
                <span>{idx + 1}/{refOrders.length}</span>
              </div>
              <h1 className="text-2xl font-black text-center uppercase mb-1">
                Phiếu giao hàng
              </h1>
              <p className="text-center font-mono font-bold mb-6">{o.order_code}</p>

              <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
                <div className="space-y-1">
                  <p><span className="text-gray-500">Khách hàng:</span> <span className="font-bold">{o.customer?.store_name || "-"}</span></p>
                  {o.customer?.phone && (
                    <p><span className="text-gray-500">SĐT:</span> <span className="font-semibold">{o.customer.phone}</span></p>
                  )}
                  {fullAddress && (
                    <p><span className="text-gray-500">Địa chỉ:</span> <span className="font-semibold">{fullAddress}</span></p>
                  )}
                </div>
                <div className="space-y-1">
                  <p><span className="text-gray-500">Ngày đặt:</span> <span className="font-semibold">{o.order_date ? formatDate(o.order_date) : "-"}</span></p>
                  <p><span className="text-gray-500">Hình thức:</span> <span className="font-semibold">{o.payment_terms || "COD"}</span></p>
                  {o.notes && <p><span className="text-gray-500">Ghi chú:</span> {o.notes}</p>}
                </div>
              </div>

              <table className="w-full text-sm border-collapse mb-6">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="py-2 text-left font-bold w-10">STT</th>
                    <th className="py-2 text-left font-bold">Sản phẩm</th>
                    <th className="py-2 text-left font-bold w-24">SKU</th>
                    <th className="py-2 text-center font-bold w-14">ĐVT</th>
                    <th className="py-2 text-right font-bold w-16">SL</th>
                    <th className="py-2 text-right font-bold w-24">Đơn giá</th>
                    <th className="py-2 text-right font-bold w-28">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {orderLines.map((l, i) => {
                    const lineTotal = Number(l.line_total || Number(l.unit_price || 0) * Number(l.quantity || 0))
                    return (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="py-1.5">{i + 1}</td>
                        <td className="py-1.5 font-medium">
                          <div>{l.product?.name || "-"}</div>
                          {l.note && (
                            <div className="text-[11px] italic text-gray-600 mt-0.5">
                              ✏ {l.note}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 font-mono text-xs">{l.product?.sku || "-"}</td>
                        <td className="py-1.5 text-center">{l.unit_name}</td>
                        <td className="py-1.5 text-right font-bold">{l.quantity}</td>
                        <td className="py-1.5 text-right">{l.unit_price ? formatCurrency(Number(l.unit_price)) : "-"}</td>
                        <td className="py-1.5 text-right font-semibold">{lineTotal ? formatCurrency(lineTotal) : "-"}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300">
                    <td colSpan={4} className="py-2 text-right font-bold">Tổng cộng:</td>
                    <td className="py-2 text-right font-black">{orderQty}</td>
                    <td className="py-2 text-right text-gray-500 text-xs">Tổng tiền</td>
                    <td className="py-2 text-right font-black">
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
                  <div className="mb-6">
                    <h2 className="text-base font-bold mb-2 mt-4">
                      Hàng trả về (thu về kho)
                    </h2>
                    <p className="text-xs text-gray-500 mb-2">
                      {hasReturns
                        ? "Thu lại các sản phẩm dưới đây và đối chiếu với khách trước khi rời điểm giao."
                        : "Đơn này hiện chưa có yêu cầu trả. Nếu khách trả tại điểm giao, ghi tay vào các dòng trống bên dưới."}
                    </p>
                    <table className="w-full text-sm border-collapse mb-2">
                      <thead>
                        <tr className="border-b-2 border-gray-300">
                          <th className="py-2 text-left font-bold w-10">STT</th>
                          <th className="py-2 text-left font-bold">Sản phẩm</th>
                          <th className="py-2 text-left font-bold w-24">SKU</th>
                          <th className="py-2 text-center font-bold w-14">ĐVT</th>
                          <th className="py-2 text-right font-bold w-16">SL</th>
                          <th className="py-2 text-right font-bold w-24">Đơn giá</th>
                          <th className="py-2 text-right font-bold w-28">Thành tiền</th>
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
                                  <td className="py-1.5">{i + 1}</td>
                                  <td className="py-1.5 font-medium">
                                    <div className="flex items-center gap-1.5">
                                      <span>{l.product?.name || "-"}</span>
                                      {l.is_exchange && (
                                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                                          ĐỔI
                                        </span>
                                      )}
                                    </div>
                                    {l.note && (
                                      <div className="text-[11px] italic text-gray-600 mt-0.5">
                                        ✏ {l.note}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1.5 font-mono text-xs">
                                    {l.product?.sku || "-"}
                                  </td>
                                  <td className="py-1.5 text-center">{l.unit_name}</td>
                                  <td className="py-1.5 text-right font-bold">
                                    {l.quantity}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    {l.is_exchange ? (
                                      <span className="text-blue-700 font-semibold">đổi</span>
                                    ) : l.unit_price ? (
                                      formatCurrency(Number(l.unit_price))
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                  <td className="py-1.5 text-right font-semibold">
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
                                <td className="py-3">{i + 1}</td>
                                <td className="py-3"></td>
                                <td className="py-3"></td>
                                <td className="py-3 text-center"></td>
                                <td className="py-3 text-right"></td>
                                <td className="py-3 text-right"></td>
                                <td className="py-3 text-right"></td>
                              </tr>
                            ))}
                      </tbody>
                      {hasReturns ? (
                        <tfoot>
                          <tr className="border-t-2 border-gray-300">
                            <td colSpan={4} className="py-2 text-right font-bold">
                              Tổng trả (trừ công nợ):
                            </td>
                            <td className="py-2 text-right font-black">
                              {totalReturnQty}
                            </td>
                            <td className="py-2 text-right text-gray-500 text-xs">
                              Giá trị trừ
                            </td>
                            <td className="py-2 text-right font-black">
                              {formatCurrency(totalReturnValue)}
                            </td>
                          </tr>
                          {allReturnLines.some((l) => l.is_exchange) && (
                            <tr>
                              <td colSpan={7} className="py-1.5 text-[11px] italic text-blue-700">
                                * Dòng có nhãn ĐỔI là hàng đổi: thu về kho nhưng KHÔNG trừ công nợ.
                              </td>
                            </tr>
                          )}
                        </tfoot>
                      ) : (
                        <tfoot>
                          <tr className="border-t-2 border-gray-300">
                            <td colSpan={4} className="py-2 text-right font-bold">
                              Tổng trả (ghi tay):
                            </td>
                            <td className="py-2 text-right">_______</td>
                            <td className="py-2 text-right text-gray-500 text-xs">
                              Giá trị trả
                            </td>
                            <td className="py-2 text-right">_______</td>
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
                        <p key={r.id} className="text-xs text-gray-600 mt-1">
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
                        <div className="mt-2 flex items-center justify-end gap-3 border-t border-gray-300 pt-2 text-sm">
                          <span className="text-gray-500">
                            {hasReturns
                              ? "Còn phải thu (sau trả):"
                              : "Số phải thu (trước trả tại điểm giao):"}
                          </span>
                          <span className="font-black text-base">
                            {formatCurrency(Math.max(0, netDue))}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              <div className="grid grid-cols-3 gap-8 text-center text-sm mt-12">
                <div>
                  <p className="font-bold">Thủ kho</p>
                  <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
                </div>
                <div>
                  <p className="font-bold">Lái xe / Giao hàng</p>
                  <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
                </div>
                <div>
                  <p className="font-bold">Khách hàng</p>
                  <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
