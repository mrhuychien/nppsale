"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import {
  Navigation, MapPin, Clock, CheckCircle2, TrendingUp, User as UserIcon,
  Camera,
} from "lucide-react"
import type { User } from "@/types"

type VisitRow = {
  id: string
  visit_date: string
  check_in_at: string | null
  check_out_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  result: string | null
  notes: string | null
  photo_url: string | null
  sales_user_id: string
  customer_id: string
  sales_user?: { full_name?: string } | null
  customer?: { id: string; store_name: string; phone: string | null } | null
}

const RESULT_META: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "danger" }> = {
  order_placed: { label: "Đã đặt đơn", variant: "success" },
  no_order: { label: "Không đặt đơn", variant: "secondary" },
  closed: { label: "Đóng cửa", variant: "warning" },
  not_visited: { label: "Chưa ghé", variant: "danger" },
}

export default function VisitsHistoryPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { user: authUser } = useAuth()
  const supabase = createClient()

  const today = new Date()
  const weekAgo = new Date(today)
  weekAgo.setDate(today.getDate() - 7)

  const [dateFrom, setDateFrom] = useState(weekAgo.toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(today.toISOString().slice(0, 10))
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [salesUsers, setSalesUsers] = useState<Pick<User, "id" | "full_name" | "role">[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [loading, setLoading] = useState(true)

  const isManagerLike = authUser && ["owner", "manager", "accountant"].includes(authUser.role)

  // Fetch sales users (manager-only)
  useEffect(() => {
    async function fetchUsers() {
      if (!isManagerLike) return
      const { data } = await supabase
        .from("users")
        .select("id, full_name, role")
        .in("role", ["sales", "manager", "owner"])
        .order("full_name")
      setSalesUsers((data as Pick<User, "id" | "full_name" | "role">[]) || [])
    }
    fetchUsers()
  }, [isManagerLike]) // eslint-disable-line react-hooks/exhaustive-deps

  // Default selected user: the current user (sales) or "all" (manager)
  useEffect(() => {
    if (authUser && !selectedUserId) {
      setSelectedUserId(isManagerLike ? "all" : authUser.id)
    }
  }, [authUser, isManagerLike]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchVisits = useCallback(async () => {
    if (!selectedUserId) return
    setLoading(true)
    let query = supabase
      .from("visit_logs")
      .select(
        "id, visit_date, check_in_at, check_out_at, check_in_lat, check_in_lng, result, notes, photo_url, sales_user_id, customer_id, sales_user:users!visit_logs_sales_user_id_fkey(full_name), customer:customers(id, store_name, phone)"
      )
      .gte("visit_date", dateFrom)
      .lte("visit_date", dateTo)
      .order("visit_date", { ascending: false })
      .order("check_in_at", { ascending: false })

    if (selectedUserId !== "all") {
      query = query.eq("sales_user_id", selectedUserId)
    }

    const { data } = await query
    setVisits(((data as unknown) as VisitRow[]) || [])
    setLoading(false)
  }, [selectedUserId, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedUserId) fetchVisits()
  }, [fetchVisits, selectedUserId])

  // Group by date then by sales user (for "all" view)
  const grouped = useMemo(() => {
    const byDate: Record<string, VisitRow[]> = {}
    for (const v of visits) {
      if (!byDate[v.visit_date]) byDate[v.visit_date] = []
      byDate[v.visit_date].push(v)
    }
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a))
  }, [visits])

  // Summary stats
  const stats = useMemo(() => {
    const totalVisits = visits.length
    const uniqueCustomers = new Set(visits.map((v) => v.customer_id)).size
    const orderPlaced = visits.filter((v) => v.result === "order_placed").length
    const successRate = totalVisits > 0 ? Math.round((orderPlaced / totalVisits) * 100) : 0
    return { totalVisits, uniqueCustomers, orderPlaced, successRate }
  }, [visits])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title={isManagerLike ? "Lịch sử đi tuyến" : "Đi tuyến của tôi"}
        description={`${formatDate(dateFrom)} - ${formatDate(dateTo)}`}
      />

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Từ ngày</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Đến ngày</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {isManagerLike && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Nhân viên</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue placeholder="Chọn NV" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả NV</SelectItem>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Navigation className="h-3.5 w-3.5" /> Lượt ghé
            </div>
            <p className="text-xl font-black mt-1">{stats.totalVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserIcon className="h-3.5 w-3.5" /> Số KH
            </div>
            <p className="text-xl font-black mt-1">{stats.uniqueCustomers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Đặt được đơn
            </div>
            <p className="text-xl font-black mt-1 text-emerald-700">{stats.orderPlaced}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-primary">
              <TrendingUp className="h-3.5 w-3.5" /> Tỉ lệ
            </div>
            <p className="text-xl font-black mt-1 text-primary">{stats.successRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Content */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : visits.length === 0 ? (
        <EmptyState
          icon={<Navigation className="h-8 w-8 text-muted-foreground" />}
          title="Không có ghé thăm"
          description="Chưa có ghi nhận ghé thăm trong khoảng thời gian đã chọn"
        />
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, rows]) => {
            const daySuccess = rows.filter((r) => r.result === "order_placed").length
            return (
              <Card key={date}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{formatDate(date)}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {rows.length} lượt ghé • {daySuccess} đặt đơn
                    </p>
                  </div>
                  <Badge variant={daySuccess > 0 ? "success" : "secondary"}>
                    {rows.length > 0 ? Math.round((daySuccess / rows.length) * 100) : 0}% thành công
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rows.map((v) => {
                    const r = v.result ? RESULT_META[v.result] : null
                    const mapsUrl = v.check_in_lat && v.check_in_lng
                      ? `https://www.google.com/maps?q=${v.check_in_lat},${v.check_in_lng}`
                      : null
                    return (
                      <div key={v.id} className="flex items-start gap-3 rounded-xl border bg-muted/10 p-3">
                        {v.photo_url ? (
                          <a
                            href={v.photo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-lg overflow-hidden border w-14 h-14 bg-muted"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={v.photo_url}
                              alt="Ảnh"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ) : (
                          <div className="shrink-0 w-14 h-14 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
                            <Camera className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/customers/${v.customer_id}`}
                                className="font-semibold text-sm text-primary hover:underline truncate block"
                              >
                                {v.customer?.store_name || "-"}
                              </Link>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {v.check_in_at && (
                                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {new Date(v.check_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                )}
                                {isManagerLike && v.sales_user?.full_name && (
                                  <span className="text-[11px] text-muted-foreground truncate">
                                    NV: {v.sales_user.full_name}
                                  </span>
                                )}
                              </div>
                            </div>
                            {r && <Badge variant={r.variant}>{r.label}</Badge>}
                          </div>
                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                            >
                              <MapPin className="h-3 w-3" />
                              Xem bản đồ
                            </a>
                          )}
                          {v.notes && (
                            <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                              &ldquo;{v.notes}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
