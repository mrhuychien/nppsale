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
import type { Delivery, DeliveryLine, SalesOrder, User } from "@/types"

type DeliveryWithStats = Delivery & {
  _stats?: { total: number; delivered: number; failed: number }
}

type PickedOrder = SalesOrder & {
  _entry?: { id: string; entry_code: string; posted_at: string | null }
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
  const [pickedOrders, setPickedOrders] = useState<PickedOrder[]>([])
  const [selectedPickedIds, setSelectedPickedIds] = useState<Set<string>>(new Set())
  const [assigningFromPicked, setAssigningFromPicked] = useState(false)
  const [pickedDriverId, setPickedDriverId] = useState<string>("")
  const supabase = createClient()
  const router = useRouter()

  const fetchAll = async () => {
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

    // Orders with status='picking' that haven't been attached to a delivery yet
    const { data: pickingOrdersData } = await supabase
      .from("sales_orders")
      .select(
        "*, customer:customers(id, store_name, phone, address, gps_lat, gps_lng), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
      )
      .eq("status", "picking")
      .order("created_at", { ascending: false })
    const pickingOrders = (pickingOrdersData as SalesOrder[]) || []

    // Exclude orders already in an open (non-completed/non-cancelled) delivery
    let awaitingOrders: PickedOrder[] = pickingOrders
    if (pickingOrders.length > 0) {
      const pickingIds = pickingOrders.map((o) => o.id)
      const { data: existingLines } = await supabase
        .from("delivery_lines")
        .select("order_id, delivery:deliveries(status)")
        .in("order_id", pickingIds)
      type LineRow = { order_id: string; delivery?: { status?: string } | null }
      const attached = new Set(
        (((existingLines as unknown) as LineRow[]) || [])
          .filter((l) => l.delivery && ["pending", "in_transit"].includes(l.delivery.status || ""))
          .map((l) => l.order_id)
      )
      awaitingOrders = pickingOrders.filter((o) => !attached.has(o.id))

      // Attach the stock_entries row (entry_code + date) that picked these
      // orders. ref_order_ids is jsonb → Supabase .overlaps() can't match
      // it, so load all recent draft/posted exports and filter in JS.
      if (awaitingOrders.length > 0) {
        const awaitingIdSet = new Set(awaitingOrders.map((o) => o.id))
        const { data: entryRows } = await supabase
          .from("stock_entries")
          .select("id, entry_code, posted_at, created_at, ref_order_ids")
          .eq("type", "export")
          .in("status", ["draft", "posted"])
          .order("created_at", { ascending: false })
          .limit(200)
        type EntryRow = {
          id: string
          entry_code: string
          posted_at: string | null
          created_at: string
          ref_order_ids: string[]
        }
        const allEntries = ((entryRows as unknown) as EntryRow[]) || []
        const entriesByOrder: Record<string, EntryRow> = {}
        for (const e of allEntries) {
          for (const oid of e.ref_order_ids || []) {
            if (awaitingIdSet.has(oid) && !entriesByOrder[oid]) {
              entriesByOrder[oid] = e
            }
          }
        }
        awaitingOrders = awaitingOrders.map((o) => {
          const entry = entriesByOrder[o.id]
          return entry
            ? { ...o, _entry: { id: entry.id, entry_code: entry.entry_code, posted_at: entry.posted_at || entry.created_at } }
            : o
        })
      }
    }

    setPickedOrders(awaitingOrders)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
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

  // Create a delivery from selected picked orders
  // Handover goods to a driver: creates a delivery, posts the related stock
  // entries (draft → posted), deducts batch on-hand FEFO, then flips orders
  // to 'delivering'. Driver is required for a handover.
  const handleCreateDeliveryFromPicked = async () => {
    if (!user?.org_id || selectedPickedIds.size === 0) return
    if (!pickedDriverId) {
      toast({
        title: "Chọn tài xế trước khi bàn giao",
        variant: "destructive",
      })
      return
    }
    const selected = pickedOrders.filter((o) => selectedPickedIds.has(o.id))
    const selectedIdList = selected.map((o) => o.id)
    setAssigningFromPicked(true)
    try {
      const routeName = selected.length === 1
        ? `Giao ${selected[0].customer?.store_name || "KH"}`
        : `Giao ${selected.length} đơn`

      // 1. Create delivery in transit (handover = truck has goods)
      const { data: delivery, error: delErr } = await supabase
        .from("deliveries")
        .insert({
          org_id: user.org_id,
          driver_id: pickedDriverId,
          route_name: routeName,
          status: "in_transit",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (delErr || !delivery) throw delErr || new Error("Không tạo được chuyến giao")

      // 2. Insert delivery_lines
      const lines = selected.map((o) => ({
        delivery_id: delivery.id,
        order_id: o.id,
        status: "pending" as const,
      }))
      const { error: linesErr } = await supabase.from("delivery_lines").insert(lines)
      if (linesErr) throw linesErr

      // 3. Find the draft export stock_entries that cover these orders
      // 3. Find the draft export stock_entries that cover these orders.
      //    ref_order_ids is jsonb, so Supabase .overlaps() (array &&) does
      //    not match. Load all draft exports and filter in JS.
      const { data: draftEntries } = await supabase
        .from("stock_entries")
        .select("id, ref_order_ids, lines:stock_entry_lines(id, product_id, quantity, batch_id)")
        .eq("type", "export")
        .eq("status", "draft")
      type EntryRow = {
        id: string
        ref_order_ids: string[]
        lines?: Array<{ id: string; product_id: string; quantity: number; batch_id: string | null }>
      }
      const allDrafts = ((draftEntries as unknown) as EntryRow[]) || []
      const entries = allDrafts.filter((e) =>
        (e.ref_order_ids || []).some((id) => selectedIdList.includes(id))
      )

      // 4. Post each entry + deduct batches FEFO for lines without batch_id
      const postedAt = new Date().toISOString()
      for (const entry of entries) {
        // Skip if entry's ref_order_ids are not fully covered by this handover —
        // don't post partial entries. This is a common case when warehouse
        // picked two orders together but driver only takes one; warn and keep
        // entry as draft.
        const fullyCovered = (entry.ref_order_ids || []).every((id) =>
          selectedIdList.includes(id)
        )
        if (!fullyCovered) continue

        // Deduct stock for each aggregated line, FEFO across batches
        for (const line of entry.lines || []) {
          let remaining = Number(line.quantity)
          if (remaining <= 0) continue

          if (line.batch_id) {
            // Explicit batch on the line → just deduct from that batch
            const { data: b } = await supabase
              .from("batches")
              .select("qty_on_hand")
              .eq("id", line.batch_id)
              .maybeSingle()
            const onHand = Number((b as { qty_on_hand?: number } | null)?.qty_on_hand) || 0
            const take = Math.min(remaining, onHand)
            if (take > 0) {
              await supabase
                .from("batches")
                .update({ qty_on_hand: onHand - take })
                .eq("id", line.batch_id)
              remaining -= take
            }
          } else {
            // Aggregate line → FEFO across this product's batches
            const { data: batches } = await supabase
              .from("batches")
              .select("id, qty_on_hand, expires_at")
              .eq("product_id", line.product_id)
              .gt("qty_on_hand", 0)
              .order("expires_at", { ascending: true })
            for (const b of (batches as Array<{ id: string; qty_on_hand: number }>) || []) {
              if (remaining <= 0) break
              const take = Math.min(remaining, Number(b.qty_on_hand))
              await supabase
                .from("batches")
                .update({ qty_on_hand: Number(b.qty_on_hand) - take })
                .eq("id", b.id)
              remaining -= take
            }
          }
          // If remaining > 0 after all batches, inventory is short — still
          // proceed (goods left warehouse physically); warn in console.
          if (remaining > 0) {
            // eslint-disable-next-line no-console
            console.warn("[handover] short stock for line", line.id, "remaining", remaining)
          }
        }

        // Post the entry
        await supabase
          .from("stock_entries")
          .update({ status: "posted", posted_at: postedAt })
          .eq("id", entry.id)
      }

      // 5. Advance orders: picking → delivering
      await supabase
        .from("sales_orders")
        .update({ status: "delivering" })
        .in("id", selectedIdList)

      // 6. Notify the driver
      if (pickedDriverId !== user.id) {
        const { createNotification } = await import("@/lib/notifications")
        createNotification(supabase, {
          orgId: user.org_id,
          userId: pickedDriverId,
          type: "info",
          title: `Đã bàn giao ${selected.length} đơn`,
          body: routeName,
          linkUrl: `/deliveries/${delivery.id}`,
          metadata: { delivery_id: delivery.id, order_ids: selectedIdList },
        })
      }

      toast({
        title: `Đã bàn giao ${selected.length} đơn`,
        description: `→ ${drivers.find((d) => d.id === pickedDriverId)?.full_name || "tài xế"} • Đã trừ tồn kho`,
      })
      setSelectedPickedIds(new Set())
      setPickedDriverId("")
      await fetchAll()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setAssigningFromPicked(false)
    }
  }

  const togglePickedOne = (id: string) => {
    const next = new Set(selectedPickedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedPickedIds(next)
  }
  const togglePickedAll = () => {
    if (selectedPickedIds.size === pickedOrders.length) {
      setSelectedPickedIds(new Set())
    } else {
      setSelectedPickedIds(new Set(pickedOrders.map((o) => o.id)))
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

        {/* Đơn đã xuất kho, chờ gán chuyến giao */}
        {canDispatch && pickedOrders.length > 0 && (
          <Card className="rounded-2xl border-amber-300 bg-gradient-to-br from-amber-50 to-background shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Truck className="h-4 w-4 text-amber-700" />
                    Đơn chờ bàn giao ({pickedOrders.length})
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Thủ kho đã tạo phiếu xuất (nháp). Chọn đơn, chọn tài xế, nhấn Bàn giao. Khi bàn giao: phiếu xuất được post và tồn kho bị trừ theo FEFO.
                  </p>
                </div>
                {selectedPickedIds.size > 0 && (
                  <Badge variant="default" className="shrink-0">
                    {selectedPickedIds.size} đã chọn
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPickedIds.size === pickedOrders.length && pickedOrders.length > 0}
                    onChange={togglePickedAll}
                    className="h-4 w-4"
                  />
                  Chọn tất cả ({pickedOrders.length})
                </label>
                <div className="rounded-xl border bg-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Mã đơn</TableHead>
                        <TableHead>Khách hàng</TableHead>
                        <TableHead>NV bán</TableHead>
                        <TableHead>Phiếu xuất</TableHead>
                        <TableHead>Ngày xuất</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pickedOrders.map((o) => {
                        const checked = selectedPickedIds.has(o.id)
                        return (
                          <TableRow
                            key={o.id}
                            className={`cursor-pointer ${checked ? "bg-primary/5" : ""}`}
                            onClick={() => togglePickedOne(o.id)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePickedOne(o.id)}
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/orders/${o.id}`}
                                className="font-mono text-xs font-bold text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {o.order_code}
                              </Link>
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              {o.customer?.store_name || "-"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {o.sales_user?.full_name || "-"}
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {o._entry ? (
                                <Link
                                  href={`/inventory/entries/${o._entry.id}`}
                                  className="text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {o._entry.entry_code}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {o._entry?.posted_at ? formatDate(o._entry.posted_at) : "-"}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedPickedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                  <div className="flex-1 min-w-[200px]">
                    <Select value={pickedDriverId} onValueChange={setPickedDriverId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn tài xế (tùy chọn)..." />
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
                  <Button
                    onClick={handleCreateDeliveryFromPicked}
                    disabled={assigningFromPicked || !pickedDriverId}
                  >
                    {assigningFromPicked
                      ? "Đang bàn giao..."
                      : !pickedDriverId
                        ? "Chọn tài xế trước"
                        : `Bàn giao ${selectedPickedIds.size} đơn`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
        {canDispatch && pickedOrders.length > 0 && (
          <Card className="rounded-2xl border-amber-300 bg-amber-50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start gap-2 mb-2">
                <Truck className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-bold text-sm text-amber-900">
                    {pickedOrders.length} đơn chờ bàn giao
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Chọn đơn + tài xế → Bàn giao (trừ tồn)
                  </p>
                </div>
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto mb-3">
                {pickedOrders.map((o) => {
                  const checked = selectedPickedIds.has(o.id)
                  return (
                    <label
                      key={o.id}
                      className={`flex items-start gap-2 rounded-lg border p-2 text-xs cursor-pointer ${
                        checked ? "bg-primary/10 border-primary" : "bg-card"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePickedOne(o.id)}
                        className="h-4 w-4 mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-bold text-primary">{o.order_code}</p>
                        <p className="truncate font-medium">{o.customer?.store_name || "-"}</p>
                        {o._entry && (
                          <p className="text-[10px] text-muted-foreground">
                            Phiếu xuất: {o._entry.entry_code}
                          </p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              {selectedPickedIds.size > 0 && (
                <div className="space-y-2">
                  <Select value={pickedDriverId} onValueChange={setPickedDriverId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Chọn tài xế (tùy chọn)..." />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleCreateDeliveryFromPicked}
                    disabled={assigningFromPicked || !pickedDriverId}
                  >
                    {assigningFromPicked
                      ? "Đang bàn giao..."
                      : !pickedDriverId
                        ? "Chọn tài xế trước"
                        : `Bàn giao ${selectedPickedIds.size} đơn`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
