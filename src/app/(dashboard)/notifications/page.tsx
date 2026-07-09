"use client"

import { useCallback, useEffect, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Bell, CheckCircle2, ShoppingCart, CircleCheck, CircleX, CreditCard,
  Clock, Navigation, Info, Check, Trash2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Notification, NotificationType } from "@/types"

const ICON_MAP: Record<NotificationType, { icon: LucideIcon; color: string; label: string }> = {
  order_pending_approval: { icon: ShoppingCart, color: "text-[#b54708] bg-[#fff4ed]", label: "Chờ duyệt" },
  order_approved: { icon: CircleCheck, color: "text-tertiary bg-[#ecfdf3]", label: "Đã duyệt" },
  order_cancelled: { icon: CircleX, color: "text-error bg-error-container", label: "Hủy đơn" },
  payment_received: { icon: CreditCard, color: "text-[#175cd3] bg-[#eff8ff]", label: "Thanh toán" },
  receivable_overdue: { icon: Clock, color: "text-[#c2410c] bg-[#fff4ed]", label: "Quá hạn" },
  visit_logged: { icon: Navigation, color: "text-primary bg-primary/10", label: "Ghé thăm" },
  info: { icon: Info, color: "text-muted-foreground bg-muted", label: "Khác" },
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "vừa xong"
  if (mins < 60) return `${mins} phút trước`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày trước`
  return new Date(iso).toLocaleDateString("vi-VN")
}

export default function NotificationsPage() {
  const { authUser } = useAuth()
  const supabase = createClient()
  const router = useRouter()

  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all")
  const [unreadCount, setUnreadCount] = useState(0)
  const pg = usePagination(50)

  // Count unread riêng — không phụ thuộc filter/page.
  const loadUnreadCount = useCallback(async () => {
    if (!authUser?.id) return
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id)
      .eq("is_read", false)
    setUnreadCount(count ?? 0)
  }, [authUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadUnreadCount() }, [loadUnreadCount])

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [typeFilter, readFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = useCallback(async () => {
    if (!authUser?.id) return
    setLoading(true)
    let q = supabase
      .from("notifications")
      .select("id, type, title, body, link_url, is_read, created_at", { count: "exact" })
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .range(pg.from, pg.to)
    if (typeFilter !== "all") q = q.eq("type", typeFilter)
    if (readFilter === "unread") q = q.eq("is_read", false)
    if (readFilter === "read") q = q.eq("is_read", true)
    const { data, count } = await q
    setItems((data as Notification[]) || [])
    pg.setTotal(count ?? 0)
    setLoading(false)
  }, [authUser?.id, pg.from, pg.to, typeFilter, readFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll() }, [fetchAll])

  // Đã filter server-side, pass-through.
  const filtered = items

  const markOneRead = async (n: Notification) => {
    if (n.is_read) return
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    setUnreadCount((c) => Math.max(0, c - 1))
    await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", n.id)
  }

  const markAllRead = async () => {
    if (!authUser?.id || unreadCount === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
    await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", authUser.id)
      .eq("is_read", false)
  }

  const deleteOne = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id))
    await supabase.from("notifications").delete().eq("id", id)
  }

  const deleteAllRead = async () => {
    if (!authUser?.id) return
    setItems((prev) => prev.filter((n) => !n.is_read))
    await supabase.from("notifications").delete().eq("user_id", authUser.id).eq("is_read", true)
  }

  const handleClick = async (n: Notification) => {
    await markOneRead(n)
    if (n.link_url) router.push(n.link_url)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Thông báo"
        description={unreadCount > 0 ? `${unreadCount} chưa đọc` : "Đã đọc hết"}
      >
        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={markAllRead}>
              <Check className="h-3.5 w-3.5 mr-1" /> Đánh dấu đã đọc
            </Button>
          )}
          {items.some((n) => n.is_read) && (
            <Button size="sm" variant="outline" onClick={deleteAllRead}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Xóa đã đọc
            </Button>
          )}
        </div>
      </PageHeader>

      <Card>
        <CardContent className="flex flex-wrap gap-2 p-4">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả loại</SelectItem>
              {(Object.keys(ICON_MAP) as NotificationType[]).map((t) => (
                <SelectItem key={t} value={t}>{ICON_MAP[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={readFilter} onValueChange={(v) => setReadFilter(v as "all" | "unread" | "read")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="unread">Chưa đọc</SelectItem>
              <SelectItem value="read">Đã đọc</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8 text-muted-foreground" />}
          title={items.length === 0 ? "Chưa có thông báo" : "Không có thông báo khớp bộ lọc"}
          description={items.length === 0 ? "Thông báo hệ thống sẽ hiển thị ở đây" : "Thử đổi bộ lọc"}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const meta = ICON_MAP[n.type] || ICON_MAP.info
            const Icon = meta.icon
            return (
              <div
                key={n.id}
                className={`rounded-xl border bg-card p-3 flex gap-3 transition-colors ${
                  !n.is_read ? "border-primary/30 bg-primary/[0.02]" : ""
                }`}
              >
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${meta.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-start gap-2">
                    <p className={`text-sm leading-tight ${!n.is_read ? "font-bold" : "font-medium"}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span className="shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" />
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {formatRelativeTime(n.created_at)}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => deleteOne(n.id)}
                  aria-label="Xóa"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <DataPagination pg={pg} shownCount={filtered.length} />

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => router.push("/home")}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
          Về trang chủ
        </Button>
      </div>
    </div>
  )
}
