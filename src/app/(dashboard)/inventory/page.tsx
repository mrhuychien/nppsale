"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon, AlertTriangle } from "lucide-react"
import Link from "next/link"
import type { Batch, Product } from "@/types"

export default function InventoryPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("batches")
        .select("*, product:products(*)")
        .gt("qty_on_hand", 0)
        .order("expires_at")
      setBatches((data as (Batch & { product?: Product })[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const expiringBatches = batches.filter((b) => getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined) !== "ok")

  return (
    <div className="space-y-4">
      <PageHeader title="Kho hang" description="Quan ly ton kho va lo hang">
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/inventory/batches">Lo hang</Link></Button>
          <Button variant="outline" asChild><Link href="/inventory/entries">Phieu kho</Link></Button>
          <Button variant="outline" asChild><Link href="/inventory/stocktake">Kiem ke</Link></Button>
        </div>
      </PageHeader>

      {expiringBatches.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Canh bao han su dung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-700">{expiringBatches.length} lo hang sap het han hoac gan het han</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BoxesIcon className="h-5 w-5" /> Ton kho hien tai
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48" /> : batches.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Chua co du lieu ton kho</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>San pham</TableHead>
                  <TableHead>Ma lo</TableHead>
                  <TableHead>Vi tri</TableHead>
                  <TableHead className="text-right">Ton</TableHead>
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
                      <TableCell className="text-right">{b.qty_on_hand}</TableCell>
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
        </CardContent>
      </Card>
    </div>
  )
}
