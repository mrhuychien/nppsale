"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { AlertTriangle, Package, BoxesIcon } from "lucide-react"
import type { Batch, Product } from "@/types"

export default function InventoryReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("batches").select("*, product:products(*)").gt("qty_on_hand", 0).order("expires_at")
      setBatches((data as (Batch & { product?: Product })[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const totalItems = batches.reduce((sum, b) => sum + b.qty_on_hand, 0)
  const uniqueProducts = new Set(batches.map((b) => b.product_id)).size
  const expiringCount = batches.filter((b) => getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined) !== "ok").length

  return (
    <div className="space-y-4">
      <PageHeader title="Bao cao kho hang" />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Tong ton kho</CardTitle>
            <BoxesIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalItems}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">San pham co ton</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{uniqueProducts}</div></CardContent>
        </Card>
        <Card className={expiringCount > 0 ? "border-amber-200" : ""}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Canh bao HSD</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{expiringCount}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Lo hang sap het han</CardTitle></CardHeader>
        <CardContent>
          {expiringCount === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Khong co lo hang sap het han</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>San pham</TableHead>
                  <TableHead>Ma lo</TableHead>
                  <TableHead className="text-right">Ton</TableHead>
                  <TableHead>HSD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches
                  .filter((b) => getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined) !== "ok")
                  .map((b) => {
                    const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.product?.name}</TableCell>
                        <TableCell className="font-mono text-sm">{b.batch_code}</TableCell>
                        <TableCell className="text-right">{b.qty_on_hand}</TableCell>
                        <TableCell>
                          <Badge variant={status === "danger" ? "danger" : "warning"}>{formatDate(b.expires_at)}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
