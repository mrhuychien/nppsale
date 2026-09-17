import { ORDER_STATUS_MAP } from "@/lib/constants"
import { isSentForApproval } from "@/lib/sell/send-approval"

/**
 * Màu và nhãn của một đơn trên ĐIỆN THOẠI — theo mẫu thiết kế màn "Đơn
 * của tôi" / "Chi tiết đơn".
 *
 * ⚠ "CHỜ DUYỆT" KHÔNG PHẢI MỘT TRẠNG THÁI trong database: nó là
 * `status = 'draft'` kèm `approval_reason`. Hai đơn cùng là `draft` — một
 * nháp chưa gửi, một đã gửi chờ quản lý — phải hiện hai màu khác nhau,
 * không thì NVBH lưu tạm xong tưởng đã gửi rồi ngồi đợi. Phép phân biệt
 * nằm ở `isSentForApproval`, không chép lại ở đây.
 *
 * ⚠ NHÃN lấy từ `ORDER_STATUS_MAP` để bảng desktop và thẻ mobile không
 * viết hai kiểu "Đã hủy" / "Đã huỷ" cho cùng một trạng thái.
 *
 * Màu là mã hex theo đúng mẫu thiết kế (thẻ có vạch màu bên trái, huy
 * hiệu nền nhạt chữ đậm) — cùng bảng với các khung cảnh báo hổ phách đang
 * dùng trong app; không phải bảng màu semantic của shadcn vì mẫu có năm
 * sắc độ mà bảng đó không có.
 */
export interface OrderTone {
  key: string
  label: string
  /** Nền huy hiệu. */
  bg: string
  /** Chữ huy hiệu. */
  fg: string
  /** Vạch màu bên trái thẻ / chấm trên dòng thời gian. */
  accent: string
}

const TONES: Record<string, Omit<OrderTone, "key" | "label">> = {
  draft: { bg: "#eef1f5", fg: "#565a67", accent: "#b9c4d6" },
  pending: { bg: "#fff4e0", fg: "#8a5a00", accent: "#fdb022" },
  confirmed: { bg: "#e3edfb", fg: "#1d4ed8", accent: "#2563eb" },
  picking: { bg: "#eef7ff", fg: "#0c4a6e", accent: "#7dd3fc" },
  delivering: { bg: "#e6f4ff", fg: "#075985", accent: "#38bdf8" },
  delivered: { bg: "#e3f5ec", fg: "#004e33", accent: "#22c55e" },
  cancelled: { bg: "#fdecec", fg: "#b00020", accent: "#ef5350" },
}

export function orderTone(status: string, approvalReason?: string | null): OrderTone {
  if (isSentForApproval(status, approvalReason)) {
    return { key: "pending", label: "Chờ duyệt", ...TONES.pending }
  }
  const t = TONES[status] ?? TONES.draft
  return { key: status, label: ORDER_STATUS_MAP[status]?.label ?? status, ...t }
}

/** Ngày theo giờ Việt Nam, dạng YYYY-MM-DD — để so với cột `order_date` (DATE). */
export function vnDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d)
}

/** Giờ:phút theo giờ Việt Nam. */
export function vnTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

/**
 * Nhãn nhóm ngày: "Hôm nay", "Hôm qua", còn lại là dd/MM/yyyy.
 *
 * `orderDate` là cột DATE (YYYY-MM-DD) nên so chuỗi thẳng, không đi qua
 * `new Date()` — đi qua là lệch một ngày cho người ở múi giờ khác.
 */
export function dayLabel(orderDate: string, now: Date = new Date()): string {
  const today = vnDateKey(now)
  const yesterday = vnDateKey(new Date(now.getTime() - 86_400_000))
  const key = (orderDate || "").slice(0, 10)
  if (key === today) return "Hôm nay"
  if (key === yesterday) return "Hôm qua"
  const [y, m, d] = key.split("-")
  return y && m && d ? `${d}/${m}/${y}` : "Không rõ ngày"
}

export interface DayGroup<T> {
  label: string
  key: string
  items: T[]
  total: number
}

/**
 * Gom đơn theo ngày đặt, GIỮ THỨ TỰ đầu vào (danh sách đã sắp mới nhất
 * trước). Mỗi nhóm kèm tổng tiền để đầu nhóm in "N đơn · X".
 */
