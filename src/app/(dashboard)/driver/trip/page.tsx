"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import {
  Truck,
  Phone,
  MapPin,
  ClipboardCheck,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react"
import type { Delivery, DeliveryLine } from "@/types"

type Stop = DeliveryLine & {
  outstanding?: number
}

export default function DriverTripPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const router = useRouter()
  const supabase = createClient()
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const { data: delData } = await supabase
      .from("deliveries")
      .select("*, driver:users!deliveries_driver_id_fkey(full_name)")
      .eq("driver_id", user.id)
      .eq("status", "in_transit")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!delData) {
      setDelivery(null)
      setStops([])
      setLoading(false)
      return
    }

    const active = delData as Delivery
    setDelivery(active)

    const { data: linesData } = await supabase
      .from("delivery_lines")
      .select(
        "*, order:sales_orders(order_code, total, customer:customers(id, store_name, phone, address))"
      )
      .eq("delivery_id", active.id)

    const lines = (linesData as DeliveryLine[]) || []
    const customerIds = Array.from(
      new Set(
        lines
          .map((l) => l.order?.customer?.id)
          .filter((id): id is string => !!id)
      )
    )

    const outstandingByCustomer: Record<string, number> = {}
    if (customerIds.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: recs } = await supabase
        .from("receivables")
        .select("customer_id, amount, paid, due_date, status")
        .in("customer_id", customerIds)
        .neq("status", "paid")
      for (const r of (recs || []) as Array<{
        customer_id: string
        amount: number
        paid: number
        due_date: string | null
      }>) {
        if (r.due_date && r.due_date < today) {
          const out = Number(r.amount || 0) - Number(r.paid || 0)
          if (out > 0) {
            outstandingByCustomer[r.customer_id] =
              (outstandingByCustomer[r.customer_id] || 0) + out
          }
        }
      }
    }

    const stopsEnriched: Stop[] = lines.map((l) => ({
      ...l,
      outstanding: l.order?.customer?.id
        ? outstandingByCustomer[l.order.customer.id] || 0
        : 0,
    }))

    setStops(stopsEnriched)
    setLoading(false)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!delivery) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<Truck className="h-8 w-8 text-muted-foreground" />}
          title="Không có chuyến nào đang giao"
          description="Hiện chưa có chuyến giao đang hoạt động được gán cho bạn."
        />
        <div className="flex justify-center">
          <Button onClick={() => router.push("/deliveries")} variant="outline">
            Xem chuyến chờ giao
          </Button>
        </div>
      </div>
    )
  }

  const total = stops.length
  const completed = stops.filter(
    (s) => s.status === "delivered" || s.status === "partial"
  ).length
  const failed = stops.filter((s) => s.status === "failed").length
  const pending = total - completed - failed
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <PageHeader title={delivery.route_name || "Chuyến giao"} backHref="/deliveries" />
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground shadow-lg">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Tuyến hôm nay
            </p>
            <h1 className="text-2xl font-black tracking-tight truncate">
              {delivery.route_name || "Chuyến giao"}
            </h1>
            {delivery.vehicle && (
              <p className="text-xs opacity-80 mt-0.5">Xe: {delivery.vehicle}</p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0 bg-white/20 text-white">
            Đang giao
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/20">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Tổng điểm
            </p>
            <p className="text-2xl font-black">{total}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Đã xong
            </p>
            <p className="text-2xl font-black">{completed}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
              Còn lại
            </p>
            <p className="text-2xl font-black">{pending}</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-white transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">Danh sách</TabsTrigger>
          <TabsTrigger value="map">Bản đồ</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {stops.length === 0 ? (
            <EmptyState
              icon={<Truck className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có điểm giao"
              description="Chuyến giao này chưa có đơn hàng"
            />
          ) : (
            stops.map((stop, idx) => {
              const isDone =
                stop.status === "delivered" || stop.status === "partial"
              const isFailed = stop.status === "failed"
              const customer = stop.order?.customer
              const addr = customer?.address || ""
              const phone = customer?.phone
              const mapUrl = addr
                ? `https://maps.google.com/?q=${encodeURIComponent(addr)}`
                : null
              return (
                <Card
                  key={stop.id}
                  className={`border-l-4 ${
                    isDone
                      ? "border-l-success opacity-75"
                      : isFailed
                      ? "border-l-danger"
                      : "border-l-primary"
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${
                          isDone
                            ? "bg-green-100 text-green-700"
                            : isFailed
                            ? "bg-red-100 text-red-700"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : isFailed ? (
                          <AlertCircle className="h-5 w-5" />
                        ) : (
                          String(idx + 1).padStart(2, "0")
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3
                              className={`font-bold text-base leading-tight ${
                                isDone ? "line-through text-muted-foreground" : ""
                              }`}
                            >
                              {customer?.store_name || "Khách hàng"}
                            </h3>
                            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {stop.order?.order_code}
                            </p>
                          </div>
                          <Badge
                            variant={
                              isDone ? "success" : isFailed ? "danger" : "default"
                            }
                            className="shrink-0"
                          >
                            {isDone
                              ? stop.status === "partial"
                                ? "1 phần"
                                : "Đã giao"
                              : isFailed
                              ? "Thất bại"
                              : "Chờ giao"}
                          </Badge>
                        </div>
                        {addr && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                            <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{addr}</span>
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs">
                          <span className="font-bold text-primary">
                            {formatCurrency(stop.order?.total || 0)}
                          </span>
                          {(stop.outstanding || 0) > 0 && (
                            <span className="text-danger font-semibold">
                              Nợ: {formatCurrency(stop.outstanding || 0)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                          {stop.status === "pending" && (
                            <Button
                              size="sm"
                              asChild
                              className="flex-1"
                            >
                              <Link
                                href={`/deliveries/${delivery.id}/pod/${stop.id}`}
                              >
                                <ClipboardCheck className="h-4 w-4 mr-1" />
                                Xác nhận POD
                              </Link>
                            </Button>
                          )}
                          {phone && (
                            <a
                              href={`tel:${phone}`}
                              className="inline-flex items-center justify-center h-9 w-9 rounded-md border bg-card hover:bg-muted active:scale-95 transition"
                              aria-label="Gọi khách hàng"
                            >
                              <Phone className="h-4 w-4" />
                            </a>
                          )}
                          {mapUrl && (
                            <a
                              href={mapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-9 w-9 rounded-md border bg-card hover:bg-muted active:scale-95 transition"
                              aria-label="Dẫn đường"
                            >
                              <MapPin className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
          {failed > 0 && (
            <p className="text-xs text-center text-danger font-semibold flex items-center justify-center gap-1">
              <Circle className="h-2 w-2 fill-current" /> {failed} điểm giao thất bại
            </p>
          )}
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center">
              <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-base">Bản đồ lộ trình</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Tính năng đang phát triển. Hiện bạn có thể bấm biểu tượng bản đồ
                trên từng điểm giao để mở Google Maps.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
