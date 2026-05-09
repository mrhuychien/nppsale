"use client"

/**
 * T-09: "Tồn kho hiện tại" balance table.
 *
 * Reads `v_stock_balance_by_zone` and pivots to a wide table:
 *   Mã SP | Tên SP | Kho bán SL+Giá trị | Kho date SL+Giá trị | Tổng
 *
 * Click a row → opens StockHistoryDrawer for that product. Search +
 * "chỉ hiện hàng còn tồn" filter at the top.
 */

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { Search } from "lucide-react"
import { StockHistoryDrawer } from "@/components/inventory/stock-history-drawer"

interface BalanceRow {
  product_id: string
  warehouse_zone: "sale" | "date"
  qty_in_base_uom: number
  value: number
}

interface ProductMeta {
  id: string
  sku: string
  name: string
  base_unit: string
}

interface PivotRow {
  product: ProductMeta
  saleQty: number
  saleValue: number
  dateQty: number
  dateValue: number
  totalQty: number
  totalValue: number
}

export function StockBalanceTable() {
  const { user } = useAuth()
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [products, setProducts] = useState<Map<string, ProductMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [onlyOnHand, setOnlyOnHand] = useState(true)
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    const supabase = createClient()
    setLoading(true)
    Promise.all([
      supabase
        .from("v_stock_balance_by_zone")
        .select("product_id, warehouse_zone, qty_in_base_uom, value"),
      supabase
        .from("products")
        .select("id, sku, name, base_unit")
        .eq("status", "active"),
    ]).then(([balRes, prodRes]) => {
      if (cancelled) return
      setRows((balRes.data as BalanceRow[]) || [])
      const map = new Map<string, ProductMeta>()
      ;(((prodRes.data as ProductMeta[]) || [])).forEach((p) => map.set(p.id, p))
      setProducts(map)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user?.org_id])

  const pivot = useMemo<PivotRow[]>(() => {
    const map = new Map<string, PivotRow>()
    for (const r of rows) {
      const product = products.get(r.product_id)
      if (!product) continue
      const existing =
        map.get(r.product_id) ?? {
          product,
          saleQty: 0,
          saleValue: 0,
          dateQty: 0,
          dateValue: 0,
          totalQty: 0,
          totalValue: 0,
        }
      const qty = Number(r.qty_in_base_uom || 0)
      const val = Number(r.value || 0)
      if (r.warehouse_zone === "date") {
        existing.dateQty += qty
        existing.dateValue += val
      } else {
        existing.saleQty += qty
        existing.saleValue += val
      }
      existing.totalQty += qty
      existing.totalValue += val
      map.set(r.product_id, existing)
    }
    // Include products with zero balance so the search can find them.
    products.forEach((p) => {
      if (!map.has(p.id) && !onlyOnHand) {
        map.set(p.id, {
          product: p,
          saleQty: 0,
          saleValue: 0,
          dateQty: 0,
          dateValue: 0,
          totalQty: 0,
          totalValue: 0,
        })
      }
    })
    let arr = Array.from(map.values())
    if (onlyOnHand) arr = arr.filter((r) => r.totalQty > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      arr = arr.filter(
        (r) =>
          r.product.name.toLowerCase().includes(q) ||
          r.product.sku.toLowerCase().includes(q)
      )
    }
    return arr.sort((a, b) => a.product.name.localeCompare(b.product.name, "vi"))
  }, [rows, products, search, onlyOnHand])

  const totals = useMemo(() => {
    return pivot.reduce(
      (acc, r) => {
        acc.saleQty += r.saleQty
        acc.saleValue += r.saleValue
        acc.dateQty += r.dateQty
        acc.dateValue += r.dateValue
        acc.totalQty += r.totalQty
        acc.totalValue += r.totalValue
        return acc
      },
      {
        saleQty: 0,
        saleValue: 0,
        dateQty: 0,
        dateValue: 0,
        totalQty: 0,
        totalValue: 0,
      }
    )
  }, [pivot])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên / SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={onlyOnHand}
            onCheckedChange={(v) => setOnlyOnHand(!!v)}
          />
          Chỉ hiện hàng còn tồn
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {pivot.length} sản phẩm — tổng giá trị{" "}
          <strong className="text-foreground">{formatCurrency(totals.totalValue)}</strong>
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Mã SP</TableHead>
                <TableHead>Tên SP</TableHead>
                <TableHead className="text-right">Kho bán SL</TableHead>
                <TableHead className="text-right">Kho bán Giá trị</TableHead>
                <TableHead className="text-right">Kho date SL</TableHead>
                <TableHead className="text-right">Kho date Giá trị</TableHead>
                <TableHead className="text-right font-semibold">Tổng SL</TableHead>
                <TableHead className="text-right font-semibold">Tổng Giá trị</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                    Không có dữ liệu phù hợp
                  </TableCell>
                </TableRow>
              ) : (
                pivot.map((r) => (
                  <TableRow
                    key={r.product.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDrawerProductId(r.product.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.product.sku}</TableCell>
                    <TableCell className="font-medium">{r.product.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.saleQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.saleValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.dateQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.dateValue)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.totalQty.toLocaleString("vi-VN")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(r.totalValue)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {pivot.length > 0 && (
              <tfoot className="bg-muted/30 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground" colSpan={2}>
                    Tổng cộng
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.saleQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.saleValue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.dateQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.dateValue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals.totalQty.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(totals.totalValue)}
                  </td>
                </tr>
              </tfoot>
            )}
          </Table>
        </div>
      )}

      <StockHistoryDrawer
        productId={drawerProductId}
        product={
          drawerProductId
            ? pivot.find((r) => r.product.id === drawerProductId)?.product ?? null
            : null
        }
        open={!!drawerProductId}
        onOpenChange={(o) => !o && setDrawerProductId(null)}
      />
    </div>
  )
}
