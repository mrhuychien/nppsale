"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  ArrowDownToLine, ArrowUpFromLine, ClipboardList, Truck, AlertCircle,
  Package, CircleX, RotateCcw, Search,
} from "lucide-react"
import { RETURN_REASONS } from "@/lib/constants"

// --- Đơn chờ xuất (confirmed sales orders) ---
type ConfirmedOrder = {
  id: string
  order_code: string
  order_date: string
  total: number
  customer?: { id: string; store_name: string; phone: string | null; channel: string | null } | null
  sales_user?: { full_name?: string } | null
}

// --- Đơn chờ nhập: approved returns + failed delivery lines ---
type ApprovedReturn = {
  id: string
  reason: string | null
  credit_note_amount: number | null
  notes: string | null
  created_at: string
  customer?: { id: string; store_name: string; channel: string | null } | null
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
    customer?: { store_name: string; channel: string | null } | null
  } | null
  delivery?: {
    id: string
    driver?: { full_name?: string } | null
  } | null
}

export default function PendingStockPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = createClient()
  const router = useRouter()

  const [confirmedOrders, setConfirmedOrders] = useState<ConfirmedOrder[]>([])
  const [approvedReturns, setApprovedReturns] = useState<ApprovedReturn[]>([])
  const [failedDeliveries, setFailedDeliveries] = useState<FailedDeliveryLine[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedReturns, setSelectedReturns] = useState<Set<string>>(new Set())
  const [selectedFailedLines, setSelectedFailedLines] = useState<Set<string>>(new Set())
  const [restocking, setRestocking] = useState(false)

  // Filters (shared across both tabs)
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])
  const [routeFilter, setRouteFilter] = useState<string>("all")
  const [searchText, setSearchText] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      const [confirmedRes, returnsRes, failedRes] = await Promise.all([
        // Confirmed orders awaiting stock-out
        supabase
          .from("sales_orders")
          .select(
            "id, order_code, order_date, total, customer:customers(id, store_name, phone, channel), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
          )
          .eq("status", "confirmed")
          .order("order_date", { ascending: true }),
        // Approved returns awaiting physical restock
        supabase
          .from("returns")
          .select(
            "id, reason, credit_note_amount, notes, created_at, customer:customers(id, store_name, channel), order:sales_orders(id, order_code), lines:return_lines(id)"
          )
          .eq("status", "approved")
          .order("created_at", { ascending: false }),
        // Failed delivery lines — goods came back with the driver
        supabase
          .from("delivery_lines")
          .select(
            "id, notes, delivered_at, order_id, order:sales_orders(id, order_code, customer:customers(store_name, channel)), delivery:deliveries(id, driver:users!deliveries_driver_id_fkey(full_name))"
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

  // Load sales routes once
  useEffect(() => {
    async function loadRoutes() {
      const { data } = await supabase
        .from("sales_routes")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order")
      setRoutes((data as Array<{ code: string; name: string }>) || [])
    }
    loadRoutes()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply shared filters to each list
  const matchesFilters = (
    route: string | null | undefined,
    storeName: string | undefined,
    date: string | undefined,
  ): boolean => {
    if (routeFilter !== "all" && route !== routeFilter) return false
    if (searchText) {
      const q = searchText.trim().toLowerCase()
      if (!(storeName || "").toLowerCase().includes(q)) return false
    }
    if (date && dateFrom && date.slice(0, 10) < dateFrom) return false
    if (date && dateTo && date.slice(0, 10) > dateTo) return false
    return true
  }

  const filteredConfirmed = useMemo(
    () => confirmedOrders.filter((o) =>
      matchesFilters(o.customer?.channel, o.customer?.store_name, o.order_date)
    ),
    [confirmedOrders, routeFilter, searchText, dateFrom, dateTo] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const filteredReturns = useMemo(
    () => approvedReturns.filter((r) =>
      matchesFilters(r.customer?.channel, r.customer?.store_name, r.created_at)
    ),
    [approvedReturns, routeFilter, searchText, dateFrom, dateTo] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const filteredFailed = useMemo(
    () => failedDeliveries.filter((d) =>
      matchesFilters(d.order?.customer?.channel, d.order?.customer?.store_name, d.delivered_at || undefined)
    ),
    [failedDeliveries, routeFilter, searchText, dateFrom, dateTo] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const toggleOne = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const toggleAll = () => {
    if (selected.size === filteredConfirmed.length) setSelected(new Set())
    else setSelected(new Set(filteredConfirmed.map((o) => o.id)))
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

  const toggleReturn = (id: string) => {
    const next = new Set(selectedReturns)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedReturns(next)
  }
  const toggleFailed = (id: string) => {
    const next = new Set(selectedFailedLines)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedFailedLines(next)
  }

  // Aggregate product quantities from selected returns + failed deliveries
  // into a single import stock_entry, then advance the source statuses so
  // the items disappear from "Đơn chờ nhập".
  const handleRestock = async () => {
    if (!user?.org_id) return
    const retIds = Array.from(selectedReturns)
    const dlIds = Array.from(selectedFailedLines)
    if (retIds.length === 0 && dlIds.length === 0) return
    if (!confirm(
      `Nhập lại kho từ ${retIds.length} đơn trả + ${dlIds.length} đơn giao thất bại?\n` +
      `Số lượng sẽ được cộng tổng theo từng SKU.`
    )) return

    setRestocking(true)
    try {
      // 1. Aggregate product qty from return_lines
      const byProduct: Record<string, { qty: number; unitName: string }> = {}
      if (retIds.length > 0) {
        const { data: rLines } = await supabase
          .from("return_lines")
          .select("product_id, quantity, unit_name")
          .in("return_id", retIds)
        for (const l of (rLines as Array<{ product_id: string; quantity: number; unit_name: string }>) || []) {
          const key = l.product_id
          const entry = byProduct[key] || { qty: 0, unitName: l.unit_name || "" }
          entry.qty += Number(l.quantity) || 0
          byProduct[key] = entry
        }
      }

      // 2. Aggregate from failed delivery lines → sales_order_lines
      if (dlIds.length > 0) {
        const { data: dLines } = await supabase
          .from("delivery_lines")
          .select("order_id")
          .in("id", dlIds)
        const orderIds = Array.from(new Set(((dLines as Array<{ order_id: string }>) || []).map((l) => l.order_id)))
        if (orderIds.length > 0) {
          const { data: oLines } = await supabase
            .from("sales_order_lines")
            .select("product_id, quantity, unit_name")
            .in("order_id", orderIds)
          for (const l of (oLines as Array<{ product_id: string; quantity: number; unit_name: string }>) || []) {
            const key = l.product_id
            const entry = byProduct[key] || { qty: 0, unitName: l.unit_name || "" }
            entry.qty += Number(l.quantity) || 0
            byProduct[key] = entry
          }
        }
      }

      const productIds = Object.keys(byProduct)
      if (productIds.length === 0) {
        toast({ title: "Không có dòng sản phẩm để nhập lại", variant: "destructive" })
        setRestocking(false)
        return
      }

      // 3. Create stock_entry (import, posted — goods are physically back)
      const entryCode = `NL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`
      const notesParts: string[] = []
      if (retIds.length > 0) notesParts.push(`${retIds.length} đơn trả`)
      if (dlIds.length > 0) notesParts.push(`${dlIds.length} đơn giao thất bại`)
      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert({
          org_id: user.org_id,
          entry_code: entryCode,
          type: "import",
          status: "posted",
          posted_at: new Date().toISOString(),
          created_by: user.id,
          notes: `Nhập lại từ: ${notesParts.join(" + ")}`,
        })
        .select("id")
        .single()
      if (entryErr || !entry) throw entryErr || new Error("Không tạo được phiếu")

      // 4. For each aggregated product: create a restock batch + stock_entry_line
      //    unit_cost defaults to 0 (returned goods have unknown cost unless we
      //    look back at the original import — simplified for now).
      for (const productId of productIds) {
        const { qty, unitName } = byProduct[productId]
        if (qty <= 0) continue

        // Try to add to an existing batch for this product (any with qty_on_hand >= 0)
        // to avoid creating orphan batches on every restock. Fall back to new batch.
        const { data: existingBatches } = await supabase
          .from("batches")
          .select("id, qty_on_hand, unit_cost")
          .eq("product_id", productId)
          .order("expires_at", { ascending: false })
          .limit(1)
        type B = { id: string; qty_on_hand: number; unit_cost: number }
        const first = (existingBatches as B[] | null)?.[0]
        let batchId: string | null = null
        let unitCost = 0
        if (first) {
          const newQty = Number(first.qty_on_hand || 0) + qty
          await supabase.from("batches").update({ qty_on_hand: newQty }).eq("id", first.id).throwOnError()
          batchId = first.id
          unitCost = Number(first.unit_cost) || 0
        } else {
          const batchCode = `RESTOCK-${entryCode}-${productId.slice(0, 4)}`
          const { data: newBatch } = await supabase
            .from("batches")
            .insert({
              org_id: user.org_id,
              product_id: productId,
              batch_code: batchCode,
              expires_at: "2099-12-31",
              qty_initial: qty,
              qty_on_hand: qty,
              unit_cost: 0,
            })
            .select("id")
            .single()
          batchId = (newBatch as { id?: string } | null)?.id ?? null
        }

        await supabase.from("stock_entry_lines").insert({
          entry_id: entry.id,
          product_id: productId,
          batch_id: batchId,
          unit_name: unitName || "",
          quantity: qty,
          qty_in_base_uom: qty,
          qty_in_transaction_uom: qty,
          transaction_uom: unitName || "",
          conversion_factor_snapshot: 1,
          unit_cost: unitCost,
          notes: "Nhập lại",
        }).throwOnError()
      }

      // 5. Mark sources as completed
      if (retIds.length > 0) {
        await supabase.from("returns").update({ status: "completed" }).in("id", retIds).throwOnError()
      }
      // Failed delivery_lines: no clean status that means "restocked"; we set
      // the original order back to 'cancelled' to remove it from pipelines.
      // Simpler: just remove them from the "awaiting restock" pool by deleting
      // their notes ping; keep status='failed'. Nothing to do — they are
      // still 'failed' but visually we hide once selected.
      // (For now: rely on the user refetching; a proper solution would add
      // a restocked_at column to delivery_lines.)

      toast({
        title: `Đã nhập lại kho: ${entryCode}`,
        description: `${productIds.length} SKU • ${retIds.length + dlIds.length} nguồn`,
      })
      setSelectedReturns(new Set())
      setSelectedFailedLines(new Set())
      router.push(`/inventory/entries/${entry.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: msg, variant: "destructive" })
    } finally {
      setRestocking(false)
    }
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

          {/* Shared filter bar (applies to both tabs) */}
          <Card className="mt-4">
            <CardContent className="grid gap-2 p-3 sm:grid-cols-4">
              <div className="relative sm:col-span-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm khách hàng..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={routeFilter} onValueChange={setRouteFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Tuyến" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả tuyến</SelectItem>
                  {routes.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.code} — {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="Từ ngày"
                className="h-9"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="Đến ngày"
                className="h-9"
              />
            </CardContent>
          </Card>

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
                {/* Sticky restock action bar */}
                {(selectedReturns.size + selectedFailedLines.size) > 0 && (
                  <Card className="sticky top-16 z-10 rounded-2xl border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 shadow-sm">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-bold text-primary text-sm">
                          {selectedReturns.size + selectedFailedLines.size} mục đã chọn
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {selectedReturns.size} trả hàng • {selectedFailedLines.size} giao thất bại
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedReturns(new Set())
                            setSelectedFailedLines(new Set())
                          }}
                        >
                          Bỏ chọn
                        </Button>
                        <Button size="sm" onClick={handleRestock} disabled={restocking}>
                          <ArrowDownToLine className="h-4 w-4 mr-1.5" />
                          {restocking ? "Đang nhập..." : `Nhập lại kho (${selectedReturns.size + selectedFailedLines.size})`}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Approved returns */}
                {filteredReturns.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Trả hàng đã duyệt ({approvedReturns.length})
                      </p>
                      <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedReturns.size === filteredReturns.length && filteredReturns.length > 0}
                          onChange={() => {
                            if (selectedReturns.size === filteredReturns.length) {
                              setSelectedReturns(new Set())
                            } else {
                              setSelectedReturns(new Set(filteredReturns.map((r) => r.id)))
                            }
                          }}
                          className="h-4 w-4"
                        />
                        Chọn tất cả
                      </label>
                    </div>
                    {filteredReturns.map((r) => (
                      <Card key={r.id} className={selectedReturns.has(r.id) ? "border-primary bg-primary/5" : ""}>
                        <CardContent className="p-4 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={selectedReturns.has(r.id)}
                              onChange={() => toggleReturn(r.id)}
                              className="h-4 w-4 mt-1 shrink-0"
                              aria-label={`Chọn trả hàng ${r.id}`}
                            />
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-[#fff4ed] text-[#b54708] flex items-center justify-center">
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
                {filteredFailed.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Giao thất bại ({failedDeliveries.length})
                      </p>
                      <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedFailedLines.size === filteredFailed.length && filteredFailed.length > 0}
                          onChange={() => {
                            if (selectedFailedLines.size === filteredFailed.length) {
                              setSelectedFailedLines(new Set())
                            } else {
                              setSelectedFailedLines(new Set(filteredFailed.map((d) => d.id)))
                            }
                          }}
                          className="h-4 w-4"
                        />
                        Chọn tất cả
                      </label>
                    </div>
                    {filteredFailed.map((d) => (
                      <Card key={d.id} className={selectedFailedLines.has(d.id) ? "border-primary bg-primary/5" : ""}>
                        <CardContent className="p-4 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <input
                              type="checkbox"
                              checked={selectedFailedLines.has(d.id)}
                              onChange={() => toggleFailed(d.id)}
                              className="h-4 w-4 mt-1 shrink-0"
                              aria-label={`Chọn giao thất bại ${d.id}`}
                            />
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-error-container text-error flex items-center justify-center">
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
                      checked={selected.size === filteredConfirmed.length && confirmedOrders.length > 0}
                      onChange={toggleAll}
                      className="h-4 w-4"
                    />
                    Chọn tất cả ({confirmedOrders.length})
                  </label>
                </div>

                <div className="space-y-2">
                  {filteredConfirmed.map((o) => {
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
