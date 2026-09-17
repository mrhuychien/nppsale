"use client"

import { useRef } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import { cn, formatCurrency } from "@/lib/utils"
import { groupOrdersByDay, orderTone, vnDateKey, vnTime } from "@/lib/orders/status-tone"

/**
 * Danh sách đơn trên ĐIỆN THOẠI — theo mẫu thiết kế "Đơn của tôi".
 *
 * BỐ CỤC
 *   Nhóm theo ngày đặt ("Hôm nay" · N đơn · tổng tiền), mỗi nhóm là một
 *   thẻ trắng; mỗi đơn là một hàng: vạch màu trạng thái bên trái, tên
 *   khách + dòng phụ (mã đơn · giờ · NVBH), bên phải tổng tiền + huy hiệu.
 *
 * ⚠ CẢ HÀNG LÀ MỘT VÙNG CHẠM. Không checkbox, không nút con. Chọn nhiều
 * bằng NHẤN GIỮ (hoặc nút "Chọn" phía trên) — đây là chỗ từng xoá được
 * ~51 vùng chạm 16px, giữ nguyên trong bản này.
 */
export interface MobileOrderRow {
  id: string
  order_code: string
  order_date: string
  created_at?: string | null
  status: string
  approval_reason?: string | null
  total: number
  customer?: { store_name?: string | null } | null
  sales_user?: { full_name?: string | null } | null
}

export function MobileOrderList({
  orders,
  showSalesName,
  selectMode,
  selectedIds,
  onToggle,
  onEnterSelect,
  now,
}: {
  orders: MobileOrderRow[]
  /** Quản lý xem nhiều NVBH thì in tên NVBH ở dòng phụ; NVBH xem đơn mình thì không. */
  showSalesName: boolean
  selectMode: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  /** Nhấn giữ một hàng: bật chế độ chọn và chọn hàng đó. */
  onEnterSelect: (id: string) => void
  /** Để kiểm thử — mặc định là bây giờ. */
  now?: Date
}) {
  const today = vnDateKey(now ?? new Date())
  const groups = groupOrdersByDay(orders, now)

  if (orders.length === 0) {
    return (
      <p className="py-10 text-center text-sm font-semibold text-on-surface-variant">
        Không có đơn phù hợp
      </p>
    )
  }

  return (
    <div className="grid gap-2">
      {groups.map((g) => (
        <section key={g.key} className="grid gap-2">
          <div className="flex items-baseline justify-between px-1 pt-2">
            <span className="text-xs font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
              {g.label}
            </span>
            <span className="text-xs font-bold tabular-data text-on-surface-variant">
              {g.items.length} đơn · {formatCurrency(g.total)}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
            {g.items.map((o, i) => {
              const tone = orderTone(o.status, o.approval_reason)
              const isToday = (o.order_date || "").slice(0, 10) === today
              const meta = [
                o.order_code,
                isToday && o.created_at ? vnTime(o.created_at) : null,
                showSalesName ? o.sales_user?.full_name : null,
              ]
                .filter(Boolean)
                .join(" · ")
              return (
                <OrderRow
                  key={o.id}
                  href={`/orders/${o.id}`}
                  first={i === 0}
                  accent={tone.accent}
                  title={o.customer?.store_name || "Khách lẻ"}
                  meta={meta}
                  total={formatCurrency(o.total)}
                  badge={tone}
                  selectMode={selectMode}
                  selected={selectedIds.has(o.id)}
                  onToggle={() => onToggle(o.id)}
                  onLongPress={() => onEnterSelect(o.id)}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Nhấn giữ 500 ms — huỷ nếu ngón tay trượt (đang cuộn). */
const LONG_PRESS_MS = 500

function OrderRow({
  href,
  first,
  accent,
  title,
  meta,
  total,
  badge,
  selectMode,
  selected,
  onToggle,
  onLongPress,
}: {
  href: string
  first: boolean
  accent: string
  title: string
  meta: string
  total: string
  badge: { label: string; bg: string; fg: string }
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onLongPress: () => void
}) {
  // ⚠ Bộ đếm nhấn giữ nằm trong ref, không phải biến cục bộ: biến cục bộ
  // sinh lại ở mỗi lần vẽ và bộ đếm cũ thành mồ côi — không huỷ được.
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const onPointerDown = (e: React.PointerEvent) => {
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    // Trượt quá 10px là đang cuộn, không phải đang giữ.
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear()
  }
  const onClickCapture = (e: React.MouseEvent) => {
    // Nhấn giữ đã nổ thì cú click theo sau KHÔNG được mở đơn.
    if (fired.current) {
      e.preventDefault()
      e.stopPropagation()
      fired.current = false
    }
  }

  const body = (
    <>
      <span
        aria-hidden
        className="h-full min-h-10 w-1 self-stretch rounded-full"
        style={{ background: accent }}
      />
      <span className="grid min-w-0 gap-1">
        <span className="truncate text-base font-extrabold text-on-surface">{title}</span>
        <span className="truncate text-xs font-semibold tabular-data text-on-surface-variant">{meta}</span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className="whitespace-nowrap text-base font-extrabold tabular-data text-on-surface">{total}</span>
        <span
          className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-extrabold"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
      </span>
      {selectMode && (
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full border-2",
            selected ? "border-primary bg-primary text-on-primary" : "border-outline-variant"
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      )}
    </>
  )

  const rowClass = cn(
    "grid w-full items-center gap-x-3 px-3 py-3 text-left transition-colors active:bg-surface-container",
    selectMode ? "grid-cols-[4px_minmax(0,1fr)_auto_24px]" : "grid-cols-[4px_minmax(0,1fr)_auto]",
    !first && "border-t border-outline-variant/30",
    selected && "bg-primary/5"
  )
  const press = { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onClickCapture }

  return selectMode ? (
    <button type="button" onClick={onToggle} aria-pressed={selected} className={rowClass} {...press}>
      {body}
    </button>
  ) : (
    <Link href={href} className={rowClass} {...press}>
      {body}
    </Link>
  )
}
