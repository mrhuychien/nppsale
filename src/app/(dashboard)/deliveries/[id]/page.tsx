"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import { Camera, PenTool } from "lucide-react"
import type { Delivery, DeliveryLine } from "@/types"

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [lines, setLines] = useState<DeliveryLine[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [delRes, linesRes] = await Promise.all([
      supabase.from("deliveries").select("*, driver:users!deliveries_driver_id_fkey(*)").eq("id", id).single(),
      supabase.from("delivery_lines").select("*, order:sales_orders(order_code, customer:customers(store_name))").eq("delivery_id", id),
    ])
    if (delRes.data) setDelivery(delRes.data as Delivery)
    setLines((linesRes.data as DeliveryLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleConfirmDelivery = async (lineId: string) => {
    const { error } = await supabase.from("delivery_lines").update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
    }).eq("id", lineId)
    if (!error) {
      toast({ title: "Da xac nhan giao hang" })
      fetchData()
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) return <div>Khong tim thay chuyen giao</div>

  const statusConfig = DELIVERY_STATUS_MAP[delivery.status] || { label: delivery.status, variant: "outline" as const }

  return (
    <div className="space-y-4">
      <PageHeader title={delivery.route_name || "Chi tiet chuyen giao"}>
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Danh sach don hang</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ma don</TableHead>
                  <TableHead>Khach hang</TableHead>
                  <TableHead>Trang thai</TableHead>
                  <TableHead>POD</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-sm">{line.order?.order_code}</TableCell>
                    <TableCell>{line.order?.customer?.store_name}</TableCell>
                    <TableCell>
                      <Badge variant={line.status === "delivered" ? "success" : line.status === "failed" ? "danger" : "secondary"}>
                        {line.status === "delivered" ? "Da giao" : line.status === "failed" ? "That bai" : "Cho giao"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {line.pod_photo_url && <Camera className="h-4 w-4 text-green-600" />}
                      {line.pod_signature && <PenTool className="h-4 w-4 text-green-600" />}
                    </TableCell>
                    <TableCell>
                      {line.status === "pending" && (
                        <Button size="sm" onClick={() => handleConfirmDelivery(line.id)}>Xac nhan</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Thong tin chuyen</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Tai xe:</span> {delivery.driver?.full_name || "-"}</p>
            <p><span className="text-muted-foreground">Phuong tien:</span> {delivery.vehicle || "-"}</p>
            <p><span className="text-muted-foreground">So don:</span> {lines.length}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
