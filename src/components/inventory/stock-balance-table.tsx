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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { Download, Search } from "lucide-react"
import { StockHistoryDrawer } from "@/components/inventory/stock-history-drawer"
import { buildStockExportAoa, stockExportFileName } from "@/lib/inventory/stock-export"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

interface BalanceRow {
  product_id: string
  warehouse_zone: "sale" | "date"
  qty_in_base_uom: number
  value: number
}

interface ProductUnitMeta {
  unit_name: string
  conversion: number
}

interface ProductMeta {
  id: string
  sku: string
  name: string
  base_unit: string
  units?: ProductUnitMeta[]
}

/** Build a tooltip showing the qty in every defined unit, e.g.:
 *    400 hộp = 40 thùng = 80 lốc
 *  Falls back to "X <base_unit>" when no other units are registered. */
function buildQtyTooltip(qtyBase: number, product: ProductMeta): string {
  if (qtyBase <= 0) return `0 ${product.base_unit}`
  const baseStr = `${qtyBase.toLocaleString("vi-VN")} ${product.base_unit}`
  const units = (product.units || [])
    .filter((u) => u.unit_name !== product.base_unit && u.conversion > 0)
    .sort((a, b) => b.conversion - a.conversion)
  const extras = units
    .map((u) => {
      const qty = qtyBase / u.conversion
      // Use up to 2 decimals for non-integer conversions, drop trailing zeros.
      const display = Number.isInteger(qty)
        ? qty.toLocaleString("vi-VN")
        : Number(qty.toFixed(2)).toLocaleString("vi-VN")
      return `${display} ${u.unit_name}`
    })
    .filter((s) => !s.startsWith("0 "))
  return [baseStr, ...extras].join(" = ")
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
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Lỗi/thiếu dữ liệu của chính bảng này — phải hiện ra, vì một bảng
  // thiếu dòng trông y hệt một bảng đủ dòng.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    const supabase = createClient()
    setLoading(true)
    // ⚠ PHẢI PHÂN TRANG CẢ HAI. Supabase chặn 1.000 dòng mỗi request và
    // trả 200 KHÔNG kèm lỗi.
    //
    // Với 1.740 sản phẩm thì truy vấn `products` chỉ về 1.000 dòng, và ở
    // phần gộp dưới đây mỗi dòng tồn không tra ra sản phẩm bị BỎ QUA
    // LẶNG LẼ (`if (!product) continue`). Hậu quả đã gặp: nhập 40 sản
    // phẩm, phiếu nhập kho có, lô hàng có, mà bảng tồn kho không hiện
    // dòng nào của chúng — vì chính 40 mã mới nhất nằm ngoài 1.000 dòng
    // đầu.
    //
    // Cùng cái bẫy với thẻ KPI đầu trang Kho và với phép đối chiếu mã
    // trùng lúc nhập sản phẩm. Ở đâu cộng hay gộp trên TOÀN BỘ bảng thì ở
    // đó phải đọc đủ.
    Promise.all([
      fetchAllForAggregate<BalanceRow>((from, to) =>
        supabase
          .from("v_stock_balance_by_zone")
          .select("product_id, warehouse_zone, qty_in_base_uom, value", { count: "exact" })
          .range(from, to)
      ),
      fetchAllForAggregate<ProductMeta>((from, to) =>
        supabase
          .from("products")
          .select("id, sku, name, base_unit, units:product_units(unit_name, conversion)", {
            count: "exact",
          })
          .eq("status", "active")
          .range(from, to)
      ),
    ]).then(([balRes, prodRes]) => {
      if (cancelled) return
      // View v_stock_balance_by_zone chạy security_invoker (mig 092) nên
      // chịu RLS. View luôn trả 200 kể cả khi bị chặn → không có lỗi để
      // hiện; giữ lỗi lại để MÀN HÌNH nói ra, đừng chỉ ghi console.
      const vErr = balRes.error || prodRes.error
      if (vErr) console.error("[stock-balance-table] truy vấn lỗi:", vErr)
      setLoadError(
        vErr
          ? `Không đọc được số liệu tồn kho: ${vErr}`
          : balRes.truncated || prodRes.truncated
            ? "Danh mục quá lớn để đọc hết trong một lần — bảng dưới đây còn THIẾU dòng."
            : null
      )
      setRows(balRes.rows)
      const map = new Map<string, ProductMeta>()
      prodRes.rows.forEach((p) => map.set(p.id, p))
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
      const q = viNormalize(search)
      arr = arr.filter(
        (r) =>
          viIncludes(r.product.name, q) ||
          viIncludes(r.product.sku, q)
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

  /**
   * Xuất đúng những dòng ĐANG HIỆN ra Excel.
   *
   * `xlsx` nạp động: nó nặng vài trăm KB và phần lớn người mở trang Kho
   * không bấm nút này lần nào — nhét vào gói chính là bắt mọi người tải
   * cho một người dùng.
   */
  const handleExport = async () => {
    if (pivot.length === 0) return
    setExporting(true)
    try {
      const XLSX = await import("xlsx")
      const aoa = buildStockExportAoa(
        pivot.map((r) => ({
          sku: r.product.sku,
          name: r.product.name,
          baseUnit: r.product.base_unit,
          saleQty: r.saleQty,
          saleValue: r.saleValue,
          dateQty: r.dateQty,
          dateValue: r.dateValue,
          totalQty: r.totalQty,
          totalValue: r.totalValue,
        }))
      )
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws["!cols"] = [
        { wch: 12 }, { wch: 46 }, { wch: 8 },
        { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
        { wch: 12 }, { wch: 18 },
      ]
      // Khoá hàng tiêu đề: bảng vài trăm dòng mà cuộn xuống là quên mất
      // cột nào là kho bán, cột nào là kho date.
      ws["!freeze"] = { xSplit: "0", ySplit: "1" }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Ton kho")
      XLSX.writeFile(wb, stockExportFileName(new Date()))
    } catch (e) {
      // Không nuốt: nút bấm xong không thấy gì thì người dùng bấm tiếp
      // mấy lần rồi tưởng máy treo.
      console.error("[stock-balance-table] xuất Excel lỗi:", e)
      setExportError((e as Error)?.message || "Không xuất được file")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          ⚠ {loadError}
        </div>
      )}
      {exportError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Không xuất được file Excel: {exportError}
        </div>
      )}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={loading || exporting || pivot.length === 0}
          // Xuất đúng những dòng ĐANG HIỆN, không phải toàn bộ kho: người
          // ta lọc rồi mới bấm xuất thì mong nhận đúng phần đã lọc.
          title={
            pivot.length === 0
              ? "Không có dòng nào để xuất"
              : `Xuất ${pivot.length} dòng đang hiện ra Excel`
          }
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exporting ? "Đang xuất…" : "Xuất Excel"}
        </Button>
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
                    <TableCell
                      className="text-right tabular-nums"
                      title={buildQtyTooltip(r.saleQty, r.product)}
                    >
                      {r.saleQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.saleValue)}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={buildQtyTooltip(r.dateQty, r.product)}
                    >
                      {r.dateQty.toLocaleString("vi-VN")}{" "}
                      <span className="text-[11px] text-muted-foreground">
                        {r.product.base_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.dateValue)}
                    </TableCell>
                    <TableCell
                      className="text-right font-semibold tabular-nums"
                      title={buildQtyTooltip(r.totalQty, r.product)}
                    >
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
