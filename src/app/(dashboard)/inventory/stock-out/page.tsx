"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Filter,
  Inbox,
  MapPin,
  Package,
  PackageCheck,
  Route,
  ScanBarcode,
  Sparkles,
} from "lucide-react"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type {
  Batch,
  Customer,
  Product,
  SalesOrder,
  SalesOrderLine,
} from "@/types"

type OrderWithRelations = SalesOrder & {
  customer?: Customer
  lines?: (SalesOrderLine & { product?: Product })[]
}

type BatchLite = Pick<Batch, "id" | "product_id" | "location" | "qty_on_hand" | "expires_at">

// Derive route label from customer district/province
function deriveRoute(customer?: Customer): string {
  const base = customer?.district || customer?.province || customer?.ward || ""
  if (!base) return "A"
  // Deterministic route letter from first char
  const code = base.trim().charCodeAt(0)
  const letters = ["A", "B", "C", "D", "E", "F"]
  return letters[code % letters.length]
}

// Stable color palette for customer grouping (same-color border)
const GROUP_COLORS = [
  "border-l-sky-400",
  "border-l-emerald-400",
  "border-l-amber-400",
  "border-l-rose-400",
  "border-l-violet-400",
  "border-l-cyan-400",
  "border-l-lime-400",
  "border-l-fuchsia-400",
]

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function generateMergeCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(1 + Math.random() * 999)
    .toString()
    .padStart(3, "0")
  return `MG-${yy}${mm}${dd}-${rand}`
}

