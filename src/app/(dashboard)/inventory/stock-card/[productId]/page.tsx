"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  ArrowDownToLine, ArrowUpFromLine, ClipboardList, Package,
  TrendingUp, TrendingDown, AlertCircle,
} from "lucide-react"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import type { Product, Batch } from "@/types"

/** Một dòng hóa đơn của chính mặt hàng đang xem. */
type InvLineRow = {
  id: string
  invoice?: {
    invoice_code: string
    invoice_date: string | null
    status: string
    stock_entry_id: string | null
    customer?: { store_name?: string | null; billing_name?: string | null } | null
  } | null
}

type MovementRow = {
  id: string
  date: string
  entry_id: string
  entry_code: string
  entry_type: "import" | "export" | "transfer" | "stocktake"
  batch_id: string | null
  batch_code: string | null
  unit_name: string
  /** SL theo ĐƠN VỊ CƠ SỞ — tồn chạy, tổng nhập/xuất và giá trị đều đọc số này. */
  quantity: number
  /** SL như ghi trên phiếu (đơn vị giao dịch), chỉ để hiện kèm. */
  qtyGd: number
  unit_cost: number
  notes: string | null
  source: string
  creator_name: string | null
  /**
   * Phiếu xuất này đi theo HÓA ĐƠN nào, ngày nào, cho ai (chủ nhà chốt
   * 20/09/2026).
   *
   * ⚠ `null` NGHĨA LÀ KHÔNG PHẢI PHIẾU BÁN HÀNG — phiếu xuất huỷ, xuất
   * chuyển kho, xuất trả nhà cung cấp đều không có hóa đơn. Điền một
   * dấu gạch vào đó là đúng; bịa ra một cái tên là sai.
   */
  invoice_code: string | null
  invoice_date: string | null
  customer_name: string | null
  /**
   * Phiếu NHẬP này nhận hàng của NCC nào (chủ nhà chốt 20/09/2026:
   * "Thêm cột VD xuất cho Khách hàng nào. Nhập của NCC nào").
   *
   * ⚠ `null` NGHĨA LÀ PHIẾU KHÔNG GẮN NCC — nhập kho thường, kiểm kê
   * thừa, chuyển kho. Điền một dấu gạch vào đó là đúng; bịa ra một cái
   * tên là sai.
   */
  supplier_name: string | null
}

const TYPE_META: Record<string, { icon: typeof Package; label: string; color: string; sign: "in" | "out" | "adjust" }> = {
  import: { icon: ArrowDownToLine, label: "Nhập", color: "text-tertiary bg-[#ecfdf3]", sign: "in" },
  export: { icon: ArrowUpFromLine, label: "Xuất", color: "text-error bg-error-container", sign: "out" },
  transfer: { icon: Package, label: "Chuyển", color: "text-[#175cd3] bg-[#eff8ff]", sign: "adjust" },
  stocktake: { icon: ClipboardList, label: "Kiểm kê", color: "text-primary bg-primary/10", sign: "adjust" },
}

