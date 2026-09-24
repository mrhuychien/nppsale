"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterMultiSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchReturnsRowsDu,
  fetchPostedStockEntries,
  fetchOrgRows,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type ReturnSummaryRow as ReturnRowMeta,
  fetchStockEntryLines,
  fetchReturnLines,
  giaVonBinhQuanCoSo,
  soLuongCoSoDongHd,
  soLuongCoSoDongTra,
  type StockEntryLineRow,
} from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import { congSL, hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { toast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"

type Variant = "sales" | "profit" | "receivables" | "products"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "receivables" as const, label: "Công nợ" },
  { key: "products" as const, label: "Hàng bán theo khách" },
] as const

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  credit_limit: number
  phone: string | null
}
/** Mặt hàng kèm đơn vị quy đổi — SL cộng dồn quy về đơn vị cơ sở. */
interface ProductRow extends SanPhamQuyDoi {
  id: string
  sku: string
  name: string
}
interface ReturnLineRow {
  return_id: string
  customer_id?: string
  product_id: string
  unit_name?: string | null
  quantity: number
  line_total: number
}
interface ReceivableRow {
  id: string
  customer_id: string
  amount: number
  paid: number
  due_date: string | null
  status: string
  created_at: string
}
interface StockEntry {
  id: string
  type: string
}

