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
import { useParams, useRouter, useSearchParams } from "next/navigation"
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { PackageOpen, Truck, AlertTriangle, CheckCircle2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import {
  createAndConfirmHandover,
  FAILURE_REASON_LABELS,
  ZONE_LABELS,
  type FailureReason,
  type HandoverItemInput,
  type WarehouseZone,
} from "@/lib/handover/confirm"
import { useWorkflowSession } from "@/hooks/use-workflow-session"

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
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [delivery, setDelivery] = useState<DeliveryRow | null>(null)
  // Workflow session: handover flow active. Resume bar cho user
  // click quay lại đây nếu họ tắt tab giữa chừng.
  const { closeSession: closeHandoverSession } = useWorkflowSession({
    entityType: "delivery",
    entityId: id,
    stage: "handover_received_goods",
    lastUrl:
      searchParams.get("next") === "collect" && searchParams.get("entry")
        ? `/deliveries/${id}/handover?next=collect&entry=${searchParams.get("entry")}`
        : `/deliveries/${id}/handover`,
    entityLabel: delivery?.route_name
      ? `Bàn giao chuyến ${delivery.route_name}`
      : undefined,
    enabled: !!id && !!user && delivery?.status !== "completed",
  })
  const [failedDrafts, setFailedDrafts] = useState<FailedOrderDraft[]>([])
  /** Per-line "thực nhận" qty trong BASE UOM cho partial orders.
   *  Map<orderId, Map<lineId, receivedQtyInBaseUom>>.
   *
   *  BASE UOM (ko phải transaction UOM) để xử lý case khách trả lẻ:
   *  vd đơn 1 thùng (= 20 hộp), khách nhận 18 hộp, trả 2 hộp móp.
   *  receivedQtyInBaseUom = 18; ordered base = 20; delta = 2 hộp.
   *
   *  Default per line = ordered_base (no return). User reduce → delta
   *  > 0 → derive items table tự động trong base UOM. */
  const [partialReceived, setPartialReceived] = useState<
    Map<string, Map<string, number>>
  >(new Map())
  /** Modal cho partial mode — orderId hiện đang edit, hoặc null. */
  const [partialModalOrderId, setPartialModalOrderId] = useState<string | null>(null)
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
        // Mặc định không tick — kế toán chủ động chọn đơn cần nhận bàn
        // giao lại. Tránh tự thêm hàng loạt khiến phải bỏ tick lại.
        selected: false,
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
    //     mode='failed'  → toàn bộ lines × ordered_qty về kho
    //     mode='partial' → chỉ lines nào (orderedBase - receivedBase) > 0;
    //                      qty về kho lưu trong BASE UOM để xử lý case
    //                      khách trả lẻ (vd 1 thùng = 20 hộp, khách
    //                      nhận 18 hộp, trả 2 hộp).
    failedDrafts.forEach((f) => {
      if (!f.selected) return
      const linesReceived = partialReceived.get(f.orderId)
      f.lines.forEach((ln) => {
        const factor = Number(ln.conversion_factor || 1)
        const ordered = Number(ln.quantity || 0)
        const orderedBase = ordered * factor
        const baseUnit = ln.product?.base_unit || ln.unit_name

        if (f.mode === "failed") {
          // Failed: toàn bộ về theo unit gốc của line.
          out.push({
            key: `fo-${ln.id}`,
            sourceType: "failed_order",
            sourceOrderId: f.orderId,
            swapMovementId: null,
            productId: ln.product_id,
            productName: ln.product?.name || "—",
            sku: ln.product?.sku || "",
            qty: String(ordered),
            unitName: ln.unit_name,
            conversionFactor: factor,
            destinationZone: "sale",
            reason: `Trả từ đơn ${f.orderCode} (giao thất bại)`,
            swappedToCustomer: false,
          })
          return
        }

        // mode='partial': delta tính ở BASE UOM, return cũng ở BASE UOM
        // (xử lý case lẻ — vd "2 hộp móp" trên đơn "1 thùng").
        // Default received = orderedBase (no return) when chưa mở modal.
        const receivedBase = linesReceived?.get(ln.id) ?? orderedBase
        const deltaBase = Math.max(0, orderedBase - receivedBase)
        if (deltaBase === 0) return

        out.push({
          key: `fo-${ln.id}`,
          sourceType: "failed_order",
          sourceOrderId: f.orderId,
          swapMovementId: null,
          productId: ln.product_id,
          productName: ln.product?.name || "—",
          sku: ln.product?.sku || "",
          // BASE UOM: qty + factor=1 → row hiển thị + restock đúng
          // số khách trả lẻ. Khác với failed (giữ unit gốc).
          qty: String(deltaBase),
          unitName: baseUnit,
          conversionFactor: 1,
          destinationZone: "sale",
          reason: `Đơn ${f.orderCode} ${ln.product?.sku || ""}: khách nhận ${receivedBase}/${orderedBase} ${baseUnit} (đặt ${ordered} ${ln.unit_name}); trả ${deltaBase} ${baseUnit}`,
          swappedToCustomer: false,
        })
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
  }, [failedDrafts, customerReturnItems, unusedSwapItems, itemEdits, removedKeys, partialReceived])

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
    const hasNothing = selectedOrders.length === 0 && itemDrafts.length === 0

    setSubmitting(true)
    try {
      // Trường hợp giao thành công 100% — không có đơn thất bại, không
      // có hàng nhận về, không có hàng đổi dư. Bỏ qua RPC (không cần
      // tạo handover record) NHƯNG vẫn phải flip delivery.status =
      // 'completed' để stage trên /deliveries/[id] hiện đúng "đã giao
      // hàng" + CTA "Nộp tiền". Tránh state lệch khi user back lại.
      if (hasNothing) {
        await supabase
          .from("deliveries")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", delivery.id)
        toast({
          title: "Tất cả đơn giao thành công",
          description: "Không có hàng cần nhập lại. Tiếp tục bước nộp tiền…",
        })
        await closeHandoverSession().catch(() => {})
        const next = searchParams.get("next")
        const entryId = searchParams.get("entry")
        if (next === "collect" && entryId) {
          router.push(`/inventory/stock-out/collect/${entryId}`)
        } else {
          // Driver flow → màn nộp tiền chuyến.
          router.push(`/deliveries/${delivery.id}/settle`)
        }
        return
      }

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

      // Partial orders: lookup unit_price từ sales_order_lines để tính
      // line_total cho returns. Tạo `returns` row (status='completed',
      // is_exchange=false) — trigger sync_return_credit_amount auto
      // tính credit_note_amount. Sau đó recompute receivable cho mỗi
      // đơn để công nợ giảm theo.
      const partialOrders = selectedOrders.filter(
        (f) =>
          f.mode === "partial" && (partialReceived.get(f.orderId)?.size || 0) > 0
      )
      if (partialOrders.length > 0) {
        const { recomputeReceivableForOrder } = await import(
          "@/lib/returns"
        )
        for (const po of partialOrders) {
          const received = partialReceived.get(po.orderId)
          if (!received) continue

          // Cần unit_price từ sales_order_lines + customer_id từ
          // sales_orders. Fetch song song.
          const [solRes, soRes] = await Promise.all([
            supabase
              .from("sales_order_lines")
              .select("id, product_id, unit_name, quantity, unit_price")
              .eq("order_id", po.orderId),
            supabase
              .from("sales_orders")
              .select("customer_id")
              .eq("id", po.orderId)
              .single(),
          ])
          const lineMap = new Map(
            (
              (solRes.data as Array<{
                id: string
                product_id: string
                unit_name: string
                quantity: number
                unit_price: number
              }>) || []
            ).map((l) => [l.id, l])
          )
          const customerId =
            (soRes.data as { customer_id: string } | null)?.customer_id
          if (!customerId) continue

          const deltaLines = po.lines
            .map((ln) => {
              // partialReceived lưu trong BASE UOM (mig 056 + handover
              // refactor) — vd "18" cho 18 hộp khi đơn 1 thùng = 20 hộp.
              const factor = Number(ln.conversion_factor || 1)
              const orderedBase = Number(ln.quantity || 0) * factor
              const recBase = received.get(ln.id) ?? orderedBase
              const deltaBase = Math.max(0, orderedBase - recBase)
              if (deltaBase === 0) return null

              const sol = lineMap.get(ln.id)
              const unitPriceTx = Number(sol?.unit_price || 0)
              // Unit price per BASE UOM. unit_price gốc tính theo
              // transaction UOM (vd 200000đ/thùng) → chia factor để
              // có giá per hộp (10000đ/hộp). Từ đó line_total ở
              // base UOM = deltaBase × pricePerBase.
              const pricePerBase = factor > 0 ? unitPriceTx / factor : unitPriceTx
              const baseUnit = ln.product?.base_unit || ln.unit_name

              return {
                product_id: ln.product_id,
                unit_name: baseUnit,
                quantity: deltaBase,
                unit_price: pricePerBase,
                line_total: deltaBase * pricePerBase,
                is_exchange: false,
              }
            })
            .filter((x): x is {
              product_id: string
              unit_name: string
              quantity: number
              unit_price: number
              line_total: number
              is_exchange: boolean
            } => x !== null)

          if (deltaLines.length === 0) continue

          // Insert returns row.
          const { data: rRow, error: rErr } = await supabase
            .from("returns")
            .insert({
              org_id: user.org_id,
              order_id: po.orderId,
              customer_id: customerId,
              requested_by: user.id,
              reason: "refused",
              status: "completed",
              notes: `Partial delivery — handover ${delivery.id.slice(0, 8)}: khách nhận một phần đơn ${po.orderCode}.`,
            })
            .select("id")
            .single()
          if (rErr || !rRow) {
            console.warn("[handover] Cannot create return for partial:", rErr)
            continue
          }
          const returnId = (rRow as { id: string }).id

          await supabase.from("return_lines").insert(
            deltaLines.map((dl) => ({
              return_id: returnId,
              ...dl,
            }))
          )
          // Trigger sync_return_credit_amount auto fills
          // returns.credit_note_amount = sum(line_total) where !is_exchange.

          // Recompute receivable to reflect the new credit.
          await recomputeReceivableForOrder(supabase, po.orderId)
        }
      }

      toast({
        title: "Đã xác nhận bàn giao lại",
        description: `${failedOrdersPayload.length} đơn thất bại + ${
          summary.partialCount
        } đơn giao 1 phần + ${items.length} dòng hàng nhập lại kho. Tiếp tục thu tiền…`,
      })
      // Bàn giao xong → close session để bar resume bỏ chip này.
      await closeHandoverSession().catch(() => {})
      // User feedback: handover TRƯỚC collect. Sau khi confirm bàn
      // giao, redirect tới collect / settle.
      const next = searchParams.get("next")
      const entryId = searchParams.get("entry")
      if (next === "collect" && entryId) {
        // Self-deliver flow.
        router.push(`/inventory/stock-out/collect/${entryId}`)
      } else {
        // Driver flow → màn nộp tiền chuyến.
        router.push(`/deliveries/${delivery.id}/settle`)
      }
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
      />


      {/* Summary */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-[#b54708]" />
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
            <PackageOpen className="h-8 w-8 text-[#c2410c]" />
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
            <AlertTriangle className="h-4 w-4 text-[#b54708]" /> 1. Đơn không
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
                        <div className="sm:col-span-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#c2410c] bg-[#fff4ed] rounded p-2">
                            <span>
                              ⓘ Đơn giao 1 phần: bấm <strong>Sửa đơn</strong>{" "}
                              để nhập <em>thực nhận</em> trong{" "}
                              <strong>đơn vị nhỏ nhất</strong>. Hỗ trợ trả
                              lẻ (vd đơn 1 thùng = 20 hộp, khách trả 2 hộp
                              móp). Phần KHÔNG nhận tự về kho ở mục 2.
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0"
                              onClick={() => setPartialModalOrderId(f.orderId)}
                            >
                              Sửa đơn (chi tiết)
                            </Button>
                          </div>
                          {(() => {
                            const received = partialReceived.get(f.orderId)
                            if (!received || received.size === 0) {
                              return (
                                <p className="text-[10px] text-muted-foreground italic px-1">
                                  Chưa nhập thực nhận — mặc định 100% lines về kho.
                                </p>
                              )
                            }
                            const adjusted = f.lines.filter((ln) => {
                              const factor = Number(ln.conversion_factor || 1)
                              const orderedBase = Number(ln.quantity || 0) * factor
                              const recBase = received.get(ln.id) ?? orderedBase
                              return recBase !== orderedBase
                            })
                            return (
                              <p className="text-[10px] text-[#c2410c] px-1">
                                Đã nhập thực nhận cho {adjusted.length}/{f.lines.length} dòng.
                              </p>
                            )
                          })()}
                        </div>
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
                            ? "bg-[#eff8ff]/40"
                            : it.sourceType === "customer_return"
                              ? "bg-[#fff4ed]/40"
                              : isPartial
                                ? "bg-[#fff4ed]/40"
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
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40">
                                  ĐỔI
                                </span>
                              )}
                            {it.sourceType === "customer_return" &&
                              !it.swappedToCustomer && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fff4ed] text-[#b54708] border border-[#fdb022]/40">
                                  TRẢ
                                </span>
                              )}
                            {it.sourceType === "failed_order" && !isPartial && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-error-container text-error border border-error/40">
                                THẤT BẠI
                              </span>
                            )}
                            {it.sourceType === "failed_order" && isPartial && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fff4ed] text-[#c2410c] border border-[#f97316]/40">
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
                              isPartial ? "border-[#f97316]/40" : ""
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
              ) : summary.orderCount === 0 && summary.itemCount === 0 ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Tất cả đã giao OK
                  — Tiếp tục →
                </>
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

      {/* Partial-order edit modal — nhập thực nhận từng dòng cho đơn
          khách giao 1 phần. Lưu vào partialReceived state → items
          table tự derive delta về kho. */}
      <Dialog
        open={!!partialModalOrderId}
        onOpenChange={(o) => {
          if (!o) setPartialModalOrderId(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          {(() => {
            const order = failedDrafts.find(
              (f) => f.orderId === partialModalOrderId
            )
            if (!order) return null
            const received =
              partialReceived.get(order.orderId) || new Map<string, number>()
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Sửa đơn {order.orderCode} — {order.customerName}
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground">
                    Nhập <strong>thực nhận</strong> trong <strong>đơn vị nhỏ
                    nhất</strong> (base UOM — vd <em>hộp</em>, <em>cái</em>).
                    Phần KHÔNG nhận tự về kho và trừ công nợ. Hỗ trợ trả lẻ:
                    đơn 1 thùng (= 20 hộp), khách trả 2 hộp móp → nhập
                    thực nhận = 18.
                  </p>
                </DialogHeader>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left">Sản phẩm</th>
                        <th className="px-2 py-2 text-right">Đặt</th>
                        <th className="px-2 py-2 text-right">Thực nhận (base)</th>
                        <th className="px-2 py-2 text-right">Về kho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((ln) => {
                        const factor = Number(ln.conversion_factor || 1)
                        const ordered = Number(ln.quantity || 0)
                        const orderedBase = ordered * factor
                        const baseUnit = ln.product?.base_unit || ln.unit_name
                        const recBase = received.get(ln.id) ?? orderedBase
                        const backBase = Math.max(0, orderedBase - recBase)
                        const showBaseEquivalent =
                          factor > 1 && baseUnit !== ln.unit_name
                        return (
                          <tr key={ln.id} className="border-b last:border-0">
                            <td className="px-2 py-2">
                              <div className="font-medium">
                                {ln.product?.name || "—"}
                              </div>
                              <div className="text-[10px] font-mono text-muted-foreground">
                                {ln.product?.sku}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              <div className="font-semibold">
                                {ordered} {ln.unit_name}
                              </div>
                              {showBaseEquivalent && (
                                <div className="text-[10px] text-muted-foreground">
                                  = {orderedBase} {baseUnit}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  max={orderedBase}
                                  step="any"
                                  value={recBase}
                                  onChange={(e) => {
                                    const v = Math.min(
                                      orderedBase,
                                      Math.max(0, Number(e.target.value) || 0)
                                    )
                                    setPartialReceived((prev) => {
                                      const next = new Map(prev)
                                      const orderMap = new Map(
                                        next.get(order.orderId) || []
                                      )
                                      if (v === orderedBase) {
                                        orderMap.delete(ln.id)
                                      } else {
                                        orderMap.set(ln.id, v)
                                      }
                                      if (orderMap.size === 0) {
                                        next.delete(order.orderId)
                                      } else {
                                        next.set(order.orderId, orderMap)
                                      }
                                      return next
                                    })
                                  }}
                                  className={`h-8 w-20 text-right tabular-nums ${
                                    recBase !== orderedBase
                                      ? "border-[#f97316]/40"
                                      : ""
                                  }`}
                                />
                                <span className="text-[10px] text-muted-foreground w-6">
                                  {baseUnit}
                                </span>
                              </div>
                            </td>
                            <td
                              className={`px-2 py-2 text-right tabular-nums font-semibold ${
                                backBase > 0
                                  ? "text-[#c2410c]"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {backBase > 0 ? `${backBase} ${baseUnit}` : "—"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 font-bold">
                      <tr>
                        <td className="px-2 py-2 text-right" colSpan={1}>
                          Tổng (base):
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {order.lines.reduce(
                            (s, ln) =>
                              s +
                              Number(ln.quantity || 0) *
                                Number(ln.conversion_factor || 1),
                            0
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {order.lines.reduce((s, ln) => {
                            const orderedBase =
                              Number(ln.quantity || 0) *
                              Number(ln.conversion_factor || 1)
                            return s + (received.get(ln.id) ?? orderedBase)
                          }, 0)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[#c2410c]">
                          {order.lines.reduce((s, ln) => {
                            const orderedBase =
                              Number(ln.quantity || 0) *
                              Number(ln.conversion_factor || 1)
                            const r = received.get(ln.id) ?? orderedBase
                            return s + Math.max(0, orderedBase - r)
                          }, 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <DialogFooter className="flex flex-row items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPartialReceived((prev) => {
                        const next = new Map(prev)
                        next.delete(order.orderId)
                        return next
                      })
                    }}
                  >
                    Reset (khách nhận hết)
                  </Button>
                  <Button onClick={() => setPartialModalOrderId(null)}>
                    Xong
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
