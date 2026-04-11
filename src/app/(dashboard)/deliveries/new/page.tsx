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
          .select("*")
          .eq("role", "driver")
          .eq("is_active", true)
          .order("full_name"),
        supabase
          .from("sales_orders")
          .select("*, customer:customers(store_name, phone)")
          .eq("status", "confirmed")
          .order("created_at", { ascending: false }),
      ])
      setDrivers((driversRes.data as User[]) || [])
      setOrders((ordersRes.data as SalesOrder[]) || [])
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
      toast({ title: "Vui long chon it nhat mot don hang", variant: "destructive" })
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

      toast({ title: "Da tao phieu giao hang" })
      router.push("/deliveries")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Co loi xay ra"
      toast({ title: "Loi", description: message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tao phieu giao hang" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Thong tin chuyen giao</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Tai xe</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger><SelectValue placeholder="Chon tai xe" /></SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phuong tien</Label>
                <Input
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  placeholder="VD: 51A-12345"
                />
              </div>
              <div className="space-y-2">
                <Label>Ten tuyen</Label>
                <Input
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="VD: Tuyen Q1-Q3"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Don hang da duyet ({selectedOrderIds.size}/{orders.length})</CardTitle>
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
                    <TableHead>Ma don</TableHead>
                    <TableHead>Khach hang</TableHead>
                    <TableHead className="text-right">Tong tien</TableHead>
                    <TableHead>Ngay tao</TableHead>
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
                Khong co don hang da duyet de giao.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>Huy</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Dang luu..." : "Tao phieu giao"}
          </Button>
        </div>
      </form>
    </div>
  )
}
