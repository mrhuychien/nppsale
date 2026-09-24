"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField, FilterSearchSelect, FilterMultiSelect } from "@/components/analytics/report-shell"
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
  type ReturnSummaryRow,
  fetchStockEntryLines,
  fetchReturnLines,
  giaVonBinhQuanCoSo,
  soLuongCoSoDongHd,
  COT_SP_QUY_DOI,
  type ReturnLineRow,
  type StockEntryLineRow,
} from "@/lib/analytics/sales"
import {
  congHangBanNhanVien,
  type HangBanNhanVien,
  type HangBanSanPham,
  type SanPhamHangBan,
} from "@/lib/analytics/hang-ban-nhan-vien"
import { ReportLoadNotice } from "../_components/report-load-notice"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { toast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"

type Variant = "sales" | "profit" | "by_customer" | "products" | "summary"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "by_customer" as const, label: "Theo khách hàng" },
  { key: "products" as const, label: "Theo sản phẩm" },
  { key: "summary" as const, label: "Hàng bán theo nhân viên" },
] as const

interface UserRow {
  id: string
  full_name: string
  role: string
  is_active: boolean
}
interface CustomerRow {
  id: string
  store_name: string
  group_id?: string | null
  channel?: string | null
}
/** Mặt hàng kèm đơn vị quy đổi + bảng giá (`COT_SP_QUY_DOI`). */
interface ProductRow extends SanPhamHangBan {
  category?: string | null
  brand?: string | null
}
interface StockEntry {
  id: string
  type: string
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ DN",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "Thủ kho",
  driver: "Tài xế",
}

