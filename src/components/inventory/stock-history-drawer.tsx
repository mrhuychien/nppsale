"use client"

/**
 * T-09: per-product movement history. Drill-down from StockBalanceTable.
 *
 * Reads `v_stock_movements` filtered by product_id, sorted desc by
 * posted/created. Displays date, type, zone, signed qty (+/-), running
 * balance per zone, and links to the source entry.
 *
 * ⚠ ĐỌC ĐỦ, LỌC TRÊN MÁY CHỦ, TỒN SAU CÓ TỒN ĐẦU KỲ (rà soát 03/10/2026) — xem
 *   `lib/inventory/lich-su-ton`. Chỉ phiếu ĐÃ GHI SỔ: phiếu nháp chưa động vào tồn, cộng nó vào
 *   "Tồn sau" là ra một số tồn không có thật.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/utils"
import { ExternalLink } from "lucide-react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { dieuKienDenNgay, tonSauTheoKho } from "@/lib/inventory/lich-su-ton"

interface ProductMeta {
  id: string
  sku: string
  name: string
  base_unit: string
}

interface MovementRow {
  id: string
  product_id: string
  warehouse_zone: "sale" | "date"
  posted_at: string | null
  created_at: string
  entry_type: "import" | "export" | "transfer" | "stocktake"
  entry_status: string
  entry_code: string
  entry_id: string
  transaction_uom: string | null
  qty_in_transaction_uom: number | null
  qty_in_base_uom: number
  conversion_factor: number | null
  unit_cost: number | null
  signed_qty_in_base_uom: number
}

const TYPE_LABEL: Record<MovementRow["entry_type"], string> = {
  import: "Nhập",
  export: "Xuất",
  transfer: "Chuyển kho",
  stocktake: "Kiểm kê",
}

const ZONE_LABEL: Record<MovementRow["warehouse_zone"], string> = {
  sale: "Kho bán",
  date: "Kho date",
}

interface StockHistoryDrawerProps {
  productId: string | null
  product: ProductMeta | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StockHistoryDrawer({
  productId,
  product,
  open,
  onOpenChange,
}: StockHistoryDrawerProps) {
  const [rows, setRows] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [zoneFilter, setZoneFilter] = useState<"all" | "sale" | "date">("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  /** Đọc hỏng / chạm trần — lịch sử và "Tồn sau" đang THIẾU, phải nói ra. */
  const [thieu, setThieu] = useState<string | null>(null)

  /* Kho và "Đến ngày" lọc TRÊN MÁY CHỦ, đọc ĐỦ theo trang (mốc `id` duy nhất — các trang chạy song
     song). "Từ ngày" KHÔNG lọc trên máy chủ: các dòng trước đó phải về để cộng tồn đầu kỳ. */
  useEffect(() => {
    if (!open || !productId) return
    let cancelled = false
    setLoading(true)
    const supabase = createClient()
    fetchAllForAggregate<MovementRow>((from, to) => {
      let q = supabase
        .from("v_stock_movements")
        .select(
          "id, product_id, warehouse_zone, posted_at, created_at, entry_type, entry_status, entry_code, entry_id, transaction_uom, qty_in_transaction_uom, qty_in_base_uom, conversion_factor, unit_cost, signed_qty_in_base_uom",
          { count: "exact" }
        )
        .eq("product_id", productId)
        .eq("entry_status", "posted")
      if (zoneFilter !== "all") q = q.eq("warehouse_zone", zoneFilter)
      if (dateTo) q = q.or(dieuKienDenNgay(dateTo))
      return q.order("id").range(from, to)
    }).then((res) => {
      if (cancelled) return
      if (res.error) console.error("[stock-history-drawer] truy vấn lỗi:", res.error)
      setThieu(
        res.error
          ? `Không đọc được lịch sử tồn: ${res.error}`
          : res.truncated
            ? truncationWarning()
            : null
      )
      setRows(res.rows)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, productId, zoneFilter, dateTo])

  /* Tồn sau cộng từ giao dịch ĐẦU TIÊN; dòng trước "Từ ngày" chỉ vào tồn đầu kỳ. */
  const { dong: filtered } = useMemo(() => tonSauTheoKho(rows, dateFrom), [rows, dateFrom])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-3xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {product ? (
              <>
                <span className="font-mono text-sm text-muted-foreground mr-2">
                  {product.sku}
                </span>
                {product.name}
              </>
            ) : (
              "Lịch sử tồn kho"
            )}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Giao dịch đã ghi sổ. Số dương = nhập, số âm = xuất. Tồn sau cộng
            riêng theo từng kho, tính cả tồn trước ngày đầu kỳ.
          </p>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 mt-4">
          <Select value={zoneFilter} onValueChange={(v) => setZoneFilter(v as typeof zoneFilter)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Cả 2 kho</SelectItem>
              <SelectItem value="sale">Kho bán</SelectItem>
              <SelectItem value="date">Kho date</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 w-40"
            placeholder="Từ"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 w-40"
            placeholder="Đến"
          />
        </div>

        {thieu && (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning-container px-3 py-2 text-xs font-semibold text-on-warning-container break-words">
            {thieu}
          </p>
        )}

        {loading ? (
          <Skeleton className="h-48 mt-4" />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-6 text-center">
            Không có giao dịch nào trong khoảng đã chọn.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Ngày</th>
                  <th className="px-2 py-2 text-left">Loại</th>
                  <th className="px-2 py-2 text-left">Kho</th>
                  <th className="px-2 py-2 text-right">SL</th>
                  <th className="px-2 py-2 text-right">Tồn sau</th>
                  <th className="px-2 py-2 text-left">Chứng từ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const ts = r.posted_at || r.created_at
                  const balValue: number | undefined = r.tonSau
                  const txQty = r.qty_in_transaction_uom ?? r.qty_in_base_uom
                  const txUom = r.transaction_uom || ""
                  const sign = r.signed_qty_in_base_uom < 0 ? "-" : "+"
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-2 whitespace-nowrap">
                        {formatDate(ts)}
                      </td>
                      <td className="px-2 py-2">{TYPE_LABEL[r.entry_type]}</td>
                      <td className="px-2 py-2">{ZONE_LABEL[r.warehouse_zone]}</td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${
                          r.signed_qty_in_base_uom < 0
                            ? "text-destructive"
                            : "text-tertiary"
                        }`}
                      >
                        {sign}
                        {Math.abs(Number(txQty)).toLocaleString("vi-VN")} {txUom}
                        <span className="text-[10px] text-muted-foreground ml-1">
                          (= {sign}
                          {Math.abs(Number(r.qty_in_base_uom)).toLocaleString("vi-VN")})
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {balValue !== undefined
                          ? balValue.toLocaleString("vi-VN")
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/inventory/entries/${r.entry_id}`}
                          className="text-primary hover:underline inline-flex items-center gap-1 font-mono text-xs"
                        >
                          {r.entry_code}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
