"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon, Plus, Eye } from "lucide-react"
import type { Batch, Product } from "@/types"

export default function BatchesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("batches").select("*, product:products(*)").order("expires_at")
      setBatches((data as (Batch & { product?: Product })[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const canCreate =
    user && ["warehouse", "owner"].includes(user.role) && hasPermission(user.role, "inventory", "create")

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý lô hàng" description={`${batches.length} lô hàng`}>
        {canCreate && (
          <Button asChild>
            <Link href="/inventory/batches/new"><Plus className="mr-2 h-4 w-4" /> Tạo lô mới</Link>
          </Button>
        )}
      </PageHeader>

      {batches.length === 0 ? (
        <EmptyState
          icon={<BoxesIcon className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có lô hàng"
          description="Lô hàng sẽ được tạo khi nhập kho hoặc bằng nút 'Tạo lô mới'"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sản phẩm</TableHead>
              <TableHead>Mã lô</TableHead>
              <TableHead>Vị trí</TableHead>
              <TableHead className="text-right">Ban đầu</TableHead>
              <TableHead className="text-right">Tồn</TableHead>
              <TableHead>NSX</TableHead>
              <TableHead>HSD</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => {
              const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
              return (
                <TableRow
                  key={b.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/inventory/batches/${b.id}`)}
                >
                  <TableCell className="font-medium">{b.product?.name}</TableCell>
                  <TableCell className="font-mono text-sm">{b.batch_code}</TableCell>
                  <TableCell>{b.location || "-"}</TableCell>
                  <TableCell className="text-right">{b.qty_initial}</TableCell>
                  <TableCell className="text-right font-medium">{b.qty_on_hand}</TableCell>
                  <TableCell>{b.manufactured_at ? formatDate(b.manufactured_at) : "-"}</TableCell>
                  <TableCell>
                    <Badge variant={status === "danger" ? "danger" : status === "warning" ? "warning" : "success"}>
                      {formatDate(b.expires_at)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
