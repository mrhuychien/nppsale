"use client"

/**
 * T-09: per-product movement history. Drill-down from StockBalanceTable.
 *
 * Reads `v_stock_movements` filtered by product_id, sorted desc by
 * posted/created. Displays date, type, zone, signed qty (+/-), running
 * balance per zone, and links to the source entry.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
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

  useEffect(() => {
    if (!open || !productId) return
    let cancelled = false
    setLoading(true)
    const supabase = createClient()
    supabase
      .from("v_stock_movements")
      .select(
        "id, product_id, warehouse_zone, posted_at, created_at, entry_type, entry_status, entry_code, entry_id, transaction_uom, qty_in_transaction_uom, qty_in_base_uom, conversion_factor, unit_cost, signed_qty_in_base_uom"
      )
      .eq("product_id", productId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return
        setRows((data as MovementRow[]) || [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, productId])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (zoneFilter !== "all" && r.warehouse_zone !== zoneFilter) return false
      const t = new Date(r.posted_at || r.created_at).getTime()
      if (dateFrom && t < new Date(dateFrom).getTime()) return false
      if (dateTo && t > new Date(dateTo + "T23:59:59").getTime()) return false
      return true
    })
  }, [rows, zoneFilter, dateFrom, dateTo])

  // Running balance per zone (newest → oldest, but balance is from
  // earliest → display reversed). We compute totalsAfter going forward
  // chronologically then map back.
  const balanceById = useMemo(() => {
    const map = new Map<string, { sale: number; date: number }>()
    const ordered = [...filtered].sort((a, b) => {
      const ta = new Date(a.posted_at || a.created_at).getTime()
      const tb = new Date(b.posted_at || b.created_at).getTime()
      return ta - tb
    })
    let saleBal = 0
    let dateBal = 0
    for (const r of ordered) {
      if (r.warehouse_zone === "date") dateBal += r.signed_qty_in_base_uom
      else saleBal += r.signed_qty_in_base_uom
      map.set(r.id, { sale: saleBal, date: dateBal })
    }
    return map
  }, [filtered])

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
            500 giao dịch gần nhất. Số dương = nhập, số âm = xuất. Tồn sau cộng
            riêng theo từng kho.
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
                  const balance = balanceById.get(r.id)
                  const balValue =
                    r.warehouse_zone === "date" ? balance?.date : balance?.sale
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
                            : "text-emerald-600"
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
