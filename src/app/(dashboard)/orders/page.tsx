"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { OrderTable } from "@/components/orders/order-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Search, ShoppingCart } from "lucide-react"
import type { SalesOrder } from "@/types"

export default function OrdersPage() {
  const { user, loading: authLoading } = useRoleGuard("orders")
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from("sales_orders")
        .select("*, customer:customers(store_name, phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name)")
        .order("created_at", { ascending: false })
      setOrders((data as SalesOrder[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = orders.filter((o) => {
    const matchSearch = o.order_code.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === "all" || o.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Don hang" description={`${orders.length} don hang`}>
        {user && hasPermission(user.role, "orders", "create") && (
          <Button onClick={() => router.push("/orders/new")}><Plus className="mr-2 h-4 w-4" /> Tao don</Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Tim ma don hang..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Trang thai" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tat ca</SelectItem>
            <SelectItem value="draft">Nhap</SelectItem>
            <SelectItem value="confirmed">Da duyet</SelectItem>
            <SelectItem value="picking">Dang lay hang</SelectItem>
            <SelectItem value="delivering">Dang giao</SelectItem>
            <SelectItem value="delivered">Da giao</SelectItem>
            <SelectItem value="cancelled">Da huy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />} title="Chua co don hang" description="Tao don hang dau tien" />
      ) : (
        <OrderTable orders={filtered} />
      )}
    </div>
  )
}
