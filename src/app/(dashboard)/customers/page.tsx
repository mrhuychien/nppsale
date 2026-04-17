"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { CustomerTable } from "@/components/customers/customer-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Users, MapPin, HandCoins, ClipboardList, Navigation } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { Customer, Receivable, SalesOrder } from "@/types"

export default function CustomersPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [debts, setDebts] = useState<Record<string, number>>({})
  const [visitedToday, setVisitedToday] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const { data: cData } = await supabase
        .from("customers")
        .select("*, group:customer_groups(*)")
        .order("store_name")
      const list = (cData as Customer[]) || []
      setCustomers(list)

      // Unpaid receivables per customer
      const { data: recData } = await supabase
        .from("receivables")
        .select("customer_id, amount, paid, status")
        .neq("status", "paid")
      const debtMap: Record<string, number> = {}
      for (const r of (recData as Pick<Receivable, "customer_id" | "amount" | "paid">[]) || []) {
        const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
        if (outstanding > 0) {
          debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + outstanding
        }
      }
      setDebts(debtMap)

      // Today's orders (visits) per customer
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: orders } = await supabase
        .from("sales_orders")
        .select("customer_id, order_date, created_at")
        .gte("created_at", todayStart.toISOString())
      const visits = new Set<string>()
      for (const o of (orders as Pick<SalesOrder, "customer_id">[]) || []) {
        if (o.customer_id) visits.add(o.customer_id)
      }
      setVisitedToday(visits)

      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = customers.filter((c) => {
    const matchSearch = c.store_name.toLowerCase().includes(search.toLowerCase()) ||
      c.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    const matchChannel = channelFilter === "all" || c.channel === channelFilter
    return matchSearch && matchChannel
  })

  const totalRoute = customers.length
  const visitedCount = customers.filter((c) => visitedToday.has(c.id)).length
  const progressPct = totalRoute > 0 ? Math.round((visitedCount / totalRoute) * 100) : 0

  const handleCheckIn = (c: Customer) => {
    alert(`Đã ghé thăm ${c.store_name}`)
  }

  const handleInventoryCheck = () => {
    alert("Tính năng đang phát triển")
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Khách hàng" description={`${customers.length} khách hàng`}>
        {user && hasPermission(user.role, "customers", "create") && (
          <Button onClick={() => router.push("/customers/new")}><Plus className="mr-2 h-4 w-4" /> Thêm KH</Button>
        )}
      </PageHeader>

      {/* Route progress (visible on all sizes; prominent on mobile) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lộ trình hôm nay</p>
            <p className="text-xl font-black tracking-tight">
              {visitedCount}
              <span className="text-sm font-medium text-muted-foreground"> / {totalRoute} điểm đã ghé</span>
            </p>
          </div>
          <span className="text-sm font-bold text-primary">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tìm tên, SĐT..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Kênh" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="GT">GT</SelectItem>
            <SelectItem value="MT">MT</SelectItem>
            <SelectItem value="HORECA">HORECA</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chưa có khách hàng" description="Bắt đầu bằng cách thêm khách hàng đầu tiên" />
      ) : (
        <>
          {/* Desktop: existing table */}
          <div className="hidden lg:block">
            <CustomerTable customers={filtered} />
          </div>

          {/* Mobile: card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((c) => {
              const debt = debts[c.id] || 0
              const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
              const hasVisited = visitedToday.has(c.id)
              return (
                <div
                  key={c.id}
                  className="relative rounded-xl border bg-card shadow-sm overflow-hidden"
                >
                  <div
                    className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${
                      isBadDebt ? "bg-danger" : hasVisited ? "bg-success" : "bg-primary"
                    }`}
                  />
                  <div
                    className="p-4 pl-5 cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => router.push(`/customers/${c.id}`)}
                  >
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {c.store_name}
                        </h3>
                        {c.owner_name && (
                          <p className="text-xs font-medium text-primary/80 mt-0.5 truncate">
                            {c.owner_name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{c.phone}</p>
                        <div className="flex items-center gap-1 text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <p className="text-xs truncate">{c.address || "-"}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {debt > 0 ? (
                          <Badge variant={isBadDebt ? "danger" : "warning"} className="whitespace-nowrap">
                            {isBadDebt ? "Nợ xấu" : formatCurrency(debt)}
                          </Badge>
                        ) : hasVisited ? (
                          <Badge variant="success" className="whitespace-nowrap">Đã ghé</Badge>
                        ) : (
                          c.channel && <Badge variant="outline">{c.channel}</Badge>
                        )}
                        {debt > 0 && isBadDebt && (
                          <p className="text-[10px] font-bold text-danger mt-1">
                            {formatCurrency(debt)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 border-t divide-x">
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCheckIn(c)
                      }}
                    >
                      <Navigation className="h-3.5 w-3.5" /> Ghé thăm
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-primary hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/receivables/collect?customer=${c.id}`)
                      }}
                    >
                      <HandCoins className="h-3.5 w-3.5" /> Thu tiền
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleInventoryCheck()
                      }}
                    >
                      <ClipboardList className="h-3.5 w-3.5" /> Kiểm tồn
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
