"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/analytics/kpi-card"
import { MoneyCell, NumberCell, TopListCard } from "@/components/analytics/top-list"
import { cn } from "@/lib/utils"

interface ReceivableRow {
  id: string
  customer_id: string
  sales_user_id: string | null
  amount: number
  paid: number
  due_date: string | null
  status: string
  created_at: string
}

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  credit_limit: number
}

interface UserRow {
  id: string
  full_name: string
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "Chưa đến hạn", min: -Infinity, max: 0 },
  { label: "1-30 ngày", min: 1, max: 30 },
  { label: "31-60 ngày", min: 31, max: 60 },
  { label: "61-90 ngày", min: 61, max: 90 },
  { label: "Trên 90 ngày", min: 91, max: Infinity },
]

function bucketOf(daysOverdue: number): string {
  for (const b of BUCKETS) {
    if (daysOverdue >= b.min && daysOverdue <= b.max) return b.label
  }
  return "Khác"
}

export default function ReceivablesAnalyticsPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [receivables, setReceivables] = useState<ReceivableRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [recvRes, custRes, usersRes] = await Promise.all([
      supabase
        .from("receivables")
        .select("id, customer_id, sales_user_id, amount, paid, due_date, status, created_at")
        .eq("org_id", user.org_id)
        .in("status", ["open", "partial", "overdue"]),
      supabase.from("customers").select("id, store_name, channel, credit_limit").eq("org_id", user.org_id),
      supabase.from("users").select("id, full_name").eq("org_id", user.org_id),
    ])
    setReceivables((recvRes.data as ReceivableRow[]) || [])
    setCustomers((custRes.data as CustomerRow[]) || [])
    setUsers((usersRes.data as UserRow[]) || [])
    setLoading(false)
  }, [user?.org_id, supabase])

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

  const enriched = useMemo(() => {
    const now = Date.now()
    return receivables.map((r) => {
      const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
      const due = r.due_date ? new Date(r.due_date).getTime() : null
      const daysOverdue = due === null ? 0 : Math.ceil((now - due) / 86400000)
      return { ...r, outstanding, daysOverdue }
    })
  }, [receivables])

  const stats = useMemo(() => {
    const totalOutstanding = enriched.reduce((s, r) => s + r.outstanding, 0)
    const overdueCount = enriched.filter((r) => r.daysOverdue > 0).length
    const overdueAmount = enriched.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.outstanding, 0)
    const customerSet = new Set(enriched.filter((r) => r.outstanding > 0).map((r) => r.customer_id))
    return { totalOutstanding, count: enriched.length, overdueCount, overdueAmount, customerCount: customerSet.size }
  }, [enriched])

  const aging = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>()
    for (const r of enriched) {
      const k = bucketOf(r.daysOverdue)
      const e = m.get(k) || { amount: 0, count: 0 }
      e.amount += r.outstanding
      e.count += 1
      m.set(k, e)
    }
    return BUCKETS.map((b) => ({
      label: b.label,
      amount: m.get(b.label)?.amount || 0,
      count: m.get(b.label)?.count || 0,
    }))
  }, [enriched])

  const topCustomers = useMemo(() => {
    const m = new Map<string, { amount: number; count: number; oldestDays: number }>()
    for (const r of enriched) {
      const e = m.get(r.customer_id) || { amount: 0, count: 0, oldestDays: 0 }
      e.amount += r.outstanding
      e.count += 1
      e.oldestDays = Math.max(e.oldestDays, r.daysOverdue)
      m.set(r.customer_id, e)
    }
    return Array.from(m.entries())
      .map(([cid, e]) => {
        const c = customerMap.get(cid)
        return {
          id: cid,
          name: c?.store_name || "—",
          channel: c?.channel || "—",
          creditLimit: Number(c?.credit_limit || 0),
          amount: e.amount,
          count: e.count,
          oldestDays: e.oldestDays,
        }
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15)
  }, [enriched, customerMap])

  const byRep = useMemo(() => {
    const m = new Map<string, { amount: number; count: number; customers: Set<string> }>()
    for (const r of enriched) {
      const uid = r.sales_user_id || "__none__"
      const e = m.get(uid) || { amount: 0, count: 0, customers: new Set() }
      e.amount += r.outstanding
      e.count += 1
      e.customers.add(r.customer_id)
      m.set(uid, e)
    }
    return Array.from(m.entries())
      .map(([uid, e]) => ({
        id: uid,
        name: uid === "__none__" ? "Không có NV" : userMap.get(uid)?.full_name || "—",
        amount: e.amount,
        count: e.count,
        customers: e.customers.size,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [enriched, userMap])

  const total = stats.totalOutstanding || 1

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Công nợ khách hàng</h1>
        <p className="text-sm text-muted-foreground">Số liệu tức thời tại thời điểm hiện tại</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Tổng công nợ" value={stats.totalOutstanding} format="compactCurrency" changePct={null} />
        <KpiCard label="Số phiếu" value={stats.count} format="number" changePct={null} />
        <KpiCard label="Phiếu quá hạn" value={stats.overdueCount} format="number" changePct={null} avgLabel="Giá trị quá hạn" avgValue={stats.overdueAmount} />
        <KpiCard label="Khách hàng có nợ" value={stats.customerCount} format="number" changePct={null} />
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-base font-semibold">Phân tích tuổi nợ (Aging)</h3>
        <div className="space-y-3">
          {aging.map((b) => {
            const pct = total > 0 ? (b.amount / total) * 100 : 0
            const overdue = b.label !== "Chưa đến hạn"
            return (
              <div key={b.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className={cn("font-medium", overdue ? "text-foreground" : "text-muted-foreground")}>
                    {b.label}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{b.count}</span>
                    <span className="mx-1 text-muted-foreground">phiếu •</span>
                    <span className={cn("font-semibold", overdue && "text-error")}>
                      {b.amount.toLocaleString("vi-VN")}đ
                    </span>
                    <span className="ml-1 text-muted-foreground">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className={cn("h-full rounded-full", overdue ? "bg-error" : "bg-tertiary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <TopListCard
        title="Top 15 khách có công nợ cao"
        rows={topCustomers}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "channel", label: "Kênh", render: (r) => r.channel },
          { key: "credit", label: "Hạn mức", align: "right", render: (r) => <MoneyCell value={r.creditLimit} /> },
          { key: "amount", label: "Công nợ", align: "right", render: (r) => <MoneyCell value={r.amount} /> },
          { key: "oldest", label: "Tuổi nợ tối đa", align: "right", render: (r) => (
            <span className={r.oldestDays > 0 ? "font-semibold text-error" : ""}>
              {r.oldestDays > 0 ? `${r.oldestDays} ngày` : "—"}
            </span>
          )},
          { key: "count", label: "Phiếu", align: "right", render: (r) => <NumberCell value={r.count} /> },
        ]}
      />

      <TopListCard
        title="Công nợ theo nhân viên kinh doanh"
        rows={byRep}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Nhân viên", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "customers", label: "Khách hàng", align: "right", render: (r) => <NumberCell value={r.customers} /> },
          { key: "count", label: "Số phiếu", align: "right", render: (r) => <NumberCell value={r.count} /> },
          { key: "amount", label: "Tổng công nợ", align: "right", render: (r) => <MoneyCell value={r.amount} /> },
        ]}
      />
    </div>
  )
}
