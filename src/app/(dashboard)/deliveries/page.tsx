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
import { Truck, Plus, Eye } from "lucide-react"
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
      <PageHeader title="Giao hàng" description={`${deliveries.length} chuyến giao`}>
        {user && hasPermission(user.role, "deliveries", "create") && (
          <Button onClick={() => router.push("/deliveries/new")}><Plus className="mr-2 h-4 w-4" /> Tạo phiếu giao</Button>
        )}
      </PageHeader>

      {deliveries.length === 0 ? (
        <EmptyState icon={<Truck className="h-8 w-8 text-muted-foreground" />} title="Chưa có chuyến giao" description="Chuyến giao sẽ được tạo từ đơn hàng đã duyệt" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tuyến</TableHead>
              <TableHead>Tài xế</TableHead>
              <TableHead>Phương tiện</TableHead>
              <TableHead>Bắt đầu</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => {
              const statusConfig = DELIVERY_STATUS_MAP[d.status] || { label: d.status, variant: "outline" as const }
              return (
                <TableRow
                  key={d.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/deliveries/${d.id}`)}
                >
                  <TableCell>
                    <Link
                      href={`/deliveries/${d.id}`}
                      className="font-bold text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {d.route_name || "Chuyến giao"}
                    </Link>
                  </TableCell>
                  <TableCell>{d.driver?.full_name || "-"}</TableCell>
                  <TableCell>{d.vehicle || "-"}</TableCell>
                  <TableCell>{d.started_at ? formatDate(d.started_at) : "-"}</TableCell>
                  <TableCell><Badge variant={statusConfig.variant}>{statusConfig.label}</Badge></TableCell>
                  <TableCell><Eye className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
