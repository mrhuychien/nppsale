"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ApprovalBadge } from "@/components/orders/approval-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { APPROVAL_THRESHOLDS } from "@/lib/constants"
import type { SalesOrder, SalesOrderLine } from "@/types"

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [loading, setLoading] = useState(true)
  const [approveOpen, setApproveOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [orderRes, linesRes] = await Promise.all([
      supabase.from("sales_orders").select("*, customer:customers(*), sales_user:users!sales_orders_sales_user_id_fkey(*)").eq("id", id).single(),
      supabase.from("sales_order_lines").select("*, product:products(*)").eq("order_id", id),
    ])
    if (orderRes.data) setOrder(orderRes.data as SalesOrder)
    setLines((linesRes.data as SalesOrderLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleApprove = async () => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      const canApprove =
        (order.total < APPROVAL_THRESHOLDS.AUTO_APPROVE) ||
        (order.total < APPROVAL_THRESHOLDS.MANAGER_APPROVE && ["owner", "manager"].includes(user.role)) ||
        (user.role === "owner")

      if (!canApprove) {
        toast({ title: "Khong co quyen duyet don hang nay", variant: "destructive" })
        return
      }

      const { error } = await supabase.from("sales_orders").update({
        status: "confirmed",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      }).eq("id", order.id)

      if (error) throw error
      toast({ title: "Da duyet don hang" })
      setApproveOpen(false)
      fetchData()
    } catch {
      toast({ title: "Loi khi duyet don", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("sales_orders").update({ status: "cancelled" }).eq("id", order.id)
      if (error) throw error
      toast({ title: "Da huy don hang" })
      setCancelOpen(false)
      fetchData()
    } catch {
      toast({ title: "Loi", variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!order) return <div>Khong tim thay don hang</div>

  return (
    <div className="space-y-4">
      <PageHeader title={order.order_code} description={`Ngay dat: ${formatDate(order.order_date)}`}>
        <StatusBadge status={order.status} type="order" />
        <ApprovalBadge total={order.total} status={order.status} approvedBy={order.approved_by} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Chi tiet san pham</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>San pham</TableHead>
                  <TableHead>DVT</TableHead>
                  <TableHead className="text-right">SL</TableHead>
                  <TableHead className="text-right">Don gia</TableHead>
                  <TableHead className="text-right">Thanh tien</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.product?.name || "-"}</TableCell>
                    <TableCell>{line.unit_name}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(line.unit_price)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(line.line_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 space-y-1 text-right border-t pt-4">
              <p>Tam tinh: {formatCurrency(order.subtotal)}</p>
              <p>Chiet khau: {formatCurrency(order.discount)}</p>
              <p>VAT: {formatCurrency(order.vat)}</p>
              <p className="text-lg font-bold">Tong: {formatCurrency(order.total)}</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Khach hang</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{order.customer?.store_name}</p>
              <p>{order.customer?.phone}</p>
              <p className="text-muted-foreground">{order.customer?.address}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Thao tac</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {order.status === "draft" && user && hasPermission(user.role, "orders", "approve") && (
                <Button className="w-full" onClick={() => setApproveOpen(true)}>Duyet don hang</Button>
              )}
              {order.status === "draft" && (
                <Button variant="destructive" className="w-full" onClick={() => setCancelOpen(true)}>Huy don hang</Button>
              )}
              {order.status === "confirmed" && (
                <Button variant="outline" className="w-full" onClick={() => router.push("/deliveries")}>Tao chuyen giao</Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={approveOpen} onOpenChange={setApproveOpen} title="Duyet don hang?" description={`Xac nhan duyet don ${order.order_code} voi tong gia tri ${formatCurrency(order.total)}`} onConfirm={handleApprove} loading={actionLoading} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Huy don hang?" description="Don hang se bi huy va khong the khoi phuc" variant="destructive" confirmLabel="Huy don" onConfirm={handleCancel} loading={actionLoading} />
    </div>
  )
}