export function groupOrdersByDay<T extends { order_date: string; total: number }>(
  orders: T[],
  now: Date = new Date()
): DayGroup<T>[] {
  const out: DayGroup<T>[] = []
  const byKey = new Map<string, DayGroup<T>>()
  for (const o of orders) {
    const key = (o.order_date || "").slice(0, 10)
    let g = byKey.get(key)
    if (!g) {
      g = { label: dayLabel(o.order_date, now), key, items: [], total: 0 }
      byKey.set(key, g)
      out.push(g)
    }
    g.items.push(o)
    g.total += Number(o.total) || 0
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Dòng thời gian của một đơn                                           */
/* ------------------------------------------------------------------ */

export interface TimelineStep {
  key: string
  label: string
  /** Đã đi qua (kể cả bước hiện tại). */
  done: boolean
  /** Bước hiện tại. */
  current: boolean
  /** ISO, hoặc null khi KHÔNG BIẾT — không đoán giờ. */
  at: string | null
  /** Ai làm — null khi không ghi. */
  by: string | null
  /** Bước huỷ — tô đỏ. */
  error?: boolean
}

export interface TimelineOrder {
  status: string
  created_at: string
  approved_at?: string | null
  approval_reason?: string | null
  sales_user?: { full_name?: string | null } | null
}

export interface TimelineHistoryEntry {
  to_status: string
  changed_at: string
  changer?: { full_name?: string | null } | null
}

const STAGE_ORDER = ["draft", "pending", "confirmed", "picking", "delivering", "delivered"] as const
const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  draft: "Tạo đơn",
  pending: "Gửi duyệt",
  confirmed: "Đã duyệt",
  picking: "Đang lấy hàng",
  delivering: "Đang giao",
  delivered: "Đã giao",
}

/**
 * Dựng dòng thời gian từ dữ liệu THẬT: `created_at`, `approved_at`, và
 * `order_status_history`. Bước nào không có mốc giờ thì để trống —
 * mẫu thiết kế bịa giờ cho đẹp, app thì không.
 *
 * ⚠ "Gửi duyệt" chỉ xuất hiện khi đơn từng bị đưa đi duyệt
 * (`approval_reason` có giá trị). Đơn tự duyệt đi thẳng Tạo đơn → Đã
 * duyệt; vẽ thêm một bước "Gửi duyệt" đã xong là kể một chuyện không có.
 *
 * Đơn HUỶ: giữ các bước đã đi qua, thêm bước "Đã huỷ" tô đỏ ở cuối; các
 * bước chưa tới bị bỏ — không vẽ "Đang giao" mờ cho một đơn đã chết.
 */
export function buildOrderTimeline(
  order: TimelineOrder,
  history: TimelineHistoryEntry[]
): TimelineStep[] {
  const latest = (status: string): TimelineHistoryEntry | undefined =>
    history.filter((h) => h.to_status === status).sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0]

  const sent = !!order.approval_reason
  const stages = STAGE_ORDER.filter((s) => s !== "pending" || sent)

  const currentKey = isSentForApproval(order.status, order.approval_reason) ? "pending" : order.status
  const reached = (() => {
    if (order.status === "cancelled") {
      // Bước xa nhất từng đi qua, theo lịch sử.
      let far = 0
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i]
        if (s === "draft" || s === "pending" || latest(s)) far = i
      }
      return far
    }
    const i = stages.indexOf(currentKey as (typeof STAGE_ORDER)[number])
    return i < 0 ? 0 : i
  })()

  const steps: TimelineStep[] = stages.map((s, i) => {
    const done = i <= reached
    let at: string | null = null
    let by: string | null = null
    if (s === "draft") {
      at = order.created_at
      by = order.sales_user?.full_name ?? null
    } else if (s === "confirmed") {
      const h = latest("confirmed")
      at = h?.changed_at ?? order.approved_at ?? null
      by = h?.changer?.full_name ?? null
    } else if (s !== "pending") {
      const h = latest(s)
      at = h?.changed_at ?? null
      by = h?.changer?.full_name ?? null
    }
    return {
      key: s,
      label: STAGE_LABEL[s],
      done,
      current: order.status !== "cancelled" && i === reached,
      at: done ? at : null,
      by: done ? by : null,
    }
  })

  if (order.status === "cancelled") {
    const h = latest("cancelled")
    return [
      ...steps.filter((st) => st.done),
      {
        key: "cancelled",
        label: ORDER_STATUS_MAP.cancelled?.label ?? "Đã hủy",
        done: true,
        current: true,
        at: h?.changed_at ?? null,
        by: h?.changer?.full_name ?? null,
        error: true,
      },
    ]
  }
  return steps
}
