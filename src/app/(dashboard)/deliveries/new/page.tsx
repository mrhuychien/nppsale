"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import type { User, SalesOrder } from "@/types"

export default function NewDeliveryPage() {
  const { user, loading: authLoading } = useRoleGuard("deliveries")
  const [drivers, setDrivers] = useState<User[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [driverId, setDriverId] = useState("")
  const [vehicle, setVehicle] = useState("")
  const [routeName, setRouteName] = useState("")
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const [driversRes, ordersRes] = await Promise.all([
        supabase
          .from("users")
          .select("id, full_name")
          .eq("role", "driver")
          .eq("is_active", true)
          .order("full_name"),
        supabase
          .from("sales_orders")
          .select("id, order_code, total, created_at, customer:customers(store_name, phone)")
          .eq("status", "confirmed")
          .order("created_at", { ascending: false }),
      ])
      setDrivers((driversRes.data as User[]) || [])
      setOrders((ordersRes.data as unknown as SalesOrder[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleOrder = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (selectedOrderIds.size === orders.length) {
      setSelectedOrderIds(new Set())
    } else {
      setSelectedOrderIds(new Set(orders.map((o) => o.id)))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedOrderIds.size === 0) {
      toast({ title: "Vui lòng chọn ít nhất một đơn hàng", variant: "destructive" })
      return
    }
    setSubmitting(true)

    try {
      const { data: delivery, error: deliveryErr } = await supabase
        .from("deliveries")
        .insert({
          org_id: user?.org_id,
          driver_id: driverId || null,
          vehicle: vehicle || null,
          route_name: routeName || null,
          status: "pending",
        })
        .select()
        .single()

      if (deliveryErr) throw deliveryErr

      const deliveryLines = Array.from(selectedOrderIds).map((orderId) => ({
        delivery_id: delivery.id,
        order_id: orderId,
        status: "pending",
      }))

      const { error: linesErr } = await supabase.from("delivery_lines").insert(deliveryLines)
      if (linesErr) throw linesErr

      toast({ title: "Đã tạo phiếu giao hàng" })
      router.push("/deliveries")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo phiếu giao hàng" backHref="/deliveries" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Thông tin chuyến giao</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Tài xế</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger><SelectValue placeholder="Chọn tài xế" /></SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phương tiện</Label>
                <Input
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  placeholder="VD: 51A-12345"
                />
              </div>
              <div className="space-y-2">
                <Label>Tên tuyến</Label>
                <Input
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="VD: Tuyến Q1-Q3"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Đơn hàng đã duyệt ({selectedOrderIds.size}/{orders.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {orders.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={orders.length > 0 && selectedOrderIds.size === orders.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                    <TableHead>Ngày tạo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedOrderIds.has(order.id)}
                          onCheckedChange={() => toggleOrder(order.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{order.order_code}</TableCell>
                      <TableCell>{order.customer?.store_name || "-"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(order.total)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(order.created_at).toLocaleDateString("vi-VN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Không có đơn hàng đã duyệt để giao.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Đang lưu..." : "Tạo phiếu giao"}
          </Button>
        </div>
      </form>
    </div>
  )
}
