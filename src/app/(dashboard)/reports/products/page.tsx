"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { viIncludes, viNormalize } from "@/lib/search"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ReportShell,
  FilterCheckbox,
  FilterField,
  FilterSearchSelect,
  FilterMultiSelect,
} from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchReturnsRowsDu,
  fetchReturnLines,
  fetchStockEntryLines,
  fetchPostedStockEntries,
  fetchOrgRows,
  soLuongCoSoDongHd,
  soLuongCoSoDongTra,
  soLuongCoSoDongKho,
  giaTriDongKho,
  COT_SP_QUY_DOI,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type ReturnLineRow,
  type StockEntryLineRow,
} from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { SalesByProductView, type SalesByProductRow } from "./_views/sales-by-product"
import { ProfitByProductView, type ProfitByProductRow } from "./_views/profit-by-product"
import { StockValueView, type StockValueRow } from "./_views/stock-value"
import { StockMovementView, type StockMovementRow } from "./_views/stock-movement"

type Variant = "sales" | "profit" | "stock_value" | "movement" | "movement_detail"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "stock_value" as const, label: "Giá trị kho" },
  { key: "movement" as const, label: "Xuất nhập tồn" },
  { key: "movement_detail" as const, label: "Xuất nhập tồn chi tiết" },
] as const

/** Mặt hàng kèm đơn vị quy đổi (`COT_SP_QUY_DOI`) — SL cộng dồn quy về đơn vị cơ sở. */
interface ProductRow extends SanPhamQuyDoi {
  id: string
  sku: string
  name: string
  category: string | null
  brand?: string | null
  base_unit: string
  primary_supplier_id?: string | null
}

interface SupplierRow {
  id: string
  name: string
}

interface BatchRow {
  id: string
  product_id: string
  qty_on_hand: number
  unit_cost: number
}

interface StockEntry {
  id: string
  type: "import" | "export" | "stocktake" | "transfer"
  status: string
  posted_at: string | null
  entry_code: string
}

interface CustomerRow {
  id: string
  store_name: string
}

