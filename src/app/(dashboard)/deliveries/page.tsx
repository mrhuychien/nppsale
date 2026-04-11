"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import { Truck, Plus } from "lucide-react"
import Link from "next/link"
import type { Delivery } from "@/types"

export default function DeliveriesPage() {
  const { user, loading: authLoading } = useRoleGuard("deliveries")
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("deliveries")
        .select("*, driver:users!deliveries_driver_id_fkey(full_name)")
        .order("created_at", { ascending: false })
      setDeliveries((data as Delivery[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Giao hang" description={`${deliveries.length} chuyen giao`}>
        {user && hasPermission(user.role, "deliveries", "create") && (
          <Button onClick={() => router.push("/deliveries/new")}><Plus className="mr-2 h-4 w-4" /> Tao phieu giao</Button>
        )}
      </PageHeader>

      {deliveries.length === 0 ? (
        <EmptyState icon={<Truck className="h-8 w-8 text-muted-foreground" />} title="Chua co chuyen giao" description="Chuyen giao se duoc tao tu don hang da duyet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tuyen</TableHead>
              <TableHead>Tai xe</TableHead>
              <TableHead>Phuong tien</TableHead>
              <TableHead>Bat dau</TableHead>
              <TableHead>Trang thai</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => {
              const statusConfig = DELIVERY_STATUS_MAP[d.status] || { label: d.status, variant: "outline" as const }
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/deliveries/${d.id}`} className="font-medium text-primary hover:underline">
                      {d.route_name || "Chuyen giao"}
                    </Link>
                  </TableCell>
                  <TableCell>{d.driver?.full_name || "-"}</TableCell>
                  <TableCell>{d.vehicle || "-"}</TableCell>
                  <TableCell>{d.started_at ? formatDate(d.started_at) : "-"}</TableCell>
                  <TableCell><Badge variant={statusConfig.variant}>{statusConfig.label}</Badge></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
