"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import {
  Bell, CheckCircle2, ShoppingCart, CircleCheck, CircleX, CreditCard,
  Clock, Navigation, Info, Check,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Notification, NotificationType } from "@/types"

const ICON_MAP: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  order_pending_approval: { icon: ShoppingCart, color: "text-[#b54708] bg-[#fff4ed]" },
  order_approved: { icon: CircleCheck, color: "text-tertiary bg-[#ecfdf3]" },
  order_cancelled: { icon: CircleX, color: "text-error bg-error-container" },
  payment_received: { icon: CreditCard, color: "text-[#175cd3] bg-[#eff8ff]" },
  receivable_overdue: { icon: Clock, color: "text-[#c2410c] bg-[#fff4ed]" },
  visit_logged: { icon: Navigation, color: "text-primary bg-primary/10" },
  info: { icon: Info, color: "text-muted-foreground bg-muted" },
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "vừa xong"
  if (mins < 60) return `${mins} phút`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} giờ`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày`
  return new Date(iso).toLocaleDateString("vi-VN")
}

export function NotificationBell() {
  const { authUser } = useAuth()
  const supabase = createClient()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    if (!authUser?.id) return
    setLoading(true)
    const { data, error: dataErr } = await supabase
      .from("notifications")
      .select("id, type, title, body, link_url, is_read, created_at")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(20)
    if (dataErr) console.error("[layout/notification-bell] truy vấn lỗi:", dataErr.message)
    const rows = (data as Notification[]) || []
    setItems(rows)
    setUnreadCount(rows.filter((n) => !n.is_read).length)
    setLoading(false)
  }, [authUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Realtime subscription — INSERT pushes new rows; UPDATE syncs is_read
  // changes made from other tabs/devices. Replaces the previous 60s poll.
  useEffect(() => {
    if (!authUser?.id) return
    const channel = supabase
      .channel(`notifications-${authUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${authUser.id}`,
        },
        (payload) => {
          const n = payload.new as Notification
          setItems((prev) => [n, ...prev].slice(0, 20))
          if (!n.is_read) setUnreadCount((prev) => prev + 1)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${authUser.id}`,
        },
        (payload) => {
          const next = payload.new as Notification
          const prevRow = payload.old as Notification
          setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)))
          if (!prevRow.is_read && next.is_read) {
            setUnreadCount((prev) => Math.max(0, prev - 1))
          } else if (prevRow.is_read && !next.is_read) {
            setUnreadCount((prev) => prev + 1)
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [authUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) fetchNotifications()
  }

  const markOneRead = async (n: Notification) => {
    if (n.is_read) return
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    const { error: readErr } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", n.id)
    if (readErr) console.error("[notifications] đánh dấu đã đọc thất bại:", readErr.message)
  }

  const markAllRead = async () => {
    if (!authUser?.id || unreadCount === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
    const { error: readErr } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", authUser.id)
      .eq("is_read", false)
    if (readErr) console.error("[notification-bell] đánh dấu tất cả đã đọc thất bại:", readErr.message)
  }

  const handleClick = async (n: Notification) => {
    await markOneRead(n)
    setOpen(false)
    if (n.link_url) router.push(n.link_url)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          // 44px trên mobile (sàn WCAG 2.5.5); desktop giữ p-2 như cũ để
          // không đẩy rộng cụm điều khiển bên phải app bar.
          className="relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 lg:h-9 lg:w-9"
          aria-label={`Thông báo${unreadCount > 0 ? `, ${unreadCount} chưa đọc` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-destructive text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-32px)] p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div>
            <p className="font-bold text-sm">Thông báo</p>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} chưa đọc` : "Đã đọc hết"}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
              <Check className="h-3.5 w-3.5 mr-1" /> Đánh dấu đã đọc
            </Button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Đang tải...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Chưa có thông báo</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const meta = ICON_MAP[n.type] || ICON_MAP.info
                const Icon = meta.icon
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={`w-full text-left p-3 flex gap-3 hover:bg-muted/40 transition-colors ${
                        !n.is_read ? "bg-primary/[0.03]" : ""
                      }`}
                    >
                      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${meta.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className={`text-sm leading-tight ${!n.is_read ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                            {n.title}
                          </p>
                          {!n.is_read && (
                            <span className="shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" />
                          )}
                        </div>
                        {n.body && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatRelativeTime(n.created_at)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              setOpen(false)
              router.push("/notifications")
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Xem tất cả thông báo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
