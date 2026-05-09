"use client"

/**
 * T-07: Driver handover ("Bàn giao lại") confirmation page.
 *
 * Two collapsible sections (the spec calls for tabs but inline sections
 * fit a phone-first warehouse handover flow better — both sets of data
 * are usually reviewed together):
 *
 *   1. Đơn giao thất bại  — orders in this delivery that didn't reach
 *      the customer. The user picks a failure_reason + notes per row.
 *   2. Hàng nhận về      — items to restock. Auto-populated from the
 *      failed orders' lines; the user adjusts qty + picks destination
 *      zone (sale | date) per row.
 *
 * Confirm calls createAndConfirmHandover which inserts the rows + runs
 * the SECURITY DEFINER RPC confirm_driver_handover.
 *
 * Out of scope for the initial Pack3 ship (Q5/T-12 deferred):
 *   - customer_return source: those flow through the existing
 *     /deliveries/[id]/settle goods_handover_* fields (mig 038).
 *   - unused_swap_stock source: T-12 not landed yet, no source data.
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
  }
}

interface FailedOrderDraft {
  orderId: string
  orderCode: string
  customerName: string
  total: number
  failureReason: FailureReason
  notes: string
  selected: boolean
}

interface ItemDraft {
  /** Stable key; usually order_line.id but can be synthesised for new rows. */
  key: string
  sourceType: "failed_order" | "unused_swap_stock"
  sourceOrderId: string | null
  /** swap_stock_movements.id when sourceType=unused_swap_stock. */
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

