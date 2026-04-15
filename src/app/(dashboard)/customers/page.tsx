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
import { Plus, Search, Users } from "lucide-react"
import type { Customer } from "@/types"

export default function CustomersPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from("customers")
        .select("*, group:customer_groups(*)")
        .order("store_name")
      setCustomers((data as Customer[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = customers.filter((c) => {
    const matchSearch = c.store_name.toLowerCase().includes(search.toLowerCase()) ||
      c.owner_name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    const matchChannel = channelFilter === "all" || c.channel === channelFilter
    return matchSearch && matchChannel
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Khách hàng" description={`${customers.length} khách hàng`}>
        {user && hasPermission(user.role, "customers", "create") && (
          <Button onClick={() => router.push("/customers/new")}><Plus className="mr-2 h-4 w-4" /> Thêm KH</Button>
        )}
      </PageHeader>

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
        <CustomerTable customers={filtered} />
      )}
    </div>
  )
}
