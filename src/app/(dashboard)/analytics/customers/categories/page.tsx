"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
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
import { fetchRevenueInvoices, type RevenueInvoiceRow } from "@/lib/analytics/sales"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { CanhBaoThieuDong, LoiTaiBaoCao } from "../../_shared/loi-tai"

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  group_id: string | null
  province: string | null
}

interface CustomerGroupRow {
  id: string
  name: string
}

export default function CustomersCategoriesPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<RevenueInvoiceRow[]>([])
  const [prevOrders, setPrevOrders] = useState<RevenueInvoiceRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const { groups } = useCustomerGroups()

  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    const orgId = user.org_id
    setLoading(true)
    setLoadError(null)
    const prev = previousRange(range)
    /**
     * ⚠ DANH SÁCH KHÁCH PHẢI ĐỦ. Màn này gán doanh thu của từng đơn vào
     *   nhóm / kênh / tỉnh BẰNG CÁCH TRA KHÁCH. Bản cũ đọc `customers` bằng
     *   `.select()` trơn — PostgREST cắt ở 1.000 dòng, nên đơn của khách thứ
     *   1.001 trở đi không tra ra ai và rơi hết vào "Chưa phân nhóm" /
     *   "Không xác định". Tổng vẫn đúng, phân bổ thì sai — loại sai khó
     *   thấy nhất.
     * ⚠ Đọc hỏng ở bất kỳ đâu → báo lỗi, không vẽ bảng số 0.
     */
    try {
      const [orderList, prevOrderList, cust] = await Promise.all([
        // Doanh thu theo HÓA ĐƠN đã ghi sổ (chủ nhà 24/09/2026), không theo đơn.
        fetchRevenueInvoices(supabase, orgId, range),
        fetchRevenueInvoices(supabase, orgId, prev),
        docDuHoacNem<CustomerRow>(
          (from, to) =>
            supabase
              .from("customers")
              .select("id, store_name, channel, group_id, province", { count: "exact" })
              .eq("org_id", orgId)
              .order("id")
              .range(from, to),
          "đọc danh sách khách hàng"
        ),
      ])
      setOrders(orderList)
      setPrevOrders(prevOrderList)
      setCustomers(cust.rows)
      setTruncated(cust.truncated)
    } catch (e) {
      console.error("[customers/categories] tải lỗi:", e)
      setLoadError(errorMessage(e, "Không tải được số liệu phân loại khách hàng"))
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

  const groupMap = useMemo(() => {
    const m = new Map<string, CustomerGroupRow>()
    for (const g of groups) m.set(g.id, g)
    return m
  }, [groups])

  type Row = { id: string; name: string; revenue: number; orders: number; customers: number; changePct: number | null }

  const aggregate = useCallback(
    (extractor: (c: CustomerRow | undefined) => string, label?: (k: string) => string) => {
      const cur = new Map<string, { revenue: number; orders: number; customers: Set<string> }>()
      const prev = new Map<string, { revenue: number; orders: number; customers: Set<string> }>()
      for (const o of orders) {
        const k = extractor(customerMap.get(o.customer_id))
        const e = cur.get(k) || { revenue: 0, orders: 0, customers: new Set() }
        e.revenue += Number(o.total || 0)
        e.orders += 1
        e.customers.add(o.customer_id)
        cur.set(k, e)
      }
      for (const o of prevOrders) {
        const k = extractor(customerMap.get(o.customer_id))
        const e = prev.get(k) || { revenue: 0, orders: 0, customers: new Set() }
        e.revenue += Number(o.total || 0)
        e.orders += 1
        e.customers.add(o.customer_id)
        prev.set(k, e)
      }
      const rows: Row[] = Array.from(cur.entries()).map(([k, e]) => ({
        id: k,
        name: label ? label(k) : k,
        revenue: e.revenue,
        orders: e.orders,
        customers: e.customers.size,
        changePct: pctChange(e.revenue, prev.get(k)?.revenue || 0),
      }))
      return rows.sort((a, b) => b.revenue - a.revenue)
    },
    [orders, prevOrders, customerMap]
  )

  const byGroup = useMemo(
    () =>
      aggregate(
        (c) => c?.group_id || "__none__",
        (k) => (k === "__none__" ? "Chưa phân nhóm" : groupMap.get(k)?.name || "—")
      ),
    [aggregate, groupMap]
  )

  const byChannel = useMemo(
    () => aggregate((c) => c?.channel || "Bán trực tiếp"),
    [aggregate]
  )

  const byProvince = useMemo(
    () => aggregate((c) => c?.province || "Không xác định"),
    [aggregate]
  )

  const totalRevenue = byGroup.reduce((s, r) => s + r.revenue, 0)
  const prevTotalRevenue = byGroup.reduce((s, r) => {
    const p = prevOrders.filter((o) => {
      const cust = customerMap.get(o.customer_id)
      const gid = cust?.group_id || "__none__"
      return gid === r.id
    })
    return s + p.reduce((a, x) => a + Number(x.total || 0), 0)
  }, 0)

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
        <h1 className="text-2xl font-bold text-foreground">Phân loại khách hàng</h1>
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
        <KpiCard label="Tổng doanh thu" value={totalRevenue} format="compactCurrency" changePct={pctChange(totalRevenue, prevTotalRevenue)} />
        <KpiCard label="Số nhóm KH có DT" value={byGroup.length} format="number" changePct={null} />
        <KpiCard label="Số kênh có DT" value={byChannel.length} format="number" changePct={null} />
      </div>

      <TopListCard
        title="Phân tích theo nhóm khách hàng"
        rows={byGroup}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Nhóm khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "customers", label: "Số khách", align: "right", render: (r) => <NumberCell value={r.customers} /> },
          { key: "orders", label: "Số HĐ", align: "right", render: (r) => <NumberCell value={r.orders} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Phân tích theo kênh bán hàng"
        rows={byChannel}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Kênh bán", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "customers", label: "Số khách", align: "right", render: (r) => <NumberCell value={r.customers} /> },
          { key: "orders", label: "Số HĐ", align: "right", render: (r) => <NumberCell value={r.orders} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Phân tích theo tỉnh / thành"
        rows={byProvince}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tỉnh / Thành", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "customers", label: "Số khách", align: "right", render: (r) => <NumberCell value={r.customers} /> },
          { key: "orders", label: "Số HĐ", align: "right", render: (r) => <NumberCell value={r.orders} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />
    </div>
  )
}
