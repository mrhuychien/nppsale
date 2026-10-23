"use client"

import { KhungAnToan } from "@/components/ui/error-boundary"
import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  Bell, ShoppingCart, CircleCheck, CircleX, CreditCard,
  Clock, Navigation, Info, Camera, PackageCheck, Pencil, Undo2, Route, ShieldCheck } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Notification, NotificationType } from "@/types"

/**
 * ⚠ THIẾU MỘT KHOÁ Ở ĐÂY LÀ THÔNG BÁO CÂM. Dòng `ICON_MAP[n.type] ||
 * ICON_MAP.info` ở dưới nuốt mọi loại lạ thành biểu tượng chữ "i" — người
 * dùng thấy thông báo nhưng không phân biệt được "đã xuất hàng" với
 * "đã sửa đơn". `Record<NotificationType, …>` là thứ bắt lỗi đó lúc biên
 * dịch, nên đừng đổi sang `Partial<…>`.
 */
export const ICON_MAP: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  order_pending_approval: { icon: ShoppingCart, color: "text-[#b54708] bg-[#fff4ed]" },
  order_approved: { icon: CircleCheck, color: "text-tertiary bg-[#ecfdf3]" },
  order_completed: { icon: PackageCheck, color: "text-tertiary bg-[#ecfdf3]" },
  order_edited: { icon: Pencil, color: "text-[#b54708] bg-[#fff4ed]" },
  order_cancelled: { icon: CircleX, color: "text-error bg-error-container" },
  return_completed: { icon: Undo2, color: "text-[#175cd3] bg-[#eff8ff]" },
  payment_received: { icon: CreditCard, color: "text-[#175cd3] bg-[#eff8ff]" },
  receivable_overdue: { icon: Clock, color: "text-[#c2410c] bg-[#fff4ed]" },
  visit_logged: { icon: Navigation, color: "text-primary bg-primary/10" },
  customer_photo_missing: { icon: Camera, color: "text-[#b54708] bg-[#fff4ed]" },
  customer_route_missing: { icon: Route, color: "text-[#b54708] bg-[#fff4ed]" },
  customer_photo_review: { icon: ShieldCheck, color: "text-primary bg-primary/10" },
  info: { icon: Info, color: "text-muted-foreground bg-muted" },
}

