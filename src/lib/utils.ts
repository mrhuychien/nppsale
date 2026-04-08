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

export function getAgingStatus(
  dueDate: string
): "current" | "warning" | "overdue" | "critical" {
  const now = new Date()
  const due = new Date(dueDate)
  const daysOverdue = Math.ceil(
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (daysOverdue <= 0) return "current"
  if (daysOverdue <= 30) return "warning"
  if (daysOverdue <= 60) return "overdue"
  return "critical"
}