export default function StockCardPage() {
  const { productId } = useParams<{ productId: string }>()
  const { loading: authLoading } = useRoleGuard("inventory")
  const supabase = createClient()
  const router = useRouter()

  const [product, setProduct] = useState<Product | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [productRes, batchesRes, linesRes, invRes] = await Promise.all([
      supabase.from("products").select("id, sku, name, base_unit").eq("id", productId).maybeSingle(),
      supabase.from("batches").select("id, batch_code, qty_on_hand, unit_cost, expires_at").eq("product_id", productId).order("expires_at"),
      supabase
        .from("stock_entry_lines")
        .select(
          "id, batch_id, unit_name, quantity, qty_in_base_uom, conversion_factor_snapshot, unit_cost, notes, batch:batches(batch_code), entry:stock_entries!inner(id, entry_code, type, status, posted_at, created_at, supplier:suppliers(name), creator:users!stock_entries_created_by_fkey(full_name))"
        )
        .eq("product_id", productId),
      /**
       * Hóa đơn bán có dòng của CHÍNH sản phẩm này.
       *
       * ⚠ HỎI TỪ PHÍA DÒNG HÓA ĐƠN, KHÔNG HỎI TỪ PHÍA PHIẾU KHO. Hỏi
       *   `sales_invoices` theo danh sách `stock_entry_id` là dựng một
       *   câu `in(...)` dài bằng số lần xuất của mặt hàng — mặt hàng
       *   chạy có hàng nghìn lần, và URL vỡ trước khi truy vấn chạy.
       *
       * ⚠ QUA `fetchAllForAggregate` VÀ CÓ `.order("id")`: đây là bảng
       *   có thể vượt 1.000 dòng, và chia trang không mốc thì các trang
       *   lặp/sót — xem `lib/supabase/aggregate`.
       */
      fetchAllForAggregate<InvLineRow>((from, to) =>
        supabase
          .from("sales_invoice_lines")
          .select(
            "id, invoice:sales_invoices!inner(invoice_code, invoice_date, status, stock_entry_id, customer:customers(store_name, billing_name))",
            { count: "exact" }
          )
          .eq("product_id", productId)
          .order("id")
          .range(from, to)
      ),
    ])
    const qErr = ([productRes, batchesRes, linesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[stock-card/productId] truy vấn lỗi:", qErr.message)

    setProduct((productRes.data as Product) || null)
    setBatches((batchesRes.data as Batch[]) || [])

    type LineRow = {
      id: string
      batch_id: string | null
      unit_name: string
      quantity: number
      qty_in_base_uom?: number | null
      conversion_factor_snapshot?: number | null
      unit_cost: number
      notes: string | null
      batch?: { batch_code?: string } | null
      entry?: {
        id: string
        entry_code: string
        type: "import" | "export" | "transfer" | "stocktake"
        status: string
        posted_at: string | null
        created_at: string
        supplier?: { name?: string } | null
        creator?: { full_name?: string } | null
      } | null
    }

    /**
     * phiếu kho → hóa đơn. `stock_entry_id` là sợi dây duy nhất nối hai
     * bên (mig 124), nên hóa đơn nào chưa có phiếu kho thì bỏ qua.
     */
    const invByEntry: Record<string, { code: string; date: string | null; customer: string | null }> = {}
    if (invRes.error) {
      console.error("[stock-card/productId] không đọc được hóa đơn:", invRes.error)
    } else {
      for (const r of invRes.rows) {
        const inv = r.invoice
        if (!inv?.stock_entry_id || inv.status !== "posted") continue
        invByEntry[inv.stock_entry_id] = {
          code: inv.invoice_code,
          date: inv.invoice_date ?? null,
          customer: inv.customer?.billing_name || inv.customer?.store_name || null,
        }
      }
    }

    const rawLines = ((linesRes.data as unknown) as LineRow[] | null) || []
    // Only posted entries count for the stock card
    const rows: MovementRow[] = rawLines
      .filter((l) => l.entry && l.entry.status === "posted")
      .map((l) => ({
        id: l.id,
        date: l.entry!.posted_at || l.entry!.created_at,
        entry_id: l.entry!.id,
        entry_code: l.entry!.entry_code,
        entry_type: l.entry!.type,
        batch_id: l.batch_id,
        batch_code: l.batch?.batch_code || null,
        unit_name: l.unit_name,
        /* ⚠ PHIẾU XUẤT GHI `quantity` THEO ĐƠN VỊ GIAO DỊCH (thùng), còn tồn lô và
           `unit_cost` theo ĐƠN VỊ CƠ SỞ — cộng thẳng là tồn chạy lệch, giá trị
           chia cho hệ số (chủ nhà 24/09/2026: rà lỗi quy đổi). */
        quantity:
          l.qty_in_base_uom != null
            ? Number(l.qty_in_base_uom) || 0
            : (Number(l.quantity) || 0) * (Number(l.conversion_factor_snapshot) || 1),
        qtyGd: Number(l.quantity) || 0,
        unit_cost: Number(l.unit_cost) || 0,
        notes: l.notes,
        source: l.entry!.entry_code,
        creator_name: l.entry!.creator?.full_name || null,
        invoice_code: invByEntry[l.entry!.id]?.code ?? null,
        invoice_date: invByEntry[l.entry!.id]?.date ?? null,
        customer_name: invByEntry[l.entry!.id]?.customer ?? null,
        supplier_name: l.entry!.supplier?.name ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    setMovements(rows)
    setLoading(false)
  }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (dateFrom && m.date.slice(0, 10) < dateFrom) return false
      if (dateTo && m.date.slice(0, 10) > dateTo) return false
      return true
    })
  }, [movements, dateFrom, dateTo])

  // Compute running balance
  const withRunning = useMemo(() => {
    let running = 0
    // Seed with "initial" = qty before the first movement = qty_on_hand for batches we haven't moved yet
    return filtered.map((m) => {
      const meta = TYPE_META[m.entry_type] || TYPE_META.import
      const delta = meta.sign === "in" ? m.quantity : meta.sign === "out" ? -m.quantity : m.quantity
      running += delta
      return { ...m, delta, running }
    })
  }, [filtered])

  const totals = useMemo(() => {
    let inQty = 0
    let outQty = 0
    let inValue = 0
    let outValue = 0
    for (const m of filtered) {
      const meta = TYPE_META[m.entry_type] || TYPE_META.import
      if (meta.sign === "in") {
        inQty += m.quantity
        inValue += m.quantity * m.unit_cost
      } else if (meta.sign === "out") {
        outQty += m.quantity
        outValue += m.quantity * m.unit_cost
      }
    }
    return { inQty, outQty, inValue, outValue }
  }, [filtered])

  const currentOnHand = batches.reduce((s, b) => s + (Number(b.qty_on_hand) || 0), 0)
  const inventoryValue = batches.reduce(
    (s, b) => s + (Number(b.qty_on_hand) || 0) * (Number(b.unit_cost) || 0),
    0
  )

  if (authLoading) return <Skeleton className="h-96" />

  if (!product && !loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Thẻ kho" backHref="/inventory" />
        <EmptyState
          icon={<AlertCircle className="h-8 w-8 text-muted-foreground" />}
          title="Không tìm thấy sản phẩm"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={product ? `Thẻ kho: ${product.name}` : "Thẻ kho"}
        description={product ? `SKU: ${product.sku} • ĐVT: ${product.base_unit}` : undefined}
        backHref="/inventory"
      >
        {product && (
          <Button variant="outline" asChild>
            <Link href={`/products/${product.id}`}>Chi tiết SP</Link>
          </Button>
        )}
      </PageHeader>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tồn hiện tại</p>
            <p className="text-xl font-black mt-1">
              {currentOnHand} <span className="text-sm font-medium text-muted-foreground">{product?.base_unit}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Giá trị tồn</p>
            <p className="text-xl font-black mt-1">{formatCurrency(inventoryValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-tertiary">
              <TrendingUp className="h-3 w-3" /> Nhập (kỳ)
            </div>
            <p className="text-xl font-black mt-1 text-tertiary">+{totals.inQty}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(totals.inValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-error">
              <TrendingDown className="h-3 w-3" /> Xuất (kỳ)
            </div>
            <p className="text-xl font-black mt-1 text-error">-{totals.outQty}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(totals.outValue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Date filter */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Từ ngày</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Đến ngày</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDateFrom(""); setDateTo("") }}
              className="w-full"
            >
              Xóa lọc
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Batches */}
      {batches.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold text-sm mb-3">Lô hàng hiện có ({batches.length})</p>
            <div className="flex flex-wrap gap-2">
              {batches.map((b) => (
                <div
                  key={b.id}
                  className="rounded-lg border bg-muted/20 px-3 py-2 text-xs min-w-[160px]"
                >
                  <p className="font-mono font-bold">{b.batch_code}</p>
                  <p className="text-muted-foreground mt-0.5">
                    Tồn: <span className="font-semibold text-foreground">{b.qty_on_hand}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Giá vốn: {formatCurrency(Number(b.unit_cost) || 0)}
                  </p>
                  {b.expires_at && (
                    <p className="text-muted-foreground">HSD: {formatDate(b.expires_at)}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Movement ledger */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : withRunning.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có giao dịch"
          description="Nhập/xuất kho sẽ hiển thị ở đây"
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày</TableHead>
                  <TableHead>Phiếu</TableHead>
                  <TableHead>Loại</TableHead>
                  {/* ⚠ MỘT CỘT CHO CẢ HAI CHIỀU (chủ nhà chốt
                      20/09/2026: "Thêm cột VD xuất cho Khách hàng nào.
                      Nhập của NCC nào"). Tra soát là đi tìm "lô này ở
                      đâu ra, đi đâu về" — mã phiếu kho một mình không
                      trả lời được câu đó. Hai cột riêng thì mỗi dòng bỏ
                      trống đúng một cột, và bảng rộng thêm vô ích. */}
                  <TableHead>Đối tác / Hóa đơn</TableHead>
                  <TableHead>Người tạo</TableHead>
                  <TableHead>Lô</TableHead>
                  <TableHead className="text-right">Nhập</TableHead>
                  <TableHead className="text-right">Xuất</TableHead>
                  <TableHead className="text-right">Tồn sau</TableHead>
                  <TableHead className="text-right">Giá vốn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withRunning.map((m) => {
                  const meta = TYPE_META[m.entry_type] || TYPE_META.import
                  const isIn = meta.sign === "in"
                  const isOut = meta.sign === "out"
                  return (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/inventory/entries/${m.entry_id}`)}
                    >
                      <TableCell className="text-xs">{formatDate(m.date)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-primary">
                        {m.entry_code}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${meta.color} border-0`} variant="outline">
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.invoice_code ? (
                          <>
                            <span className="font-mono font-bold text-primary">{m.invoice_code}</span>
                            <span className="block text-muted-foreground">
                              {m.invoice_date ? formatDate(m.invoice_date) : "—"}
                              {m.customer_name ? ` · ${m.customer_name}` : ""}
                            </span>
                          </>
                        ) : m.supplier_name ? (
                          <>
                            <span className="font-semibold">{m.supplier_name}</span>
                            <span className="block text-muted-foreground">nhà cung cấp</span>
                          </>
                        ) : (
                          /* ⚠ Phiếu không gắn đối tác nào (nhập kho thường,
                             chuyển kho, kiểm kê) thì để gạch — đừng bịa. */
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.creator_name || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.batch_code || "-"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {isIn ? `+${m.quantity}` : meta.sign === "adjust" && m.quantity > 0 ? `+${m.quantity}` : "-"}
                        {isIn && m.unit_name && m.unit_name !== product?.base_unit && (
                          <span className="block text-[11px] font-normal text-muted-foreground">{m.qtyGd} {m.unit_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-error">
                        {isOut ? `-${m.quantity}` : "-"}
                        {isOut && m.unit_name && m.unit_name !== product?.base_unit && (
                          <span className="block text-[11px] font-normal text-muted-foreground">{m.qtyGd} {m.unit_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold">{m.running}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {m.unit_cost > 0 ? formatCurrency(m.unit_cost) : "-"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-2">
            {withRunning.slice().reverse().map((m) => {
              const meta = TYPE_META[m.entry_type] || TYPE_META.import
              const Icon = meta.icon
              const isIn = meta.sign === "in"
              const isOut = meta.sign === "out"
              return (
                <Link
                  key={m.id}
                  href={`/inventory/entries/${m.entry_id}`}
                  className="block rounded-xl border bg-card p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${meta.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-bold text-primary truncate">
                            {m.entry_code}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(m.date)}
                            {m.batch_code ? ` • Lô ${m.batch_code}` : ""}
                          </p>
                          {/* ⚠ Đi theo hóa đơn nào, cho ai — xem chú thích
                              ở cột cùng tên của bảng máy tính. */}
                          {m.invoice_code ? (
                            <p className="mt-0.5 truncate text-xs font-semibold text-on-surface-variant">
                              {m.invoice_code}
                              {m.invoice_date ? ` · ${formatDate(m.invoice_date)}` : ""}
                              {m.customer_name ? ` · ${m.customer_name}` : ""}
                            </p>
                          ) : m.supplier_name ? (
                            <p className="mt-0.5 truncate text-xs font-semibold text-on-surface-variant">
                              NCC: {m.supplier_name}
                            </p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`font-bold text-sm ${isIn ? "text-tertiary" : isOut ? "text-error" : ""}`}>
                            {isIn ? "+" : isOut ? "-" : "Δ"}{m.quantity}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Tồn: {m.running}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
