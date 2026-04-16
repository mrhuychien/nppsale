"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/utils"
import { ShoppingCart, TrendingUp, Users, Package } from "lucide-react"
import type { SalesOrder } from "@/types"

export default function SalesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [customerCount, setCustomerCount] = useState(0)
  const [productCount, setProductCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const [ordersRes, custRes, prodRes] = await Promise.all([
        supabase.from("sales_orders").select("*").order("order_date", { ascending: false }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
      ])
      setOrders((ordersRes.data as SalesOrder[]) || [])
      setCustomerCount(custRes.count || 0)
      setProductCount(prodRes.count || 0)
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const totalRevenue = orders.filter((o) => o.status === "delivered").reduce((sum, o) => sum + o.total, 0)
  const totalOrders = orders.length
  const deliveredOrders = orders.filter((o) => o.status === "delivered").length
  const avgOrderValue = deliveredOrders > 0 ? totalRevenue / deliveredOrders : 0

  return (
    <div className="space-y-4">
      <PageHeader title="Báo cáo doanh số" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tổng doanh thu</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{formatCurrency(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">Từ đơn đã giao</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tổng đơn hàng</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{totalOrders}</div>
            <p className="text-xs text-muted-foreground">{deliveredOrders} đã giao</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Khách hàng</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{customerCount}</div>
            <p className="text-xs text-muted-foreground">Tổng số khách hàng</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Giá trị TB/đơn</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{formatCurrency(avgOrderValue)}</div>
            <p className="text-xs text-muted-foreground">{productCount} sản phẩm</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Đơn hàng gần đây</CardTitle></CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-2">
              {orders.slice(0, 10).map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <span className="font-mono text-sm">{o.order_code}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{o.order_date}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(o.total)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