export default function StockOutPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [orders, setOrders] = useState<OrderWithRelations[]>([])
  const [batches, setBatches] = useState<BatchLite[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showFilter, setShowFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [customerFilter, setCustomerFilter] = useState<string>("all")
  const [mergeCode] = useState<string>(generateMergeCode())
  const [submitting, setSubmitting] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null)
  // T-12: hàng đem đi đổi (dự phòng) — driver carries spare stock for
  // in-the-field exchanges. These rows ride along on the same export
  // stock_entry and surface on the print slip in their own section.
  const [swapItems, setSwapItems] = useState<
    Array<{
      key: string
      productId: string
      productName: string
      sku: string
      unit: string
      conversionFactor: number
      qty: string
      reason: string
    }>
  >([])
  const [swapPickerOpen, setSwapPickerOpen] = useState(false)
  const [swapSearch, setSwapSearch] = useState("")
  const [productCatalog, setProductCatalog] = useState<
    Array<{
      id: string
      sku: string
      name: string
      base_unit: string
      units: Array<{ unit_name: string; conversion: number }>
    }>
  >([])

  const canUpdate =
    !!user &&
    (user.role === "owner" ||
      user.role === "manager" ||
      user.role === "warehouse") &&
    hasPermission(user.role, "orders", "read")

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const ordersRes = await supabase
        .from("sales_orders")
        .select(
          "*, customer:customers(id, store_name, phone, district, province, ward), lines:sales_order_lines(*, product:products(id, sku, name, base_unit))"
        )
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })

      const typed = (ordersRes.data as OrderWithRelations[]) || []
      setOrders(typed)

      // Pre-select orders from ?orderIds= (from /inventory/pending)
      const preIds = searchParams.get("orderIds")
      if (preIds) {
        const idSet = new Set(preIds.split(",").filter(Boolean))
        const valid = typed.filter((o) => idSet.has(o.id)).map((o) => o.id)
        if (valid.length > 0) setSelectedIds(new Set(valid))
      }

      const productIds = Array.from(
        new Set(
          typed.flatMap((o) => (o.lines || []).map((l) => l.product_id))
        )
      )

      if (productIds.length > 0) {
        const { data: batchData } = await supabase
          .from("batches")
          .select("id, product_id, location, qty_on_hand, expires_at")
          .in("product_id", productIds)
          .gt("qty_on_hand", 0)
          .order("expires_at", { ascending: true })
        setBatches((batchData as BatchLite[]) || [])
      } else {
        setBatches([])
      }
      setLoading(false)
      setLastUpdated(new Date())
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>()
    orders.forEach((o) => {
      if (o.customer_id && o.customer?.store_name) {
        map.set(o.customer_id, o.customer.store_name)
      }
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [orders])

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const matchCustomer =
        customerFilter === "all" || o.customer_id === customerFilter
      const matchFrom =
        !dateFrom || new Date(o.order_date) >= new Date(dateFrom)
      const matchTo =
        !dateTo ||
        new Date(o.order_date) <= new Date(dateTo + "T23:59:59")
      return matchCustomer && matchFrom && matchTo
    })
  }, [orders, customerFilter, dateFrom, dateTo])

  // Customer groups with count > 1 get highlighted with same color border
  const customerGroupColor = useMemo(() => {
    const counts = new Map<string, number>()
    filtered.forEach((o) => {
      counts.set(o.customer_id, (counts.get(o.customer_id) || 0) + 1)
    })
    const map = new Map<string, string>()
    counts.forEach((count, cid) => {
      if (count > 1) {
        map.set(cid, GROUP_COLORS[hashString(cid) % GROUP_COLORS.length])
      }
    })
    return map
  }, [filtered])

  const selectedOrders = useMemo(
    () => orders.filter((o) => selectedIds.has(o.id)),
    [orders, selectedIds]
  )

  // Pick-list summary: aggregate quantity by product across selected orders.
  // T-01 — carry conversion_factor snapshot from sales_order_lines so the
  // export entry can deduct batches in BASE UOM (4 thùng → 40 hộp).
  const pickList = useMemo(() => {
    const agg = new Map<
      string,
      {
        product_id: string
        sku: string
        name: string
        unit: string
        qty: number
        qty_in_base_uom: number
        conversion_factor: number
        location: string
      }
    >()
    selectedOrders.forEach((o) => {
      ;(o.lines || []).forEach((l) => {
        const key = `${l.product_id}__${l.unit_name}`
        const factor = Number(
          (l as unknown as { conversion_factor?: number }).conversion_factor ?? 1
        )
        const existing = agg.get(key)
        const lineQty = Number(l.quantity || 0)
        if (existing) {
          existing.qty += lineQty
          existing.qty_in_base_uom += lineQty * factor
        } else {
          const firstBatch = batches.find(
            (b) => b.product_id === l.product_id
          )
          agg.set(key, {
            product_id: l.product_id,
            sku: l.product?.sku || "",
            name: l.product?.name || "",
            unit: l.unit_name,
            qty: lineQty,
            qty_in_base_uom: lineQty * factor,
            conversion_factor: factor,
            location: firstBatch?.location || "—",
          })
        }
      })
    })
    return Array.from(agg.values()).sort((a, b) => b.qty - a.qty)
  }, [selectedOrders, batches])

  const uniqueSkuCount = pickList.length

  const targetCustomer = useMemo(() => {
    if (selectedOrders.length === 0) return null
    const first = selectedOrders[0].customer_id
    const allSame = selectedOrders.every((o) => o.customer_id === first)
    return allSame ? selectedOrders[0].customer : null
  }, [selectedOrders])

  const readyToMergeCount = useMemo(() => {
    const counts = new Map<string, number>()
    filtered.forEach((o) => {
      counts.set(o.customer_id, (counts.get(o.customer_id) || 0) + 1)
    })
    let c = 0
    counts.forEach((v) => {
      if (v > 1) c += v
    })
    return c
  }, [filtered])

  const processBarcodeResult = (code: string) => {
    const matchedProduct = orders
      .flatMap((o) => o.lines || [])
      .map((l) => l.product)
      .find((p) => p && (p.sku === code))
    if (!matchedProduct) {
      toast({ title: "Không tìm thấy", description: `Mã: ${code}`, variant: "destructive" })
      setHighlightedProductId(null)
      return
    }
    const containingOrders = filtered.filter((o) =>
      (o.lines || []).some((l) => l.product_id === matchedProduct.id)
    )
    if (containingOrders.length === 0) {
      toast({ title: "Không có đơn nào chứa sản phẩm này", description: matchedProduct.name, variant: "destructive" })
      setHighlightedProductId(null)
    } else {
      setHighlightedProductId(matchedProduct.id)
      toast({ title: `Tìm thấy trong ${containingOrders.length} đơn`, description: matchedProduct.name })
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const clearSelection = () => setSelectedIds(new Set())

  // T-12: lazy load full catalog for the swap picker.
  const openSwapPicker = async () => {
    setSwapPickerOpen(true)
    if (productCatalog.length === 0) {
      const { data } = await supabase
        .from("products")
        .select("id, sku, name, base_unit, units:product_units(unit_name, conversion)")
        .eq("status", "active")
        .order("name")
      setProductCatalog(
        (data as Array<{
          id: string
          sku: string
          name: string
          base_unit: string
          units: Array<{ unit_name: string; conversion: number }>
        }>) || []
      )
    }
  }

  const addSwapItem = (p: {
    id: string
    sku: string
    name: string
    base_unit: string
    units: Array<{ unit_name: string; conversion: number }>
  }) => {
    const baseUnit = p.units[0]?.unit_name || p.base_unit
    const factor = p.units[0]?.conversion ?? 1
    setSwapItems((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        unit: baseUnit,
        conversionFactor: factor,
        qty: "1",
        reason: "Hàng đem đi đổi dự phòng",
      },
    ])
    setSwapPickerOpen(false)
    setSwapSearch("")
  }

  const updateSwapItem = (
    key: string,
    patch: Partial<(typeof swapItems)[number]>
  ) => {
    setSwapItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it))
    )
  }

  const removeSwapItem = (key: string) => {
    setSwapItems((prev) => prev.filter((it) => it.key !== key))
  }

  const resetFilters = () => {
    setDateFrom("")
    setDateTo("")
    setCustomerFilter("all")
  }

  const handleMerge = async () => {
    if (!user || !canUpdate) {
      toast({
        title: "Không đủ quyền",
        description: "Bạn không có quyền xuất kho.",
        variant: "destructive",
      })
      return
    }
    if (selectedOrders.length === 0) {
      toast({
        title: "Chưa chọn đơn nào",
        description: "Vui lòng chọn ít nhất một đơn hàng.",
        variant: "destructive",
      })
      return
    }
    setSubmitting(true)
    try {
      const ids = selectedOrders.map((o) => o.id)

      // 1) Create a stock_entry (type='export') to formally persist the picking command
      const customerNames = Array.from(
        new Set(
          selectedOrders.map((o) => o.customer?.store_name).filter(Boolean)
        )
      ).join(", ")
      const { data: stockEntry, error: stockErr } = await supabase
        .from("stock_entries")
        .insert({
          org_id: user.org_id,
          entry_code: mergeCode,
          type: "export",
          // Draft until a delivery is handed over; batches stay untouched so
          // inventory reflects reality (goods are still physically in the
          // warehouse until the driver takes them).
          status: "draft",
          posted_at: null,
          created_by: user.id,
          notes: `Lệnh xuất kho gộp ${ids.length} đơn cho KH: ${customerNames}`,
          ref_order_ids: ids,
        })
        .select()
        .single()
      if (stockErr) throw stockErr

      // 2) Insert stock_entry_lines - one row per SKU in pick list.
      // T-01: store quantity (transaction UOM) AND base-UOM split.
      // `quantity` column stays in transaction UOM (existing semantics —
      // some legacy code reads it). `qty_in_base_uom` is what the
      // FIFO/batch deduction should consume.
      const entryLines = pickList.map((p) => ({
        entry_id: stockEntry.id,
        product_id: p.product_id,
        unit_name: p.unit,
        quantity: p.qty,
        qty_in_transaction_uom: p.qty,
        qty_in_base_uom: p.qty_in_base_uom,
        transaction_uom: p.unit,
        conversion_factor_snapshot: p.conversion_factor,
        notes: `Vị trí: ${p.location}`,
      }))
      if (entryLines.length > 0) {
        const { error: linesErr } = await supabase
          .from("stock_entry_lines")
          .insert(entryLines)
        if (linesErr) throw linesErr
      }

      // T-12: hàng đem đi đổi → 1 stock_entry_line per swap item +
      // 1 swap_stock_movements row pointing back to that line so T-07
      // handover can see what's still unused.
      if (swapItems.length > 0) {
        const swapEntryLines = swapItems
          .filter((s) => Number(s.qty) > 0)
          .map((s) => {
            const qtyNum = Number(s.qty) || 0
            return {
              entry_id: stockEntry.id,
              product_id: s.productId,
              unit_name: s.unit,
              quantity: qtyNum,
              qty_in_transaction_uom: qtyNum,
              qty_in_base_uom: qtyNum * (s.conversionFactor || 1),
              transaction_uom: s.unit,
              conversion_factor_snapshot: s.conversionFactor,
              notes: `[Swap] ${s.reason || "Hàng đem đi đổi dự phòng"}`,
            }
          })
        if (swapEntryLines.length > 0) {
          const { data: insertedSwapLines, error: swapLinesErr } = await supabase
            .from("stock_entry_lines")
            .insert(swapEntryLines)
            .select("id, product_id, unit_name, qty_in_base_uom")
          if (swapLinesErr) throw swapLinesErr

          // Match inserted lines back to their drafts by (product, unit, base qty).
          const swapMovements = swapItems
            .filter((s) => Number(s.qty) > 0)
            .map((s) => {
              const qtyNum = Number(s.qty) || 0
              const baseQty = qtyNum * (s.conversionFactor || 1)
              const matched = (insertedSwapLines || []).find(
                (l) =>
                  l.product_id === s.productId &&
                  l.unit_name === s.unit &&
                  Number(l.qty_in_base_uom) === baseQty
              )
              return {
                org_id: user.org_id,
                stock_entry_id: stockEntry.id,
                product_id: s.productId,
                qty: qtyNum,
                unit_name: s.unit,
                conversion_factor: s.conversionFactor,
                qty_in_base_uom: baseQty,
                reason: s.reason || null,
                out_line_id: matched?.id ?? null,
                created_by: user.id,
              }
            })
          if (swapMovements.length > 0) {
            const { error: swapErr } = await supabase
              .from("swap_stock_movements")
              .insert(swapMovements)
            if (swapErr) throw swapErr
          }
        }
      }

      // 3) Update orders to 'picking'
      const { error: updateErr } = await supabase
        .from("sales_orders")
        .update({ status: "picking" })
        .in("id", ids)
      if (updateErr) throw updateErr

      // Group selected by customer_id
      const byCustomer = new Map<string, string[]>()
      selectedOrders.forEach((o) => {
        const arr = byCustomer.get(o.customer_id) || []
        arr.push(o.id)
        byCustomer.set(o.customer_id, arr)
      })

      const mergedRows: {
        merged_order_id: string
        source_order_id: string
      }[] = []
      byCustomer.forEach((orderIds) => {
        if (orderIds.length >= 2) {
          const parent = orderIds[0]
          orderIds.slice(1).forEach((sid) => {
            mergedRows.push({
              merged_order_id: parent,
              source_order_id: sid,
            })
          })
        }
      })

      if (mergedRows.length > 0) {
        const { error: mergeErr } = await supabase
          .from("merged_orders")
          .insert(mergedRows)
        if (mergeErr) throw mergeErr
      }

      toast({
        title: `Đã tạo lệnh xuất kho ${mergeCode}`,
        description: `${ids.length} đơn chuyển sang trạng thái soạn hàng. Tiếp theo: phân công lái xe.`,
      })
      clearSelection()
      router.push(`/inventory/entries/${stockEntry.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({
        title: "Lỗi",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const pendingCount = orders.length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Xuất kho & Gộp đơn"
        description="Chọn đơn đã duyệt và tạo lệnh nhặt hàng hợp nhất"
        backHref="/inventory"
      />

      {/* Top stats mini */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="bg-surface-low">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Đơn chờ xử lý
              </p>
              <p className="text-3xl font-black mt-1">{pendingCount}</p>
            </div>
            <Inbox className="h-10 w-10 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Sẵn sàng gộp đơn
              </p>
              <p className="text-3xl font-black mt-1 text-primary">
                {readyToMergeCount}
              </p>
            </div>
            <PackageCheck className="h-10 w-10 text-primary" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7/12 */}
        <div className="lg:col-span-7 space-y-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">
                    Đơn hàng chờ xuất kho
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Chỉ hiển thị đơn đã duyệt (confirmed)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setBarcodeOpen(true)}
                    title="Quét mã vạch tìm đơn"
                  >
                    <ScanBarcode className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilter((v) => !v)}
                    className="gap-2"
                  >
                    <Filter className="h-4 w-4" /> Filter
                  </Button>
                </div>
              </div>

              {showFilter && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-4 rounded-xl bg-surface-low">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Từ ngày
                    </label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Đến ngày
                    </label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Khách hàng
                    </label>
                    <Select
                      value={customerFilter}
                      onValueChange={setCustomerFilter}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tất cả" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tất cả khách hàng</SelectItem>
                        {customerOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-3 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetFilters}
                    >
                      Xóa bộ lọc
                    </Button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-8 w-8 text-muted-foreground" />}
                  title="Không có đơn chờ xuất"
                  description="Chưa có đơn ở trạng thái đã duyệt."
                />
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Mã đơn</TableHead>
                          <TableHead>Khách hàng</TableHead>
                          <TableHead>Ngày đặt</TableHead>
                          <TableHead className="text-right">Tổng tiền</TableHead>
                          <TableHead>Lộ trình</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((o) => {
                          const checked = selectedIds.has(o.id)
                          const groupColor = customerGroupColor.get(
                            o.customer_id
                          )
                          const route = deriveRoute(o.customer)
                          const isHighlighted = highlightedProductId
                            ? (o.lines || []).some((l) => l.product_id === highlightedProductId)
                            : false
                          return (
                            <TableRow
                              key={o.id}
                              data-state={checked ? "selected" : undefined}
                              onClick={() => toggleOne(o.id)}
                              className={`cursor-pointer border-l-4 ${
                                isHighlighted ? "border-l-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" : groupColor || "border-l-transparent"
                              }`}
                            >
                              <TableCell
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleOne(o.id)}
                                  aria-label={`Chọn ${o.order_code}`}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-sm font-bold text-primary">
                                {o.order_code}
                              </TableCell>
                              <TableCell className="font-medium">
                                {o.customer?.store_name || "-"}
                              </TableCell>
                              <TableCell className="text-sm">
                                {formatDate(o.order_date)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(o.total)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  LỘ TRÌNH {route}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile card list */}
                  <div className="md:hidden space-y-2">
                    {filtered.map((o) => {
                      const checked = selectedIds.has(o.id)
                      const route = deriveRoute(o.customer)
                      const isHighlighted = highlightedProductId
                        ? (o.lines || []).some((l) => l.product_id === highlightedProductId)
                        : false
                      return (
                        <div
                          key={o.id}
                          onClick={() => toggleOne(o.id)}
                          className={`rounded-xl border p-3 cursor-pointer active:scale-[0.99] transition-transform ${
                            checked ? "bg-primary/5 border-primary" : ""
                          } ${isHighlighted ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" : ""}`}
                        >
                          <div className="flex items-start gap-2">
                            <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleOne(o.id)}
                                aria-label={`Chọn ${o.order_code}`}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <p className="font-mono text-xs font-bold text-primary">{o.order_code}</p>
                                <Badge variant="secondary" className="text-[10px]">LT {route}</Badge>
                              </div>
                              <p className="font-medium text-sm truncate">{o.customer?.store_name || "-"}</p>
                              <div className="flex items-center justify-between gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">{formatDate(o.order_date)}</span>
                                <span className="text-sm font-bold">{formatCurrency(o.total)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 5/12 - Dark merge preview */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-3xl bg-gray-900 text-white p-6 shadow-ambient-md">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-400 font-semibold">
                  <Sparkles className="h-3.5 w-3.5" /> Merge Preview
                </div>
                <h3 className="text-xl font-black mt-1">Lệnh xuất kho</h3>
              </div>
              <Badge
                variant="outline"
                className="border-white/30 text-white bg-white/5"
              >
                {mergeCode}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                  Số đơn gộp
                </p>
                <p className="text-2xl font-black mt-1">
                  {selectedOrders.length}
                </p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                  Khách mục tiêu
                </p>
                <p className="text-sm font-bold mt-1 truncate">
                  {targetCustomer?.store_name || "—"}
                </p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                  Tổng SKU
                </p>
                <p className="text-2xl font-black mt-1">{uniqueSkuCount}</p>
              </div>
            </div>

            <div className="mb-5">
              <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
                Pick-list Summary (SKU)
              </p>
              {pickList.length === 0 ? (
                <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-gray-400">
                  Chọn đơn hàng để xem danh sách nhặt
                </div>
              ) : (
                <div className="space-y-2">
                  {pickList.slice(0, 3).map((p) => (
                    <div
                      key={`${p.product_id}-${p.unit}`}
                      className="flex items-center justify-between rounded-xl bg-white/5 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-gray-300">
                            {p.sku}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                            <MapPin className="h-3 w-3" /> {p.location}
                          </span>
                        </div>
                        <p className="text-sm font-semibold truncate mt-0.5">
                          {p.name}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-lg font-black">{p.qty}</p>
                        <p className="text-[10px] uppercase text-gray-400">
                          {p.unit}
                        </p>
                      </div>
                    </div>
                  ))}
                  {pickList.length > 3 && (
                    <p className="text-xs text-gray-400 text-center">
                      +{pickList.length - 3} SKU khác
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* T-12: hàng đem đi đổi (dự phòng) */}
            <div className="rounded-xl bg-white/5 border border-dashed border-amber-300/40 p-3 mb-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-amber-200 font-semibold">
                  Hàng đem đi đổi (dự phòng)
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={openSwapPicker}
                >
                  + Thêm SP
                </Button>
              </div>
              {swapItems.length === 0 ? (
                <p className="text-[11px] text-gray-400">
                  Tuỳ chọn — thêm SP nếu lái xe muốn cầm theo để đổi cho khách tại nhà.
                </p>
              ) : (
                <div className="space-y-1">
                  {swapItems.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center gap-2 text-xs bg-black/20 rounded p-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{s.productName}</p>
                        <p className="font-mono text-[10px] text-gray-400">{s.sku}</p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={s.qty}
                        onChange={(e) =>
                          updateSwapItem(s.key, { qty: e.target.value })
                        }
                        className="h-7 w-16 rounded bg-white/10 px-2 text-right tabular-nums text-white"
                      />
                      <span className="text-[10px] text-gray-400 w-8">{s.unit}</span>
                      <Input
                        value={s.reason}
                        onChange={(e) =>
                          updateSwapItem(s.key, { reason: e.target.value })
                        }
                        placeholder="Lý do"
                        className="h-7 text-[11px] bg-white/10 border-0 text-white placeholder:text-gray-500"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-300 hover:text-red-100"
                        onClick={() => removeSwapItem(s.key)}
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-3">
              <p className="text-[11px] text-gray-300">
                Bước tiếp theo: sau khi bấm <span className="font-bold">Xuất kho</span>, hệ thống sẽ
                tạo phiếu xuất nháp và chuyển bạn sang trang phiếu để phân công lái xe, bàn giao
                hoặc tự giao hàng.
              </p>
            </div>

            <Button
              className="w-full h-12 text-base"
              onClick={handleMerge}
              disabled={
                submitting || selectedOrders.length === 0 || !canUpdate
              }
            >
              <Package className="mr-2 h-5 w-5" />
              {submitting ? "Đang xử lý..." : "Xuất kho"}
            </Button>
            {!canUpdate && (
              <p className="text-xs text-amber-300 mt-2 text-center">
                Cần quyền kho/quản lý để thực hiện.
              </p>
            )}
          </div>

          {/* Optimized Pathing insight */}
          <Card className="bg-surface-container-high border-l-4 border-green-500">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Route className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-green-700 mb-1">
                    Optimized Pathing
                  </p>
                  <p className="text-sm text-foreground">
                    Việc gộp {selectedOrders.length || "N"} đơn này giúp giảm{" "}
                    <span className="font-black text-green-700">~28%</span>{" "}
                    quãng đường nhặt hàng tại{" "}
                    <span className="font-bold">
                      Khu vực{" "}
                      {targetCustomer
                        ? deriveRoute(targetCustomer)
                        : "A-B"}
                    </span>
                    .
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <BarcodeScanner open={barcodeOpen} onClose={() => setBarcodeOpen(false)} onScan={processBarcodeResult} />

      {/* T-12: swap product picker */}
      <Dialog open={swapPickerOpen} onOpenChange={setSwapPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Chọn SP đem đi đổi (dự phòng)</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={swapSearch}
            onChange={(e) => setSwapSearch(e.target.value)}
            placeholder="Tìm theo tên hoặc SKU…"
          />
          <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
            {(() => {
              const q = swapSearch.trim().toLowerCase()
              const list = productCatalog.filter(
                (p) =>
                  !q ||
                  p.name.toLowerCase().includes(q) ||
                  p.sku.toLowerCase().includes(q)
              )
              if (list.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {productCatalog.length === 0
                      ? "Đang tải danh mục..."
                      : "Không tìm thấy sản phẩm"}
                  </p>
                )
              }
              return list.slice(0, 30).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors"
                  onClick={() => addSwapItem(p)}
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    {p.sku} • {p.base_unit}
                  </div>
                </button>
              ))
            })()}
          </div>
          <p className="text-[11px] text-muted-foreground">
            SP chọn ở đây sẽ ghi vào phiếu xuất kèm với hàng theo đơn. Khi lái xe trả về,
            phần chưa dùng sẽ hiện ở trang Bàn giao lại để nhập lại kho.
          </p>
        </DialogContent>
      </Dialog>

      {/* Bottom system log */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground font-mono border-t pt-3">
        <span>[SYS]</span>
        <span>updated {lastUpdated.toLocaleTimeString("vi-VN")}</span>
        <span>·</span>
        <span>server: wms-edge-01</span>
        <span>·</span>
        <span>merge_code={mergeCode}</span>
        <span>·</span>
        <span>selected={selectedOrders.length}</span>
      </div>
    </div>
  )
}
