"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDate } from "@/lib/utils"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import {
  Truck,
  Plus,
  Eye,
  Map as MapIcon,
  List,
  Users,
  Navigation,
  CheckCircle2,
  Calendar,
  User as UserIcon,
} from "lucide-react"
import type { Delivery, DeliveryLine, User } from "@/types"

type DeliveryWithStats = Delivery & {
  _stats?: { total: number; delivered: number; failed: number }
}

type MobileTabRange = "today" | "7days" | "month"

export default function DeliveriesPage() {
  const { user, loading: authLoading } = useRoleGuard("deliveries")
  const { user: authUser } = useAuth()
  const isDriver = authUser?.role === "driver"
  const { toast } = useToast()
  const [deliveries, setDeliveries] = useState<DeliveryWithStats[]>([])
  const [drivers, setDrivers] = useState<Pick<User, "id" | "full_name">[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDriverId, setSelectedDriverId] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTabRange>("today")
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetch() {
      const [deliveriesRes, driversRes] = await Promise.all([
        supabase
          .from("deliveries")
          .select("*, driver:users!deliveries_driver_id_fkey(full_name)")
          .order("created_at", { ascending: false }),
        supabase.from("users").select("id, full_name, role").eq("role", "driver").order("full_name"),
      ])
      const list = (deliveriesRes.data as Delivery[]) || []

      const ids = list.map((d) => d.id)
      let byDelivery: Record<string, { total: number; delivered: number; failed: number }> = {}
      if (ids.length > 0) {
        const { data: linesData } = await supabase
          .from("delivery_lines")
          .select("delivery_id, status")
          .in("delivery_id", ids)
        byDelivery = ((linesData as Pick<DeliveryLine, "delivery_id" | "status">[]) || []).reduce(
          (acc, l) => {
            const entry = acc[l.delivery_id] || { total: 0, delivered: 0, failed: 0 }
            entry.total += 1
            if (l.status === "delivered" || l.status === "partial") entry.delivered += 1
            if (l.status === "failed") entry.failed += 1
            acc[l.delivery_id] = entry
            return acc
          },
          {} as Record<string, { total: number; delivered: number; failed: number }>
        )
      }

      setDeliveries(
        list.map((d) => ({
          ...d,
          _stats: byDelivery[d.id] || { total: 0, delivered: 0, failed: 0 },
        }))
      )
      setDrivers((driversRes.data as Pick<User, "id" | "full_name">[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const pending = deliveries.filter((d) => d.status === "pending").length
    const inTransit = deliveries.filter((d) => d.status === "in_transit").length
    const completed = deliveries.filter(
      (d) => d.status === "completed" || d.status === ("delivered" as unknown as string)
    ).length
    return { pending, inTransit, completed }
  }, [deliveries])

  const unassigned = useMemo(
    () => deliveries.filter((d) => d.status === "pending" && !d.driver_id),
    [deliveries]
  )

  const filteredForMobile = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(today.getDate() - 7)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return deliveries.filter((d) => {
      const dt = new Date(d.started_at || d.created_at)
      if (mobileTab === "today") return dt >= today
      if (mobileTab === "7days") return dt >= sevenDaysAgo
      return dt >= monthStart
    })
  }, [deliveries, mobileTab])

  if (authLoading || loading) return <Skeleton className="h-96" />

  const canCreate = user && hasPermission(user.role, "deliveries", "create")
  const canDispatch = user && hasPermission(user.role, "deliveries", "update")

  const handleBulkAssign = async () => {
    if (!selectedDriverId || unassigned.length === 0) return
    setAssigning(true)
    try {
      const ids = unassigned.map((d) => d.id)
      const { error } = await supabase
        .from("deliveries")
        .update({ driver_id: selectedDriverId })
        .in("id", ids)
      if (error) throw error
      const driver = drivers.find((d) => d.id === selectedDriverId)
      setDeliveries((prev) =>
        prev.map((d) =>
          ids.includes(d.id)
            ? { ...d, driver_id: selectedDriverId, driver: driver ? { ...d.driver, ...driver } as User : d.driver }
            : d
        )
      )
      toast({ title: `Đã phân công ${ids.length} chuyến cho ${driver?.full_name || "tài xế"}` })
      setSelectedDriverId("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isDriver ? "Chuyến giao của tôi" : "Giao hàng"} description={`${deliveries.length} chuyến giao`}>
        {canCreate && (
          <Button onClick={() => router.push("/deliveries/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo phiếu giao
          </Button>
        )}
      </PageHeader>

      {isDriver && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-bold">i</span>
          Bạn chỉ thấy chuyến giao được giao cho bạn.
        </div>
      )}

      {/* Desktop: existing rich UI */}
      <div className="hidden lg:block space-y-4">
        {/* Sticky glass stats */}
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 backdrop-blur-md bg-background/70 border-b">
          <div className="grid grid-cols-3 gap-3">
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-xl bg-amber-100 p-3 text-amber-700">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Đang chờ</div>
                  <div className="text-2xl font-bold">{stats.pending}</div>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
                  <Navigation className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Đang giao</div>
                  <div className="text-2xl font-bold">{stats.inTransit}</div>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="flex items-center gap-3 pt-6">
                <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Hoàn tất</div>
                  <div className="text-2xl font-bold">{stats.completed}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Dispatch card */}
        {canDispatch && unassigned.length > 0 && (
          <Card className="rounded-2xl border-primary/30 bg-gradient-to-br from-primary/5 to-background shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Điều phối nhanh
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="font-semibold text-primary">{unassigned.length}</span>{" "}
                chuyến chưa phân công tài xế
              </div>
              <div className="flex-1 min-w-[200px]">
                <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn tài xế..." />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleBulkAssign} disabled={!selectedDriverId || assigning}>
                {assigning ? "Đang gán..." : `Gán ${unassigned.length} chuyến`}
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="list" className="w-full">
          <TabsList>
            <TabsTrigger value="list" className="gap-2">
              <List className="h-4 w-4" />
              Danh sách
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2">
              <MapIcon className="h-4 w-4" />
              Bản đồ
            </TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="mt-4">
            {deliveries.length === 0 ? (
              <EmptyState
                icon={<Truck className="h-8 w-8 text-muted-foreground" />}
                title="Chưa có chuyến giao"
                description="Chuyến giao sẽ được tạo từ đơn hàng đã duyệt"
              />
            ) : (
              <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tuyến</TableHead>
                      <TableHead>Tài xế</TableHead>
                      <TableHead>Phương tiện</TableHead>
                      <TableHead>Bắt đầu</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.map((d) => {
                      const statusConfig =
                        DELIVERY_STATUS_MAP[d.status] || { label: d.status, variant: "outline" as const }
                      return (
                        <TableRow
                          key={d.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/deliveries/${d.id}`)}
                        >
                          <TableCell>
                            <Link
                              href={`/deliveries/${d.id}`}
                              className="font-bold text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.route_name || "Chuyến giao"}
                            </Link>
                          </TableCell>
                          <TableCell>{d.driver?.full_name || <span className="text-muted-foreground italic">Chưa phân công</span>}</TableCell>
                          <TableCell>{d.vehicle || "-"}</TableCell>
                          <TableCell>{d.started_at ? formatDate(d.started_at) : "-"}</TableCell>
                          <TableCell>
                            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
          <TabsContent value="map" className="mt-4">
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 p-6">
                  <MapIcon className="h-12 w-12 text-primary" />
                </div>
                <div className="text-lg font-semibold">Tích hợp bản đồ sắp ra mắt</div>
                <div className="text-sm text-muted-foreground max-w-md">
                  Theo dõi vị trí tài xế và tuyến giao hàng trực quan trên bản đồ.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Mobile: card history with date tabs */}
      <div className="lg:hidden space-y-3">
        <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as MobileTabRange)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="today">Hôm nay</TabsTrigger>
            <TabsTrigger value="7days">7 ngày</TabsTrigger>
            <TabsTrigger value="month">Tháng này</TabsTrigger>
          </TabsList>
        </Tabs>

        {deliveries.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-8 w-8 text-muted-foreground" />}
            title="Chưa có chuyến giao"
            description="Chuyến giao sẽ được tạo từ đơn hàng đã duyệt"
          />
        ) : filteredForMobile.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-8 w-8 text-muted-foreground" />}
            title="Không có chuyến trong khoảng thời gian này"
          />
        ) : (
          filteredForMobile.map((d) => {
            const statusConfig =
              DELIVERY_STATUS_MAP[d.status] || { label: d.status, variant: "outline" as const }
            const st = d._stats || { total: 0, delivered: 0, failed: 0 }
            const accent =
              d.status === "completed"
                ? "border-l-success"
                : d.status === "cancelled"
                ? "border-l-danger"
                : d.status === "in_transit"
                ? "border-l-warning"
                : "border-l-primary"
            return (
              <Card
                key={d.id}
                onClick={() => router.push(`/deliveries/${d.id}`)}
                className={`border-l-4 ${accent} cursor-pointer active:scale-[0.99] transition-transform`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight truncate">
                        {d.route_name || "Chuyến giao"}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-3 w-3" />
                          {d.driver?.full_name || "Chưa gán"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(d.started_at || d.created_at)}
                        </span>
                      </div>
                    </div>
                    <Badge variant={statusConfig.variant} className="shrink-0">
                      {statusConfig.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t text-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Điểm
                      </p>
                      <p className="text-lg font-bold">{st.total}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Đã giao
                      </p>
                      <p className="text-lg font-bold text-success">{st.delivered}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Thất bại
                      </p>
                      <p className="text-lg font-bold text-danger">{st.failed}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
