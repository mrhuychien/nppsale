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
  fetchDeliveredOrders,
  fetchOrderLines,
  fetchReturnsRows,
  type SalesOrderLineRow,
  type SalesOrderRow,
  type ReturnSummaryRow,
} from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

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
interface ProductRow {
  id: string
  sku: string
  name: string
  category?: string | null
  brand?: string | null
  base_unit?: string | null
  sell_price?: number | null
}
interface ReturnLineRow {
  return_id: string
  product_id: string
  quantity: number
  line_total: number
}
interface StockEntry {
  id: string
  type: string
}
interface StockEntryLine {
  entry_id: string
  product_id: string
  quantity: number
  unit_cost: number
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

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLine[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const fromIso = `${range.from}T00:00:00Z`
    const toIso = `${range.to}T23:59:59Z`
    const [orderList, returnsRows, usersRes, customersRes, productsRes, stockEntriesRes] =
      await Promise.all([
        fetchDeliveredOrders(supabase, user.org_id, range),
        fetchReturnsRows(supabase, user.org_id, range),
        supabase
          .from("users")
          .select("id, full_name, role, is_active")
          .eq("org_id", user.org_id),
        supabase.from("customers").select("id, store_name, group_id, channel").eq("org_id", user.org_id),
        supabase.from("products").select("id, sku, name, base_unit, sell_price, category, brand").eq("org_id", user.org_id),
        supabase
          .from("stock_entries")
          .select("id, type")
          .eq("org_id", user.org_id)
          .eq("status", "posted")
          .eq("type", "export")
          .gte("posted_at", fromIso)
          .lte("posted_at", toIso),
      ])
    const qErr2 = ([usersRes, customersRes, productsRes, stockEntriesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr2) console.error("[reports/employees] truy vấn lỗi:", qErr2.message)
    const orderIds = orderList.map((o) => o.id)
    const stockEntryIds = ((stockEntriesRes.data as StockEntry[]) || []).map((e) => e.id)
    const returnIds = returnsRows.map((r) => r.id)
    const [linesList, stockLinesRes, returnLinesRes] = await Promise.all([
      fetchOrderLines(supabase, orderIds),
      stockEntryIds.length === 0
        ? Promise.resolve({ data: [] as StockEntryLine[] })
        : supabase
            .from("stock_entry_lines")
            .select("entry_id, product_id, quantity, unit_cost")
            .in("entry_id", stockEntryIds),
      returnIds.length === 0
        ? Promise.resolve({ data: [] as ReturnLineRow[] })
        : supabase
            .from("return_lines")
            .select("return_id, product_id, quantity, line_total")
            .in("return_id", returnIds),
    ])
    const qErr = ([stockLinesRes, returnLinesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[reports/employees] truy vấn lỗi:", qErr.message)
    setOrders(orderList)
    setLines(linesList)
    setReturns(returnsRows)
    setUsers((usersRes.data as UserRow[]) || [])
    setCustomers((customersRes.data as CustomerRow[]) || [])
    setProducts((productsRes.data as ProductRow[]) || [])
    setStockEntries((stockEntriesRes.data as StockEntry[]) || [])
    setStockLines((stockLinesRes.data as StockEntryLine[]) || [])
    setReturnLines((returnLinesRes.data as ReturnLineRow[]) || [])
    setLoading(false)
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

  // Average COGS per product over the period
  const avgCostMap = useMemo(() => {
    const productCogs = new Map<string, { qty: number; value: number }>()
    for (const l of stockLines) {
      const e = productCogs.get(l.product_id) || { qty: 0, value: 0 }
      e.qty += Math.abs(Number(l.quantity || 0))
      e.value += Math.abs(Number(l.quantity || 0)) * Number(l.unit_cost || 0)
      productCogs.set(l.product_id, e)
    }
    const m = new Map<string, number>()
    for (const [pid, v] of Array.from(productCogs.entries())) {
      m.set(pid, v.qty > 0 ? v.value / v.qty : 0)
    }
    return m
  }, [stockLines])

  // Map order_id -> [lines]
  const linesByOrder = useMemo(() => {
    const m = new Map<string, SalesOrderLineRow[]>()
    for (const l of lines) {
      const a = m.get(l.order_id) || []
      a.push(l)
      m.set(l.order_id, a)
    }
    return m
  }, [lines])

  // Map customer_id -> total returns value (used to attribute returns to NV via order's sales_user)
  const orderByCustomer = useMemo(() => {
    const m = new Map<string, SalesOrderRow[]>()
    for (const o of orders) {
      const a = m.get(o.customer_id) || []
      a.push(o)
      m.set(o.customer_id, a)
    }
    return m
  }, [orders])

  const matchSearchUser = useCallback(
    (uid: string) => {
      if (salesUserFilter.length && !salesUserFilter.includes(uid)) return false
      if (!search) return true
      const u = userMap.get(uid)
      if (!u) return false
      return u.full_name.toLowerCase().includes(search.toLowerCase())
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
    // revenue from orders
    for (const o of orders) {
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
      const d = String(o.order_date).slice(0, 10)
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
    // attribute returns to the most recent sales_user that served the customer
    for (const r of returns) {
      const ords = orderByCustomer.get(r.customer_id) || []
      if (ords.length === 0) continue
      const ord = ords.reduce((a, b) => (a.order_date > b.order_date ? a : b))
      if (!matchSearchUser(ord.sales_user_id)) continue
      const u = userMap.get(ord.sales_user_id)
      const e =
        m.get(ord.sales_user_id) ||
        ({
          id: ord.sales_user_id,
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
      m.set(ord.sales_user_id, e)
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
  }, [orders, returns, orderByCustomer, userMap, matchSearchUser, customerPasses, productPasses])

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
    for (const o of orders) {
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
      const ls = linesByOrder.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        e.cogs += Number(l.quantity || 0) * (avgCostMap.get(l.product_id) || 0)
      }
      m.set(o.sales_user_id, e)
    }
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [orders, linesByOrder, avgCostMap, userMap, matchSearchUser, customerPasses, productPasses])

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
    for (const o of orders) {
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
      const ls = linesByOrder.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        let pr = e.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, qty: 0, revenue: 0, customers: [] }
          e.products.push(pr)
        }
        pr.qty += Number(l.quantity || 0)
        pr.revenue += Number(l.line_total || 0)
        e.qty += Number(l.quantity || 0)
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
        cust.qty += Number(l.quantity || 0)
        cust.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.revenue - a.revenue)
      for (const p of e.products) p.customers.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [orders, linesByOrder, userMap, customerMap, productMap, matchSearchUser, customerPasses, productPasses])

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
    for (const o of orders) {
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

      const ls = linesByOrder.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const prod = productMap.get(l.product_id)
        if (!prod) continue
        cust.qty += Number(l.quantity || 0)
        e.qty += Number(l.quantity || 0)
        let pr = cust.products.find((x) => x.id === l.product_id)
        if (!pr) {
          pr = { id: l.product_id, sku: prod.sku, name: prod.name, qty: 0, revenue: 0 }
          cust.products.push(pr)
        }
        pr.qty += Number(l.quantity || 0)
        pr.revenue += Number(l.line_total || 0)
      }
      m.set(o.sales_user_id, e)
    }
    for (const e of Array.from(m.values())) {
      e.customers.sort((a, b) => b.revenue - a.revenue)
      for (const c of e.customers) c.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [orders, linesByOrder, userMap, customerMap, productMap, matchSearchUser, customerPasses, productPasses])

  // ============== Hàng bán theo nhân viên (summary 9 cột) ==============
  // Map customer→sales_user thông qua đơn (returns không tham chiếu trực tiếp
  // sales_user, nên dùng đơn gần nhất của KH trong kỳ để gán).
  type SummaryProduct = {
    productId: string
    sku: string
    name: string
    unit: string
    qty: number
    listed: number
    revenue: number
    diff: number
    returnQty: number
    returnValue: number
    netRevenue: number
  }
  type SummaryRow = {
    id: string
    name: string
    role: string
    qty: number
    listed: number
    revenue: number
    diff: number
    returnQty: number
    returnValue: number
    netRevenue: number
    products: SummaryProduct[]
  }

  const employeeSummaryRows: SummaryRow[] = useMemo(() => {
    const m = new Map<string, SummaryRow & { _byProduct: Map<string, SummaryProduct> }>()

    const ensureRow = (uid: string): SummaryRow & { _byProduct: Map<string, SummaryProduct> } => {
      const existing = m.get(uid)
      if (existing) return existing
      const u = userMap.get(uid)
      const r: SummaryRow & { _byProduct: Map<string, SummaryProduct> } = {
        id: uid,
        name: u?.full_name || "—",
        role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
        qty: 0,
        listed: 0,
        revenue: 0,
        diff: 0,
        returnQty: 0,
        returnValue: 0,
        netRevenue: 0,
        products: [],
        _byProduct: new Map(),
      }
      m.set(uid, r)
      return r
    }

    const ensureProduct = (
      row: SummaryRow & { _byProduct: Map<string, SummaryProduct> },
      productId: string
    ): SummaryProduct => {
      const existing = row._byProduct.get(productId)
      if (existing) return existing
      const p = productMap.get(productId)
      const created: SummaryProduct = {
        productId,
        sku: p?.sku || "—",
        name: p?.name || "—",
        unit: p?.base_unit || "",
        qty: 0,
        listed: 0,
        revenue: 0,
        diff: 0,
        returnQty: 0,
        returnValue: 0,
        netRevenue: 0,
      }
      row._byProduct.set(productId, created)
      row.products.push(created)
      return created
    }

    // Order lines → tính SL bán + Giá trị niêm yết + Doanh thu
    for (const o of orders) {
      if (!matchSearchUser(o.sales_user_id)) continue
      if (!customerPasses(o.customer_id)) continue
      const row = ensureRow(o.sales_user_id)
      const ls = linesByOrder.get(o.id) || []
      for (const l of ls) {
        if (!productPasses(l.product_id)) continue
        const p = productMap.get(l.product_id)
        if (!p) continue
        const qty = Number(l.quantity || 0)
        const unitListPrice = Number(p.sell_price || 0) > 0
          ? Number(p.sell_price)
          : Number(l.unit_price || 0)
        const listed = qty * unitListPrice
        const revenue = Number(l.line_total || 0)
        row.qty += qty
        row.listed += listed
        row.revenue += revenue
        const pr = ensureProduct(row, l.product_id)
        pr.qty += qty
        pr.listed += listed
        pr.revenue += revenue
      }
    }

    // Returns → gán cho NV phục vụ KH gần nhất
    const lineByOrderId = linesByOrder
    const lastSalesUserByCustomer = new Map<string, string>()
    const sortedOrders = [...orders].sort((a, b) => b.order_date.localeCompare(a.order_date))
    for (const o of sortedOrders) {
      if (!lastSalesUserByCustomer.has(o.customer_id)) {
        lastSalesUserByCustomer.set(o.customer_id, o.sales_user_id)
      }
    }
    const returnIdToCustomer = new Map<string, string>()
    for (const r of returns) returnIdToCustomer.set(r.id, r.customer_id)

    for (const rl of returnLines) {
      const cid = returnIdToCustomer.get(rl.return_id)
      if (!cid) continue
      const uid = lastSalesUserByCustomer.get(cid)
      if (!uid || !matchSearchUser(uid)) continue
      const row = ensureRow(uid)
      const qty = Number(rl.quantity || 0)
      const value = Number(rl.line_total || 0)
      row.returnQty += qty
      row.returnValue += value
      const pr = ensureProduct(row, rl.product_id)
      pr.returnQty += qty
      pr.returnValue += value
    }

    // Suppress unused warning
    void lineByOrderId

    // Tính chênh lệch + doanh thu thuần
    for (const row of Array.from(m.values())) {
      row.diff = row.revenue - row.listed
      row.netRevenue = row.revenue - row.returnValue
      for (const p of row.products) {
        p.diff = p.revenue - p.listed
        p.netRevenue = p.revenue - p.returnValue
      }
      row.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [orders, linesByOrder, returns, returnLines, userMap, productMap, matchSearchUser, customerPasses, productPasses])

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
        ["Người bán", "Vai trò", "Số đơn", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"],
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
      {loading ? (
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
            { key: "or", label: "Số đơn", align: "right", render: (r) => r.orders },
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
                          ({c.orders} đơn)
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