export default function CustomersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [search, setSearch] = useState("")
  const [customerFilter, setCustomerFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returns, setReturns] = useState<ReturnRowMeta[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [receivables, setReceivables] = useState<ReceivableRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    /* ⚠ CHẶN SỚM NẰM NGOÀI `try`. Để trong thì `finally` tắt vòng quay
       ngay cả khi chưa hề bắt đầu đọc — màn hiện một báo cáo rỗng trong
       lúc phiên đăng nhập còn đang tải. */
    if (!user?.org_id) return
    /**
     * ⚠ ĐỌC HỎNG THÌ NÓI RA, ĐỪNG QUAY MÃI. Các hàm đọc dòng nay NÉM khi
     *   truy vấn hỏng thay vì trả mảng rỗng — vì một báo cáo tiền thiếu
     *   dòng trông y hệt một báo cáo đúng. Nhưng ném mà không ai bắt là
     *   vòng quay không bao giờ dừng và không có chữ nào giải thích.
     */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      /* ⚠ CÔNG NỢ VÀ PHIẾU XUẤT HỎNG THÌ NÉM. Bản cũ chỉ `console.error`
         rồi đọc `rows` rỗng → giá vốn 0 (lãi phồng) và công nợ 0. Khách
         hàng cũng đọc đủ theo trang: khách thứ 1.001 không có trong map
         thì dòng của họ mất tên, mất kênh. */
      const [invoiceRes, returnsRes, customersRes, productsRes, receivablesRes, stockEntriesRes] =
        await Promise.all([
          fetchRevenueInvoicesDu(supabase, orgId, range),
          fetchReturnsRowsDu(supabase, orgId, range),
          fetchOrgRows<CustomerRow>(
            supabase, "customers", orgId, "id, store_name, channel, credit_limit, phone", "đọc khách hàng"
          ),
          fetchOrgRows<ProductRow>(
            supabase, "products", orgId, "id, sku, name, base_unit, units:product_units(unit_name, conversion)", "đọc mặt hàng"
          ),
          docDuHoacNem<ReceivableRow>(
            (from, to) =>
              supabase
                .from("receivables")
                .select("id, customer_id, amount, paid, due_date, status, created_at", { count: "exact" })
                .eq("org_id", orgId)
                .in("status", ["open", "partial", "overdue"])
                .order("id")
                .range(from, to),
            "đọc công nợ"
          ),
          fetchPostedStockEntries(supabase, orgId, range, "export"),
        ])
      const invoiceList = invoiceRes.rows
      const returnsRows = returnsRes.rows
      setTruncated(
        invoiceRes.truncated || returnsRes.truncated || customersRes.truncated ||
          productsRes.truncated || receivablesRes.truncated || stockEntriesRes.truncated
      )
      const invoiceIds = invoiceList.map((o) => o.id)
      const returnIds = returnsRows.map((r) => r.id)
      const stockEntryIds = stockEntriesRes.rows.map((e) => e.id)
      /* ⚠ PHÂN TRANG CẢ BA. Quá 1.000 dòng thì API trả đúng 1.000 kèm 200,
         không lỗi — báo cáo cộng thiếu mà trông vẫn bình thường. */
      const [linesList, retLinesList, stockLinesList] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceIds),
        fetchReturnLines(supabase, returnIds),
        fetchStockEntryLines(supabase, stockEntryIds),
      ])

      setInvoices(invoiceList)
      setLines(linesList)
      setReturns(returnsRows)
      setReturnLines(retLinesList)
      setCustomers(customersRes.rows)
      setProducts(productsRes.rows)
      setReceivables(receivablesRes.rows)
      setStockEntries(stockEntriesRes.rows)
      setStockLines(stockLinesList)
    } catch (err) {
      setLoadError(errorMessage(err))
      toast({
        title: "Chưa dựng được báo cáo",
        description: errorMessage(err),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])
  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // helper: returns map of return_id -> customer_id (need to fetch from returns)
  const returnIdToCustomer = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of returns) m.set(r.id, r.customer_id)
    return m
  }, [returns])

  const matchSearch = useCallback(
    (c: CustomerRow | undefined) => {
      if (!c) return false
      if (customerFilter.length && !customerFilter.includes(c.id)) return false
      if (!search) return true
      const q = viNormalize(search)
      return (
        viIncludes(c.store_name, q) ||
        viIncludes((c.phone || ""), q) ||
        viIncludes(c.id, q)
      )
    },
    [search, customerFilter]
  )

  // -------------------- Bán hàng (theo khách) --------------------
  type SalesRow = {
    id: string
    name: string
    channel: string
    orders: number
    revenue: number
    returnValue: number
    netRevenue: number
  }
  const salesRows: SalesRow[] = useMemo(() => {
    const m = new Map<string, SalesRow>()
    for (const o of invoices) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
      }
      e.orders += 1
      e.revenue += Number(o.total || 0)
      m.set(o.customer_id, e)
    }
    for (const r of returns) {
      const c = customerMap.get(r.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(r.customer_id) || {
        id: r.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
      }
      e.returnValue += Number(r.credit_note_amount || 0)
      m.set(r.customer_id, e)
    }
    return Array.from(m.values())
      .map((r) => ({ ...r, netRevenue: r.revenue - r.returnValue }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [invoices, returns, customerMap, matchSearch])

  // -------------------- Lợi nhuận (theo khách) --------------------
  type ProfitRow = SalesRow & { cogs: number; profit: number; margin: number }
  const profitRows: ProfitRow[] = useMemo(() => {
    // Giá vốn bình quân MỖI ĐƠN VỊ CƠ SỞ theo mặt hàng trong kỳ.
    const avgCost = giaVonBinhQuanCoSo(stockLines)
    const linesByInvoice = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      const a = linesByInvoice.get(l.invoice_id) || []
      a.push(l)
      linesByInvoice.set(l.invoice_id, a)
    }
    const m = new Map<string, ProfitRow>()
    for (const o of invoices) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
        cogs: 0,
        profit: 0,
        margin: 0,
      }
      e.orders += 1
      e.revenue += Number(o.total || 0)
      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        // SL cơ sở × giá vốn mỗi đơn vị cơ sở.
        e.cogs += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCost.get(l.product_id) || 0)
      }
      m.set(o.customer_id, e)
    }
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [invoices, lines, stockLines, customerMap, productMap, matchSearch])

  // -------------------- Công nợ --------------------
  type RecvRow = {
    id: string
    name: string
    channel: string
    creditLimit: number
    invoices: number
    outstanding: number
    overdueDays: number
  }
  const recvRows: RecvRow[] = useMemo(() => {
    const m = new Map<string, RecvRow>()
    const now = Date.now()
    for (const r of receivables) {
      const c = customerMap.get(r.customer_id)
      if (!matchSearch(c)) continue
      const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
      if (outstanding === 0) continue
      const e = m.get(r.customer_id) || {
        id: r.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        creditLimit: Number(c?.credit_limit || 0),
        invoices: 0,
        outstanding: 0,
        overdueDays: 0,
      }
      /* Dòng ÂM (hàng trả > hàng xuất, mig 186) là dư có: TRỪ vào nợ, không
         phải một hóa đơn còn nợ, không bao giờ quá hạn. */
      e.outstanding += outstanding
      if (outstanding > 0) {
        e.invoices += 1
        const days = r.due_date ? Math.ceil((now - new Date(r.due_date).getTime()) / 86400000) : 0
        if (days > e.overdueDays) e.overdueDays = days
      }
      m.set(r.customer_id, e)
    }
    return Array.from(m.values()).sort((a, b) => b.outstanding - a.outstanding)
  }, [receivables, customerMap, matchSearch])

  // -------------------- Hàng bán theo khách (drill-down) --------------------
  type CustomerProductRow = HangBanTheoKhach
  const customerProductRows: CustomerProductRow[] = useMemo(() => {
    const linesByInvoice = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      const a = linesByInvoice.get(l.invoice_id) || []
      a.push(l)
      linesByInvoice.set(l.invoice_id, a)
    }
    const m = new Map<string, CustomerProductRow>()
    for (const o of invoices) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        revenue: 0,
        qty: 0,
        qtyTheoDv: {},
        products: [],
      }
      e.revenue += Number(o.total || 0)
      const ls = linesByInvoice.get(o.id) || []
      const prodMap = new Map<string, MatHangTheoKhach>()
      for (const r of e.products) prodMap.set(r.id, r)
      for (const l of ls) {
        const p = productMap.get(l.product_id)
        if (!p) continue
        const pr = prodMap.get(l.product_id) || {
          id: l.product_id,
          sku: p.sku,
          name: p.name,
          unit: p.base_unit || "",
          qty: 0,
          revenue: 0,
          returnQty: 0,
          returnValue: 0,
        }
        // SL quy về đơn vị cơ sở trước khi cộng.
        const qty = soLuongCoSoDongHd(l, p)
        pr.qty += qty
        pr.revenue += Number(l.line_total || 0)
        prodMap.set(l.product_id, pr)
        e.qty += qty
        // Khách mua nhiều mặt hàng → giữ SL theo từng đơn vị cơ sở.
        congSL(e.qtyTheoDv, p.base_unit, qty)
      }
      e.products = Array.from(prodMap.values())
      m.set(o.customer_id, e)
    }
    // attribute return lines by customer via return_id
    for (const rl of returnLines) {
      const cid = returnIdToCustomer.get(rl.return_id)
      if (!cid) continue
      const e = m.get(cid)
      if (!e) continue
      const p = productMap.get(rl.product_id)
      if (!p) continue
      const pr = e.products.find((x) => x.id === rl.product_id)
      // Dòng trả không có hệ số chụp → tra danh mục.
      const rqty = soLuongCoSoDongTra(rl, p)
      if (pr) {
        pr.returnQty += rqty
        pr.returnValue += Number(rl.line_total || 0)
      } else {
        e.products.push({
          id: rl.product_id,
          sku: p.sku,
          name: p.name,
          unit: p.base_unit || "",
          qty: 0,
          revenue: 0,
          returnQty: rqty,
          returnValue: Number(rl.line_total || 0),
        })
      }
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [invoices, lines, returnLines, productMap, customerMap, returnIdToCustomer, matchSearch])

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Số HĐ", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows)
        out.push([r.name, r.channel, r.orders, r.revenue, -r.returnValue, r.netRevenue])
      downloadXlsx(`bao-cao-kh-banhang-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Số HĐ", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows)
        out.push([r.name, r.channel, r.orders, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadXlsx(`bao-cao-kh-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "receivables") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Hạn mức", "Số phiếu", "Công nợ", "Tuổi nợ tối đa (ngày)"],
      ]
      for (const r of recvRows)
        out.push([r.name, r.channel, r.creditLimit, r.invoices, r.outstanding, r.overdueDays])
      downloadXlsx(`bao-cao-kh-congno-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Mã hàng", "Tên hàng", "Đơn vị", "SL bán", "Doanh thu", "SL trả", "Giá trị trả"],
      ]
      for (const c of customerProductRows) {
        for (const p of c.products) {
          out.push([c.name, c.channel, p.sku, p.name, p.unit, p.qty, p.revenue, p.returnQty, p.returnValue])
        }
      }
      downloadXlsx(`bao-cao-kh-hangban-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  // Suppress unused warning
  void stockEntries

  return (
    <ReportShell
      title="Báo cáo khách hàng"
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
      filters={
        <>
          <FilterField label="Khách hàng (chọn nhiều)">
            <FilterMultiSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              options={catalogs.customers}
              placeholder="Tất cả khách hàng"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo mã, tên, SĐT (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
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
        <SalesView rows={salesRows} />
      ) : variant === "profit" ? (
        <ProfitView rows={profitRows} />
      ) : variant === "receivables" ? (
        <ReceivablesView rows={recvRows} />
      ) : (
        <CustomerProductsView rows={customerProductRows} />
      )}
    </ReportShell>
  )
}

