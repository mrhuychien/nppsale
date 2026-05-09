"use client"

/**
 * T-07: Driver handover ("Bàn giao lại") confirmation page.
 *
 * Data model — items giờ DERIVED từ failed-order selections + customer
 * returns + unused swap stock (đã có) — không phải state cố định:
 *
 *  failedDrafts        → orderId, mode (failed | partial), selected, …
 *  itemEdits           → Map<key, Partial<ItemDraft>>  (qty / zone / …)
 *  removedKeys         → Set<key>                       (user x bỏ row)
 *  customerReturnItems → seeded từ delivered orders' returns
 *  unusedSwapItems     → seeded từ swap_stock_movements remaining
 *
 *  derived itemDrafts  = build(failedDrafts.filter(selected),
 *                              customerReturnItems, unusedSwapItems)
 *                        |> apply itemEdits |> filter !removedKeys
 *
 * Tick / untick failed order → items tự thêm / xoá. User edit qty
 * / zone trên 1 dòng → giữ qua mọi re-derive.
 *
 * Đơn nào có receivable.paid > 0 → đã giao 1 phần / 100% → bỏ khỏi
 * failed list (vẫn còn ở customer_return nếu có returns).
 *
 * Partial mode = customer nhận 1 phần đơn → user chỉnh qty từng dòng
 * xuống số "đem về kho" (hoặc xoá dòng nếu khách nhận hết).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronLeft, PackageOpen, Truck, AlertTriangle, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import {
  createAndConfirmHandover,
  FAILURE_REASON_LABELS,
  ZONE_LABELS,
  type FailureReason,
  type HandoverItemInput,
  type WarehouseZone,
} from "@/lib/handover/confirm"

interface DeliveryRow {
  id: string
  org_id: string
  driver_id: string | null
  route_name: string | null
  status: string
  driver?: { full_name: string } | null
}

interface OrderLineRow {
  id: string
  product_id: string
  unit_name: string
  quantity: number
  conversion_factor: number | null
  product?: { name: string; sku: string; base_unit: string } | null
}

interface ReturnLineRow {
  id: string
  product_id: string
  unit_name: string
  quantity: number
  is_exchange: boolean | null
  product?: { name: string; sku: string; base_unit?: string } | null
}

interface DeliveryLineWithOrder {
  id: string
  status: string
  order_id: string
  order?: {
    id: string
    order_code: string
    customer_id: string
    total: number
    customer?: { store_name: string } | null
    lines?: OrderLineRow[]
    returns?: Array<{
      id: string
      status: string
      return_lines?: ReturnLineRow[]
    }>
  }
}

type FailedOrderMode = "failed" | "partial"

interface FailedOrderDraft {
  orderId: string
  orderCode: string
  customerName: string
  total: number
  /** sales_order_lines snapshot — deriving items khi tick. */
  lines: OrderLineRow[]
  failureReason: FailureReason
  notes: string
  selected: boolean
  /** failed = toàn bộ về kho. partial = khách nhận 1 phần, user chỉnh
   *  qty từng dòng xuống "phần về kho". */
  mode: FailedOrderMode
}

type ItemSourceType = "failed_order" | "customer_return" | "unused_swap_stock"

interface ItemDraft {
  /** Stable key — luôn unique per source row. */
  key: string
  sourceType: ItemSourceType
  sourceOrderId: string | null
  swapMovementId: string | null
  productId: string
  productName: string
  sku: string
  qty: string
  unitName: string
  conversionFactor: number
  destinationZone: WarehouseZone
  reason: string
  swappedToCustomer: boolean
}

interface ReceivableLite {
  order_id: string | null
  paid: number
}

