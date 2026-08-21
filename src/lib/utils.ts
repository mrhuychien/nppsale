import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount)) + "đ"
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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
