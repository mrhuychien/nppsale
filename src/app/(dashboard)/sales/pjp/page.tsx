"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import {
  MapPin,
  Save,
  Trash2,
  CheckCircle2,
  Clock,
  LogIn,
  LogOut as LogOutIcon,
  ShoppingCart,
  XCircle,
  Navigation,
} from "lucide-react"
import Link from "next/link"

interface PjpRoute {
  id?: string
  sales_user_id: string
  day_of_week: number
  customer_id: string
  visit_order: number
  is_active: boolean
  customer?: { id: string; store_name: string; address: string | null }
}

interface SalesUser {
  id: string
  full_name: string
  role: string
}

interface VisitLog {
  id: string
  customer_id: string
  check_in_at: string | null
  check_out_at: string | null
  result: string | null
}

const DAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]

function getTodayDow(): number {
  const jsDay = new Date().getDay()
  // Convert JS (0=Sun) to our format (0=Mon)
  return jsDay === 0 ? 6 : jsDay - 1
}

export default function PjpPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = useMemo(() => createClient(), [])

  const isManager = user?.role === "owner" || user?.role === "manager"
  const isSales = user?.role === "sales"

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [routes, setRoutes] = useState<PjpRoute[]>([])
  const [todayVisits, setTodayVisits] = useState<VisitLog[]>([])
  const [customers, setCustomers] = useState<{ id: string; store_name: string; address: string | null }[]>([])
  const [activeDay, setActiveDay] = useState<number>(getTodayDow())
  const [checkingIn, setCheckingIn] = useState<string | null>(null)

  // Fetch sales users for manager
  useEffect(() => {
    if (!user || !isManager) return
    async function fetchUsers() {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, role")
        .eq("org_id", user!.org_id)
        .in("role", ["sales"])
        .eq("is_active", true)
      if (data) setSalesUsers(data)
    }
    fetchUsers()
  }, [user, isManager, supabase])

  // Set default selected user
  useEffect(() => {
    if (isSales && user) {
      setSelectedUserId(user.id)
    } else if (isManager && salesUsers.length > 0 && !selectedUserId) {
      setSelectedUserId(salesUsers[0].id)
    }
  }, [isSales, isManager, user, salesUsers, selectedUserId])

  // Fetch routes for selected user
  const fetchRoutes = useCallback(async () => {
    if (!selectedUserId) return
    setLoading(true)
    const { data } = await supabase
      .from("pjp_routes")
      .select("id, sales_user_id, day_of_week, customer_id, visit_order, is_active, customer:customers(id, store_name, address)")
      .eq("sales_user_id", selectedUserId)
      .eq("is_active", true)
      .order("visit_order", { ascending: true })
    if (data) setRoutes(data as unknown as PjpRoute[])
    setLoading(false)
  }, [selectedUserId, supabase])

  // Fetch today visit logs for sales user
  const fetchTodayVisits = useCallback(async () => {
    if (!selectedUserId) return
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from("visit_logs")
      .select("id, customer_id, check_in_at, check_out_at, result")
      .eq("sales_user_id", selectedUserId)
      .eq("visit_date", todayStr)
    if (data) setTodayVisits(data)
  }, [selectedUserId, supabase])

  // Fetch available customers for adding (manager only)
  const fetchCustomers = useCallback(async () => {
    if (!user || !isManager) return
    const { data } = await supabase
      .from("customers")
      .select("id, store_name, address")
      .eq("org_id", user.org_id)
      .eq("status", "active")
      .order("store_name")
      .limit(500)
    if (data) setCustomers(data)
  }, [user, isManager, supabase])

  useEffect(() => {
    fetchRoutes()
    fetchTodayVisits()
    fetchCustomers()
  }, [fetchRoutes, fetchTodayVisits, fetchCustomers])

  // Routes for active day
  const dayRoutes = routes.filter((r) => r.day_of_week === activeDay)

  // Add customer to day
  const addCustomerToDay = (customerId: string) => {
    const cust = customers.find((c) => c.id === customerId)
    if (!cust) return
    const alreadyExists = routes.some((r) => r.day_of_week === activeDay && r.customer_id === customerId)
    if (alreadyExists) return

    const maxOrder = dayRoutes.reduce((max, r) => Math.max(max, r.visit_order), 0)
    setRoutes([
      ...routes,
      {
        sales_user_id: selectedUserId,
        day_of_week: activeDay,
        customer_id: customerId,
        visit_order: maxOrder + 1,
        is_active: true,
        customer: cust,
      },
    ])
  }

  // Remove customer from day
  const removeFromDay = (customerId: string) => {
    setRoutes(routes.filter((r) => !(r.day_of_week === activeDay && r.customer_id === customerId)))
  }

  // Save routes
  const saveRoutes = async () => {
    if (!selectedUserId) return
    setSaving(true)
    // Delete existing for this user + day then re-insert
    const { error: delErr } = await supabase
      .from("pjp_routes")
      .delete()
      .eq("sales_user_id", selectedUserId)
      .eq("day_of_week", activeDay)
    if (delErr) {
      toast({ title: "Lưu lộ trình thất bại", description: delErr.message, variant: "destructive" })
      setSaving(false)
      return
    }

    const toInsert = dayRoutes.map((r, idx) => ({
      sales_user_id: selectedUserId,
      day_of_week: activeDay,
      customer_id: r.customer_id,
      visit_order: idx + 1,
      is_active: true,
    }))

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("pjp_routes").insert(toInsert)
      if (insErr) {
        // Nguy hiểm: lộ trình cũ đã bị xoá ở trên mà lộ trình mới không vào
        // được — phải báo rõ để người dùng nhập lại ngay.
        toast({
          title: "Lưu lộ trình thất bại — lộ trình cũ đã bị xoá",
          description: `${insErr.message}. Vui lòng nhập lại và lưu.`,
          variant: "destructive",
        })
        setSaving(false)
        fetchRoutes()
        return
      }
    }
    setSaving(false)
    fetchRoutes()
  }

  // Check-in for sales rep
  const handleCheckIn = async (customerId: string) => {
    setCheckingIn(customerId)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      })
      const todayStr = new Date().toISOString().slice(0, 10)
      await supabase.from("visit_logs").insert({
        org_id: user!.org_id,
        sales_user_id: user!.id,
        customer_id: customerId,
        visit_date: todayStr,
        check_in_at: new Date().toISOString(),
        check_in_lat: position.coords.latitude,
        check_in_lng: position.coords.longitude,
        result: null,
      }).throwOnError()
      await fetchTodayVisits()
    } catch (err) {
      console.error("Check-in error:", err)
      alert("Không thể lấy vị trí GPS. Vui lòng bật định vị.")
    }
    setCheckingIn(null)
  }

  // Check-out
  const handleCheckOut = async (customerId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const visit = todayVisits.find((v) => v.customer_id === customerId && !v.check_out_at)
    if (!visit) return
    const { error: outErr } = await supabase
      .from("visit_logs")
      .update({ check_out_at: new Date().toISOString() })
      .eq("id", visit.id)
    if (outErr) {
      toast({ title: "Không ghi được giờ rời điểm", description: outErr.message, variant: "destructive" })
      return
    }
    await fetchTodayVisits()
  }

  // Mark no order
  const handleNoOrder = async (customerId: string, result: string) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const visit = todayVisits.find((v) => v.customer_id === customerId)
    if (!visit) return
    await supabase
      .from("visit_logs")
      .update({ result, check_out_at: new Date().toISOString() })
      .eq("id", visit.id)
      .throwOnError()
    await fetchTodayVisits()
  }

  const getVisitStatus = (customerId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const visit = todayVisits.find((v) => v.customer_id === customerId)
    if (!visit) return "pending"
    if (visit.check_out_at || visit.result) return "visited"
    if (visit.check_in_at) return "checked_in"
    return "pending"
  }

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="Tuyến bán hàng (PJP)"
        description={isManager ? "Lập kế hoạch tuyến bán cho nhân viên" : "Tuyến ghé thăm khách hàng của bạn"}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/sales/visits">
            <Navigation className="h-3.5 w-3.5 mr-1.5" /> Lịch sử đi tuyến
          </Link>
        </Button>
      </PageHeader>

      {/* Manager: select sales user */}
      {isManager && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-foreground">Nhân viên:</label>
          <select
            className="border border-border rounded-lg px-3 py-2 text-sm bg-card"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            {salesUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Day tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {DAY_NAMES.map((name, idx) => {
          const count = routes.filter((r) => r.day_of_week === idx).length
          return (
            <button
              key={idx}
              onClick={() => setActiveDay(idx)}
              className={`flex flex-col items-center px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                activeDay === idx
                  ? "bg-primary text-on-primary shadow-card"
                  : "bg-surface-low text-muted-foreground hover:bg-surface-container"
              }`}
            >
              <span>{name}</span>
              <span className="text-[10px] mt-0.5">{count} KH</span>
            </button>
          )
        })}
      </div>

      {/* Today indicator for sales */}
      {isSales && activeDay === getTodayDow() && (
        <div className="flex items-center gap-2 text-sm font-bold text-primary">
          <Navigation className="h-4 w-4" />
          <span>Tuyến hôm nay</span>
        </div>
      )}

      {/* Route list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : dayRoutes.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có tuyến"
          description={isManager ? "Thêm khách hàng vào tuyến cho ngày này" : "Chưa có tuyến. Liên hệ quản lý."}
        />
      ) : (
        <div className="space-y-3">
          {dayRoutes.map((route, idx) => {
            const status = getVisitStatus(route.customer_id)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const visit = todayVisits.find((v) => v.customer_id === route.customer_id)
            return (
              <Card key={`${route.customer_id}-${idx}`} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
                          status === "visited"
                            ? "bg-[#ecfdf3] text-tertiary"
                            : status === "checked_in"
                            ? "bg-[#fff4ed] text-[#b54708]"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">
                          {route.customer?.store_name || "N/A"}
                        </p>
                        {route.customer?.address && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {route.customer.address}
                          </p>
                        )}
                        {status === "visited" && (
                          <Badge variant="outline" className="mt-1 text-tertiary border-tertiary/40 bg-[#ecfdf3]">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Đã ghé
                          </Badge>
                        )}
                        {status === "checked_in" && (
                          <Badge variant="outline" className="mt-1 text-[#b54708] border-[#fdb022]/40 bg-[#fff4ed]">
                            <Clock className="h-3 w-3 mr-1" />
                            Đang ghé
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isManager && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFromDay(route.customer_id)}
                          className="text-destructive h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {route.customer?.address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(route.customer.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary"
                        >
                          <MapPin className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Sales actions for today */}
                  {isSales && activeDay === getTodayDow() && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {status === "pending" && (
                        <Button
                          size="sm"
                          onClick={() => handleCheckIn(route.customer_id)}
                          disabled={checkingIn === route.customer_id}
                          className="text-xs"
                        >
                          <LogIn className="h-3.5 w-3.5 mr-1" />
                          {checkingIn === route.customer_id ? "Đang lấy GPS..." : "Check-in"}
                        </Button>
                      )}
                      {status === "checked_in" && (
                        <>
                          <Link href={`/orders/new?customerId=${route.customer_id}`}>
                            <Button size="sm" className="text-xs">
                              <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                              Tạo đơn
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleNoOrder(route.customer_id, "no_order")}
                            className="text-xs"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Không đặt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleNoOrder(route.customer_id, "closed")}
                            className="text-xs"
                          >
                            Đóng cửa
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCheckOut(route.customer_id)}
                            className="text-xs"
                          >
                            <LogOutIcon className="h-3.5 w-3.5 mr-1" />
                            Check-out
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Manager: add customer + save */}
      {isManager && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thêm khách hàng</CardTitle>
            </CardHeader>
            <CardContent>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                onChange={(e) => {
                  if (e.target.value) addCustomerToDay(e.target.value)
                  e.target.value = ""
                }}
                defaultValue=""
              >
                <option value="">-- Chọn khách hàng --</option>
                {customers
                  .filter((c) => !dayRoutes.some((r) => r.customer_id === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.store_name}
                    </option>
                  ))}
              </select>
            </CardContent>
          </Card>

          <Button onClick={saveRoutes} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Đang lưu..." : "Lưu tuyến"}
          </Button>
        </div>
      )}

      {/* Summary per day */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tổng quan tuần</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {DAY_NAMES.map((name, idx) => {
              const count = routes.filter((r) => r.day_of_week === idx).length
              return (
                <div
                  key={idx}
                  className={`text-center p-2 rounded-lg ${
                    idx === getTodayDow() ? "bg-primary/10 ring-1 ring-primary" : "bg-surface-low"
                  }`}
                >
                  <p className="text-[10px] font-bold text-muted-foreground">{name.slice(0, 2)}</p>
                  <p className="text-lg font-black text-foreground">{count}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
