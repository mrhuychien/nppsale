"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { viIncludes, viNormalize } from "@/lib/search"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterMultiSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchReturnsRowsDu,
  fetchCogsForRange,
  fetchOrgRows,
  vnDateOf,
  giamGiaHoaDon,
  giaVonBinhQuanCoSo,
  giaTriDongKho,
  soLuongCoSoDongHd,
  type InvoiceLineRow,
  type RevenueInvoiceRow,
  type StockExportLineRow,
  type ReturnSummaryRow as ReturnRowMeta,
} from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import { errorMessage } from "@/lib/errors"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { ByTimeView, type DayBucket } from "./_views/by-time"
import { ProfitByTimeView, type ProfitByDayRow } from "./_views/by-profit"
import { DiscountView, type DiscountRow } from "./_views/by-discount"
import { ReturnsView, type ReturnSummaryRow } from "./_views/by-returns"
import { EmployeeView, type EmployeeRow } from "./_views/by-employee"

type Variant = "time" | "profit" | "discount" | "returns" | "employee"

const VARIANTS = [
  { key: "time" as const, label: "Thời gian" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "discount" as const, label: "Giảm giá HĐ" },
  { key: "returns" as const, label: "Trả hàng" },
  { key: "employee" as const, label: "Nhân viên" },
] as const

interface CustomerRow {
  id: string
  store_name: string
}
/** Mặt hàng: NCC + đơn vị quy đổi (dòng hóa đơn thiếu hệ số chụp mới cần). */
type SanPhamBaoCao = SanPhamQuyDoi & { id: string; primary_supplier_id: string | null }
interface UserRow {
  id: string
  full_name: string
  role: string
}
const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ DN",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "Thủ kho",
  driver: "Tài xế",
}