export default function DeliveryHandoverPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [delivery, setDelivery] = useState<DeliveryRow | null>(null)
  const [failedDrafts, setFailedDrafts] = useState<FailedOrderDraft[]>([])
  /** Customer-return items seeded từ delivered orders' returns. Always
   *  shown unless user removes. */
  const [customerReturnItems, setCustomerReturnItems] = useState<ItemDraft[]>([])
  /** Unused swap stock items. Always shown unless user removes. */
  const [unusedSwapItems, setUnusedSwapItems] = useState<ItemDraft[]>([])
  /** User edits per-key: qty / zone / reason / swappedToCustomer. */
  const [itemEdits, setItemEdits] = useState<
    Map<string, Partial<ItemDraft>>
  >(new Map())
  /** User explicitly removed rows — don't auto-add back. */
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    if (!id || !user?.org_id) return
    setLoading(true)

    const [delRes, lineRes] = await Promise.all([
      supabase
        .from("deliveries")
        .select(
          "id, org_id, driver_id, route_name, status, driver:users!deliveries_driver_id_fkey(full_name)"
        )
        .eq("id", id)
        .single(),
      supabase
        .from("delivery_lines")
        .select(
          "id, status, order_id, order:sales_orders(id, order_code, customer_id, total, customer:customers(store_name), lines:sales_order_lines(id, product_id, unit_name, quantity, conversion_factor, product:products(name, sku, base_unit)), returns(id, status, return_lines(id, product_id, unit_name, quantity, is_exchange, product:products(name, sku, base_unit))))"
        )
        .eq("delivery_id", id),
    ])

    setDelivery((delRes.data as unknown as DeliveryRow) || null)
    const linesData =
      ((lineRes.data as unknown) as DeliveryLineWithOrder[]) || []

    // Fetch receivables để biết đơn nào đã thu tiền (paid > 0).
    const orderIds = linesData
      .map((dl) => dl.order_id)
      .filter(Boolean) as string[]
    const paidByOrder = new Map<string, number>()
    if (orderIds.length > 0) {
      const { data: receivables } = await supabase
        .from("receivables")
        .select("order_id, paid")
        .in("order_id", orderIds)
      ;(((receivables as ReceivableLite[]) || [])).forEach((r) => {
        if (r.order_id) {
          paidByOrder.set(r.order_id, (paidByOrder.get(r.order_id) || 0) + Number(r.paid || 0))
        }
      })
    }

    // FAILED list — ONLY orders chưa giao (delivery_line.status !=
    // 'delivered') VÀ chưa thu tiền (paid = 0).
    // Đơn có thu tiền (full hoặc partial) = đã giao → loại khỏi failed.
    const failed = linesData
      .filter((dl) => {
        if (!dl.order) return false
        if (dl.status === "delivered") return false
        const paid = paidByOrder.get(dl.order.id) || 0
        if (paid > 0) return false
        return true
      })
      .map<FailedOrderDraft>((dl) => ({
        orderId: dl.order!.id,
        orderCode: dl.order!.order_code,
        customerName: dl.order!.customer?.store_name || "—",
        total: Number(dl.order!.total || 0),
        lines: dl.order!.lines || [],
        failureReason: "customer_absent",
        notes: "",
        selected:
          dl.status === "failed" ||
          dl.status === "partial" ||
          dl.status === "pending",
        mode: dl.status === "partial" ? "partial" : "failed",
      }))
    setFailedDrafts(failed)

    // CUSTOMER RETURN items — luôn hiện cho mọi đơn delivered (paid > 0
    // OR status='delivered') có returns. Failed orders đã có returns
    // thì returns riêng đó được include cùng nguồn.
    const crItems: ItemDraft[] = []
    linesData.forEach((dl) => {
      if (!dl.order) return
      ;(dl.order.returns || []).forEach((r) => {
        if (r.status === "rejected") return
        ;(r.return_lines || []).forEach((rl) => {
          crItems.push({
            key: `ret-${rl.id}`,
            sourceType: "customer_return",
            sourceOrderId: dl.order!.id,
            swapMovementId: null,
            productId: rl.product_id,
            productName: rl.product?.name || "—",
            sku: rl.product?.sku || "",
            qty: String(rl.quantity ?? 0),
            unitName: rl.unit_name,
            conversionFactor: 1,
            destinationZone: rl.is_exchange ? "date" : "sale",
            reason: rl.is_exchange
              ? `Đổi từ đơn ${dl.order!.order_code} (kho date)`
              : `Trả từ đơn ${dl.order!.order_code} (trừ công nợ)`,
            swappedToCustomer: !!rl.is_exchange,
          })
        })
      })
    })
    setCustomerReturnItems(crItems)

    // UNUSED SWAP — Q7 wiring (T-12 không trong phiên bản này nhưng
    // schema có).
    const swapItems: ItemDraft[] = []
    if (orderIds.length > 0) {
      const { data: entries } = await supabase
        .from("stock_entries")
        .select("id, ref_order_ids")
        .eq("type", "export")
      const entryIds = (
        (entries as Array<{ id: string; ref_order_ids: string[] | null }>) || []
      )
        .filter((e) => {
          const refs = e.ref_order_ids || []
          return refs.some((rid) => orderIds.includes(rid))
        })
        .map((e) => e.id)
      if (entryIds.length > 0) {
        const { data: swapRows } = await supabase
          .from("swap_stock_movements")
          .select(
            "id, product_id, qty, unit_name, conversion_factor, qty_in_base_uom, qty_returned_in_base_uom, reason, product:products(name, sku)"
          )
          .in("stock_entry_id", entryIds)
        ;(((swapRows as unknown) as Array<{
          id: string
          product_id: string
          qty: number
          unit_name: string
          conversion_factor: number
          qty_in_base_uom: number
          qty_returned_in_base_uom: number
          reason: string | null
          product?: { name: string; sku: string } | null
        }>) || []).forEach((sw) => {
          const remainingBase =
            Number(sw.qty_in_base_uom || 0) -
            Number(sw.qty_returned_in_base_uom || 0)
          if (remainingBase <= 0) return
          const factor = Number(sw.conversion_factor || 1) || 1
          const remainingTx = remainingBase / factor
          swapItems.push({
            key: `sw-${sw.id}`,
            sourceType: "unused_swap_stock",
            sourceOrderId: null,
            swapMovementId: sw.id,
            productId: sw.product_id,
            productName: sw.product?.name || "—",
            sku: sw.product?.sku || "",
            qty: String(remainingTx),
            unitName: sw.unit_name,
            conversionFactor: factor,
            destinationZone: "sale",
            reason: sw.reason || "Hàng đem đi đổi không dùng",
            swappedToCustomer: false,
          })
        })
      }
    }
    setUnusedSwapItems(swapItems)

    setItemEdits(new Map())
    setRemovedKeys(new Set())
    setLoading(false)
  }, [id, user?.org_id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Derive itemDrafts: failedDrafts.selected → 1 row per line. Apply
  // edits + filter removedKeys.
  const itemDrafts = useMemo<ItemDraft[]>(() => {
    const out: ItemDraft[] = []

    // (a) failed_order items — chỉ orders đã tick.
    failedDrafts.forEach((f) => {
      if (!f.selected) return
      f.lines.forEach((ln) => {
        const factor = Number(ln.conversion_factor || 1)
        const baseDraft: ItemDraft = {
          key: `fo-${ln.id}`,
          sourceType: "failed_order",
          sourceOrderId: f.orderId,
          swapMovementId: null,
          productId: ln.product_id,
          productName: ln.product?.name || "—",
          sku: ln.product?.sku || "",
          qty: String(ln.quantity ?? 0),
          unitName: ln.unit_name,
          conversionFactor: factor,
          destinationZone: "sale",
          reason:
            f.mode === "partial"
              ? `Khách nhận 1 phần đơn ${f.orderCode} — phần này về kho`
              : `Trả từ đơn ${f.orderCode} (giao thất bại)`,
          swappedToCustomer: false,
        }
        out.push(baseDraft)
      })
    })

    // (b) customer_return — luôn include.
    out.push(...customerReturnItems)

    // (c) unused_swap_stock — luôn include.
    out.push(...unusedSwapItems)

    // Apply user edits + filter removed.
    return out
      .filter((it) => !removedKeys.has(it.key))
      .map((it) => {
        const edit = itemEdits.get(it.key)
        return edit ? { ...it, ...edit } : it
      })
  }, [failedDrafts, customerReturnItems, unusedSwapItems, itemEdits, removedKeys])

  const summary = useMemo(() => {
    const selectedOrders = failedDrafts.filter((f) => f.selected)
    const totalFailedValue = selectedOrders.reduce((s, o) => s + o.total, 0)
    const baseQtyTotal = itemDrafts.reduce(
      (s, it) => s + (Number(it.qty) || 0) * (it.conversionFactor || 1),
      0
    )
    return {
      orderCount: selectedOrders.length,
      itemCount: itemDrafts.length,
      totalFailedValue,
      baseQtyTotal,
      partialCount: selectedOrders.filter((f) => f.mode === "partial").length,
    }
  }, [failedDrafts, itemDrafts])

  const updateFailed = (
    orderId: string,
    patch: Partial<FailedOrderDraft>
  ) => {
    setFailedDrafts((prev) =>
      prev.map((f) => (f.orderId === orderId ? { ...f, ...patch } : f))
    )
  }

  const updateItem = (key: string, patch: Partial<ItemDraft>) => {
    setItemEdits((prev) => {
      const next = new Map(prev)
      const existing = next.get(key) || {}
      next.set(key, { ...existing, ...patch })
      return next
    })
  }

  const removeItem = (key: string) => {
    setRemovedKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!user?.org_id || !delivery) return
    const selectedOrders = failedDrafts.filter((f) => f.selected)
    if (selectedOrders.length === 0 && itemDrafts.length === 0) {
      toast({
        title: "Chưa chọn dữ liệu nào",
        description: "Cần ít nhất một đơn thất bại hoặc một dòng hàng nhận về.",
        variant: "destructive",
      })
      return
    }

    setSubmitting(true)
    try {
      const items: HandoverItemInput[] = itemDrafts
        .filter((it) => Number(it.qty) > 0)
        .map((it) => {
          const qtyNum = Number(it.qty) || 0
          return {
            sourceType: it.sourceType,
            sourceOrderId: it.sourceOrderId,
            swapMovementId: it.swapMovementId,
            productId: it.productId,
            qty: qtyNum,
            unitName: it.unitName,
            conversionFactor: it.conversionFactor,
            qtyInBaseUom: qtyNum * (it.conversionFactor || 1),
            destinationZone: it.destinationZone,
            reason: it.reason || undefined,
            swappedToCustomer: it.swappedToCustomer,
          }
        })

      // Partial mode → orders KHÔNG flip về 'delivery_failed' vì khách
      // đã nhận 1 phần. Chỉ orders mode='failed' mới đi vào failedOrders
      // payload (nguyên đơn về kho). Partial → user nhập tay phần về,
      // không cần flip status.
      const failedOrdersPayload = selectedOrders
        .filter((f) => f.mode === "failed")
        .map((f) => ({
          orderId: f.orderId,
          failureReason: f.failureReason,
          notes: f.notes || undefined,
        }))

      const { error } = await createAndConfirmHandover(supabase, {
        orgId: user.org_id,
        deliveryId: delivery.id,
        driverId: delivery.driver_id,
        receivedByUserId: user.id,
        notes: notes || undefined,
        failedOrders: failedOrdersPayload,
        items,
      })

      if (error) throw new Error(error)

      toast({
        title: "Đã xác nhận bàn giao lại",
        description: `${failedOrdersPayload.length} đơn thất bại + ${
          summary.partialCount
        } đơn giao 1 phần + ${items.length} dòng hàng nhập lại kho.`,
      })
      router.push(`/deliveries/${delivery.id}`)
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy chuyến giao" backHref="/deliveries" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nhận bàn giao lại từ tài xế"
        description={`${delivery.route_name || "Chuyến giao"} • Lái xe: ${delivery.driver?.full_name || "—"}`}
        backHref={`/deliveries/${delivery.id}`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/deliveries/${delivery.id}/settle`}>
            <ChevronLeft className="mr-1.5 h-4 w-4" /> Quyết toán
          </Link>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Đơn thất bại</p>
              <p className="text-xl font-bold">{summary.orderCount}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatCurrency(summary.totalFailedValue)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <PackageOpen className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Đơn giao 1 phần</p>
              <p className="text-xl font-bold">{summary.partialCount}</p>
              <p className="text-[11px] text-muted-foreground">
                Khách nhận 1 phần — chỉnh qty từng dòng
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <PackageOpen className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Dòng nhận về</p>
              <p className="text-xl font-bold">{summary.itemCount}</p>
              <p className="text-[11px] text-muted-foreground">
                Tổng SL base: {summary.baseQtyTotal.toLocaleString("vi-VN")}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Truck className="h-8 w-8 text-secondary" />
            <div>
              <p className="text-xs text-muted-foreground">Trạng thái chuyến</p>
              <Badge variant="default">{delivery.status}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: Failed orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> 1. Đơn không
            giao thành công
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tích chọn đơn → tự thêm hàng vào danh sách bàn giao bên dưới. Bỏ
            tick → tự xoá. Đơn có thu tiền (1 phần / 100%) đã được loại khỏi
            list này (coi như đã giao).
          </p>
        </CardHeader>
        <CardContent>
          {failedDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chuyến này không còn đơn nào chưa giao thành công (mọi đơn đã có
              thu tiền hoặc giao thành công).
            </p>
          ) : (
            <div className="space-y-2">
              {failedDrafts.map((f) => (
                <div
                  key={f.orderId}
                  className="rounded-xl border bg-muted/10 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={f.selected}
                      onChange={(e) =>
                        updateFailed(f.orderId, { selected: e.target.checked })
                      }
                      className="h-4 w-4"
                    />
                    <Link
                      href={`/orders/${f.orderId}`}
                      className="font-mono font-bold text-primary hover:underline"
                    >
                      {f.orderCode}
                    </Link>
                    <span className="text-sm text-muted-foreground">
                      {f.customerName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({f.lines.length} SP)
                    </span>
                    <span className="ml-auto font-semibold">
                      {formatCurrency(f.total)}
                    </span>
                  </div>
                  {f.selected && (
                    <div className="grid gap-2 sm:grid-cols-3 pl-6">
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">
                          Loại
                        </Label>
                        <Select
                          value={f.mode}
                          onValueChange={(v) =>
                            updateFailed(f.orderId, {
                              mode: v as FailedOrderMode,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="failed">
                              Thất bại — toàn bộ về kho
                            </SelectItem>
                            <SelectItem value="partial">
                              Giao 1 phần — chỉnh qty từng dòng
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">
                          Lý do
                        </Label>
                        <Select
                          value={f.failureReason}
                          onValueChange={(v) =>
                            updateFailed(f.orderId, {
                              failureReason: v as FailureReason,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.keys(FAILURE_REASON_LABELS) as FailureReason[]
                            ).map((k) => (
                              <SelectItem key={k} value={k}>
                                {FAILURE_REASON_LABELS[k]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs uppercase text-muted-foreground">
                          Ghi chú
                        </Label>
                        <Input
                          value={f.notes}
                          onChange={(e) =>
                            updateFailed(f.orderId, { notes: e.target.value })
                          }
                          placeholder="Vd: hẹn giao lại thứ 3"
                        />
                      </div>
                      {f.mode === "partial" && (
                        <p className="sm:col-span-3 text-[11px] text-orange-700 bg-orange-50 rounded p-2">
                          ⓘ Đơn giao 1 phần: {f.lines.length} dòng đã thêm vào
                          mục 2. Chỉnh qty từng dòng xuống số <strong>về kho</strong> (số
                          khách KHÔNG nhận). Xoá dòng nếu khách nhận hết SP đó.
                          Đơn KHÔNG flip về <em>delivery_failed</em> vì đã giao 1 phần.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Received goods */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-primary" /> 2. Hàng nhận về
            ({itemDrafts.length} dòng)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Mỗi dòng = 1 SP cần nhập lại kho. Auto thêm khi tick đơn ở mục 1
            (failed) / từ phiếu trả khách / từ swap dự phòng. Chỉnh qty cho
            partial; chọn kho đích.
          </p>
        </CardHeader>
        <CardContent>
          {itemDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Không có dòng hàng nào — chuyến đã giao đủ.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Sản phẩm</th>
                    <th className="px-2 py-2 text-right">SL về</th>
                    <th className="px-2 py-2 text-left">ĐVT</th>
                    <th className="px-2 py-2 text-left">Kho đích</th>
                    <th className="px-2 py-2 text-left">Lý do / nguồn</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {itemDrafts.map((it) => {
                    const isPartial =
                      it.sourceType === "failed_order" &&
                      failedDrafts.find((f) => f.orderId === it.sourceOrderId)
                        ?.mode === "partial"
                    return (
                      <tr
                        key={it.key}
                        className={`border-b last:border-0 ${
                          it.sourceType === "customer_return" && it.swappedToCustomer
                            ? "bg-blue-50/40"
                            : it.sourceType === "customer_return"
                              ? "bg-amber-50/40"
                              : isPartial
                                ? "bg-orange-50/40"
                                : ""
                        }`}
                      >
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            {it.sourceType === "unused_swap_stock" && (
                              <Badge variant="default" className="text-[10px]">
                                SWAP
                              </Badge>
                            )}
                            {it.sourceType === "customer_return" &&
                              it.swappedToCustomer && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                                  ĐỔI
                                </span>
                              )}
                            {it.sourceType === "customer_return" &&
                              !it.swappedToCustomer && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                  TRẢ
                                </span>
                              )}
                            {it.sourceType === "failed_order" && !isPartial && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">
                                THẤT BẠI
                              </span>
                            )}
                            {it.sourceType === "failed_order" && isPartial && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300">
                                1 PHẦN
                              </span>
                            )}
                            <span className="font-medium">{it.productName}</span>
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {it.sku}
                          </div>
                          {it.sourceType === "unused_swap_stock" && (
                            <label className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={it.swappedToCustomer}
                                onChange={(e) =>
                                  updateItem(it.key, {
                                    swappedToCustomer: e.target.checked,
                                    destinationZone: e.target.checked
                                      ? "date"
                                      : "sale",
                                  })
                                }
                              />
                              Đã đổi cho khách rồi
                            </label>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={it.qty}
                            onChange={(e) =>
                              updateItem(it.key, { qty: e.target.value })
                            }
                            className={`h-8 w-20 text-right tabular-nums ml-auto ${
                              isPartial ? "border-orange-300" : ""
                            }`}
                            title={
                              isPartial
                                ? "Đơn giao 1 phần — chỉnh xuống số khách KHÔNG nhận."
                                : undefined
                            }
                          />
                        </td>
                        <td className="px-2 py-2">{it.unitName}</td>
                        <td className="px-2 py-2">
                          <Select
                            value={it.destinationZone}
                            onValueChange={(v) =>
                              updateItem(it.key, {
                                destinationZone: v as WarehouseZone,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(ZONE_LABELS) as WarehouseZone[]).map(
                                (k) => (
                                  <SelectItem key={k} value={k}>
                                    {ZONE_LABELS[k]}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={it.reason}
                            onChange={(e) =>
                              updateItem(it.key, { reason: e.target.value })
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(it.key)}
                            className="h-8 px-2 text-xs"
                            title="Xoá khỏi danh sách (vd khách nhận hết SP này)"
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes + confirm */}
      <Card>
        <CardHeader>
          <CardTitle>Ghi chú bàn giao</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="VD: Lái xe báo 1 thùng móp do mưa, đã chuyển kho date."
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href={`/deliveries/${delivery.id}`}>Huỷ</Link>
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                "Đang xử lý..."
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Xác nhận bàn giao &
                  nhập lại kho
                </>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Đơn THẤT BẠI sẽ chuyển sang <em>Huỷ / delivery_failed</em>; đơn 1
            PHẦN giữ nguyên trạng thái (đã giao có thu). Tồn kho tăng theo lựa
            chọn ở Mục 2 và phiên giao đóng.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
