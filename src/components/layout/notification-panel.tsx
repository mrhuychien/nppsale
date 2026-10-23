"use client"

import type { ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Bell, Check, CheckCircle2 } from "lucide-react"
import type { Notification } from "@/types"
import { ICON_MAP, formatRelativeTime } from "@/components/layout/notification-bell"

/**
 * TẤM DANH SÁCH THÔNG BÁO — tải LƯỜI ở lần bấm chuông đầu (chủ nhà 23/10/2026 "load trang chậm lắm": giảm JS khung).
 * Kho, kênh realtime và số chưa đọc vẫn ở `notification-bell` — chuông có số ngay khi mở trang; chỉ cái hộp
 * (Popover + danh sách) mới chờ người bấm.
 */
export function BangThongBao({
  open,
  onOpenChange,
  nut,
  items,
  unreadCount,
  loading,
  onMarkAllRead,
  onPick,
  onSeeAll,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Nút chuông (cùng hình với nút trước lúc tải) — làm nút mở hộp. */
  nut: ReactNode
  items: Notification[]
  unreadCount: number
  loading: boolean
  onMarkAllRead: () => void
  onPick: (n: Notification) => void
  onSeeAll: () => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{nut}</PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-32px)] p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div>
            <p className="font-bold text-sm">Thông báo</p>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} chưa đọc` : "Đã đọc hết"}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onMarkAllRead}>
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
                      onClick={() => onPick(n)}
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
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onSeeAll}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Xem tất cả thông báo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
