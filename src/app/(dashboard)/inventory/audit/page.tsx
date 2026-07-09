"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import {
  Search, Package, ChevronRight, Warehouse, AlertCircle,
} from "lucide-react"
import type { Product, Batch } from "@/types"

type ProductWithStock = Product & {
  _stock?: {
    on_hand: number
    value: number
    batch_count: number
  }
}

export default function InventoryAuditPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()

  const [products, setProducts] = useState<ProductWithStock[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const [prodRes, batchRes] = await Promise.all([
      supabase.from("products").select("id, org_id, sku, name, category, brand, barcode, base_unit, vat_rate, shelf_life_days, status, created_at, description, warranty_info, cost_price, sell_price, track_serial, min_stock, max_stock, shelf_location, weight, weight_unit, direct_sale, images, allow_price_edit, price_edit_max_type, price_edit_max, primary_supplier_id").order("name"),
      supabase
        .from("batches")
        .select("product_id, qty_on_hand, unit_cost")
        .gt("qty_on_hand", 0),
    ])
    const prodList = (prodRes.data as Product[]) || []
    const batchList = (batchRes.data as Array<Pick<Batch, "product_id" | "qty_on_hand" | "unit_cost">>) || []

    const stockByProduct: Record<string, { on_hand: number; value: number; batch_count: number }> = {}
    for (const b of batchList) {
      const entry = stockByProduct[b.product_id] || { on_hand: 0, value: 0, batch_count: 0 }
      entry.on_hand += Number(b.qty_on_hand) || 0
      entry.value += (Number(b.qty_on_hand) || 0) * (Number(b.unit_cost) || 0)
      entry.batch_count += 1
      stockByProduct[b.product_id] = entry
    }

    setProducts(
      prodList.map((p) => ({
        ...p,
        _stock: stockByProduct[p.id] || { on_hand: 0, value: 0, batch_count: 0 },
      }))
    )
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.trim().toLowerCase()
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q)
    )
  }, [products, search])

  const stats = useMemo(() => {
    const totalValue = products.reduce((s, p) => s + (p._stock?.value || 0), 0)
    const inStock = products.filter((p) => (p._stock?.on_hand || 0) > 0).length
    const outOfStock = products.filter((p) => (p._stock?.on_hand || 0) === 0).length
    return { totalValue, inStock, outOfStock }
  }, [products])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tra soát kho"
        description="Tra cứu chi tiết nhập / xuất / điều chỉnh của từng mã hàng"
        backHref="/inventory"
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng giá trị tồn</p>
            <p className="text-lg font-black mt-1">{formatCurrency(stats.totalValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-tertiary">Đang tồn</p>
            <p className="text-lg font-black mt-1 text-tertiary">{stats.inStock} SKU</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-error">Hết hàng</p>
            <p className="text-lg font-black mt-1 text-error">{stats.outOfStock} SKU</p>
          </CardContent>
        </Card>
      </div>

      {/* Hint */}
      <div className="rounded-xl border border-dashed p-3 flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        Chọn một sản phẩm để xem thẻ kho đầy đủ: mỗi lần nhập/xuất/điều chỉnh
        — ai tạo, ngày nào, phiếu nào, số lượng và giá vốn.
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Tìm theo SKU, tên sản phẩm, nhãn hàng..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
          autoFocus
        />
      </div>

      {/* Results */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8 text-muted-foreground" />}
          title={search ? "Không tìm thấy" : "Chưa có sản phẩm"}
          description={search ? "Thử gõ khác" : "Thêm sản phẩm để bắt đầu"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const stock = p._stock || { on_hand: 0, value: 0, batch_count: 0 }
            const outOfStock = stock.on_hand === 0
            return (
              <Link
                key={p.id}
                href={`/inventory/stock-card/${p.id}`}
                className="block rounded-xl border bg-card p-4 hover:border-primary transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-primary">{p.sku}</span>
                      <span className="font-semibold text-sm truncate">{p.name}</span>
                      {p.brand && (
                        <Badge variant="outline" className="text-[10px]">{p.brand}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.category || "—"} • ĐVT: {p.base_unit}
                      {stock.batch_count > 0 && ` • ${stock.batch_count} lô`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-bold text-sm ${outOfStock ? "text-error" : ""}`}>
                      {stock.on_hand} {p.base_unit}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {stock.value > 0 ? formatCurrency(stock.value) : outOfStock ? "Hết hàng" : "-"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <div className="flex justify-center pt-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory">
            <Warehouse className="h-3.5 w-3.5 mr-1.5" /> Về trang kho
          </Link>
        </Button>
      </div>
    </div>
  )
}