function SalesView({ rows }: { rows: { id: string; name: string; channel: string; orders: number; revenue: number; returnValue: number; netRevenue: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { orders: 0, revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "code", label: "Mã KH", render: (r) => <span className="font-mono text-xs text-primary">KH{r.id.slice(0, 6)}</span> },
        { key: "name", label: "Khách hàng", render: (r) => r.name },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "or", label: "Số HĐ", align: "right", render: (r) => r.orders },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "ret", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0") },
        { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.orders, align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            {
              content: totals.returnValue > 0 ? `-${formatCurrency(totals.returnValue)}` : "0",
              align: "right",
            },
            { content: formatCurrency(totals.netRevenue), align: "right", className: "text-primary" },
          ]}
        />
      }
    />
  )
}

function ProfitView({ rows }: { rows: { id: string; name: string; channel: string; orders: number; revenue: number; cogs: number; profit: number; margin: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "or", label: "Số HĐ", align: "right", render: (r) => r.orders },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
        { key: "profit", label: "Lợi nhuận", align: "right", render: (r) => <span className={r.profit >= 0 ? "font-semibold text-tertiary" : "font-semibold text-error"}>{formatCurrency(r.profit)}</span> },
        { key: "m", label: "Biên LN", align: "right", render: (r) => `${r.margin.toFixed(1)}%` },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 2 },
            { content: totals.orders, align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: formatCurrency(totals.cogs), align: "right" },
            { content: formatCurrency(totals.profit), align: "right", className: "text-primary" },
            { content: `${totalMargin.toFixed(1)}%`, align: "right" },
          ]}
        />
      }
    />
  )
}