export default function ProductsReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [groupSameType, setGroupSameType] = useState(false)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const [productFilter, setProductFilter] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [groupFilter, setGroupFilter] = useState("")
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    /**
     * ⚠ MỌI BẢNG ĐỀU ĐỌC ĐỦ, HỎNG THÌ NÉM. Bản cũ đọc mặt hàng, lô, phiếu
     *   kho trần (cắt ở 1.000 dòng) và `.in(...)` cả danh sách id phiếu
     *   trả / phiếu kho (URL quá dài) — lỗi chỉ `console.error`. Mặt hàng
     *   thứ 1.001 không có trong map thì mọi view `if (!p) continue` bỏ
     *   luôn doanh số và giá vốn của nó, không một dấu vết.
     */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      const [invoiceRes, productsRes, batchesRes, returnsRes, entriesRes, customersRes, suppliersRes] =
        await Promise.all([
          fetchRevenueInvoicesDu(supabase, orgId, range),
          fetchOrgRows<ProductRow>(
            supabase, "products", orgId,
            `id, sku, name, category, brand, base_unit, sell_price, primary_supplier_id, ${COT_SP_QUY_DOI}`, "đọc mặt hàng"
          ),
          /* ⚠ CHỈ LÔ CÒN HÀNG. Lô đã hết vẫn nằm trong bảng mãi mãi; đọc cả
             chúng thì trần 1.000 dòng cạn nhanh gấp mấy lần, mà giá trị kho
             và tồn cuối của chúng đều là 0. */
          docDuHoacNem<BatchRow>(
            (from, to) =>
              supabase
                .from("batches")
                .select("id, product_id, qty_on_hand, unit_cost", { count: "exact" })
                .eq("org_id", orgId)
                .gt("qty_on_hand", 0)
                .order("id")
                .range(from, to),
            "đọc lô tồn kho"
          ),
          fetchReturnsRowsDu(supabase, orgId, range),
          fetchPostedStockEntries(supabase, orgId, range, null),
          fetchOrgRows<CustomerRow>(supabase, "customers", orgId, "id, store_name", "đọc khách hàng"),
          fetchOrgRows<SupplierRow>(supabase, "suppliers", orgId, "id, name", "đọc nhà cung cấp"),
        ])

      const [lineList, returnLineList, stockLineList] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceRes.rows.map((o) => o.id)),
        fetchReturnLines(supabase, returnsRes.rows.map((r) => r.id)),
        fetchStockEntryLines(supabase, entriesRes.rows.map((e) => e.id)),
      ])

      setTruncated(
        invoiceRes.truncated || productsRes.truncated || batchesRes.truncated || returnsRes.truncated ||
          entriesRes.truncated || customersRes.truncated || suppliersRes.truncated
      )
      setInvoices(invoiceRes.rows)
      setLines(lineList)
      setReturnLines(returnLineList)
      setProducts(productsRes.rows)
      setBatches(batchesRes.rows)
      setStockEntries(entriesRes.rows)
      setStockLines(stockLineList)
      setCustomers(customersRes.rows)
      setSuppliers(suppliersRes.rows.slice().sort((x, y) => x.name.localeCompare(y.name, "vi")))
    } catch (err) {
      setLoadError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  // §3.2 + filter overhaul — apply ALL catalog-backed filters at the
  // productMap layer; downstream views skip any line/batch whose
  // product isn't in the map.
  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) {
      if (supplierFilter.length && !supplierFilter.includes(p.primary_supplier_id || "")) continue
      if (productFilter.length && !productFilter.includes(p.id)) continue
      if (categoryFilter.length && !categoryFilter.includes(p.category || "")) continue
      const brand = (p as unknown as { brand?: string | null }).brand
      if (brandFilter.length && !brandFilter.includes(brand || "")) continue
      m.set(p.id, p)
    }
    return m
  }, [products, supplierFilter, productFilter, categoryFilter, brandFilter])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const orderMap = useMemo(() => {
    const m = new Map<string, { id: string; order_code: string; order_date: string; customer_name: string }>()
    for (const o of invoices) {
      m.set(o.id, {
        id: o.id,
        // Chi tiết theo HÓA ĐƠN: mã và ngày của tờ hóa đơn.
        order_code: o.invoice_code,
        order_date: o.invoice_date,
        customer_name: customerMap.get(o.customer_id)?.store_name || "—",
      })
    }
    return m
  }, [invoices, customerMap])

  const stockEntryMap = useMemo(() => {
    const m = new Map<string, StockEntry>()
    for (const e of stockEntries) m.set(e.id, e)
    return m
  }, [stockEntries])

  const filterFn = useCallback(
    (p: ProductRow) => {
      if (!search) return true
      const q = viNormalize(search)
      return viIncludes(p.name, q) || viIncludes(p.sku, q)
    },
    [search]
  )

  const groupKey = useCallback(
    (p: ProductRow): string => {
      if (groupSameType) return p.category || "Khác"
      return p.id
    },
    [groupSameType]
  )

  const groupLabel = useCallback(
    (key: string, sample: ProductRow): { sku: string; name: string } => {
      if (groupSameType) {
        return { sku: key.slice(0, 12).toUpperCase(), name: key }
      }
      return { sku: sample.sku, name: sample.name }
    },
    [groupSameType]
  )

  // -------------------- Bán hàng --------------------
  const salesRows: SalesByProductRow[] = useMemo(() => {
    const m = new Map<string, SalesByProductRow>()
    for (const l of lines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || { id: k, sku: lbl.sku, name: lbl.name, unit: groupSameType ? "" : p.base_unit, qty: 0, revenue: 0, returnQty: 0, returnValue: 0, netRevenue: 0 }
      // SL quy về đơn vị cơ sở (ưu tiên hệ số chụp trên dòng hóa đơn).
      e.qty += soLuongCoSoDongHd(l, p)
      e.revenue += Number(l.line_total || 0)
      m.set(k, e)
    }
    for (const l of returnLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || { id: k, sku: lbl.sku, name: lbl.name, unit: groupSameType ? "" : p.base_unit, qty: 0, revenue: 0, returnQty: 0, returnValue: 0, netRevenue: 0 }
      // Dòng trả không có hệ số chụp → tra danh mục.
      e.returnQty += soLuongCoSoDongTra(l, p)
      e.returnValue += Number(l.line_total || 0)
      m.set(k, e)
    }
    return Array.from(m.values())
      .map((r) => ({ ...r, netRevenue: r.revenue - r.returnValue }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [lines, returnLines, productMap, filterFn, groupKey, groupLabel, groupSameType])

  // -------------------- Lợi nhuận --------------------
  const profitRows: ProfitByProductRow[] = useMemo(() => {
    // Doanh thu & SL từ dòng hóa đơn đã ghi sổ; COGS from posted export entry lines
    const m = new Map<string, ProfitByProductRow>()
    const exportLines = stockLines.filter(
      (l) => stockEntryMap.get(l.entry_id)?.type === "export"
    )

    for (const l of lines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || { id: k, sku: lbl.sku, name: lbl.name, qty: 0, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      e.qty += soLuongCoSoDongHd(l, p)
      e.revenue += Number(l.line_total || 0)
      m.set(k, e)
    }
    for (const l of exportLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || { id: k, sku: lbl.sku, name: lbl.name, qty: 0, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      // SL cơ sở × giá vốn mỗi đơn vị cơ sở.
      e.cogs += giaTriDongKho(l)
      m.set(k, e)
    }
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [lines, stockLines, stockEntryMap, productMap, filterFn, groupKey, groupLabel])

  // -------------------- Giá trị kho --------------------
  const stockValueRows: StockValueRow[] = useMemo(() => {
    const m = new Map<string, StockValueRow & { _qtyAccum: number; _valAccum: number }>()
    for (const b of batches) {
      const p = productMap.get(b.product_id)
      if (!p || !filterFn(p)) continue
      if (Number(b.qty_on_hand || 0) <= 0) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || {
        id: k,
        sku: lbl.sku,
        name: lbl.name,
        category: p.category || "—",
        qty: 0,
        unit_cost: 0,
        value: 0,
        batches: 0,
        _qtyAccum: 0,
        _valAccum: 0,
      }
      const q = Number(b.qty_on_hand || 0)
      const c = Number(b.unit_cost || 0)
      e.qty += q
      e.value += q * c
      e.batches += 1
      e._qtyAccum += q
      e._valAccum += q * c
      m.set(k, e)
    }
    return Array.from(m.values())
      .map(({ _qtyAccum, _valAccum, ...rest }) => ({
        ...rest,
        unit_cost: _qtyAccum > 0 ? _valAccum / _qtyAccum : 0,
      }))
      .sort((a, b) => b.value - a.value)
  }, [batches, productMap, filterFn, groupKey, groupLabel])

  // -------------------- Xuất nhập tồn --------------------
  const movementData = useMemo(() => {
    type MR = StockMovementRow & { _id: string }
    const m = new Map<string, MR>()
    const detail = new Map<string, { date: string; type: "import" | "export" | "stocktake" | "transfer"; doc: string; qty: number; unit_cost: number }[]>()

    // current stock value (end-of-period proxy = current on-hand)
    for (const b of batches) {
      const p = productMap.get(b.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const e = m.get(k) || {
        _id: k,
        id: k,
        sku: lbl.sku,
        name: lbl.name,
        beginQty: 0,
        importQty: 0,
        importValue: 0,
        exportQty: 0,
        exportValue: 0,
        endQty: 0,
      }
      e.endQty += Number(b.qty_on_hand || 0)
      m.set(k, e)
    }

    // import / export within period
    for (const l of stockLines) {
      const p = productMap.get(l.product_id)
      if (!p || !filterFn(p)) continue
      const k = groupKey(p)
      const lbl = groupLabel(k, p)
      const entry = stockEntryMap.get(l.entry_id)
      if (!entry) continue
      const e = m.get(k) || {
        _id: k,
        id: k,
        sku: lbl.sku,
        name: lbl.name,
        beginQty: 0,
        importQty: 0,
        importValue: 0,
        exportQty: 0,
        exportValue: 0,
        endQty: 0,
      }
      // SL cơ sở — cùng đơn vị với tồn lô (`qty_on_hand`) và `unit_cost`.
      const q = soLuongCoSoDongKho(l)
      const c = Number(l.unit_cost || 0)
      if (entry.type === "import") {
        e.importQty += q
        e.importValue += q * c
      } else if (entry.type === "export") {
        e.exportQty += q
        e.exportValue += q * c
      }
      m.set(k, e)
      const arr = detail.get(k) || []
      arr.push({
        date: entry.posted_at || "",
        type: entry.type,
        doc: entry.entry_code,
        qty: q,
        unit_cost: c,
      })
      detail.set(k, arr)
    }

    // begin = end - imports + exports (approximation)
    for (const e of Array.from(m.values())) {
      e.beginQty = Math.max(0, e.endQty - e.importQty + e.exportQty)
    }

    return {
      rows: Array.from(m.values()).sort((a, b) => b.endQty - a.endQty) as StockMovementRow[],
      detail,
    }
  }, [batches, stockLines, stockEntryMap, productMap, filterFn, groupKey, groupLabel])

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Đơn vị", "SL bán", "Doanh thu", "SL trả", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows) {
        out.push([r.sku, r.name, r.unit, r.qty, r.revenue, r.returnQty, -r.returnValue, r.netRevenue])
      }
      downloadXlsx(`bao-cao-hh-banhang-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "SL bán", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows) {
        out.push([r.sku, r.name, r.qty, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      }
      downloadXlsx(`bao-cao-hh-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "stock_value") {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Nhóm", "SL tồn", "Giá vốn TB", "Giá trị tồn", "Số lô"],
      ]
      for (const r of stockValueRows) {
        out.push([r.sku, r.name, r.category, r.qty, r.unit_cost, r.value, r.batches])
      }
      downloadXlsx(`bao-cao-hh-giatrikho-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mã hàng", "Tên hàng", "Tồn đầu", "SL nhập", "Giá trị nhập", "SL xuất", "Giá trị xuất", "Tồn cuối"],
      ]
      for (const r of movementData.rows) {
        out.push([r.sku, r.name, r.beginQty, r.importQty, r.importValue, r.exportQty, r.exportValue, r.endQty])
      }
      downloadXlsx(`bao-cao-hh-xnt-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportShell
      title="Báo cáo hàng hóa"
      variants={VARIANTS}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      extraOptions={
        <FilterField label="Tùy chọn">
          <FilterCheckbox
            label="Gộp theo nhóm hàng"
            checked={groupSameType}
            onChange={setGroupSameType}
          />
        </FilterField>
      }
      filters={
        <>
          <FilterField label="Bảng giá / Nhóm khách">
            <FilterSearchSelect
              value={groupFilter}
              onChange={setGroupFilter}
              options={catalogs.customerGroups}
              placeholder="Chọn bảng giá"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Hàng hóa (chọn nhiều)">
            <FilterMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              placeholder="Tất cả hàng hóa"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Theo mã, tên hàng (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            />
          </FilterField>
          <FilterField label="Loại hàng (chọn nhiều)">
            <FilterMultiSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={catalogs.categories}
              placeholder="Tất cả loại hàng"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Thương hiệu (chọn nhiều)">
            <FilterMultiSelect
              value={brandFilter}
              onChange={setBrandFilter}
              options={catalogs.brands}
              placeholder="Tất cả thương hiệu"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Nhà cung cấp (chọn nhiều)">
            <FilterMultiSelect
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              placeholder="Tất cả NCC"
              loading={catalogs.loading}
            />
          </FilterField>
        </>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {!loadError && <ReportLoadNotice truncated={truncated} />}
      {loadError ? (
        <ReportLoadNotice error={loadError} />
      ) : loading ? (
        <Skeleton className="h-72" />
      ) : variant === "sales" ? (
        <SalesByProductView rows={salesRows} orderLines={lines} orderMap={orderMap} productMap={productMap} />
      ) : variant === "profit" ? (
        <ProfitByProductView rows={profitRows} />
      ) : variant === "stock_value" ? (
        <StockValueView rows={stockValueRows} />
      ) : variant === "movement" ? (
        <StockMovementView rows={movementData.rows} />
      ) : (
        <StockMovementView
          rows={movementData.rows}
          detail
          detailLines={movementData.detail}
        />
      )}
    </ReportShell>
  )
}
