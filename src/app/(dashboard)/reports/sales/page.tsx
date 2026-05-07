"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField } from "@/components/analytics/report-shell"
import { downloadXlsx } from "@/components/analytics/report-frame"
import {
  fetchDeliveredOrders,
  fetchOrderLines,
  fetchReturnsRows,
  type SalesOrderLineRow,
  type SalesOrderRow,
  type ReturnSummaryRow as ReturnRowMeta,
} from "@/lib/analytics/sales"
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
interface UserRow {
  id: string
  full_name: string
  role: string
}
interface StockEntry {
  id: string
  type: string
  status: string
  posted_at: string | null
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

export default function SalesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("time")
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [returns, setReturns] = useState<ReturnRowMeta[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLine[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const fromIso = `${range.from}T00:00:00Z`
    const toIso = `${range.to}T23:59:59Z`
    const [orderList, returnsRows, customersRes, usersRes, stockEntriesRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchReturnsRows(supabase, user.org_id, range),
      supabase.from("customers").select("id, store_name").eq("org_id", user.org_id),
      supabase.from("users").select("id, full_name, role").eq("org_id", user.org_id),
      supabase
        .from("stock_entries")
        .select("id, type, status, posted_at")
        .eq("org_id", user.org_id)
        .eq("status", "posted")
        .eq("type", "export")
        .gte("posted_at", fromIso)
        .lte("posted_at", toIso),
    ])
    const orderIds = orderList.map((o) => o.id)
    const stockEntryIds = ((stockEntriesRes.data as StockEntry[]) || []).map((e) => e.id)
    const [linesList, stockLinesRes] = await Promise.all([
      fetchOrderLines(supabase, orderIds),
      stockEntryIds.length === 0
        ? Promise.resolve({ data: [] as StockEntryLine[] })
        : supabase
            .from("stock_entry_lines")
            .select("entry_id, product_id, quantity, unit_cost")
            .in("entry_id", stockEntryIds),
    ])
    setOrders(orderList)
    setLines(linesList)
    setReturns(returnsRows)
    setCustomers((customersRes.data as CustomerRow[]) || [])
    setUsers((usersRes.data as UserRow[]) || [])
    setStockEntries((stockEntriesRes.data as StockEntry[]) || [])
    setStockLines((stockLinesRes.data as StockEntryLine[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

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

  const stockEntryMap = useMemo(() => {
    const m = new Map<string, StockEntry>()
    for (const e of stockEntries) m.set(e.id, e)
    return m
  }, [stockEntries])

  // -------------------- Thời gian --------------------
  const timeBuckets: DayBucket[] = useMemo(() => {
    const map = new Map<string, DayBucket>()
    for (const o of orders) {
      const d = String(o.order_date).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, returnValue: 0, netRevenue: 0, invoices: [] }
      e.revenue += Number(o.total || 0)
      const code = o.order_code
      if (
        !search ||
        code.toLowerCase().includes(search.toLowerCase()) ||
        (customerMap.get(o.customer_id)?.store_name || "").toLowerCase().includes(search.toLowerCase())
      ) {
        e.invoices.push({
          id: o.id,
          code,
          time: new Date(o.order_date).toLocaleString("vi-VN"),
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
  }, [orders, returns, customerMap, search])

  // -------------------- Lợi nhuận --------------------
  const profitRows: ProfitByDayRow[] = useMemo(() => {
    // revenue per day from delivered orders
    const map = new Map<string, ProfitByDayRow>()
    for (const o of orders) {
      const d = String(o.order_date).slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      e.revenue += Number(o.total || 0)
      map.set(d, e)
    }
    // cogs per day from posted export entries
    for (const l of stockLines) {
      const entry = stockEntryMap.get(l.entry_id)
      if (!entry || entry.type !== "export" || !entry.posted_at) continue
      const d = entry.posted_at.slice(0, 10)
      const dd = d.split("-")
      const label = `${dd[2]}/${dd[1]}/${dd[0]}`
      const e = map.get(d) || { date: d, label, revenue: 0, cogs: 0, profit: 0, margin: 0 }
      e.cogs += Math.abs(Number(l.quantity || 0)) * Number(l.unit_cost || 0)
      map.set(d, e)
    }
    return Array.from(map.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [orders, stockLines, stockEntryMap])

  // -------------------- Giảm giá HĐ --------------------
  const discountRows: DiscountRow[] = useMemo(() => {
    return orders
      .filter((o) => Number(o.discount || 0) > 0)
      .filter((o) => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          o.order_code.toLowerCase().includes(q) ||
          (customerMap.get(o.customer_id)?.store_name || "").toLowerCase().includes(q)
        )
      })
      .map((o) => {
        const subtotal = Number(o.subtotal || 0) || Number(o.total || 0) + Number(o.discount || 0)
        return {
          id: o.id,
          order_code: o.order_code,
          order_date: o.order_date,
          customer: customerMap.get(o.customer_id)?.store_name || "—",
          subtotal,
          discount: Number(o.discount || 0),
          total: Number(o.total || 0),
          pct: subtotal > 0 ? (Number(o.discount || 0) / subtotal) * 100 : 0,
        }
      })
      .sort((a, b) => b.discount - a.discount)
  }, [orders, customerMap, search])

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
    for (const o of orders) {
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
    const lineByOrder = new Map<string, SalesOrderLineRow[]>()
    for (const l of lines) {
      const a = lineByOrder.get(l.order_id) || []
      a.push(l)
      lineByOrder.set(l.order_id, a)
    }
    const productCogs = new Map<string, { qty: number; value: number }>()
    for (const l of stockLines) {
      const entry = stockEntryMap.get(l.entry_id)
      if (!entry || entry.type !== "export") continue
      const e = productCogs.get(l.product_id) || { qty: 0, value: 0 }
      e.qty += Math.abs(Number(l.quantity || 0))
      e.value += Math.abs(Number(l.quantity || 0)) * Number(l.unit_cost || 0)
      productCogs.set(l.product_id, e)
    }
    const avgCost = new Map<string, number>()
    for (const [pid, v] of Array.from(productCogs.entries())) {
      avgCost.set(pid, v.qty > 0 ? v.value / v.qty : 0)
    }
    for (const o of orders) {
      const e = m.get(o.sales_user_id)
      if (!e) continue
      const ls = lineByOrder.get(o.id) || []
      let cogs = 0
      for (const l of ls) {
        cogs += Number(l.quantity || 0) * (avgCost.get(l.product_id) || 0)
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
        return r.name.toLowerCase().includes(search.toLowerCase())
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [orders, lines, stockLines, stockEntryMap, userMap, search])

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
      const out: (string | number)[][] = [["Nhân viên", "Vai trò", "Số đơn", "Doanh thu", "Giá vốn", "Lợi nhuận", "TB/đơn"]]
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
        <FilterField label="Tìm kiếm">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mã HĐ, khách hàng, NV…"
            className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
          />
        </FilterField>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {loading ? (
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