export default function EmployeesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [productFilter, setProductFilter] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [groupFilter, setGroupFilter] = useState("")
  const [salesUserFilter, setSalesUserFilter] = useState<string[]>([])
  const [routeFilter, setRouteFilter] = useState<string[]>([])
  const catalogs = useFilterCatalogs(user?.org_id)
  const [loading, setLoading] = useState(true)

  // Hóa đơn ĐÃ GHI SỔ trong kỳ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  const [invoices, setInvoices] = useState<RevenueInvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLineRow[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
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
      /* ⚠ PHIẾU XUẤT HỎNG THÌ NÉM. Bản cũ chỉ `console.error` rồi đọc
         `rows` rỗng → giá vốn 0 → lợi nhuận và hoa hồng phồng lên. Bảng
         tra cứu (khách, mặt hàng, người dùng) cũng đọc đủ theo trang. */
      const [invoiceRes, returnsRes, usersRes, customersRes, productsRes, stockEntriesRes] =
        await Promise.all([
          fetchRevenueInvoicesDu(supabase, orgId, range),
          fetchReturnsRowsDu(supabase, orgId, range),
          fetchOrgRows<UserRow>(supabase, "users", orgId, "id, full_name, role, is_active", "đọc nhân viên"),
          fetchOrgRows<CustomerRow>(supabase, "customers", orgId, "id, store_name, group_id, channel", "đọc khách hàng"),
          fetchOrgRows<ProductRow>(
            supabase, "products", orgId,
            `id, sku, name, base_unit, sell_price, category, brand, ${COT_SP_QUY_DOI}`, "đọc mặt hàng"
          ),
          fetchPostedStockEntries(supabase, orgId, range, "export"),
        ])
      const invoiceList = invoiceRes.rows
      const returnsRows = returnsRes.rows
      setTruncated(
        invoiceRes.truncated || returnsRes.truncated || usersRes.truncated ||
          customersRes.truncated || productsRes.truncated || stockEntriesRes.truncated
      )
      const invoiceIds = invoiceList.map((o) => o.id)
      const stockEntryIds = stockEntriesRes.rows.map((e) => e.id)
      const returnIds = returnsRows.map((r) => r.id)
      /* ⚠ CẢ BA ĐỀU PHẢI PHÂN TRANG. Trước đây chỉ `fetchInvoiceLines` phân
         trang, còn dòng kho và dòng trả nằm ngay cạnh trong cùng
         `Promise.all` thì đọc trần — quá 1.000 dòng là API trả đúng 1.000,
         không lỗi, và giá vốn thiếu kéo hoa hồng sai theo. */
      const [linesList, stockLinesList, returnLinesList] = await Promise.all([
        fetchInvoiceLines(supabase, invoiceIds),
        fetchStockEntryLines(supabase, stockEntryIds),
        fetchReturnLines(supabase, returnIds),
      ])
      setInvoices(invoiceList)
      setLines(linesList)
      setReturns(returnsRows)
      setUsers(usersRes.rows)
      setCustomers(customersRes.rows)
      setProducts(productsRes.rows)
      setStockEntries(stockEntriesRes.rows)
      setStockLines(stockLinesList)
      setReturnLines(returnLinesList)
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

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

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

  // Giá vốn bình quân MỖI ĐƠN VỊ CƠ SỞ theo mặt hàng trong kỳ.
  const avgCostMap = useMemo(() => giaVonBinhQuanCoSo(stockLines), [stockLines])

  // Map invoice_id -> [dòng hóa đơn]
  const linesByInvoice = useMemo(() => {
    const m = new Map<string, InvoiceLineRow[]>()
    for (const l of lines) {
      const a = m.get(l.invoice_id) || []
      a.push(l)
      m.set(l.invoice_id, a)
    }
    return m
  }, [lines])

  // Map customer_id -> đơn của khách. Chỉ còn dùng cho phiếu trả CHƯA
  // GÁN nhân viên (lập trước mig 160) — phiếu có ghi tên thì đọc tên.
  const orderByCustomer = useMemo(() => {
    const m = new Map<string, RevenueInvoiceRow[]>()
    for (const o of invoices) {
      const a = m.get(o.customer_id) || []
      a.push(o)
      m.set(o.customer_id, a)
    }
    return m
  }, [invoices])

  const matchSearchUser = useCallback(
    (uid: string) => {
      if (salesUserFilter.length && !salesUserFilter.includes(uid)) return false
      if (!search) return true
      const u = userMap.get(uid)
      if (!u) return false
      return viIncludes(u.full_name, viNormalize(search))
    },
    [search, salesUserFilter, userMap]
  )

  // Filter at the line level — applied where lines are iterated.
  const productPasses = useCallback(
    (productId: string) => {
      if (!productFilter.length && !categoryFilter.length && !brandFilter.length) return true
      const p = productMap.get(productId)
      if (!p) return false
      if (productFilter.length && !productFilter.includes(p.id)) return false
      if (categoryFilter.length && !categoryFilter.includes(p.category || "")) return false
      if (brandFilter.length && !brandFilter.includes(p.brand || "")) return false
      return true
    },
    [productFilter, categoryFilter, brandFilter, productMap]
  )

  // Filter at the customer level (group + route) — applied where orders / customers are iterated.
  const customerPasses = useCallback(
    (customerId: string) => {
      if (!groupFilter && !routeFilter.length) return true
      const c = customerMap.get(customerId)
      if (!c) return false
      if (groupFilter && c.group_id !== groupFilter) return false
      if (routeFilter.length) {
        const matchVals = new Set<string>()
        for (const rid of routeFilter) {
          const route = catalogs.routes.find((r) => r.id === rid)
          for (const v of [route?.id, route?.label, route?.hint]) if (v) matchVals.add(v)
        }
        if (!c.channel || !matchVals.has(c.channel)) return false
      }
      return true
    },
    [groupFilter, routeFilter, customerMap, catalogs.routes]
  )

  // ============== Bán hàng (drill-down theo thời gian) ==============
  type SalesRow = {
    id: string
    name: string
    role: string
    revenue: number
    returnValue: number
    netRevenue: number
    days: { date: string; label: string; revenue: number; returnValue: number; netRevenue: number }[]
  }

  const salesRows: SalesRow[] = useMemo(() => {
    const m = new Map<string, SalesRow>()
    // doanh thu từ hóa đơn đã ghi sổ
    for (const o of invoices) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          returnValue: 0,
          netRevenue: 0,
          days: [],
        } as SalesRow)
      e.revenue += Number(o.total || 0)
      const d = String(o.invoice_date).slice(0, 10)
      const dd = d.split("-")
      const lbl = `${dd[2]}/${dd[1]}/${dd[0]}`
      const dayBucket = e.days.find((x) => x.date === d)
      if (dayBucket) {
        dayBucket.revenue += Number(o.total || 0)
      } else {
        e.days.push({ date: d, label: lbl, revenue: Number(o.total || 0), returnValue: 0, netRevenue: 0 })
      }
      m.set(o.sales_user_id, e)
    }
    /**
     * Quy phiếu trả về nhân viên.
     *
     * ⚠ PHIẾU CÓ GHI TÊN THÌ ĐỌC TÊN, ĐỪNG ĐOÁN (mig 160). Đường vòng
     *   dưới đây — lấy nhân viên của đơn GẦN NHẤT của cùng khách — sai
     *   ngay khi một khách mua của hai nhân viên, và nó sai vào đúng con
     *   số trừ doanh số.
     *
     * ⚠ PHIẾU CHƯA GÁN THÌ VẪN ĐOÁN NHƯ CŨ, KHÔNG BỎ RA NGOÀI SỔ. Mọi
     *   phiếu lập trước mig 160 đều rỗng cột ấy; bỏ chúng đi là doanh số
     *   thuần của cả năm ngoái tự nhiên tăng lên, không ai hiểu vì sao.
     */
    for (const r of returns) {
      let uid = r.sales_user_id ?? ""
      if (!uid) {
        const ords = orderByCustomer.get(r.customer_id) || []
        if (ords.length === 0) continue
        uid = ords.reduce((a, b) => (a.invoice_date > b.invoice_date ? a : b)).sales_user_id
      }
      if (!matchSearchUser(uid)) continue
      const u = userMap.get(uid)
      const e =
        m.get(uid) ||
        ({
          id: uid,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          returnValue: 0,
          netRevenue: 0,
          days: [],
        } as SalesRow)
      const amt = Number(r.credit_note_amount || 0)
      e.returnValue += amt
      const d = String(r.created_at).slice(0, 10)
      const dd = d.split("-")
      const lbl = `${dd[2]}/${dd[1]}/${dd[0]}`
      const dayBucket = e.days.find((x) => x.date === d)
      if (dayBucket) {
        dayBucket.returnValue += amt
      } else {
        e.days.push({ date: d, label: lbl, revenue: 0, returnValue: amt, netRevenue: 0 })
      }
      m.set(uid, e)
    }
    return Array.from(m.values())
      .map((r) => ({
        ...r,
        netRevenue: r.revenue - r.returnValue,
        days: r.days
          .map((d) => ({ ...d, netRevenue: d.revenue - d.returnValue }))
          .sort((a, b) => b.date.localeCompare(a.date)),
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [invoices, returns, orderByCustomer, userMap, matchSearchUser, customerPasses, productPasses])

  // ============== Lợi nhuận ==============
  type ProfitRow = {
    id: string
    name: string
    role: string
    orders: number
    revenue: number
    cogs: number
    profit: number
    margin: number
  }
  const profitRows: ProfitRow[] = useMemo(() => {
    const m = new Map<string, ProfitRow>()
    for (const o of invoices) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          orders: 0,
          revenue: 0,
          cogs: 0,
          profit: 0,
          margin: 0,
        } as ProfitRow)
      e.orders += 1
      e.revenue += Number(o.total || 0)
      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        // SL cơ sở × giá vốn mỗi đơn vị cơ sở.
        e.cogs += soLuongCoSoDongHd(l, productMap.get(l.product_id)) * (avgCostMap.get(l.product_id) || 0)
      }
      m.set(o.sales_user_id, e)
    }
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [invoices, linesByInvoice, avgCostMap, userMap, productMap, matchSearchUser, customerPasses, productPasses])

  // ============== Hàng bán theo nhân viên ==============
  type EmployeeProductRow = {
    id: string
    name: string
    role: string
    revenue: number
    qty: number
    products: {
      id: string
      sku: string
      name: string
      qty: number
      revenue: number
      customers: { id: string; store_name: string; qty: number; revenue: number }[]
    }[]
  }
  const employeeProductRows: EmployeeProductRow[] = useMemo(() => {
    const m = new Map<string, EmployeeProductRow>()
    for (const o of invoices) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          products: [],
        } as EmployeeProductRow)
      e.revenue += Number(o.total || 0)
      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        let pr = e.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, qty: 0, revenue: 0, customers: [] }
          e.products.push(pr)
        }
        // SL quy về đơn vị cơ sở trước khi cộng (3 thùng + 5 hộp ≠ 8).
        const qty = soLuongCoSoDongHd(l, prod)
        pr.qty += qty
        pr.revenue += Number(l.line_total || 0)
        e.qty += qty
        const c = customerMap.get(o.customer_id)
        let cust = pr.customers.find((x) => x.id === o.customer_id)
        if (!cust) {
          cust = {
            id: o.customer_id,
            store_name: c?.store_name || "—",
            qty: 0,
            revenue: 0,
          }
          pr.customers.push(cust)
        }
        cust.qty += qty
        cust.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.revenue - a.revenue)
      for (const p of e.products) p.customers.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [invoices, linesByInvoice, userMap, customerMap, productMap, matchSearchUser, customerPasses, productPasses])

  // ============== Theo khách hàng (NV → KH → mặt hàng) ==============
  type EmployeeCustomerRow = {
    id: string
    name: string
    role: string
    revenue: number
    qty: number
    customers: {
      id: string
      store_name: string
      orders: number
      qty: number
      revenue: number
      products: { id: string; sku: string; name: string; qty: number; revenue: number }[]
    }[]
  }
  const employeeCustomerRows: EmployeeCustomerRow[] = useMemo(() => {
    const m = new Map<string, EmployeeCustomerRow>()
    for (const o of invoices) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const u = userMap.get(o.sales_user_id)
      const e =
        m.get(o.sales_user_id) ||
        ({
          id: o.sales_user_id,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          revenue: 0,
          qty: 0,
          customers: [],
        } as EmployeeCustomerRow)
      e.revenue += Number(o.total || 0)

      let cust = e.customers.find((x) => x.id === o.customer_id)
      if (!cust) {
        const c = customerMap.get(o.customer_id)
        cust = {
          id: o.customer_id,
          store_name: c?.store_name || "—",
          orders: 0,
          qty: 0,
          revenue: 0,
          products: [],
        }
        e.customers.push(cust)
      }
      cust.orders += 1
      cust.revenue += Number(o.total || 0)

      const ls = linesByInvoice.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        const qty = soLuongCoSoDongHd(l, prod)
        cust.qty += qty
        e.qty += qty
        let pr = cust.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, qty: 0, revenue: 0 }
          cust.products.push(pr)
        }
        pr.qty += qty
        pr.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    for (const e of Array.from(m.values())) {
      e.customers.sort((a, b) => b.revenue - a.revenue)
      for (const c of e.customers) c.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [invoices, linesByInvoice, userMap, customerMap, productMap, matchSearchUser, customerPasses, productPasses])

  // ============== Hàng bán theo nhân viên (summary 9 cột) ==============
  // SL quy về đơn vị cơ sở, niêm yết theo giá của đúng đơn vị dòng — `congHangBanNhanVien`.
  type SummaryProduct = HangBanSanPham
  type SummaryRow = Omit<HangBanNhanVien, "products"> & { name: string; role: string; products: SummaryProduct[] }

  const employeeSummaryRows: SummaryRow[] = useMemo(() => {
    const ban: { uid: string; line: InvoiceLineRow }[] = []
    for (const o of invoices) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      for (const l of linesByInvoice.get(o.id) || []) {
        if (!productPasses(l.product_id)) continue
        ban.push({ uid: o.sales_user_id, line: l })
      }
    }

    /**
     * Quy dòng hàng trả về nhân viên — CÙNG MỘT LUẬT với bảng doanh số
     * phía trên, không được lệch. Phiếu có ghi tên thì đọc tên (mig
     * 160); chưa gán thì mới đoán theo đơn gần nhất của cùng khách.
     *
     * ⚠ HAI BẢNG LỆCH LUẬT LÀ HAI CON SỐ TRẢ HÀNG KHÁC NHAU TRÊN CÙNG
     *   MỘT TRANG, và không ai biết tin bảng nào.
     */
    const lastSalesUserByCustomer = new Map<string, string>()
    const sortedOrders = [...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))
    for (const o of sortedOrders) {
      if (!lastSalesUserByCustomer.has(o.customer_id)) {
        lastSalesUserByCustomer.set(o.customer_id, o.sales_user_id)
      }
    }
    const returnIdToSalesUser = new Map<string, string>()
    for (const r of returns) {
      const uid = r.sales_user_id || lastSalesUserByCustomer.get(r.customer_id)
      if (uid) returnIdToSalesUser.set(r.id, uid)
    }
    const tra: { uid: string; line: ReturnLineRow }[] = []
    for (const rl of returnLines) {
      const uid = returnIdToSalesUser.get(rl.return_id)
      if (!uid || !matchSearchUser(uid)) continue
      tra.push({ uid, line: rl })
    }

    return congHangBanNhanVien({ ban, tra, sanPham: productMap }).map((r) => {
      const u = userMap.get(r.id)
      return { ...r, name: u?.full_name || "—", role: ROLE_LABEL[u?.role || ""] || u?.role || "—" }
    })
  }, [invoices, linesByInvoice, returns, returnLines, userMap, productMap, matchSearchUser, customerPasses, productPasses])

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Người bán", "Vai trò", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows)
        out.push([r.name, r.role, r.revenue, -r.returnValue, r.netRevenue])
      downloadXlsx(`bao-cao-nv-banhang-${range.from}-${range.to}`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Người bán", "Vai trò", "Số HĐ", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows)
        out.push([r.name, r.role, r.orders, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadXlsx(`bao-cao-nv-loinhuan-${range.from}-${range.to}`, out)
    } else if (variant === "by_customer") {
      const out: (string | number)[][] = [
        ["Nhân viên", "Khách hàng", "Mã hàng", "Tên hàng", "SL", "Doanh thu"],
      ]
      for (const e of employeeCustomerRows) {
        for (const c of e.customers) {
          for (const p of c.products) {
            out.push([e.name, c.store_name, p.sku, p.name, p.qty, p.revenue])
          }
        }
      }
      downloadXlsx(`bao-cao-nv-theo-khach-${range.from}-${range.to}`, out)
    } else if (variant === "products") {
      const out: (string | number)[][] = [
        ["Nhân viên", "Mã hàng", "Tên hàng", "Khách hàng", "SL", "Doanh thu"],
      ]
      for (const e of employeeProductRows) {
        for (const p of e.products) {
          for (const c of p.customers) {
            out.push([e.name, p.sku, p.name, c.store_name, c.qty, c.revenue])
          }
        }
      }
      downloadXlsx(`bao-cao-nv-theo-sanpham-${range.from}-${range.to}`, out)
    } else if (variant === "summary") {
      const out: (string | number)[][] = [
        [
          "Người bán",
          "Mã hàng",
          "Tên hàng",
          "Đơn vị",
          "SL bán",
          "Giá trị niêm yết",
          "Doanh thu",
          "Chênh lệch",
          "SL trả",
          "Giá trị trả",
          "Doanh thu thuần",
        ],
      ]
      for (const r of employeeSummaryRows) {
        // Tổng hợp NV (không có mã hàng)
        out.push([
          r.name,
          "",
          "(Tổng hợp)",
          "",
          r.qty,
          r.listed,
          r.revenue,
          r.diff,
          r.returnQty,
          -r.returnValue,
          r.netRevenue,
        ])
        for (const p of r.products) {
          out.push([
            r.name,
            p.sku,
            p.name,
            p.unit,
            p.qty,
            p.listed,
            p.revenue,
            p.diff,
            p.returnQty,
            -p.returnValue,
            p.netRevenue,
          ])
        }
      }
      downloadXlsx(`bao-cao-nv-hangban-summary-${range.from}-${range.to}`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  // suppress unused warning
  void stockEntries

  const totalsSales = salesRows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  const totalsProfit = profitRows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )
  const totalsProducts = employeeProductRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, revenue: acc.revenue + r.revenue }),
    { qty: 0, revenue: 0 }
  )
  const totalsByCustomer = employeeCustomerRows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      revenue: acc.revenue + r.revenue,
      customers: acc.customers + r.customers.length,
    }),
    { qty: 0, revenue: 0, customers: 0 }
  )

  return (
    <ReportShell
      title="Báo cáo nhân viên"
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
          <FilterField label="Hàng hóa (chọn nhiều)">
            <FilterMultiSelect
              value={productFilter}
              onChange={setProductFilter}
              options={catalogs.products}
              placeholder="Tất cả hàng hóa"
              loading={catalogs.loading}
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
          <FilterField label="Nhóm hàng / Bảng giá">
            <FilterSearchSelect
              value={groupFilter}
              onChange={setGroupFilter}
              options={catalogs.customerGroups}
              placeholder="Chọn nhóm hàng"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Người bán (chọn nhiều)">
            <FilterMultiSelect
              value={salesUserFilter}
              onChange={setSalesUserFilter}
              options={catalogs.salesUsers}
              placeholder="Tất cả người bán"
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
          <FilterField label="Tìm tự do">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên NV (tự do)"
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
        <ReportTable
          rows={salesRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
            { key: "ret", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? <span className="text-error">-{formatCurrency(r.returnValue)}</span> : "0") },
            { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${salesRows.length}`, colSpan: 2 },
                { content: formatCurrency(totalsSales.revenue), align: "right" },
                {
                  content:
                    totalsSales.returnValue > 0
                      ? `-${formatCurrency(totalsSales.returnValue)}`
                      : "0",
                  align: "right",
                  className: "text-error",
                },
                { content: formatCurrency(totalsSales.netRevenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#ecfdf3]/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                        Không có ngày phát sinh
                      </td>
                    </tr>
                  ) : (
                    r.days.map((d) => (
                      <tr key={d.date} className="border-t border-border/30">
                        <td className="px-3 py-1.5 text-primary">{d.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(d.revenue)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {d.returnValue > 0 ? <span className="text-error">-{formatCurrency(d.returnValue)}</span> : "0"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {formatCurrency(d.netRevenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : variant === "profit" ? (
        <ReportTable
          rows={profitRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "or", label: "Số HĐ", align: "right", render: (r) => r.orders },
            { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
            { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
            { key: "profit", label: "Lợi nhuận", align: "right", render: (r) => <span className={r.profit >= 0 ? "font-semibold text-tertiary" : "font-semibold text-error"}>{formatCurrency(r.profit)}</span> },
            { key: "m", label: "Biên LN", align: "right", render: (r) => `${r.margin.toFixed(1)}%` },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${profitRows.length}`, colSpan: 2 },
                { content: totalsProfit.orders, align: "right" },
                { content: formatCurrency(totalsProfit.revenue), align: "right" },
                { content: formatCurrency(totalsProfit.cogs), align: "right" },
                { content: formatCurrency(totalsProfit.profit), align: "right", className: "text-primary" },
                {
                  content: `${
                    totalsProfit.revenue > 0
                      ? ((totalsProfit.profit / totalsProfit.revenue) * 100).toFixed(1)
                      : "0.0"
                  }%`,
                  align: "right",
                },
              ]}
            />
          }
        />
      ) : variant === "by_customer" ? (
        <ReportTable
          rows={employeeCustomerRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "ck", label: "Số khách", align: "right", render: (r) => r.customers.length },
            { key: "qty", label: "Tổng SL", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
            { key: "rev", label: "Doanh thu", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeCustomerRows.length}`, colSpan: 2 },
                { content: totalsByCustomer.customers, align: "right" },
                { content: totalsByCustomer.qty.toLocaleString("vi-VN"), align: "right" },
                { content: formatCurrency(totalsByCustomer.revenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="space-y-2">
              {r.customers.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nhân viên này chưa có khách hàng
                </p>
              ) : (
                r.customers.map((c) => (
                  <div key={c.id} className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-border/40 bg-[#ecfdf3]/60 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.store_name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({c.orders} HĐ)
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        SL:{" "}
                        <span className="font-semibold text-foreground">
                          {c.qty.toLocaleString("vi-VN")}
                        </span>
                        <span className="mx-2">·</span>
                        Doanh thu:{" "}
                        <span className="font-semibold text-primary">
                          {formatCurrency(c.revenue)}
                        </span>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">
                            Mã hàng
                          </th>
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">
                            Tên hàng
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">
                            SL
                          </th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">
                            Doanh thu
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.products.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3 py-2 text-center text-xs text-muted-foreground"
                            >
                              Không có dòng hàng
                            </td>
                          </tr>
                        ) : (
                          c.products.map((p) => (
                            <tr key={p.id} className="border-t border-border/30">
                              <td className="px-3 py-1.5 font-mono text-xs text-primary">
                                {p.sku}
                              </td>
                              <td className="px-3 py-1.5">{p.name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {p.qty.toLocaleString("vi-VN")}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatCurrency(p.revenue)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}
        />
      ) : variant === "summary" ? (
        <ReportTable
          rows={employeeSummaryRows}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "name",
              label: "Người bán",
              render: (r) => <span className="font-medium text-primary">{r.name}</span>,
            },
            {
              key: "qty",
              label: "SL bán",
              align: "right",
              render: (r) => r.qty.toLocaleString("vi-VN"),
            },
            {
              key: "unit",
              label: "Đơn vị",
              render: () => <span className="text-muted-foreground">—</span>,
            },
            {
              key: "listed",
              label: "Giá trị niêm yết",
              align: "right",
              render: (r) => formatCurrency(r.listed),
            },
            {
              key: "revenue",
              label: "Doanh thu",
              align: "right",
              render: (r) => formatCurrency(r.revenue),
            },
            {
              key: "diff",
              label: "Chênh lệch",
              align: "right",
              render: (r) => (
                <span
                  className={
                    r.diff > 0
                      ? "text-tertiary"
                      : r.diff < 0
                        ? "text-error"
                        : "text-muted-foreground"
                  }
                >
                  {r.diff === 0 ? "0" : formatCurrency(Math.abs(r.diff))}
                </span>
              ),
            },
            {
              key: "rqty",
              label: "SL trả",
              align: "right",
              render: (r) => (r.returnQty > 0 ? r.returnQty.toLocaleString("vi-VN") : "0"),
            },
            {
              key: "rval",
              label: "Giá trị trả",
              align: "right",
              render: (r) =>
                r.returnValue > 0 ? (
                  <span className="text-error">-{formatCurrency(r.returnValue)}</span>
                ) : (
                  "0"
                ),
            },
            {
              key: "net",
              label: "Doanh thu thuần",
              align: "right",
              render: (r) => (
                <span className="font-semibold text-primary">
                  {formatCurrency(r.netRevenue)}
                </span>
              ),
            },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeSummaryRows.length}` },
                {
                  content: employeeSummaryRows
                    .reduce((s, r) => s + r.qty, 0)
                    .toLocaleString("vi-VN"),
                  align: "right",
                },
                { content: "" },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.listed, 0)
                  ),
                  align: "right",
                },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.revenue, 0)
                  ),
                  align: "right",
                },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.diff, 0)
                  ),
                  align: "right",
                },
                {
                  content: employeeSummaryRows
                    .reduce((s, r) => s + r.returnQty, 0)
                    .toLocaleString("vi-VN"),
                  align: "right",
                },
                {
                  content: (() => {
                    const v = employeeSummaryRows.reduce((s, r) => s + r.returnValue, 0)
                    return v > 0 ? `-${formatCurrency(v)}` : "0"
                  })(),
                  align: "right",
                  className: "text-error",
                },
                {
                  content: formatCurrency(
                    employeeSummaryRows.reduce((s, r) => s + r.netRevenue, 0)
                  ),
                  align: "right",
                  className: "text-primary",
                },
              ]}
            />
          }
          expandable={(r) => (
            <div className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#ecfdf3]/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Tên hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Đơn vị</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL bán</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị niêm yết</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Chênh lệch</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase">DT thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {r.products.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-3 py-2 text-center text-xs text-muted-foreground"
                      >
                        Không có dòng hàng
                      </td>
                    </tr>
                  ) : (
                    r.products.map((p) => (
                      <tr key={p.productId} className="border-t border-border/30">
                        <td className="px-3 py-1.5 font-mono text-xs text-primary">{p.sku}</td>
                        <td className="px-3 py-1.5">{p.name}</td>
                        <td className="px-3 py-1.5">{p.unit || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.qty.toLocaleString("vi-VN")}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatCurrency(p.listed)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatCurrency(p.revenue)}
                        </td>
                        <td
                          className={
                            "px-3 py-1.5 text-right tabular-nums " +
                            (p.diff > 0
                              ? "text-tertiary"
                              : p.diff < 0
                                ? "text-error"
                                : "text-muted-foreground")
                          }
                        >
                          {p.diff === 0 ? "0" : formatCurrency(Math.abs(p.diff))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.returnQty > 0 ? p.returnQty.toLocaleString("vi-VN") : "0"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.returnValue > 0 ? (
                            <span className="text-error">
                              -{formatCurrency(p.returnValue)}
                            </span>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                          {formatCurrency(p.netRevenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        />
      ) : (
        <ReportTable
          rows={employeeProductRows}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Người bán", render: (r) => <span className="font-medium text-primary">{r.name}</span> },
            { key: "role", label: "Vai trò", render: (r) => r.role },
            { key: "skus", label: "Số mặt hàng", align: "right", render: (r) => r.products.length },
            { key: "qty", label: "Tổng SL", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
            { key: "rev", label: "Doanh thu", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
          ]}
          totalsRow={
            <TotalsRow
              cells={[
                { content: `SL người bán: ${employeeProductRows.length}`, colSpan: 3 },
                { content: totalsProducts.qty.toLocaleString("vi-VN"), align: "right" },
                { content: formatCurrency(totalsProducts.revenue), align: "right", className: "text-primary" },
              ]}
            />
          }
          expandable={(r) => (
            <div className="space-y-2">
              {r.products.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nhân viên này chưa có hàng bán
                </p>
              ) : (
                r.products.map((p) => (
                  <div key={p.id} className="rounded-md border border-border/40 bg-background/60 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-border/40 bg-[#ecfdf3]/60 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">{p.sku}</span>
                        <span className="font-medium">{p.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        SL: <span className="font-semibold text-foreground">{p.qty.toLocaleString("vi-VN")}</span>
                        <span className="mx-2">·</span>
                        DT: <span className="font-semibold text-primary">{formatCurrency(p.revenue)}</span>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30">
                          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase">Khách hàng</th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">SL</th>
                          <th className="px-3 py-1.5 text-right text-xs font-semibold uppercase">Doanh thu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.customers.map((c) => (
                          <tr key={c.id} className="border-t border-border/30">
                            <td className="px-3 py-1.5">{c.store_name}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {c.qty.toLocaleString("vi-VN")}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {formatCurrency(c.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}
        />
      )}
    </ReportShell>
  )
}
