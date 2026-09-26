"use client"

import { useRef } from "react"
import Link from "@/components/ui/link"
import { Check } from "lucide-react"
import { cn, formatCurrency } from "@/lib/utils"
import { groupOrdersByDay, orderTone, vnTime } from "@/lib/orders/status-tone"
import { DocListRow, DocListGroupHeader } from "@/components/ui/doc-list-row"
import {
  docQtyText, docSummaryText, isCreditTerm, shortTermLabel,
  type DocLineSummary,
} from "@/lib/orders/list-summary"

/**
 * Danh sách đơn trên ĐIỆN THOẠI — theo mẫu thiết kế "Đơn của tôi".
 *
 * BỐ CỤC (mẫu mới chủ nhà gửi)
 *   Nhóm theo ngày đặt ("Hôm nay" · N đơn · tổng tiền); mỗi đơn là một
 *   hàng BỐN DÒNG — xem `DocListRow`. Khuôn hàng dùng chung với danh
 *   sách hóa đơn bán để hai màn không tách nhau ra theo thời gian.
 *
 * ⚠ KHÁC BẢN CŨ Ở CHỖ QUAN TRỌNG NHẤT: dòng đầu là TÊN KHÁCH + TỔNG
 *   TIỀN, không phải mã đơn. Người bán nhớ khách, không nhớ mã.
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
  payment_terms?: string | null
  total: number
  customer?: { store_name?: string | null } | null
  sales_user?: { full_name?: string | null } | null
}

/**
 * ⚠ TRẠNG THÁI KHÔNG CÒN VIỆC PHẢI LÀM THÌ KHÔNG CẦN HUY HIỆU (mẫu chốt
 * `hasBadge`). Một danh sách mà dòng nào cũng đeo huy hiệu thì huy hiệu
 * hết nghĩa — mắt không còn bắt được dòng nào đang chờ mình.
 */
const QUIET_STATUS = new Set(["completed", "closed"])

export function MobileOrderList({
  orders,
  showSalesName,
  selectMode,
  selectedIds,
  onToggle,
  onEnterSelect,
  lineSummary,
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
  /**
   * Mặt hàng đại diện của từng đơn, theo mã đơn.
   *
   * ⚠ CHƯA ĐỌC XONG THÌ ĐỂ `undefined`, đừng truyền `{}` rồi để dòng in
   * "0 mặt hàng" — xem `docSummaryText`.
   */
  lineSummary?: Record<string, DocLineSummary>
  /** Để kiểm thử — mặc định là bây giờ. */
  now?: Date
}) {
  const groups = groupOrdersByDay(orders, now)

  if (orders.length === 0) {
    return (
      <p className="py-10 text-center text-sm font-semibold text-on-surface-variant">
        Không có đơn phù hợp
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
      {groups.map((g) => (
        <section key={g.key}>
          <DocListGroupHeader
            label={g.label}
            count={g.items.length}
            total={formatCurrency(g.total)}
          />
          {g.items.map((o, i) => {
            const tone = orderTone(o.status)
            const sum = lineSummary?.[o.id]
            /**
             * ⚠ GIỜ LẤY TỪ `created_at`, không lấy từ `order_date`. Cột
             * ngày là kiểu `date`, không mang giờ; dựng giờ từ nó là in
             * "07:00" cho mọi đơn.
             */
            const meta = [o.created_at ? vnTime(o.created_at) : null, o.order_code]
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
                payment={shortTermLabel(o.payment_terms)}
                paymentCredit={isCreditTerm(o.payment_terms)}
                summary={
                  // NVBH chỉ xem đơn của mình nên tên NVBH là thừa; quản
                  // lý xem nhiều người thì phải biết đơn của ai.
                  showSalesName && o.sales_user?.full_name
                    ? [docSummaryText(sum), o.sales_user.full_name].filter(Boolean).join(" · ")
                    : docSummaryText(sum)
                }
                qtyText={docQtyText(sum)}
                total={formatCurrency(o.total)}
                badge={QUIET_STATUS.has(o.status) ? null : tone}
                selectMode={selectMode}
                selected={selectedIds.has(o.id)}
                onToggle={() => onToggle(o.id)}
                onLongPress={() => onEnterSelect(o.id)}
              />
            )
          })}
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
  payment,
  paymentCredit,
  summary,
  qtyText,
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
  payment: string
  paymentCredit: boolean
  summary: string
  qtyText: string
  total: string
  badge: { label: string; bg: string; fg: string } | null
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
    <DocListRow
      first={first}
      accent={accent}
      title={title}
      meta={meta}
      payment={payment}
      paymentCredit={paymentCredit}
      summary={summary}
      qtyText={qtyText}
      total={total}
      badge={badge}
      trailing={
        selectMode ? (
          <span
            className={cn(
              "col-span-2 justify-self-end grid h-6 w-6 place-items-center rounded-full border-2",
              selected ? "border-primary bg-primary text-on-primary" : "border-outline-variant"
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        ) : null
      }
    />
  )

  // ⚠ `relative` là để vạch màu `absolute` trong `DocListRow` bám vào
  //   đúng hàng này; thiếu nó thì vạch nhảy lên khối cha gần nhất.
  const rowClass = cn(
    "relative block w-full min-w-0 text-left transition-colors active:bg-surface-container",
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
