"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { FilterSearchSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDate, formatCurrency, getExpiryStatus, cn } from "@/lib/utils"
import {
  AlertTriangle,
  Boxes,
  Wallet,
  TrendingDown,
  Download,
} from "lucide-react"
import type { Batch, Product, SalesOrderLine } from "@/types"

interface SupplierOption {
  id: string
  name: string
}

export default function InventoryReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const [batchesAll, setBatchesAll] = useState<(Batch & { product?: Product })[]>([])
  const [salesLines, setSalesLines] = useState<SalesOrderLine[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [brandFilter, setBrandFilter] = useState<string>("")
  const [productFilter, setProductFilter] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const catalogs = useFilterCatalogs(user?.org_id)

  useEffect(() => {
    async function fetch() {
      const [batchesRes, linesRes, suppliersRes] = await Promise.all([
        // Hai truy vấn này để cộng tồn kho và sản lượng bán → phải lấy đủ.
        fetchAllForAggregate((from, to) =>
          supabase
            .from("batches")
            .select("id, product_id, batch_code, qty_on_hand, expires_at, product:products(*)", {
              count: "exact",
            })
            .gt("qty_on_hand", 0)
            .order("expires_at")
            .range(from, to)
        ),
        fetchAllForAggregate<SalesOrderLine>((from, to) =>
          supabase
            .from("sales_order_lines")
            .select("id, product_id, quantity", { count: "exact" })
            .range(from, to)
        ),
        supabase.from("suppliers").select("id, name").order("name"),
      ])
      const aggErr = [batchesRes.error, linesRes.error].find(Boolean)
      if (aggErr) console.error("[reports/inventory] truy vấn lỗi:", aggErr)
      const qErr = ([suppliersRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[reports/inventory] truy vấn lỗi:", qErr.message)
      setBatchesAll(batchesRes.rows as unknown as (Batch & { product?: Product })[])
      setSalesLines(linesRes.rows)
      setSuppliers((suppliersRes.data as SupplierOption[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const b of batchesAll) {
      const c = b.product?.category
      if (c) set.add(c)
    }
    return Array.from(set).sort()
  }, [batchesAll])

  const batches = useMemo(() => {
    return batchesAll.filter((b) => {
      if (supplierFilter !== "all" && b.product?.primary_supplier_id !== supplierFilter) {
        return false
      }
      if (categoryFilter !== "all" && (b.product?.category || "") !== categoryFilter) {
        return false
      }
      if (brandFilter && (b.product?.brand || "") !== brandFilter) return false
      if (productFilter && b.product_id !== productFilter) return false
      return true
    })
  }, [batchesAll, supplierFilter, categoryFilter, brandFilter, productFilter])

  const stats = useMemo(() => {
    const totalItems = batches.reduce((sum, b) => sum + b.qty_on_hand, 0)
    const uniqueSkus = new Set(batches.map((b) => b.product_id)).size
    const expiringCount = batches.filter(
      (b) => getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined) !== "ok"
    ).length
    const lowStockThreshold = 20
    const stockByProduct = new Map<string, number>()
    batches.forEach((b) => {
      stockByProduct.set(b.product_id, (stockByProduct.get(b.product_id) || 0) + b.qty_on_hand)
    })
    const lowStockCount = Array.from(stockByProduct.values()).filter(
      (q) => q > 0 && q <= lowStockThreshold
    ).length
    const totalValue = batches.reduce((sum, b) => sum + b.qty_on_hand * 50000, 0)
    return { totalItems, uniqueSkus, expiringCount, lowStockCount, totalValue, stockByProduct }
  }, [batches])

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    batches.forEach((b) => {
      const cat = b.product?.category || "Khác"
      map.set(cat, (map.get(cat) || 0) + b.qty_on_hand)
    })
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0) || 1
    return Array.from(map.entries())
      .map(([name, qty]) => ({
        name,
        qty,
        pct: Math.round((qty / total) * 100),
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
  }, [batches])

  /**
   * ĐÃ GỠ — biểu đồ "Xu hướng tồn kho" từng vẽ bằng Math.random().
   *
   * Mã cũ:
   *     const sample = stats.totalItems * (0.6 + Math.random() * 0.5)
   *
   * Nó nằm dưới tiêu đề "Tổng tồn kho theo 6 tháng gần nhất" kèm chú giải
   * "Tổng đơn vị tồn", nên người xem hoàn toàn tin đó là số thật và có thể
   * kết luận về xu hướng tồn kho từ số bịa. Cột còn đổi mỗi lần render.
   * (Math.random() trong render cũng làm HTML server và client khác nhau →
   * React báo lỗi #418/#423.)
   *
   * KHÔNG dựng lại bằng số thật ở đây vì chưa có dữ liệu để dựng: không có
   * bảng nào lưu tồn kho theo thời điểm. Có thể suy ngược từ stock_entries
   * nhưng phải giả định lịch sử xuất nhập đầy đủ — nếu tồn đầu kỳ từng được
   * đặt thẳng vào batches thì con số suy ra sẽ sai. Thay số bịa bằng số có
   * thể sai thì không hơn gì. Muốn có biểu đồ này thì cần chốt cách ghi
   * nhận lịch sử tồn trước.
   */

  const attentionRows = useMemo(() => {
    const nearExpiry = batches
      .filter(
        (b) => getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined) !== "ok"
      )
      .slice(0, 5)
      .map((b) => ({
        id: b.id,
        sku: b.product?.sku || "—",
        name: b.product?.name || "—",
        category: b.product?.category || "—",
        unit: b.product?.base_unit || "—",
        qty: b.qty_on_hand,
        batchCode: b.batch_code,
        expiry: b.expires_at,
        tag: "Cận date" as const,
      }))

    const salesCount = new Map<string, number>()
    salesLines.forEach((l) => {
      salesCount.set(l.product_id, (salesCount.get(l.product_id) || 0) + l.quantity)
    })

    const slowMovers = batches
      .filter((b) => (salesCount.get(b.product_id) || 0) < 5 && b.qty_on_hand > 0)
      .slice(0, 5)
      .map((b) => ({
        id: `slow-${b.id}`,
        sku: b.product?.sku || "—",
        name: b.product?.name || "—",
        category: b.product?.category || "—",
        unit: b.product?.base_unit || "—",
        qty: b.qty_on_hand,
        batchCode: b.batch_code,
        expiry: b.expires_at,
        tag: "Bán chậm" as const,
      }))

    const combined = [...nearExpiry, ...slowMovers]
    const seen = new Set<string>()
    return combined.filter((r) => {
      if (seen.has(r.sku)) return false
      seen.add(r.sku)
      return true
    })
  }, [batches, salesLines])

  if (authLoading || loading) return <Skeleton className="h-[500px]" />

  const donutColors = ["bg-primary", "bg-primary/60", "bg-primary/40", "bg-secondary", "bg-muted"]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Báo cáo Chi tiết Kho hàng"
        description="Phân tích chuyên sâu hiệu suất và giá trị hàng tồn (Module M12)"
        backHref="/reports"
      >
        <button
          onClick={() => typeof window !== "undefined" && window.print()}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-md hover:brightness-110 transition-all print:hidden"
        >
          <Download className="h-4 w-4" /> Xuất báo cáo
        </button>
      </PageHeader>

      {/* Bộ lọc — NCC + Ngành hàng (§3.2) */}
      <Card className="rounded-2xl border-dashed print:hidden">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Nhà cung cấp
            </label>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tất cả NCC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả NCC</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ngành hàng
            </label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tất cả" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả ngành hàng</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Thương hiệu
            </label>
            <FilterSearchSelect
              value={brandFilter}
              onChange={setBrandFilter}
              options={catalogs.brands}
              placeholder="Tất cả thương hiệu"
              loading={catalogs.loading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hàng hóa cụ thể
            </label>
            <FilterSearchSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              placeholder="Theo mã, tên hàng"
              loading={catalogs.loading}
            />
          </div>
          <div className="md:col-span-3 flex items-end">
            <p className="text-xs text-muted-foreground">
              Đang xem <span className="font-bold text-foreground">{batches.length}</span> /{" "}
              {batchesAll.length} lô hàng
            </p>
          </div>
        </CardContent>
      </Card>

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-primary bg-surface-lowest/70 backdrop-blur-sm shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-primary/10 text-primary">
                <Boxes className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tổng SKU có tồn
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">{stats.uniqueSkus}</h3>
            <p className="mt-2 text-xs text-muted-foreground">{stats.totalItems.toLocaleString("vi-VN")} đơn vị</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-secondary bg-surface-lowest/70 backdrop-blur-sm shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-secondary/20 text-secondary-foreground">
                <Wallet className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tổng giá trị tồn
            </p>
            <h3 className="mt-1 text-2xl font-black text-foreground">
              {formatCurrency(stats.totalValue)}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">Ước tính theo giá trung bình</p>
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-l-4 bg-surface-lowest/70 backdrop-blur-sm shadow-sm",
            stats.expiringCount > 0 ? "border-l-danger" : "border-l-muted"
          )}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-danger/10 text-danger">
                <AlertTriangle className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              SP sắp hết hạn
            </p>
            <h3 className="mt-1 text-2xl font-black text-danger">{stats.expiringCount}</h3>
            <p className="mt-2 text-xs text-muted-foreground">Lô cận date (≤ 30 ngày)</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-warning bg-surface-lowest/70 backdrop-blur-sm shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="p-2 rounded-lg bg-warning/10 text-warning">
                <TrendingDown className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              SP tồn thấp
            </p>
            <h3 className="mt-1 text-2xl font-black text-warning">{stats.lowStockCount}</h3>
            <p className="mt-2 text-xs text-muted-foreground">Ngưỡng ≤ 20 đơn vị</p>
          </CardContent>
        </Card>
      </div>

      {/* 60/40 Chart Split */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* 60% - Trend */}
        <Card className="lg:col-span-3 bg-surface-lowest/80 backdrop-blur-sm border border-border/40 shadow-sm">
          <CardContent className="p-6 lg:p-8">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-foreground">Xu hướng tồn kho</h3>
                <p className="text-sm text-muted-foreground">
                  Tổng đơn vị tồn hiện tại
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-primary" />
                <span className="text-xs font-semibold text-muted-foreground">Tổng đơn vị tồn</span>
              </div>
            </div>
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                Chưa theo dõi được xu hướng tồn kho
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Hệ thống chưa lưu tồn kho theo từng thời điểm nên không dựng
                được biểu đồ 6 tháng. Số tồn hiện tại vẫn chính xác — xem các ô
                thống kê phía trên.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 40% - Category donut */}
        <Card className="lg:col-span-2 bg-surface-lowest/80 backdrop-blur-sm border border-border/40 shadow-sm">
          <CardContent className="p-6 lg:p-8">
            <h3 className="text-lg font-bold text-foreground mb-6">Phân bổ theo danh mục</h3>
            {categoryBreakdown.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Chưa có dữ liệu</p>
            ) : (
              <>
                <div className="relative mx-auto mb-6 flex h-40 w-40 items-center justify-center">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="hsl(var(--surface-container-low))"
                      strokeWidth="16"
                    />
                    {(() => {
                      const strokeColors = [
                        "hsl(var(--primary))",
                        "hsl(var(--primary) / 0.65)",
                        "hsl(var(--primary) / 0.45)",
                        "hsl(var(--secondary))",
                        "hsl(var(--muted))",
                      ]
                      const circumference = 2 * Math.PI * 40
                      let offset = 0
                      return categoryBreakdown.map((c, i) => {
                        const dash = (c.pct / 100) * circumference
                        const seg = (
                          <circle
                            key={i}
                            cx="50"
                            cy="50"
                            r="40"
                            fill="transparent"
                            stroke={strokeColors[i % strokeColors.length]}
                            strokeWidth="16"
                            strokeDasharray={`${dash} ${circumference - dash}`}
                            strokeDashoffset={-offset}
                          />
                        )
                        offset += dash
                        return seg
                      })
                    })()}
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Tổng
                    </span>
                    <span className="text-xl font-black text-primary">100%</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {categoryBreakdown.map((c, i) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("h-2 w-2 rounded-full shrink-0", donutColors[i % donutColors.length])} />
                        <span className="text-sm font-semibold text-muted-foreground truncate">
                          {c.name}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-foreground shrink-0 ml-2">
                        {c.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SKU Attention Table */}
      <Card className="bg-surface-lowest/80 backdrop-blur-sm border border-border/40 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="p-6 pb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-foreground">Danh sách SKU cần chú ý</h3>
              <p className="text-sm text-muted-foreground">
                Sản phẩm tồn thấp, bán chậm hoặc sắp hết hạn sử dụng
              </p>
            </div>
          </div>
          {attentionRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Không có SKU cần chú ý
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã SKU</TableHead>
                      <TableHead>Tên sản phẩm</TableHead>
                      <TableHead>Đơn vị</TableHead>
                      <TableHead className="text-right">Tồn thực tế</TableHead>
                      <TableHead>Lô hàng (HSD)</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attentionRows.map((r) => {
                      const status = getExpiryStatus(r.expiry)
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-bold text-primary">{r.sku}</TableCell>
                          <TableCell>
                            <div className="text-sm font-semibold text-foreground">{r.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              Nhóm: {r.category}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{r.unit}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-bold",
                              r.qty <= 20 ? "text-danger" : ""
                            )}
                          >
                            {r.qty}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-mono">{r.batchCode}</div>
                            <div
                              className={cn(
                                "text-[10px] font-bold",
                                status !== "ok" ? "text-danger" : "text-muted-foreground"
                              )}
                            >
                              HSD: {formatDate(r.expiry)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.tag === "Cận date"
                                  ? "danger"
                                  : r.qty <= 20
                                    ? "warning"
                                    : "default"
                              }
                            >
                              {r.tag === "Cận date"
                                ? "Cận date"
                                : r.qty <= 20
                                  ? "Tồn thấp"
                                  : "Bán chậm"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="lg:hidden space-y-3">
                {attentionRows.map((r) => {
                  const status = getExpiryStatus(r.expiry)
                  const variant = r.tag === "Cận date" ? "danger" : r.qty <= 20 ? "warning" : "default"
                  const label = r.tag === "Cận date" ? "Cận date" : r.qty <= 20 ? "Tồn thấp" : "Bán chậm"
                  return (
                    <div key={r.id} className="rounded-2xl border bg-card p-4 shadow-card">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-bold text-primary">{r.sku}</p>
                          <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                            {r.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Nhóm: {r.category} • ĐVT: {r.unit}
                          </p>
                        </div>
                        <Badge variant={variant} className="shrink-0">{label}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t text-xs">
                        <div>
                          <p className="text-muted-foreground">Tồn thực tế</p>
                          <p className={cn("font-bold", r.qty <= 20 ? "text-danger" : "")}>{r.qty}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Lô (HSD)</p>
                          <p className="font-mono text-xs">{r.batchCode}</p>
                          <p className={cn("text-[10px] font-bold", status !== "ok" ? "text-danger" : "text-muted-foreground")}>
                            HSD: {formatDate(r.expiry)}
                          </p>
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
  )
}