function ReceivablesView({ rows }: { rows: { id: string; name: string; channel: string; creditLimit: number; invoices: number; outstanding: number; overdueDays: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + r.invoices,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { invoices: 0, outstanding: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "cl", label: "Hạn mức", align: "right", render: (r) => formatCurrency(r.creditLimit) },
        { key: "inv", label: "Số phiếu", align: "right", render: (r) => r.invoices },
        { key: "out", label: "Công nợ", align: "right", render: (r) => <span className="font-semibold text-error">{formatCurrency(r.outstanding)}</span> },
        { key: "od", label: "Tuổi nợ tối đa", align: "right", render: (r) => (
          <span className={r.overdueDays > 0 ? "font-semibold text-error" : ""}>
            {r.overdueDays > 0 ? `${r.overdueDays} ngày` : "—"}
          </span>
        )},
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.invoices, align: "right" },
            { content: formatCurrency(totals.outstanding), align: "right", className: "text-error" },
            { content: "", align: "right" },
          ]}
        />
      }
    />
  )
}

/** Một mặt hàng của khách — `qty` / `returnQty` theo đơn vị cơ sở `unit`. */
type MatHangTheoKhach = {
  id: string
  sku: string
  name: string
  unit: string
  qty: number
  revenue: number
  returnQty: number
  returnValue: number
}
type HangBanTheoKhach = {
  id: string
  name: string
  channel: string
  revenue: number
  /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  products: MatHangTheoKhach[]
}

/** SL một mặt hàng kèm đơn vị cơ sở, vd "640 hộp". */
const slMatHang = (q: number, unit: string) => `${q.toLocaleString("vi-VN")}${unit ? ` ${unit}` : ""}`

function CustomerProductsView({ rows }: { rows: HangBanTheoKhach[] }) {
  // Dòng tổng nhiều khách, nhiều mặt hàng: gộp theo đơn vị cơ sở.
  const totals = {
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    qtyTheoDv: tongSLTheoDonVi(rows),
  }
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "qty", label: "Tổng SL", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 2 },
            { content: hienSLTheoDonVi(totals.qtyTheoDv), align: "right" },
            { content: formatCurrency(totals.revenue), align: "right", className: "text-primary" },
          ]}
        />
      }
      expandable={(r) => (
        <div className="rounded-md border border-border/40 bg-background/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#ecfdf3]/60">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hàng</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Tên hàng</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL bán</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL trả</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
              </tr>
            </thead>
            <tbody>
              {r.products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-center text-xs text-muted-foreground">
                    Không có hàng
                  </td>
                </tr>
              ) : (
                r.products.map((p) => (
                  <tr key={p.id} className="border-t border-border/30">
                    <td className="px-3 py-1.5 font-mono text-xs text-primary">{p.sku}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{slMatHang(p.qty, p.unit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(p.revenue)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {p.returnQty > 0 ? slMatHang(p.returnQty, p.unit) : "0"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {p.returnValue > 0 ? `-${formatCurrency(p.returnValue)}` : "0"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    />
  )
}
