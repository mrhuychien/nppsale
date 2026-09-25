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
  fetchReturnsRows,
  type RevenueInvoiceRow,
  type ReturnSummaryRow,
} from "@/lib/analytics/sales"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { demHoacNem } from "../../_shared/doc-du"
import { CanhBaoThieuDong, LoiTaiBaoCao } from "../../_shared/loi-tai"

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  group_id: string | null
  created_at: string
  status: string
}

export default function CustomersOverviewPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<RevenueInvoiceRow[]>([])
  const [prevOrders, setPrevOrders] = useState<RevenueInvoiceRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  /**
   * ⚠ Phiếu trả trừ trong kỳ — doanh thu THUẦN = đi − trả (chủ nhà 25/09/2026: "Rà
   *   soát lại toàn bộ doanh số tính bằng số đi - số trả"). Cùng luật công nợ.
   */
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])
  const [prevReturns, setPrevReturns] = useState<ReturnSummaryRow[]>([])

  const [totalCustomers, setTotalCustomers] = useState(0)
  const [newCustomers, setNewCustomers] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    const orgId = user.org_id
    setLoading(true)
    setLoadError(null)
    const prev = previousRange(range)
    const fromIso = new Date(range.from + "T00:00:00").toISOString()
    const toIso = new Date(range.to + "T23:59:59").toISOString()
    /**
     * ⚠ MỘT `try/catch` CHO CẢ LƯỢT. Bản cũ đọc `customers` bằng
     *   `.select()` trơn: "Tổng khách hàng" dừng ở 1.000 và "Khách mới"
     *   đếm thiếu mà không có dòng lỗi nào. Nay:
     *   - HAI CON SỐ ĐẾM đi bằng `count: "exact", head: true` — đúng tuyệt
     *     đối, không tải dòng nào, không phụ thuộc trần 20.000.
     *   - DANH SÁCH (để tra tên và tìm khách Active không mua) đọc đủ theo
     *     trang, mốc `id` duy nhất; chạm trần thì nói ra.
     *   - Đọc hỏng ở BẤT KỲ đâu (kể cả `fetchRevenueInvoices`) → màn hình
     *     báo lỗi, không vẽ số 0.
     */
    try {
      const [orderList, prevOrderList, retRows, prevRetRows, cust, total, moi] = await Promise.all([
        // Doanh thu theo HÓA ĐƠN đã ghi sổ (chủ nhà 24/09/2026), không theo đơn.
        fetchRevenueInvoices(supabase, orgId, range),
        fetchRevenueInvoices(supabase, orgId, prev),
        fetchReturnsRows(supabase, orgId, range),
        fetchReturnsRows(supabase, orgId, prev),
        docDuHoacNem<CustomerRow>(
          (from, to) =>
            supabase
              .from("customers")
              .select("id, store_name, channel, group_id, created_at, status", { count: "exact" })
              .eq("org_id", orgId)
              .order("id")
              .range(from, to),
          "đọc danh sách khách hàng"
        ),
        demHoacNem(
          supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId),
          "đếm khách hàng"
        ),
        demHoacNem(
          supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .gte("created_at", fromIso)
            .lte("created_at", toIso),
          "đếm khách hàng mới"
        ),
      ])
      setOrders(orderList)
      setPrevOrders(prevOrderList)
      setReturns(retRows)
      setPrevReturns(prevRetRows)
      setCustomers(cust.rows)
      setTruncated(cust.truncated)
      setTotalCustomers(total)
      setNewCustomers(moi)
    } catch (e) {
      console.error("[customers/overview] tải lỗi:", e)
      setLoadError(errorMessage(e, "Không tải được số liệu khách hàng"))
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

  const stats = useMemo(() => {
    const buyers = new Set(orders.map((o) => o.customer_id))
    const prevBuyers = new Set(prevOrders.map((o) => o.customer_id))
    // Doanh thu THUẦN = Σ hóa đơn − Σ hàng trả trừ trong kỳ.
    const tra = (rs: ReturnSummaryRow[]) => rs.reduce((s, r) => s + Number(r.credit_note_amount || 0), 0)
    const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0) - tra(returns)
    const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total || 0), 0) - tra(prevReturns)
    return {
      totalCustomers,
      activeCustomers: buyers.size,
      prevActive: prevBuyers.size,
      newCustomers,
      revenue,
      prevRevenue,
      arpu: buyers.size > 0 ? revenue / buyers.size : 0,
      prevArpu: prevBuyers.size > 0 ? prevRevenue / prevBuyers.size : 0,
    }
  }, [orders, prevOrders, returns, prevReturns, totalCustomers, newCustomers])

  const topCustomers = useMemo(() => {
    const cur = new Map<string, { revenue: number; orders: number }>()
    const prev = new Map<string, { revenue: number; orders: number }>()
    for (const o of orders) {
      const e = cur.get(o.customer_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      cur.set(o.customer_id, e)
    }
    for (const o of prevOrders) {
      const e = prev.get(o.customer_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      prev.set(o.customer_id, e)
    }
    // Số THUẦN: trừ hàng trả của từng khách (khách chỉ có trả vẫn có dòng, DT âm).
    const truTra = (m: typeof cur, rs: ReturnSummaryRow[]) => {
      for (const r of rs) {
        const e = m.get(r.customer_id) || { revenue: 0, orders: 0 }
        e.revenue -= Number(r.credit_note_amount || 0)
        m.set(r.customer_id, e)
      }
    }
    truTra(cur, returns)
    truTra(prev, prevReturns)
    return Array.from(cur.entries())
      .map(([cid, e]) => {
        const c = customerMap.get(cid)
        return {
          id: cid,
          name: c?.store_name || "—",
          channel: c?.channel || "—",
          revenue: e.revenue,
          orders: e.orders,
          aov: e.orders > 0 ? e.revenue / e.orders : 0,
          changePct: pctChange(e.revenue, prev.get(cid)?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [orders, prevOrders, returns, prevReturns, customerMap])

  const inactive = useMemo(() => {
    const buyers = new Set(orders.map((o) => o.customer_id))
    return customers
      .filter((c) => c.status === "active" && !buyers.has(c.id))
      .slice(0, 10)
  }, [orders, customers])

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
        <h1 className="text-2xl font-bold text-foreground">Tổng quan khách hàng</h1>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tổng khách hàng"
          value={stats.totalCustomers}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Khách hàng có giao dịch"
          value={stats.activeCustomers}
          format="number"
          changePct={pctChange(stats.activeCustomers, stats.prevActive)}
        />
        <KpiCard
          label="Khách hàng mới trong kỳ"
          value={stats.newCustomers}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Doanh thu thuần / Khách"
          value={stats.arpu}
          format="compactCurrency"
          changePct={pctChange(stats.arpu, stats.prevArpu)}
        />
      </div>

      <TopListCard
        title="Top 10 khách hàng theo doanh thu"
        rows={topCustomers}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "channel", label: "Kênh", render: (r) => r.channel },
          { key: "orders", label: "Số HĐ", align: "right", render: (r) => <NumberCell value={r.orders} /> },
          { key: "revenue", label: "Doanh thu thuần", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "aov", label: "DT TB/HĐ", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Khách hàng Active không phát sinh"
        description="Khách trong tệp Active nhưng không mua hàng trong kỳ"
        rows={inactive}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên khách hàng", render: (r) => <span className="font-medium">{r.store_name}</span> },
          { key: "channel", label: "Kênh", render: (r) => r.channel || "—" },
          { key: "status", label: "Trạng thái", render: (r) => r.status },
        ]}
        emptyText="Tất cả khách hàng active đều có phát sinh"
      />
    </div>
  )
}
