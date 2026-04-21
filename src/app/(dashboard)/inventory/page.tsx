"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  ClipboardList,
  Search,
  MoreVertical,
  Package,
  AlertTriangle,
  Clock,
  Wallet,
  Eye,
  Plus,
} from "lucide-react"
import type { Batch, Product, StockEntry } from "@/types"

type BatchWithProduct = Batch & { product?: Product; avg_price?: number | null }

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function getBatchExpiryState(
  expiresAt: string,
  shelfLifeDays?: number | null
): "expired" | "critical" | "push" | "safe" {
  const days = daysUntil(expiresAt)
  if (days < 0) return "expired"
  if (days < 30) return "critical"
  if (shelfLifeDays && days < shelfLifeDays / 3) return "push"
  return "safe"
}

export default function InventoryPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<BatchWithProduct[]>([])
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("fefo")
  const [search, setSearch] = useState("")
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [now, setNow] = useState<Date>(new Date())
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    async function fetchAll() {
      const [batchesRes, entriesRes] = await Promise.all([
        supabase
          .from("batches")
          .select("*, product:products(*)")
          .gt("qty_on_hand", 0)
          .order("expires_at"),
        supabase
          .from("stock_entries")
          .select("*, creator:users!stock_entries_created_by_fkey(*)")
          .order("created_at", { ascending: false }),
      ])
      setBatches((batchesRes.data as BatchWithProduct[]) || [])
      setEntries((entriesRes.data as StockEntry[]) || [])
      setLoading(false)
    }
    fetchAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let expiringSoon = 0
    let needsPush = 0
    let totalValue = 0
    for (const b of batches) {
      const state = getBatchExpiryState(b.expires_at, b.product?.shelf_life_days ?? undefined)
      if (state === "critical" || state === "expired") expiringSoon++
      if (state === "push") needsPush++
      const price = typeof b.avg_price === "number" ? b.avg_price : 0
      totalValue += (b.qty_on_hand || 0) * price
    }
    return { expiringSoon, needsPush, totalValue }
  }, [batches])

  const brands = useMemo(() => {
    const set = new Set<string>()
    batches.forEach((b) => {
      if (b.product?.brand) set.add(b.product.brand)
    })
    return Array.from(set)
  }, [batches])

  const locations = useMemo(() => {
    const set = new Set<string>()
    batches.forEach((b) => {
      if (b.location) set.add(b.location)
    })
    return Array.from(set)
  }, [batches])

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return batches.filter((b) => {
      if (
        q &&
        !(b.product?.name || "").toLowerCase().includes(q) &&
        !(b.product?.sku || "").toLowerCase().includes(q) &&
        !b.batch_code.toLowerCase().includes(q)
      ) {
        return false
      }
      if (brandFilter !== "all" && b.product?.brand !== brandFilter) return false
      if (locationFilter !== "all" && b.location !== locationFilter) return false
      return true
    })
  }, [batches, search, brandFilter, locationFilter])

  const inventorySummary = useMemo(() => {
    const map = new Map<
      string,
      { product: Product; total: number; lowThreshold: number }
    >()
    for (const b of batches) {
      if (!b.product) continue
      const key = b.product.id
      const current = map.get(key) || {
        product: b.product,
        total: 0,
        lowThreshold: 20,
      }
      current.total += b.qty_on_hand || 0
      map.set(key, current)
    }
    return Array.from(map.values()).sort((a, b) =>
      a.product.name.localeCompare(b.product.name, "vi")
    )
  }, [batches])

  const stocktakeEntries = useMemo(
    () => entries.filter((e) => e.type === "stocktake"),
    [entries]
  )

  const timeLabel = now.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-2xl font-bold tracking-tight text-foreground">
            Quản lý Kho hàng
          </h1>
          <div className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
            <Activity className="h-3 w-3" />
            Hệ thống ổn định • Cập nhật cuối: {timeLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/inventory/stock-in">
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              Nhập kho
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/inventory/stock-out">
              <ArrowUpFromLine className="mr-2 h-4 w-4" />
              Xuất kho
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/inventory/stocktake-check">
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Kiểm kê
            </Link>
          </Button>
          <Button asChild>
            <Link href="/inventory/stocktake">
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Điều chỉnh
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="sticky top-0 z-10 -mx-2 bg-background/80 px-2 py-2 backdrop-blur">
          <TabsList className="w-full overflow-x-auto justify-start gap-1 h-auto flex-wrap">
            <TabsTrigger value="current">Tồn kho hiện tại</TabsTrigger>
            <TabsTrigger value="fefo">Theo lô hàng (FEFO)</TabsTrigger>
            <TabsTrigger value="entries">Phiếu nhập/xuất</TabsTrigger>
            <TabsTrigger value="stocktake">Kiểm kê</TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: current stock summary */}
        <TabsContent value="current" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <Skeleton className="h-48" />
                </div>
              ) : inventorySummary.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-8 w-8 text-muted-foreground" />}
                  title="Chưa có dữ liệu tồn kho"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Tổng tồn</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventorySummary.map((row) => {
                      const low = row.total <= row.lowThreshold
                      return (
                        <TableRow key={row.product.id}>
                          <TableCell className="font-medium">
                            {row.product.name}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {row.product.sku}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {row.total} {row.product.base_unit}
                          </TableCell>
                          <TableCell>
                            <Badge variant={low ? "warning" : "success"}>
                              {low ? "Low" : "OK"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: FEFO batches (default) */}
        <TabsContent value="fefo" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="border-l-4 border-l-destructive">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Sắp hết hạn
                    </div>
                    <div className="mt-2 text-2xl font-bold text-destructive">
                      {stats.expiringSoon}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Lô có HSD &lt; 30 ngày
                    </div>
                  </div>
                  <div className="rounded-xl bg-destructive/10 p-3 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-primary">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cần đẩy hàng
                    </div>
                    <div className="mt-2 text-2xl font-bold text-primary">
                      {stats.needsPush}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      HSD còn &lt; 1/3 tuổi thọ
                    </div>
                  </div>
                  <div className="rounded-xl bg-primary/10 p-3 text-primary">
                    <Clock className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-green-500">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tổng giá trị tồn kho
                    </div>
                    <div className="mt-2 text-xl font-bold text-green-700">
                      {formatCurrency(stats.totalValue)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Tính theo giá vốn trung bình
                    </div>
                  </div>
                  <div className="rounded-xl bg-green-100 p-3 text-green-700">
                    <Wallet className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo SKU, tên sản phẩm hoặc mã lô..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Thương hiệu" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả thương hiệu</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Vị trí" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả vị trí</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <Skeleton className="h-48" />
                </div>
              ) : filteredBatches.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-8 w-8 text-muted-foreground" />}
                  title="Không có lô hàng phù hợp"
                  description="Thử điều chỉnh bộ lọc để xem thêm kết quả"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Mã lô</TableHead>
                      <TableHead>NSX / HSD</TableHead>
                      <TableHead>Trạng thái HSD</TableHead>
                      <TableHead>Vị trí</TableHead>
                      <TableHead className="text-right">Tồn thực tế</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBatches.map((b) => {
                      const state = getBatchExpiryState(
                        b.expires_at,
                        b.product?.shelf_life_days ?? undefined
                      )
                      const days = daysUntil(b.expires_at)
                      const expiryColor =
                        state === "expired" || state === "critical"
                          ? "text-destructive"
                          : state === "push"
                            ? "text-primary"
                            : "text-foreground"
                      const statusBadge =
                        state === "expired" ? (
                          <Badge variant="danger">
                            Đã hết hạn {Math.abs(days)} ngày
                          </Badge>
                        ) : state === "critical" ? (
                          <Badge variant="danger">
                            Hết hạn trong {days} ngày
                          </Badge>
                        ) : state === "push" ? (
                          <Badge variant="warning">
                            Cần đẩy hàng (&lt;1/3)
                          </Badge>
                        ) : (
                          <Badge variant="success">An toàn</Badge>
                        )
                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/30 text-muted-foreground">
                                <Package className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold truncate">
                                  {b.product?.name || "—"}
                                </div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {b.product?.sku}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-md bg-muted/30 px-2 py-1 font-mono text-xs">
                              {b.batch_code}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground">
                              NSX:{" "}
                              {b.manufactured_at
                                ? formatDate(b.manufactured_at)
                                : "—"}
                            </div>
                            <div className={`text-sm font-semibold ${expiryColor}`}>
                              HSD: {formatDate(b.expires_at)}
                            </div>
                          </TableCell>
                          <TableCell>{statusBadge}</TableCell>
                          <TableCell>
                            <div className="font-medium">{b.location || "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              Khu vực kho
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-bold">{b.qty_on_hand}</div>
                            <div className="text-xs text-muted-foreground">
                              {b.product?.base_unit || ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/inventory/batches/${b.id}`}>
                                    <Eye className="mr-2 h-4 w-4" /> Xem chi
                                    tiết
                                  </Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: stock entries */}
        <TabsContent value="entries" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <Skeleton className="h-48" />
                </div>
              ) : entries.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
                  title="Chưa có phiếu kho"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã phiếu</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>Người tạo</TableHead>
                      <TableHead>Ghi chú</TableHead>
                      <TableHead>Ngày</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => {
                      const t = STOCK_ENTRY_TYPES.find((x) => x.value === e.type)
                      const variant: "success" | "warning" | "default" | "secondary" =
                        e.type === "import"
                          ? "success"
                          : e.type === "export"
                            ? "warning"
                            : e.type === "transfer"
                              ? "default"
                              : "secondary"
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-sm">
                            {e.entry_code}
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant}>{t?.label || e.type}</Badge>
                          </TableCell>
                          <TableCell>{e.creator?.full_name || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {e.notes || "—"}
                          </TableCell>
                          <TableCell>{formatDate(e.created_at)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: stocktake */}
        <TabsContent value="stocktake" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {stocktakeEntries.length} phiếu kiểm kê
            </div>
            <Button onClick={() => router.push("/inventory/stocktake")}>
              <Plus className="mr-2 h-4 w-4" /> Tạo phiếu kiểm kê
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <Skeleton className="h-48" />
                </div>
              ) : stocktakeEntries.length === 0 ? (
                <EmptyState
                  icon={<ClipboardCheck className="h-8 w-8 text-muted-foreground" />}
                  title="Chưa có phiếu kiểm kê"
                  description="Tạo phiếu kiểm kê để điều chỉnh tồn kho thực tế"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã phiếu</TableHead>
                      <TableHead>Người tạo</TableHead>
                      <TableHead>Ghi chú</TableHead>
                      <TableHead>Ngày</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stocktakeEntries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-sm">
                          {e.entry_code}
                        </TableCell>
                        <TableCell>{e.creator?.full_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.notes || "—"}
                        </TableCell>
                        <TableCell>{formatDate(e.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