export default function DeliveryHandoverPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [delivery, setDelivery] = useState<DeliveryRow | null>(null)
  const [failedDrafts, setFailedDrafts] = useState<FailedOrderDraft[]>([])
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>([])
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
          "id, status, order_id, order:sales_orders(id, order_code, customer_id, total, customer:customers(store_name), lines:sales_order_lines(id, product_id, unit_name, quantity, conversion_factor, product:products(name, sku, base_unit)))"
        )
        .eq("delivery_id", id),
    ])

    setDelivery((delRes.data as unknown as DeliveryRow) || null)
    const linesData = ((lineRes.data as unknown) as DeliveryLineWithOrder[]) || []

    // Failed = anything not 'delivered' (pending / partial / failed all
    // count as "didn't make it"). Pre-select failed/partial.
    const failed = linesData
      .filter((dl) => dl.status !== "delivered" && dl.order)
      .map<FailedOrderDraft>((dl) => ({
        orderId: dl.order!.id,
        orderCode: dl.order!.order_code,
        customerName: dl.order!.customer?.store_name || "—",
        total: Number(dl.order!.total || 0),
        failureReason: "customer_absent",
        notes: "",
        selected: dl.status === "failed" || dl.status === "partial" || dl.status === "pending",
      }))
    setFailedDrafts(failed)

    // Items = order lines from failed orders, one per line.
    const items: ItemDraft[] = []
    linesData.forEach((dl) => {
      if (dl.status === "delivered" || !dl.order?.lines) return
      dl.order.lines.forEach((ln) => {
        const factor = Number(ln.conversion_factor || 1)
        items.push({
          key: `fo-${ln.id}`,
          sourceType: "failed_order",
          sourceOrderId: dl.order!.id,
          swapMovementId: null,
          productId: ln.product_id,
          productName: ln.product?.name || "—",
          sku: ln.product?.sku || "",
          qty: String(ln.quantity ?? 0),
          unitName: ln.unit_name,
          conversionFactor: factor,
          destinationZone: "sale",
          reason: `Trả từ đơn ${dl.order!.order_code}`,
          swappedToCustomer: false,
        })
      })
    })

    // Q7: also load unused swap stock.
    // Path: delivery → delivery_lines.order_id IN (...) → stock_entries
    // whose ref_order_ids contains any of those orders → swap_stock_movements.
    const orderIds = linesData.map((dl) => dl.order_id).filter(Boolean) as string[]
    if (orderIds.length > 0) {
      // Fetch stock_entries that reference these orders.
      const { data: entries } = await supabase
        .from("stock_entries")
        .select("id, ref_order_ids")
        .eq("type", "export")
      const entryIds = ((entries as Array<{ id: string; ref_order_ids: string[] | null }>) || [])
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
        ;((swapRows as unknown) as Array<{
          id: string
          product_id: string
          qty: number
          unit_name: string
          conversion_factor: number
          qty_in_base_uom: number
          qty_returned_in_base_uom: number
          reason: string | null
          product?: { name: string; sku: string } | null
        }> || []).forEach((sw) => {
          const remainingBase =
            Number(sw.qty_in_base_uom || 0) - Number(sw.qty_returned_in_base_uom || 0)
          if (remainingBase <= 0) return
          const factor = Number(sw.conversion_factor || 1) || 1
          const remainingTx = remainingBase / factor
          items.push({
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
            // D7 default — unused swap = back to Kho bán; user can flip to Kho date
            // when they confirm "Đã đổi cho khách rồi".
            destinationZone: "sale",
            reason: sw.reason || "Hàng đem đi đổi không dùng",
            swappedToCustomer: false,
          })
        })
      }
    }

    setItemDrafts(items)
    setLoading(false)
  }, [id, user?.org_id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const summary = useMemo(() => {
    const selectedOrders = failedDrafts.filter((f) => f.selected)
    const totalFailedValue = selectedOrders.reduce((s, o) => s + o.total, 0)
    const baseQtyTotal = itemDrafts.reduce(
      (s, it) =>
        s + (Number(it.qty) || 0) * (it.conversionFactor || 1),
      0
    )
    return {
      orderCount: selectedOrders.length,
      itemCount: itemDrafts.length,
      totalFailedValue,
      baseQtyTotal,
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
    setItemDrafts((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it))
    )
  }

  const removeItem = (key: string) => {
    setItemDrafts((prev) => prev.filter((it) => it.key !== key))
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

      const { error } = await createAndConfirmHandover(supabase, {
        orgId: user.org_id,
        deliveryId: delivery.id,
        driverId: delivery.driver_id,
        receivedByUserId: user.id,
        notes: notes || undefined,
        failedOrders: selectedOrders.map((f) => ({
          orderId: f.orderId,
          failureReason: f.failureReason,
          notes: f.notes || undefined,
        })),
        items,
      })

      if (error) throw new Error(error)

      toast({
        title: "Đã xác nhận bàn giao lại",
        description: `${selectedOrders.length} đơn thất bại + ${items.length} dòng hàng nhập lại kho.`,
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
      <div className="grid gap-3 md:grid-cols-3">
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
            <PackageOpen className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Dòng hàng nhận về</p>
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
            <AlertTriangle className="h-4 w-4 text-amber-600" /> 1. Đơn giao thất bại
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tích chọn đơn không giao được. Chọn lý do để bộ phận chăm sóc KH biết cần xử lý gì.
          </p>
        </CardHeader>
        <CardContent>
          {failedDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chuyến này không có đơn nào chưa giao thành công.
            </p>
          ) : (
            <div className="space-y-2">
              {failedDrafts.map((f) => (
                <div
                  key={f.orderId}
                  className="rounded-xl border bg-muted/10 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
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
                    <span className="ml-auto font-semibold">
                      {formatCurrency(f.total)}
                    </span>
                  </div>
                  {f.selected && (
                    <div className="grid gap-2 md:grid-cols-2 pl-6">
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
                            {(Object.keys(FAILURE_REASON_LABELS) as FailureReason[]).map(
                              (k) => (
                                <SelectItem key={k} value={k}>
                                  {FAILURE_REASON_LABELS[k]}
                                </SelectItem>
                              )
                            )}
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
                          placeholder="Tuỳ chọn — vd: hẹn giao lại thứ 3"
                        />
                      </div>
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
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Mỗi dòng = 1 sản phẩm cần nhập lại kho. Chọn kho đích — mặc định <em>Kho bán</em>;
            chuyển sang <em>Kho date</em> với hàng đã đổi cho khách hoặc gần hết hạn.
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
                    <th className="px-2 py-2 text-right">SL</th>
                    <th className="px-2 py-2 text-left">ĐVT</th>
                    <th className="px-2 py-2 text-left">Kho đích</th>
                    <th className="px-2 py-2 text-left">Lý do / nguồn</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {itemDrafts.map((it) => (
                    <tr key={it.key} className="border-b last:border-0">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          {it.sourceType === "unused_swap_stock" && (
                            <Badge variant="default" className="text-[10px]">
                              SWAP
                            </Badge>
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
                                  // D7 default: checked → date stock,
                                  // unchecked → sale stock.
                                  destinationZone: e.target.checked ? "date" : "sale",
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
                          className="h-8 w-20 text-right tabular-nums ml-auto"
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
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  ))}
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
            Thao tác sẽ chuyển đơn thất bại sang trạng thái <em>Huỷ / delivery_failed</em>,
            tăng tồn kho theo lựa chọn ở Mục 2 và đóng phiên giao.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
