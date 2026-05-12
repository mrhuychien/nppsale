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
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency, formatDate } from "@/lib/utils"

type Variant = "purchase" | "payable" | "purchase_by_supplier"

const VARIANTS = [
  { key: "purchase" as const, label: "Nhập hàng" },
  { key: "payable" as const, label: "Công nợ" },
  { key: "purchase_by_supplier" as const, label: "Hàng nhập theo NCC" },
] as const

interface SupplierRow {
  id: string
  name: string
  code: string | null
  category: string | null
  phone: string | null
}
interface ProductRow {
  id: string
  sku: string
  name: string
}

interface PurchaseInvoiceRow {
  id: string
  supplier_id: string
  invoice_number: string | null
  invoice_date: string
  total: number
  status: string
  po_id: string | null
}

interface POLineRow {
  po_id: string
  product_id: string
  quantity: number
  line_total: number
  received_qty: number
}

interface PayableRow {
  id: string
  supplier_id: string
  amount: number
  paid: number
  due_date: string | null
  status: string
}

interface StockEntryRow {
  id: string
  type: string
  status: string
  posted_at: string | null
  entry_code: string
  supplier_id: string | null
}

interface StockEntryLineRow {
  entry_id: string
  product_id: string
  quantity: number
  unit_cost: number
}