export function formatRelativeTime(iso: string): string {
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

/* ================================================================
 * KHO THÔNG BÁO DÙNG CHUNG (chủ nhà 27/09/2026 — log Supabase vượt gói).
 *
 * Một màn có thể gắn 2–3 chuông (app bar đang ẩn bằng CSS + đầu trang riêng của màn). Trước
 * đây MỖI chuông tự đọc 20 thông báo và tự mở một kênh realtime, và đọc lại mỗi lần chuyển
 * trang — 3 lượt đọc + 3 kênh cho một màn. Nay: một lượt đọc cho cả phiên, một kênh realtime
 * dùng chung (đếm người dùng, đóng trễ để chuyển trang không đóng/mở lại); bấm mở chuông vẫn
 * đọc mới.
 * ================================================================ */
interface TrangThaiTB {
  items: Notification[]
  unread: number
}
const khoTB = {
  uid: null as string | null,
  tb: { items: [], unread: 0 } as TrangThaiTB,
  daDoc: false,
  dangDoc: null as Promise<void> | null,
  nghe: new Set<(t: TrangThaiTB) => void>(),
  kenh: null as { go: () => void } | null,
  soChuong: 0,
  henDong: null as ReturnType<typeof setTimeout> | null,
}

function datTB(f: (t: TrangThaiTB) => TrangThaiTB) {
  khoTB.tb = f(khoTB.tb)
  khoTB.nghe.forEach((cb) => cb(khoTB.tb))
}

function docTB(uid: string, epMoi = false): Promise<void> {
  if (khoTB.uid !== uid) {
    khoTB.uid = uid
    khoTB.daDoc = false
    khoTB.tb = { items: [], unread: 0 }
  }
  if (khoTB.dangDoc) return khoTB.dangDoc
  if (khoTB.daDoc && !epMoi) return Promise.resolve()
  khoTB.dangDoc = (async () => {
    const { data, error: dataErr } = await createClient()
      .from("notifications")
      .select("id, type, title, body, link_url, is_read, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(20)
    if (dataErr) console.error("[layout/notification-bell] truy vấn lỗi:", dataErr.message)
    else khoTB.daDoc = true
    const rows = (data as Notification[]) || []
    if (khoTB.uid === uid) datTB(() => ({ items: rows, unread: rows.filter((n) => !n.is_read).length }))
  })().finally(() => {
    khoTB.dangDoc = null
  })
  return khoTB.dangDoc
}

/** Một kênh realtime cho mọi chuông của người này; chuông cuối gỡ ra thì 10 giây sau mới đóng. */
function moKenhTB(uid: string): () => void {
  khoTB.soChuong++
  if (khoTB.henDong) {
    clearTimeout(khoTB.henDong)
    khoTB.henDong = null
  }
  if (!khoTB.kenh) {
    const supabase = createClient()
    /* ⚠ Tên kênh có đuôi ngẫu nhiên: đăng ký lại cùng tên kênh lúc kênh cũ chưa gỡ xong là
       supabase ném "cannot add postgres_changes callbacks … after subscribe()" (26/09/2026). */
    const channel = supabase
      .channel(`notifications-${uid}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (payload) => {
          const n = payload.new as Notification
          datTB((t) => ({ items: [n, ...t.items].slice(0, 20), unread: t.unread + (n.is_read ? 0 : 1) }))
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (payload) => {
          const next = payload.new as Notification
          const prevRow = payload.old as Notification
          datTB((t) => ({
            items: t.items.map((x) => (x.id === next.id ? next : x)),
            unread: !prevRow.is_read && next.is_read ? Math.max(0, t.unread - 1) : prevRow.is_read && !next.is_read ? t.unread + 1 : t.unread,
          }))
        }
      )
      .subscribe()
    khoTB.kenh = { go: () => void supabase.removeChannel(channel) }
  }
  return () => {
    khoTB.soChuong = Math.max(0, khoTB.soChuong - 1)
    if (khoTB.soChuong > 0) return
    khoTB.henDong = setTimeout(() => {
      khoTB.henDong = null
      if (khoTB.soChuong === 0 && khoTB.kenh) {
        khoTB.kenh.go()
        khoTB.kenh = null
      }
    }, 10_000)
  }
}

const BangThongBao = lazy(() => import("./notification-panel").then((m) => ({ default: m.BangThongBao })))

function ChuongThongBao() {
  const { authUser } = useAuth()
  const supabase = createClient()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [tb, setTb] = useState<TrangThaiTB>(khoTB.tb)
  const [loading, setLoading] = useState(false)
  const items = tb.items
  const unreadCount = tb.unread
  const setItems = (f: (p: Notification[]) => Notification[]) => datTB((t) => ({ ...t, items: f(t.items) }))
  const setUnreadCount = (f: number | ((p: number) => number)) =>
    datTB((t) => ({ ...t, unread: typeof f === "function" ? f(t.unread) : f }))

  useEffect(() => {
    khoTB.nghe.add(setTb)
    setTb(khoTB.tb)
    return () => {
      khoTB.nghe.delete(setTb)
    }
  }, [])

  const fetchNotifications = useCallback(
    async (epMoi = false) => {
      if (!authUser?.id) return
      setLoading(true)
      await docTB(authUser.id, epMoi)
      setLoading(false)
    },
    [authUser?.id]
  )

  // Lần đầu trong phiên mới đọc; chuông gắn sau dùng lại số đã có.
  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Realtime — INSERT đẩy dòng mới; UPDATE đồng bộ is_read từ tab / máy khác. Một kênh chung.
  useEffect(() => {
    if (!authUser?.id) return
    return moKenhTB(authUser.id)
  }, [authUser?.id])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) fetchNotifications(true)
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

  /* ⚠ HỘP DANH SÁCH TẢI LƯỜI (chủ nhà 23/10/2026 "load trang chậm lắm"): Popover + danh sách chỉ cần khi bấm chuông —
     tải ở lần bấm đầu (chạm / rê chuột là tải trước). Số chưa đọc, kho, kênh realtime vẫn ở đây: chuông có số ngay. */
  const [canHop, setCanHop] = useState(false)
  const taiHop = () => void import("./notification-panel")
  // 44px trên mobile (sàn WCAG 2.5.5); desktop giữ p-2 như cũ để không đẩy rộng cụm điều khiển bên phải app bar.
  const lop = "relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 lg:h-9 lg:w-9"
  const nhan = `Thông báo${unreadCount > 0 ? `, ${unreadCount} chưa đọc` : ""}`
  const hinh = (
    <>
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-destructive text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </>
  )
  const nutTruoc = (
    <button
      type="button"
      className={lop}
      aria-label={nhan}
      aria-haspopup="dialog"
      aria-expanded={false}
      onPointerEnter={taiHop}
      onTouchStart={taiHop}
      onFocus={taiHop}
      onClick={() => {
        setCanHop(true)
        handleOpenChange(true)
      }}
    >
      {hinh}
    </button>
  )
  if (!canHop) return nutTruoc
  return (
    <Suspense fallback={nutTruoc}>
      <BangThongBao
        open={open}
        onOpenChange={handleOpenChange}
        nut={
          <button type="button" className={lop} aria-label={nhan}>
            {hinh}
          </button>
        }
        items={items}
        unreadCount={unreadCount}
        loading={loading}
        onMarkAllRead={markAllRead}
        onPick={handleClick}
        onSeeAll={() => {
          setOpen(false)
          router.push("/notifications")
        }}
      />
    </Suspense>
  )
}

/** Chuông trong vùng bắt lỗi riêng: kênh realtime hay dữ liệu thông báo hỏng thì chỉ mất chuông. */
export function NotificationBell() {
  return (
    <KhungAnToan noi="notification-bell">
      <ChuongThongBao />
    </KhungAnToan>
  )
}
