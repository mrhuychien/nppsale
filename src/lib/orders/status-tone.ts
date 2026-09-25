import { ORDER_STATUS_MAP, INVOICE_STATUS_MAP } from "@/lib/constants"

/**
 * Màu và nhãn của một đơn trên ĐIỆN THOẠI — theo mẫu thiết kế màn "Đơn
 * của tôi" / "Chi tiết đơn".
 *
 * ⚠ WORKFLOW V2 BỎ TRẠNG THÁI ẢO "CHỜ DUYỆT". Trước đây "đã gửi" là
 * `status = 'draft'` kèm `approval_reason`, phải suy ra mới biết. Giờ
 * `submitted` là một trạng thái thật trong database, nên nhãn và màu đọc
 * thẳng từ nó. `approval_reason` chỉ còn là dòng cảnh báo cho NPP.
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

/**
 * ⚠ ĐỦ SÁU TRẠNG THÁI. Thiếu một khoá thì `orderTone` rơi về màu của
 * `draft` — xám, nghĩa là "chưa gửi" — và một đơn đã giao một phần trông
 * y hệt một đơn chưa ai đụng tới.
 *
 * ⚠ `partially_invoiced` CÙNG MÀU `completed`. Chủ nhà 25/09/2026: "gộp trạng
 * thái Xuất một phần vào Hoàn thành (coi như Hoàn thành) bỏ trạng thái Xuất
 * một phần" — cùng nhãn "Hoàn thành" (ORDER_STATUS_MAP), cùng màu xanh.
 *
 * ⚠ `closed` DÙNG XÁM ĐẬM, không dùng xanh của `completed`. Hai thứ khác
 * nhau: `completed` = đã giao đủ, `closed` = thôi không giao nốt. Cho
 * chúng cùng màu xanh là xoá đúng cái khác biệt ấy khỏi màn hình.
 */
const TONES: Record<string, Omit<OrderTone, "key" | "label">> = {
  draft: { bg: "#eef1f5", fg: "#565a67", accent: "#b9c4d6" },
  submitted: { bg: "#fff4e0", fg: "#8a5a00", accent: "#fdb022" },
  partially_invoiced: { bg: "#e3f5ec", fg: "#004e33", accent: "#22c55e" },
  completed: { bg: "#e3f5ec", fg: "#004e33", accent: "#22c55e" },
  closed: { bg: "#e7e9ee", fg: "#3f4550", accent: "#6b7280" },
  cancelled: { bg: "#fdecec", fg: "#b00020", accent: "#ef5350" },
}

export function orderTone(status: string): OrderTone {
  const t = TONES[status] ?? TONES.draft
  return { key: status, label: ORDER_STATUS_MAP[status]?.label ?? status, ...t }
}

/**
 * Màu và nhãn của một HÓA ĐƠN BÁN — cùng bảng màu với đơn hàng để hai
 * danh sách đọc được bằng một cách nhìn (chủ nhà chốt: hai màn theo cùng
 * một mẫu).
 *
 * ⚠ CHỈ HAI TRẠNG THÁI, và đó là cố ý: hóa đơn sinh ra và ghi sổ trong
 * cùng một RPC (mig 124), không có nháp. Xem `INVOICE_STATUS_MAP`.
 *
 * ⚠ `posted` DÙNG XANH — cùng sắc với `completed` của đơn, vì cả hai
 * đều nghĩa là "xong, không còn việc". Huỷ dùng đỏ như đơn huỷ.
 */
const INVOICE_TONES: Record<string, Omit<OrderTone, "key" | "label">> = {
  posted: { bg: "#e3f5ec", fg: "#004e33", accent: "#22c55e" },
  cancelled: { bg: "#fdecec", fg: "#b00020", accent: "#ef5350" },
}

export function invoiceTone(status: string): OrderTone {
  const t = INVOICE_TONES[status] ?? TONES.draft
  return { key: status, label: INVOICE_STATUS_MAP[status]?.label ?? status, ...t }
}

/**
 * Gom theo ngày cho một loại chứng từ BẤT KỲ.
 *
 * ⚠ `groupOrdersByDay` ở trên GIỮ NGUYÊN và gọi vào đây. Đổi chữ ký của
 * nó là bắt mọi nơi gọi sửa theo, mà nó đang là chỗ duy nhất chốt thứ tự
 * nhóm của danh sách đơn.
 */
export function groupDocsByDay<T>(
  items: T[],
  getDate: (item: T) => string,
  getTotal: (item: T) => number,
  now: Date = new Date()
): DayGroup<T>[] {
  const out: DayGroup<T>[] = []
  const byKey = new Map<string, DayGroup<T>>()
  for (const it of items) {
    const key = (getDate(it) || "").slice(0, 10)
    let g = byKey.get(key)
    if (!g) {
      g = { label: dayLabel(getDate(it), now), key, items: [], total: 0 }
      byKey.set(key, g)
      out.push(g)
    }
    g.items.push(it)
    g.total += Number(getTotal(it)) || 0
  }
  return out
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
  return groupDocsByDay(orders, (o) => o.order_date, (o) => o.total, now)
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
  submitted_at?: string | null
  completed_at?: string | null
  sales_user?: { full_name?: string | null } | null
}

export interface TimelineHistoryEntry {
  to_status: string
  changed_at: string
  changer?: { full_name?: string | null } | null
}

const STAGE_ORDER = ["draft", "submitted", "completed"] as const
const STAGE_LABEL: Record<(typeof STAGE_ORDER)[number], string> = {
  draft: "Tạo đơn",
  submitted: "Gửi đơn",
  completed: "Xuất hàng",
}

/**
 * Dựng dòng thời gian từ dữ liệu THẬT: `created_at`, `submitted_at`,
 * `completed_at` và `order_status_history`. Bước nào không có mốc giờ thì
 * để trống — mẫu thiết kế bịa giờ cho đẹp, app thì không.
 *
 * ⚠ Đơn cũ (trước workflow v2) không có `submitted_at`: backfill cố ý để
 * trống thay vì lấy `created_at` cho đủ chỗ. Bước "Gửi đơn" của chúng vẫn
 * hiện là đã qua, nhưng không có giờ — đúng với những gì biết được.
 *
 * Đơn HUỶ: giữ các bước đã đi qua, thêm bước "Đã huỷ" tô đỏ ở cuối; các
 * bước chưa tới bị bỏ — không vẽ bước mờ cho một đơn đã chết.
 */
export function buildOrderTimeline(
  order: TimelineOrder,
  history: TimelineHistoryEntry[]
): TimelineStep[] {
  const latest = (status: string): TimelineHistoryEntry | undefined =>
    history.filter((h) => h.to_status === status).sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0]

  const stages = STAGE_ORDER
  const reached = (() => {
    if (order.status === "cancelled") {
      // Bước xa nhất từng đi qua, theo lịch sử.
      let far = 0
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i]
        if (s === "draft" || latest(s)) far = i
      }
      return far
    }
    const i = stages.indexOf(order.status as (typeof STAGE_ORDER)[number])
    return i < 0 ? 0 : i
  })()

  const steps: TimelineStep[] = stages.map((s, i) => {
    const done = i <= reached
    let at: string | null = null
    let by: string | null = null
    if (s === "draft") {
      at = order.created_at
      by = order.sales_user?.full_name ?? null
    } else if (s === "submitted") {
      at = latest("submitted")?.changed_at ?? order.submitted_at ?? null
      by = latest("submitted")?.changer?.full_name ?? order.sales_user?.full_name ?? null
    } else {
      const h = latest(s)
      at = h?.changed_at ?? order.completed_at ?? null
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
