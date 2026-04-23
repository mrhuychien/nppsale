"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  ArrowDownToLine, ArrowUpFromLine, ClipboardList, Truck, AlertCircle,
  Package, CircleX, RotateCcw,
} from "lucide-react"
import { RETURN_REASONS } from "@/lib/constants"

// --- Đơn chờ xuất (confirmed sales orders) ---
type ConfirmedOrder = {
  id: string
  order_code: string
  order_date: string
  total: number
  customer?: { id: string; store_name: string; phone: string | null } | null
  sales_user?: { full_name?: string } | null
}

// --- Đơn chờ nhập: approved returns + failed delivery lines ---
type ApprovedReturn = {
  id: string
  reason: string | null
  credit_note_amount: number | null
  notes: string | null
  created_at: string
  customer?: { id: string; store_name: string } | null
  order?: { id: string; order_code: string } | null
  lines_count: number
}

type FailedDeliveryLine = {
  id: string
  notes: string | null
  delivered_at: string | null
  order_id: string
  order?: {
    id: string
    order_code: string
    customer?: { store_name: string } | null
  } | null
  delivery?: {
    id: string
    driver?: { full_name?: string } | null
  } | null
}

export default function PendingStockPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()
  const router = useRouter()

  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([])
  const [approvedReturns, setApprovedReturns] = useState<ApprovedReturn[]>([])
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDeliveryLine[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      const [confirmedRes, returnsRes, failedRes] = await Promise.all([
        // Confirmed orders awaiting stock-out
        supabase
          .from("sales_orders")
          .select(
            "id, order_code, order_date, total, customer:customers(id, store_name, phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
          )
          .eq("status", "confirmed")
          .order("order_date", { ascending: true }),
        // Approved returns awaiting physical restock
        supabase
          .from("returns")
          .select(
            "id, reason, credit_note_amount, notes, created_at, customer:customers(id, store_name), order:sales_orders(id, order_code), lines:return_lines(id)"
          )
          .eq("status", "approved")
          .order("created_at", { ascending: false }),
        // Failed delivery lines — goods came back with the driver
        supabase
          .from("delivery_lines")
          .select(
            "id, notes, delivered_at, order_id, order:sales_orders(id, order_code, customer:customers(store_name)), delivery:deliveries(id, driver:users!deliveries_driver_id_fkey(full_name))"
          )
          .eq("status", "failed")
          .order("delivered_at", { ascending: false }),
      ])
      setConfirmedOrders(((confirmedRes.data as unknown) as ConfirmedOrder[]) || [])
      setApprovedReturns(
        (((returnsRes.data as unknown) as Array<ApprovedReturn & { lines?: { id: string }[] }>) || []).map(
          (r) => ({ ...r, lines_count: r.lines?.length || 0 })
        )
      )
      setFailedDeliveries(((failedRes.data as unknown) as FailedDeliveryLine[]) || [])
      setLoading(false)
    }
    fetchAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleOne = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const toggleAll = () => {
    if (selected.size === confirmedOrders.length) setSelected(new Set())
    else setSelected(new Set(confirmedOrders.map((o) => o.id)))
  }

  const totalSelected = useMemo(
    () => confirmedOrders.filter((o) => selected.has(o.id)).reduce((s, o) => s + o.total, 0),
    [confirmedOrders, selected]
  )

  const handleDispatch = () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    router.push(`/inventory/stock-out?orderIds=${ids.join(",")}`)
  }

  const reasonLabel = (code: string | null) =>
    RETURN_REASONS.find((r) => r.value === code)?.label || code || "-"

  if (authLoading) return <Skeleton className="h-96" />

  const inboundCount = approvedReturns.length + failedDeliveries.length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phiếu kho chờ xử lý"
        description="Đơn chờ nhập (trả hàng, giao thất bại) • Đơn chờ xuất (đã duyệt)"
        backHref="/inventory"
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs defaultValue="outbound">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="inbound" className="flex-1 sm:flex-none">
              <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
              Đơn chờ nhập ({inboundCount})
            </TabsTrigger>
            <TabsTrigger value="outbound" className="flex-1 sm:flex-none">
              <ArrowUpFromLine className="h-3.5 w-3.5 mr-1.5" />
              Đơn chờ xuất ({confirmedOrders.length})
            </TabsTrigger>
          </TabsList>

          {/* ================= ĐƠN CHỜ NHẬP ================= */}
          <TabsContent value="inbound" className="mt-4 space-y-4">
            {inboundCount === 0 ? (
              <EmptyState
                icon={<ArrowDownToLine className="h-8 w-8 text-muted-foreground" />}
                title="Không có đơn chờ nhập"
                description="Hàng trả đã duyệt và đơn giao thất bại sẽ xuất hiện ở đây"
              />
            ) : (
              <>
                {/* Approved returns */}
                {approvedReturns.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                      Trả hàng đã duyệt ({approvedReturns.length})
                    </p>
                    {approvedReturns.map((r) => (
                      <Card key={r.id}>
                        <CardContent className="p-4 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                              <RotateCcw className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  href={`/returns/${r.id}`}
                                  className="font-semibold text-primary hover:underline"
                                >
                                  {r.customer?.store_name || "-"}
                                </Link>
                                <Badge variant="warning">Trả hàng</Badge>
                                {r.order?.order_code && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {r.order.order_code}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {reasonLabel(r.reason)} • {r.lines_count} SP
                                {" • "}{formatDate(r.created_at)}
                              </p>
                              {r.notes && (
                                <p className="text-xs text-muted-foreground italic line-clamp-1 mt-1">
                                  &ldquo;{r.notes}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-2">
                            {r.credit_note_amount && (
                              <p className="text-sm font-bold">
                                {formatCurrency(r.credit_note_amount)}
                              </p>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                            >
                              <Link href={`/returns/${r.id}`}>
                                <Package className="h-3.5 w-3.5 mr-1" /> Xử lý
                              </Link>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Failed deliveries */}
                {failedDeliveries.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                      Giao thất bại ({failedDeliveries.length})
                    </p>
                    {failedDeliveries.map((d) => (
                      <Card key={d.id}>
                        <CardContent className="p-4 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
                              <CircleX className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  href={`/orders/${d.order_id}`}
                                  className="font-semibold text-primary hover:underline"
                                >
                                  {d.order?.customer?.store_name || "-"}
                                </Link>
                                <Badge variant="danger">Thất bại</Badge>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {d.order?.order_code}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {d.delivery?.driver?.full_name ? `Tài xế: ${d.delivery.driver.full_name} • ` : ""}
                                {d.delivered_at ? formatDate(d.delivered_at) : "-"}
                              </p>
                              {d.notes && (
                                <p className="text-xs text-muted-foreground italic line-clamp-1 mt-1">
                                  &ldquo;{d.notes}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                          {d.delivery?.id && (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/deliveries/${d.delivery.id}`}>Xem chuyến</Link>
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ================= ĐƠN CHỜ XUẤT ================= */}
          <TabsContent value="outbound" className="mt-4 space-y-3">
            {confirmedOrders.length === 0 ? (
              <EmptyState
                icon={<ArrowUpFromLine className="h-8 w-8 text-muted-foreground" />}
                title="Không có đơn chờ xuất"
                description="Đơn đã duyệt sẽ xuất hiện ở đây, chờ thủ kho chọn và xuất"
              />
            ) : (
              <>
                {/* Sticky action bar when selection > 0 */}
                {selected.size > 0 && (
                  <Card className="sticky top-16 z-10 rounded-2xl border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 shadow-sm">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-bold text-primary text-sm">
                          {selected.size} đơn đã chọn
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Tổng: {formatCurrency(totalSelected)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                          Bỏ chọn
                        </Button>
                        <Button size="sm" onClick={handleDispatch}>
                          <Truck className="h-4 w-4 mr-1.5" />
                          Xuất hàng ({selected.size})
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex items-center gap-2 px-1">
                  <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.size === confirmedOrders.length && confirmedOrders.length > 0}
                      onChange={toggleAll}
                      className="h-4 w-4"
                    />
                    Chọn tất cả ({confirmedOrders.length})
                  </label>
                </div>

                <div className="space-y-2">
                  {confirmedOrders.map((o) => {
                    const checked = selected.has(o.id)
                    return (
                      <Card key={o.id} className={checked ? "border-primary bg-primary/5" : ""}>
                        <CardContent className="p-4 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOne(o.id)}
                            className="h-4 w-4 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/orders/${o.id}`}
                                className="font-mono text-sm font-bold text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {o.order_code}
                              </Link>
                              <span className="font-semibold text-sm truncate">
                                {o.customer?.store_name || "-"}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {o.sales_user?.full_name ? `NV: ${o.sales_user.full_name} • ` : ""}
                              {formatDate(o.order_date)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-bold text-sm">{formatCurrency(o.total)}</p>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Info footer — explains the flow */}
      <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong>Luồng:</strong> Đơn <code>confirmed</code> hiện ở đây → Thủ kho chọn → &ldquo;Xuất hàng&rdquo; → vào màn hình xuất + bàn giao lái xe. Khi bàn giao xong, đơn sẽ sang &ldquo;Đơn chờ giao&rdquo; của{" "}
          <Link href="/deliveries" className="text-primary font-semibold underline">Giao hàng</Link>.
        </p>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory/entries">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
            Xem tất cả phiếu kho
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory/adjustments">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Điều chỉnh kiểm kê
          </Link>
        </Button>
      </div>
    </div>
  )
}
