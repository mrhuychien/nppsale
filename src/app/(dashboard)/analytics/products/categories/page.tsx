"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/analytics/kpi-card"
import { ChangeBadge, MoneyCell, NumberCell, TopListCard } from "@/components/analytics/top-list"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  previousRange,
  pctChange,
  formatRangeLabel,
} from "@/lib/analytics/period"
import {
  fetchRevenueInvoices,
  fetchInvoiceLines,
  fetchReturnsRows,
  fetchReturnLines,
  type InvoiceLineRow,
  type ReturnLineRow,
} from "@/lib/analytics/sales"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { slCoSoDong } from "@/lib/analytics/quy-doi-dong"
import { errorMessage } from "@/lib/errors"
import { CanhBaoThieuDong, LoiTaiBaoCao } from "../../_shared/loi-tai"

interface ProductRow {
  id: string
  name: string
  category: string | null
  brand: string | null
}

export default function ProductsCategoriesPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [prevLines, setPrevLines] = useState<InvoiceLineRow[]>([])
  /**
   * ⚠ Dòng hàng trả (không tính hàng đổi) của phiếu trừ trong kỳ — doanh thu THUẦN
   *   theo nhóm / thương hiệu = dòng hóa đơn − dòng trả (chủ nhà 25/09/2026: "Rà soát
   *   lại toàn bộ doanh số tính bằng số đi - số trả").
   */
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  const [prevReturnLines, setPrevReturnLines] = useState<ReturnLineRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])

  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    const orgId = user.org_id
    setLoading(true)
    setLoadError(null)
    const prev = previousRange(range)
    /**
     * ⚠ DANH MỤC HÀNG PHẢI ĐỦ. Đây là bảng TRA TÊN / NHÓM cho từng dòng
     *   đơn. Bản cũ đọc `products` bằng `.select()` trơn — PostgREST cắt ở
     *   1.000 mã, dòng đơn của mã thứ 1.001 trở đi hiện "—" / "Chưa phân
     *   nhóm". Nay đọc đủ theo trang, mốc `id` duy nhất.
     * ⚠ MỘT `try/catch` CHO CẢ LƯỢT, kể cả hàm ở `lib/analytics/sales`
     *   (`fetchInvoiceLines` đã ném từ trước). Hỏng thì BÁO, không vẽ số 0.
     */
    try {
      const [orders, prevOrders, retRows, prevRetRows, productsRes] = await Promise.all([
        // Doanh thu theo HÓA ĐƠN đã ghi sổ (chủ nhà 24/09/2026), không theo đơn.
        fetchRevenueInvoices(supabase, orgId, range),
        fetchRevenueInvoices(supabase, orgId, prev),
        fetchReturnsRows(supabase, orgId, range),
        fetchReturnsRows(supabase, orgId, prev),
        docDuHoacNem<ProductRow>(
          (from, to) =>
            supabase
              .from("products")
              .select("id, name, category, brand", { count: "exact" })
              .eq("org_id", orgId)
              .order("id")
              .range(from, to),
          "đọc danh mục hàng"
        ),
      ])
      const [lineList, prevLineList, retLineList, prevRetLineList] = await Promise.all([
        fetchInvoiceLines(supabase, orders.map((o) => o.id)),
        fetchInvoiceLines(supabase, prevOrders.map((o) => o.id)),
        fetchReturnLines(supabase, retRows.map((r) => r.id)),
        fetchReturnLines(supabase, prevRetRows.map((r) => r.id)),
      ])
      setLines(lineList)
      setPrevLines(prevLineList)
      setReturnLines(retLineList)
      setPrevReturnLines(prevRetLineList)
      setProducts(productsRes.rows)
      setTruncated(productsRes.truncated)
    } catch (e) {
      console.error("[products/categories] tải lỗi:", e)
      setLoadError(errorMessage(e, "Không tải được số liệu nhóm hàng"))
    } finally {
      setLoading(false)
    }
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const aggregate = useCallback(
    (rows: InvoiceLineRow[], retRows: ReturnLineRow[], key: "category" | "brand") => {
      const m = new Map<string, { qty: number; revenue: number; skuSet: Set<string> }>()
      for (const l of rows) {
        const p = productMap.get(l.product_id)
        const k = (p?.[key] as string | null | undefined) || "Khác"
        const e = m.get(k) || { qty: 0, revenue: 0, skuSet: new Set() }
        // SL hóa đơn theo `unit_name` → quy về đơn vị cơ sở bằng hệ số chụp (24/09/2026).
        e.qty += slCoSoDong(l)
        e.revenue += Number(l.line_total || 0)
        e.skuSet.add(l.product_id)
        m.set(k, e)
      }
      // Số THUẦN: trừ dòng hàng trả vào nhóm / thương hiệu của mặt hàng.
      for (const l of retRows) {
        const p = productMap.get(l.product_id)
        const k = (p?.[key] as string | null | undefined) || "Khác"
        const e = m.get(k) || { qty: 0, revenue: 0, skuSet: new Set<string>() }
        e.revenue -= Number(l.line_total || 0)
        m.set(k, e)
      }
      return m
    },
    [productMap]
  )

  const byCategory = useMemo(() => {
    const cur = aggregate(lines, returnLines, "category")
    const prev = aggregate(prevLines, prevReturnLines, "category")
    return Array.from(cur.entries())
      .map(([k, e]) => ({
        id: k,
        name: k,
        qty: e.qty,
        revenue: e.revenue,
        skus: e.skuSet.size,
        changePct: pctChange(e.revenue, prev.get(k)?.revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [lines, prevLines, returnLines, prevReturnLines, aggregate])

  const byBrand = useMemo(() => {
    const cur = aggregate(lines, returnLines, "brand")
    const prev = aggregate(prevLines, prevReturnLines, "brand")
    return Array.from(cur.entries())
      .map(([k, e]) => ({
        id: k,
        name: k,
        qty: e.qty,
        revenue: e.revenue,
        skus: e.skuSet.size,
        changePct: pctChange(e.revenue, prev.get(k)?.revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [lines, prevLines, returnLines, prevReturnLines, aggregate])

  // Tổng doanh thu THUẦN (đi − trả) của kỳ này và kỳ trước, cùng một phép gộp.
  const totalRevenue = byCategory.reduce((s, r) => s + r.revenue, 0)
  const prevTotalRevenue = useMemo(() => {
    let t = 0
    aggregate(prevLines, prevReturnLines, "category").forEach((e) => { t += e.revenue })
    return t
  }, [prevLines, prevReturnLines, aggregate])

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Phân loại hàng hóa</h1>
        <p className="text-sm text-muted-foreground">{formatRangeLabel(range)}</p>
      </div>
      <DateRangePicker
        value={range}
        preset={preset}
        onChange={(p, r) => {
          setPreset(p)
          setRange(r)
        }}
      />
    </div>
  )

  if (loadError) {
    return (
      <div className="space-y-6">
        {header}
        <LoiTaiBaoCao loi={loadError} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {truncated && <CanhBaoThieuDong />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Tổng doanh thu thuần (đã phân loại)"
          value={totalRevenue}
          format="compactCurrency"
          changePct={pctChange(totalRevenue, prevTotalRevenue)}
        />
        <KpiCard
          label="Số nhóm hàng"
          value={byCategory.length}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Số thương hiệu"
          value={byBrand.length}
          format="number"
          changePct={null}
        />
      </div>

      <TopListCard
        title="Phân tích theo nhóm hàng (category)"
        rows={byCategory}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Nhóm hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "skus", label: "SKU", align: "right", render: (r) => <NumberCell value={r.skus} /> },
          { key: "qty", label: "SL bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu thuần", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Phân tích theo thương hiệu (brand)"
        rows={byBrand}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Thương hiệu", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "skus", label: "SKU", align: "right", render: (r) => <NumberCell value={r.skus} /> },
          { key: "qty", label: "SL bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu thuần", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />
    </div>
  )
}