export default function SalesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("time")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returns, setReturns] = useState<ReturnRowMeta[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [stockLines, setStockLines] = useState<StockExportLineRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [productSupplierMap, setProductSupplierMap] = useState<Map<string, string | null>>(new Map())
  const [productMap, setProductMap] = useState<Map<string, SanPhamBaoCao>>(new Map())
  const [supplierFilter, setSupplierFilter] = useState<string[]>([])
  const [priceListFilter, setPriceListFilter] = useState<string[]>([])
  const [routeFilter, setRouteFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  // Customer → group_id map (for bảng giá / kênh bán filtering on orders)
  const [customerGroupMap, setCustomerGroupMap] = useState<Map<string, string | null>>(new Map())
  const [customerRouteMap, setCustomerRouteMap] = useState<Map<string, string | null>>(new Map())

  const load = useCallback(async () => {
    if (!user?.org_id) return
    /**
     * ⚠ ĐỌC HỎNG THÌ NÓI RA. Bản cũ đọc phiếu xuất và dòng phiếu kho trần
     *   (1.000 dòng, `.in` cả danh sách id — URL quá dài), lỗi chỉ
     *   `console.error`, dòng kho thành [] → giá vốn 0, lãi 100% ở tab
     *   Lợi nhuận và Nhân viên. Nay đi chung đường giá vốn với màn Tài
     *   chính (`fetchCogsForRange`), hỏng thì ném và dải báo thay bảng số.
     */
    try {
      setLoading(true)
      setLoadError(null)
      const orgId = user.org_id
      const [invoiceRes, returnsRes, customersRes, usersRes, cogsRes, suppliersRes, productsRes] = await Promise.all([
        fetchRevenueInvoicesDu(supabase, orgId, range),
        fetchReturnsRowsDu(supabase, orgId, range),
        fetchOrgRows<CustomerRow & { group_id: string | null; channel: string | null }>(
          supabase, "customers", orgId, "id, store_name, group_id, channel", "đọc khách hàng"
        ),
        fetchOrgRows<UserRow>(supabase, "users", orgId, "id, full_name, role", "đọc nhân viên"),
        fetchCogsForRange(supabase, orgId, range),
        fetchOrgRows<{ id: string; name: string }>(supabase, "suppliers", orgId, "id, name", "đọc nhà cung cấp"),
        fetchOrgRows<SanPhamBaoCao>(
          supabase, "products", orgId, "id, base_unit, primary_supplier_id, units:product_units(unit_name, conversion)", "đọc mặt hàng"
        ),
      ])
      const linesList = await fetchInvoiceLines(supabase, invoiceRes.rows.map((o) => o.id))
      setTruncated(
        invoiceRes.truncated || returnsRes.truncated || customersRes.truncated || usersRes.truncated ||
          cogsRes.truncated || suppliersRes.truncated || productsRes.truncated
      )
      setInvoices(invoiceRes.rows)
      setLines(linesList)
      setReturns(returnsRes.rows)
      setCustomers(customersRes.rows)
      const groupMap = new Map<string, string | null>()
      const routeMap = new Map<string, string | null>()
      for (const c of customersRes.rows) {
        groupMap.set(c.id, c.group_id)
        routeMap.set(c.id, c.channel)
      }
      setCustomerGroupMap(groupMap)
      setCustomerRouteMap(routeMap)
      setUsers(usersRes.rows)
      setStockLines(cogsRes.lines)
      setSuppliers(suppliersRes.rows.slice().sort((x, y) => x.name.localeCompare(y.name, "vi")))
      const psMap = new Map<string, string | null>()
      const spMap = new Map<string, SanPhamBaoCao>()
      for (const p of productsRes.rows) {
        psMap.set(p.id, p.primary_supplier_id)
        spMap.set(p.id, p)
      }
      setProductSupplierMap(psMap)
      setProductMap(spMap)
    } catch (err) {
      setLoadError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  // §3.2 — apply NCC filter (chọn nhiều). Giữ lại các dòng có
  // lines whose product's primary_supplier_id matches; an order keeps
  // appearing if it still has ≥ 1 matching line. Returns are filtered
  // similarly via their lines (return_lines product_id) — but since we
  // only have summary `returns` here without per-line products, we
  // skip return filter when NCC is selected (small acceptable
  // limitation; most NCC-focused use cases care about sales side).
  const filteredLines = useMemo(() => {
    if (supplierFilter.length === 0) return lines
    return lines.filter((l) => supplierFilter.includes(productSupplierMap.get(l.product_id) || ""))
  }, [lines, supplierFilter, productSupplierMap])

  const filteredInvoices = useMemo<RevenueInvoiceRow[]>(() => {
    let result = invoices
    if (supplierFilter.length > 0) {
      const invoiceIdsWithLines = new Set(filteredLines.map((l) => l.invoice_id))
      result = result.filter((o) => invoiceIdsWithLines.has(o.id))
    }
    if (priceListFilter.length > 0) {
      result = result.filter((o) => priceListFilter.includes(customerGroupMap.get(o.customer_id) || ""))
    }
    if (routeFilter.length > 0) {
      const matchVals = new Set<string>()
      for (const rid of routeFilter) {
        const route = catalogs.routes.find((r) => r.id === rid)
        for (const v of [route?.id, route?.label, route?.hint]) if (v) matchVals.add(v)
      }
      result = result.filter((o) => {
        const ch = customerRouteMap.get(o.customer_id)
        return ch ? matchVals.has(ch) : false
      })
    }
    return result
  }, [
    invoices,
    supplierFilter,
    filteredLines,
    priceListFilter,
    customerGroupMap,
    routeFilter,
    catalogs.routes,
    customerRouteMap,
  ])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  // -------------------- Thời gian --------------------
  const timeBuckets: DayBucket[] = useMemo(() => {
    const map = new Map<string, DayBucket>()
    for (const o of filteredInvoices) {
      const d = String(o.invoice_date).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, returnValue: 0, netRevenue: 0, invoices: [] }
      e.revenue += Number(o.total || 0)
      const code = o.invoice_code
      if (
        !search ||
        viIncludes(code, viNormalize(search)) ||
        viIncludes((customerMap.get(o.customer_id)?.store_name || ""), viNormalize(search))
      ) {
        e.invoices.push({
          id: o.id,
          code,
          time: new Date(o.invoice_date).toLocaleString("vi-VN"),
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          total: Number(o.total || 0),
        })
      }
      map.set(d, e)
    }
    for (const r of returns) {
      const d = String(r.created_at).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, returnValue: 0, netRevenue: 0, invoices: [] }
      e.returnValue += Number(r.credit_note_amount || 0)
      map.set(d, e)
    }
    return Array.from(map.values())
      .map((b) => ({ ...b, netRevenue: b.revenue - b.returnValue }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredInvoices, returns, customerMap, search])

  // -------------------- Lợi nhuận --------------------
  const profitRows: ProfitByDayRow[] = useMemo(() => {
    // doanh thu theo ngày HÓA ĐƠN (invoice_date)
    const map = new Map<string, ProfitByDayRow>()
    for (const o of filteredInvoices) {
      const d = String(o.invoice_date).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      e.revenue += Number(o.total || 0)
      map.set(d, e)
    }
    // cogs per day from posted export entries
    // Dòng từ `fetchCogsForRange` đều là phiếu XUẤT đã ghi sổ; xếp cột theo
    // ngày Việt Nam, cùng mốc với kỳ đã đọc.
    for (const l of stockLines) {
      if (!l.posted_at) continue
      const d = vnDateOf(l.posted_at)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      // SL cơ sở × giá vốn mỗi đơn vị cơ sở (`fetchCogsForRange` đã quy đổi).
      e.cogs += giaTriDongKho(l)
      map.set(d, e)
    }
    return Array.from(map.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredInvoices, stockLines])

  // -------------------- Giảm giá HĐ --------------------
  const discountRows: DiscountRow[] = useMemo(() => {
    // Hóa đơn không có cột giảm giá: giảm = Σ dòng − subtotal (mig 183).
    // Cộng trên MỌI dòng của tờ, không phải dòng đã lọc NCC.
    const dongTheoHd = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      const a = dongTheoHd.get(l.invoice_id) || []
      a.push(l)
      dongTheoHd.set(l.invoice_id, a)
    }
    return filteredInvoices
      .map((o) => ({ o, giam: giamGiaHoaDon(o, dongTheoHd.get(o.id) || []) }))
      .filter(({ giam }) => giam > 0)
      .filter(({ o }) => {
        if (!search) return true
        const q = viNormalize(search)
        return (
          viIncludes(o.invoice_code, q) ||
          viIncludes((customerMap.get(o.customer_id)?.store_name || ""), q)
        )
      })
      .map(({ o, giam }) => {
        // Tạm tính = tiền hàng TRƯỚC giảm giá cả đơn.
        const subtotal = Number(o.subtotal || 0) + giam
        return {
          id: o.id,
          order_code: o.invoice_code,
          order_date: o.invoice_date,
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          subtotal,
          discount: giam,
          total: Number(o.total || 0),
          pct: subtotal > 0 ? (giam / subtotal) * 100 : 0,
        }
      })
      .sort((a, b) => b.discount - a.discount)
  }, [filteredInvoices, lines, customerMap, search])

  // -------------------- Trả hàng --------------------
  const returnsRows: ReturnSummaryRow[] = useMemo(() => {
    return returns
      .filter((r) => {
        if (!search) return true
        return (customerMap.get(r.customer_id)?.store_name || "")
          .toLowerCase()
          .includes(search.toLowerCase())
      })
      .map((r) => ({
        id: r.id,
        date: r.created_at,
        customer: customerMap.get(r.customer_id)?.store_name || "—",
        reason: "—", // table doesn't include reason in our shape
        status: r.status,
        amount: Number(r.credit_note_amount || 0),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [returns, customerMap, search])

  // -------------------- Nhân viên --------------------
  const employeeRows: EmployeeRow[] = useMemo(() => {
    const m = new Map<string, EmployeeRow>()
    for (const o of filteredInvoices) {
      const u = userMap.get(o.sales_user_id)
      const e = m.get(o.sales_user_id) || {
        id: o.sales_user_id,
        name: u?.full_name || "—",
        role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
        orders: 0,
        revenue: 0,
        cogs: 0,
        profit: 0,
        aov: 0,
      }
      e.orders += 1
      e.revenue += Number(o.total || 0)
      m.set(o.sales_user_id, e)
    }
    // attribute COGS by line aggregated to order
    const lineByInvoice = new Map<string, InvoiceLineRow[]>()
    for (const l of filteredLines) {
      const a = lineByInvoice.get(l.invoice_id) || []
      a.push(l)
      lineByInvoice.set(l.invoice_id, a)
    }
    // Giá vốn bình quân mỗi đơn vị cơ sở (dòng từ `fetchCogsForRange` đã là SL cơ sở).
    const avgCost = giaVonBinhQuanCoSo(stockLines)
    for (const o of filteredInvoices) {
      const e = m.get(o.sales_user_id)
      if (!e) continue
      const ls = lineByInvoice.get(o.id) || []
      let cogs = 0
      for (const l of ls) {
        // SL dòng hóa đơn quy về đơn vị cơ sở trước khi nhân giá vốn cơ sở.
        cogs += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCost.get(l.product_id) || 0)
      }
      e.cogs += cogs
    }
    return Array.from(m.values())
      .map((r) => ({
        ...r,
        profit: r.revenue - r.cogs,
        aov: r.orders > 0 ? r.revenue / r.orders : 0,
      }))
      .filter((r) => {
        if (!search) return true
        return viIncludes(r.name, viNormalize(search))
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredInvoices, filteredLines, stockLines, userMap, productMap, search])

  const handleExport = () => {
    if (variant === "time") {
      const out: (string | number)[][] = [["Thời gian", "Doanh thu", "Giá trị trả", "Doanh thu thuần"]]
      for (const r of timeBuckets) out.push([r.label, r.revenue, -r.returnValue, r.netRevenue])
      downloadXlsx(`bao-cao-banhang-thoigian-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [["Thời gian", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"]]
      for (const r of profitRows) out.push([r.label, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadXlsx(`bao-cao-banhang-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "discount") {
      const out: (string | number)[][] = [["Mã HĐ", "Ngày", "Khách hàng", "Tạm tính", "Giảm giá", "Thành tiền", "% giảm"]]
      for (const r of discountRows)
        out.push([r.order_code, r.order_date, r.customer, r.subtotal, r.discount, r.total, r.pct.toFixed(2)])
      downloadXlsx(`bao-cao-banhang-giamgia-${range.from}-${range.to}`, out)
    } else if (variant === "returns") {
      const out: (string | number)[][] = [["Mã trả", "Ngày", "Khách hàng", "Trạng thái", "Giá trị trả"]]
      for (const r of returnsRows) out.push([r.id, r.date, r.customer, r.status, r.amount])
      downloadXlsx(`bao-cao-banhang-trahang-${range.from}-${range.to}`, out)
    } else {
      const out: (string | number)[][] = [["Nhân viên", "Vai trò", "Số HĐ", "Doanh thu", "Giá vốn", "Lợi nhuận", "TB/HĐ"]]
      for (const r of employeeRows)
        out.push([r.name, r.role, r.orders, r.revenue, r.cogs, r.profit, r.aov])
      downloadXlsx(`bao-cao-banhang-nhanvien-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportShell
      title="Báo cáo bán hàng"
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
          <FilterField label="Tìm kiếm">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mã HĐ, khách hàng, NV…"
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
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
          <FilterField label="Bảng giá (chọn nhiều)">
            <FilterMultiSelect
              value={priceListFilter}
              onChange={setPriceListFilter}
              options={catalogs.customerGroups}
              placeholder="Tất cả bảng giá"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Kênh bán (chọn nhiều)">
            <FilterMultiSelect
              value={routeFilter}
              onChange={setRouteFilter}
              options={catalogs.routes}
              placeholder="Tất cả kênh bán"
              loading={catalogs.loading}
            />
          </FilterField>
          {/* ⚠ Đã BỎ ô "Phương thức bán hàng" (24/09/2026): sổ không ghi thông tin
              này ở đâu (không cột `sales_method`) — chọn là ra rỗng. */}
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
      ) : variant === "time" ? (
        <ByTimeView buckets={timeBuckets} />
      ) : variant === "profit" ? (
        <ProfitByTimeView rows={profitRows} />
      ) : variant === "discount" ? (
        <DiscountView rows={discountRows} />
      ) : variant === "returns" ? (
        <ReturnsView rows={returnsRows} />
      ) : (
        <EmployeeView rows={employeeRows} />
      )}
    </ReportShell>
  )
}