export default function SuppliersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("purchase")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loading, setLoading] = useState(true)

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([])
  const [poLines, setPoLines] = useState<POLineRow[]>([])
  const [payables, setPayables] = useState<PayableRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntryRow[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const fromIso = `${range.from}T00:00:00Z`
    const toIso = `${range.to}T23:59:59Z`
    const [suppliersRes, productsRes, invoicesRes, payablesRes, stockEntriesRes] = await Promise.all([
      supabase.from("suppliers").select("id, name, code, category, phone").eq("org_id", user.org_id),
      supabase.from("products").select("id, sku, name").eq("org_id", user.org_id),
      supabase
        .from("purchase_invoices")
        .select("id, supplier_id, invoice_number, invoice_date, total, status, po_id")
        .eq("org_id", user.org_id)
        .gte("invoice_date", range.from)
        .lte("invoice_date", range.to)
        .neq("status", "cancelled"),
      supabase
        .from("payables")
        .select("id, supplier_id, amount, paid, due_date, status")
        .eq("org_id", user.org_id),
      supabase
        .from("stock_entries")
        .select("id, type, status, posted_at, entry_code, supplier_id")
        .eq("org_id", user.org_id)
        .eq("type", "import")
        .eq("status", "posted")
        .gte("posted_at", fromIso)
        .lte("posted_at", toIso),
    ])
    const poIds = ((invoicesRes.data as PurchaseInvoiceRow[]) || [])
      .map((i) => i.po_id)
      .filter((x): x is string => Boolean(x))
    const stockEntryIds = ((stockEntriesRes.data as StockEntryRow[]) || []).map((e) => e.id)
    const [poLinesRes, stockLinesRes] = await Promise.all([
      poIds.length === 0
        ? Promise.resolve({ data: [] as POLineRow[] })
        : supabase
            .from("purchase_order_lines")
            .select("po_id, product_id, quantity, line_total, received_qty")
            .in("po_id", poIds),
      stockEntryIds.length === 0
        ? Promise.resolve({ data: [] as StockEntryLineRow[] })
        : supabase
            .from("stock_entry_lines")
            .select("entry_id, product_id, quantity, unit_cost")
            .in("entry_id", stockEntryIds),
    ])
    setSuppliers((suppliersRes.data as SupplierRow[]) || [])
    setProducts((productsRes.data as ProductRow[]) || [])
    setInvoices((invoicesRes.data as PurchaseInvoiceRow[]) || [])
    setPoLines((poLinesRes.data as POLineRow[]) || [])
    setPayables((payablesRes.data as PayableRow[]) || [])
    setStockEntries((stockEntriesRes.data as StockEntryRow[]) || [])
    setStockLines((stockLinesRes.data as StockEntryLineRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const supplierMap = useMemo(() => {
    const m = new Map<string, SupplierRow>()
    for (const s of suppliers) m.set(s.id, s)
    return m
  }, [suppliers])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const stockEntryMap = useMemo(() => {
    const m = new Map<string, StockEntryRow>()
    for (const e of stockEntries) m.set(e.id, e)
    return m
  }, [stockEntries])

  const matchSearch = useCallback(
    (s: SupplierRow | undefined) => {
      if (!s) return false
      if (supplierFilter.length && !supplierFilter.includes(s.id)) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        s.name.toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q) ||
        (s.phone || "").toLowerCase().includes(q)
      )
    },
    [search, supplierFilter]
  )

  // -------------------- Nhập hàng (drill-down) --------------------
  type PurchaseRow = {
    id: string
    code: string
    name: string
    category: string
    purchaseValue: number
    invoiceCount: number
    invoices: { id: string; doc: string; date: string; total: number; status: string }[]
  }
  const purchaseRows: PurchaseRow[] = useMemo(() => {
    const m = new Map<string, PurchaseRow>()
    for (const inv of invoices) {
      const s = supplierMap.get(inv.supplier_id)
      if (!matchSearch(s)) continue
      const e = m.get(inv.supplier_id) || {
        id: inv.supplier_id,
        code: s?.code || "—",
        name: s?.name || "—",
        category: s?.category || "—",
        purchaseValue: 0,
        invoiceCount: 0,
        invoices: [],
      }
      e.invoiceCount += 1
      e.purchaseValue += Number(inv.total || 0)
      e.invoices.push({
        id: inv.id,
        doc: inv.invoice_number || `HD${inv.id.slice(0, 6)}`,
        date: inv.invoice_date,
        total: Number(inv.total || 0),
        status: inv.status,
      })
      m.set(inv.supplier_id, e)
    }
    return Array.from(m.values()).sort((a, b) => b.purchaseValue - a.purchaseValue)
  }, [invoices, supplierMap, matchSearch])

  // -------------------- Công nợ NCC --------------------
  type PayableViewRow = {
    id: string
    code: string
    name: string
    invoices: number
    outstanding: number
    overdueDays: number
  }
  const payableRows: PayableViewRow[] = useMemo(() => {
    const m = new Map<string, PayableViewRow>()
    const now = Date.now()
    for (const p of payables) {
      const s = supplierMap.get(p.supplier_id)
      if (!matchSearch(s)) continue
      const outstanding = Number(p.amount || 0) - Number(p.paid || 0)
      if (outstanding <= 0) continue
      const e = m.get(p.supplier_id) || {
        id: p.supplier_id,
        code: s?.code || "—",
        name: s?.name || "—",
        invoices: 0,
        outstanding: 0,
        overdueDays: 0,
      }
      e.invoices += 1
      e.outstanding += outstanding
      const days = p.due_date ? Math.ceil((now - new Date(p.due_date).getTime()) / 86400000) : 0
      if (days > e.overdueDays) e.overdueDays = days
      m.set(p.supplier_id, e)
    }
    return Array.from(m.values()).sort((a, b) => b.outstanding - a.outstanding)
  }, [payables, supplierMap, matchSearch])

  // -------------------- Hàng nhập theo NCC (drill-down) --------------------
  type SupplierProductRow = {
    id: string
    code: string
    name: string
    qty: number
    value: number
    products: { id: string; sku: string; name: string; qty: number; value: number }[]
  }
  const supplierProductRows: SupplierProductRow[] = useMemo(() => {
    const m = new Map<string, SupplierProductRow>()
    // From posted import stock entries (preferred — tied to supplier_id)
    for (const l of stockLines) {
      const entry = stockEntryMap.get(l.entry_id)
      if (!entry || entry.type !== "import") continue
      const supplierId = entry.supplier_id
      if (!supplierId) continue
      const s = supplierMap.get(supplierId)
      if (!matchSearch(s)) continue
      const e = m.get(supplierId) || {
        id: supplierId,
        code: s?.code || "—",
        name: s?.name || "—",
        qty: 0,
        value: 0,
        products: [],
      }
      const p = productMap.get(l.product_id)
      const q = Math.abs(Number(l.quantity || 0))
      const v = q * Number(l.unit_cost || 0)
      e.qty += q
      e.value += v
      const existing = e.products.find((x) => x.id === l.product_id)
      if (existing) {
        existing.qty += q
        existing.value += v
      } else {
        e.products.push({
          id: l.product_id,
          sku: p?.sku || "—",
          name: p?.name || "—",
          qty: q,
          value: v,
        })
      }
      m.set(supplierId, e)
    }
    // Fallback: PO lines (when stock entries aren't tied via supplier)
    if (m.size === 0) {
      const invByPo = new Map<string, PurchaseInvoiceRow>()
      for (const i of invoices) {
        if (i.po_id) invByPo.set(i.po_id, i)
      }
      for (const l of poLines) {
        const inv = invByPo.get(l.po_id)
        if (!inv) continue
        const s = supplierMap.get(inv.supplier_id)
        if (!matchSearch(s)) continue
        const e = m.get(inv.supplier_id) || {
          id: inv.supplier_id,
          code: s?.code || "—",
          name: s?.name || "—",
          qty: 0,
          value: 0,
          products: [],
        }
        const p = productMap.get(l.product_id)
        const q = Number(l.received_qty || l.quantity || 0)
        const v = Number(l.line_total || 0)
        e.qty += q
        e.value += v
        const existing = e.products.find((x) => x.id === l.product_id)
        if (existing) {
          existing.qty += q
          existing.value += v
        } else {
          e.products.push({
            id: l.product_id,
            sku: p?.sku || "—",
            name: p?.name || "—",
            qty: q,
            value: v,
          })
        }
        m.set(inv.supplier_id, e)
      }
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.value - a.value)
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value)
  }, [stockLines, stockEntryMap, supplierMap, productMap, invoices, poLines, matchSearch])

  const handleExport = () => {
    if (variant === "purchase") {
      const out: (string | number)[][] = [
        ["Mã NCC", "Tên NCC", "Nhóm", "Số HĐ", "Giá trị nhập"],
      ]
      for (const r of purchaseRows)
        out.push([r.code, r.name, r.category, r.invoiceCount, r.purchaseValue])
      downloadXlsx(`bao-cao-ncc-nhaphang-${range.from}-${range.to}`, out)
    } else if (variant === "payable") {
      const out: (string | number)[][] = [
        ["Mã NCC", "Tên NCC", "Số phiếu", "Công nợ", "Tuổi nợ tối đa (ngày)"],
      ]
      for (const r of payableRows)
        out.push([r.code, r.name, r.invoices, r.outstanding, r.overdueDays])
      downloadXlsx(`bao-cao-ncc-congno-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [
        ["Mã NCC", "Tên NCC", "Mã hàng", "Tên hàng", "SL", "Giá trị"],
      ]
      for (const r of supplierProductRows) {
        for (const p of r.products) {
          out.push([r.code, r.name, p.sku, p.name, p.qty, p.value])
        }
      }
      downloadXlsx(`bao-cao-ncc-hangnhap-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  const totalsPurchase = purchaseRows.reduce(
    (acc, r) => ({ inv: acc.inv + r.invoiceCount, val: acc.val + r.purchaseValue }),
    { inv: 0, val: 0 }
  )
  const totalsPayable = payableRows.reduce(
    (acc, r) => ({ inv: acc.inv + r.invoices, out: acc.out + r.outstanding }),
    { inv: 0, out: 0 }
  )
  const totalsByProduct = supplierProductRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, val: acc.val + r.value }),
    { qty: 0, val: 0 }
  )

  return (
    <ReportShell
      title="Báo cáo nhà cung cấp"
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
          <FilterField label="Nhà cung cấp">
            <FilterMultiSelect
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={catalogs.suppliers}
              placeholder="Theo mã, tên, số điện thoại"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã, tên, SĐT (tự do)"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            />
          </FilterField>
        </>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {loading ? (
        <Skeleton className="h-72" />
      ) : variant === "purchase" ? (
        <ReportTable
          rows={purchaseRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "code", label: "Mã NCC", render: (r) => <span className="font-mono text-xs text-primary">{r.code}</span> },
            { key: "name", label: "Tên NCC", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "cat", label: "Nhóm", render: (r) => r.category },
            { key: "n", label: "Số HĐ", align: "right", render: (r) => r.invoiceCount },
            { key: "v", label: "Giá trị nhập", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.purchaseValue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL NCC: ${purchaseRows.length}`, colSpan: 3 },
                { content: totalsPurchase.inv, align: "right" },
                { content: formatCurrency(totalsPurchase.val), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-emerald-100/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã HĐ</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Ngày</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Trạng thái</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {r.invoices.map((d) => (
                    <tr key={d.id} className="border-t border-border/30">
                      <td className="px-3 py-1.5 font-mono text-xs text-primary">{d.doc}</td>
                      <td className="px-3 py-1.5">{formatDate(d.date)}</td>
                      <td className="px-3 py-1.5">{d.status}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatCurrency(d.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : variant === "payable" ? (
        <ReportTable
          rows={payableRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "code", label: "Mã NCC", render: (r) => <span className="font-mono text-xs text-primary">{r.code}</span> },
            { key: "name", label: "Tên NCC", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "n", label: "Số phiếu", align: "right", render: (r) => r.invoices },
            { key: "out", label: "Công nợ", align: "right", render: (r) => <span className="font-semibold text-red-600">{formatCurrency(r.outstanding)}</span> },
            { key: "od", label: "Tuổi nợ tối đa", align: "right", render: (r) => (
              <span className={r.overdueDays > 0 ? "font-semibold text-red-600" : ""}>
                {r.overdueDays > 0 ? `${r.overdueDays} ngày` : "—"}
              </span>
            )},
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL NCC: ${payableRows.length}`, colSpan: 2 },
                { content: totalsPayable.inv, align: "right" },
                { content: formatCurrency(totalsPayable.out), align: "right", className: "text-red-600" },
                { content: "", align: "right" },
              ]}
            />
          }
        />
      ) : (
        <ReportTable
          rows={supplierProductRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "code", label: "Mã NCC", render: (r) => <span className="font-mono text-xs text-primary">{r.code}</span> },
            { key: "name", label: "Tên NCC", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "qty", label: "Tổng SL nhập", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
            { key: "val", label: "Giá trị nhập", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.value)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL NCC: ${supplierProductRows.length}`, colSpan: 2 },
                { content: totalsByProduct.qty.toLocaleString("vi-VN"), align: "right" },
                { content: formatCurrency(totalsByProduct.val), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-emerald-100/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Tên hàng</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL nhập</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {r.products.map((p) => (
                    <tr key={p.id} className="border-t border-border/30">
                      <td className="px-3 py-1.5 font-mono text-xs text-primary">{p.sku}</td>
                      <td className="px-3 py-1.5">{p.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.qty.toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      )}
    </ReportShell>
  )
}
