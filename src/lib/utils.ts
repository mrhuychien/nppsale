import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

/**
 * Múi giờ dùng cho MỌI chỗ hiển thị ngày/giờ.
 *
 * VÌ SAO PHẢI GHIM CỨNG
 * Không đặt `timeZone` thì `toLocaleDateString` lấy múi giờ của MÁY ĐANG
 * CHẠY. Hai hậu quả:
 *
 *  1. SAI NGÀY. Vercel chạy UTC. Một mốc timestamptz lúc 20:00 giờ Việt Nam
 *     ngày 20/04 là 13:00 UTC cùng ngày — chỗ này thì trùng. Nhưng 02:00
 *     giờ Việt Nam ngày 21/04 là 19:00 UTC ngày 20/04, nên server in ra
 *     20/04 còn điện thoại in 21/04. Đơn tạo lúc nửa đêm hiện sai ngày.
 *
 *  2. LỆCH HYDRATION. Next.js render trước ở server rồi khớp lại ở trình
 *     duyệt. Hai bên ra hai chuỗi khác nhau thì React báo lỗi #418/#423 —
 *     đúng nhóm lỗi console mà đợt kiểm thử trên điện thoại ghi lại.
 *
 * Tài liệu thiết kế của dự án (design-ux-ui/SKILL.md) vốn đã ghi
 * "vi-VN, Asia/Ho_Chi_Minh"; mã nguồn chỉ đơn giản là chưa làm đúng.
 */
export const VN_TZ = "Asia/Ho_Chi_Minh"

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: VN_TZ,
  })
}

/** Ngày + giờ, cùng múi giờ với `formatDate`. */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: VN_TZ,
  })
}

export function generateOrderCode(): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `SO-${dateStr}-${rand}`
}

export function generatePOCode(): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `PO-${dateStr}-${rand}`
}

export function getExpiryStatus(
  expiresAt: string,
  shelfLifeDays?: number
): "ok" | "warning" | "danger" {
  const now = new Date()
  const expiry = new Date(expiresAt)
  const daysLeft = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (daysLeft <= 30) return "danger"
  if (shelfLifeDays && daysLeft <= shelfLifeDays / 3) return "warning"
  return "ok"
}

/**
 * Phân nhóm tuổi nợ theo số ngày QUÁ HẠN.
 *
 * So sánh theo NGÀY LỊCH, cố ý bỏ qua giờ. Bản trước lấy
 * `now.getTime() - new Date(dueDate).getTime()` rồi `Math.ceil`, sinh hai
 * lỗi:
 *
 *   • `new Date("2026-08-21")` được hiểu là nửa đêm UTC = 07:00 giờ Việt
 *     Nam. Nên một phiếu đến hạn HÔM NAY hiện "Hiện tại" lúc 6 giờ sáng và
 *     đột ngột đổi thành "Cảnh báo" lúc 7 giờ — cùng một phiếu, cùng một
 *     ngày, hai màu khác nhau.
 *   • Phiếu đến hạn hôm nay bị tính là đã quá hạn 1 ngày. Đến hạn hôm nay
 *     thì chưa quá hạn.
 *
 * Ngưỡng ở đây PHẢI khớp với hàm SQL `receivables_summary()` trong
 * migration 093 (nơi tính các ô tổng đầu trang Công nợ). Có test khoá hai
 * bên lại với nhau: tests/aging-thresholds.test.ts.
 */
export function getAgingStatus(
  dueDate: string
): "current" | "warning" | "overdue" | "critical" {
  // Cắt phần giờ ở cả hai vế rồi mới trừ.
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number)
  const due = Date.UTC(y, (m || 1) - 1, d || 1)

  const daysOverdue = Math.round((today - due) / (1000 * 60 * 60 * 24))
  if (daysOverdue <= 0) return "current"
  if (daysOverdue <= 30) return "warning"
  if (daysOverdue <= 60) return "overdue"
  return "critical"
}
