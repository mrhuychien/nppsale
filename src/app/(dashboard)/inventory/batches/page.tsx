"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon } from "lucide-react"
import type { Batch, Product } from "@/types"

export default function BatchesPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("batches").select("*, product:products(*)").order("expires_at")
      setBatches((data as (Batch & { product?: Product })[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Quan ly lo hang" description={`${batches.length} lo hang`} />

      {batches.length === 0 ? (
        <EmptyState icon={<BoxesIcon className="h-8 w-8 text-muted-foreground" />} title="Chua co lo hang" description="Lo hang se duoc tao khi nhap kho" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>San pham</TableHead>
              <TableHead>Ma lo</TableHead>
              <TableHead>Vi tri</TableHead>
              <TableHead className="text-right">Ban dau</TableHead>
              <TableHead className="text-right">Ton</TableHead>
              <TableHead>NSX</TableHead>
              <TableHead>HSD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => {
              const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
              return (
                <TableRow key={b.id}>
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
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
