"use client"

/**
 * SUB-HEADER — loại chứng từ · mã · badge · phụ đề | select ngữ cảnh · ngày.
 * Spec §2 và §7.
 */

import type { ReactNode } from "react"
import { POS_BADGE_STYLE, type PosBadge } from "@/lib/pos/types"

export function DocSubHeader({
  title,
  code,
  badge,
  subtitle,
  right,
}: {
  title: string
  code?: string | null
  badge?: PosBadge | null
  /** Ví dụ: `Tạo offline · chưa kiểm tồn`, hoặc `Đã xuất 1 lần · HD-0143`. */
  subtitle?: ReactNode
  /** Select ngữ cảnh + ngày giờ, mỗi chứng từ một bộ. */
  right?: ReactNode
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--pos-line-soft)] bg-white px-5">
      <span className="shrink-0 text-[19px] font-extrabold tracking-[-0.3px] text-[var(--pos-ink)]">{title}</span>
      {code && <span className="n shrink-0 text-[13px] font-bold text-[var(--pos-muted)]">{code}</span>}
      {badge && (
        <span
          className="shrink-0 rounded-[6px] px-[7px] py-px text-[11px] font-extrabold"
          style={{ background: POS_BADGE_STYLE[badge.tone].bg, color: POS_BADGE_STYLE[badge.tone].fg }}
        >
          {badge.label}
        </span>
      )}
      {subtitle && <span className="ml-1 truncate text-[13px] font-semibold text-[var(--pos-muted)]">{subtitle}</span>}
      <div className="flex-grow" />
      {right}
    </div>
  )
}

/** Ô select có nhãn bên trái — dùng cho NVBH / tuyến / kho. */
export function SubHeaderSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; label: string }>
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[38px] max-w-[180px] rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white px-2.5 text-[13px] font-bold text-[var(--pos-ink)]"
      >
        {/* ⚠ Có lựa chọn rỗng RÕ RÀNG. Một select không có ô trống là
            người dùng không có cách nào bỏ chọn thứ họ lỡ chọn. */}
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Hôm nay theo giờ máy, dạng `YYYY-MM-DD` — giá trị mặc định cho ô ngày. */
export function homNay(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Ô ngày của chứng từ — spec §2, có icon lịch.
 *
 * ⚠ `type="date"`, KHÔNG PHẢI Ô CHỮ TỰ DO. Bản đầu là `type="text"`, và
 * giá trị ấy đi thẳng vào cột `date` của `purchase_invoices` /
 * `supplier_returns` — người dùng gõ `21/09/2026` là Postgres từ chối
 * cả phiếu. Ô ngày của trình duyệt chỉ cho ra `YYYY-MM-DD`.
 *
 * ⚠ `readOnly` cho những chứng từ mà ngày do máy chủ đặt lúc ghi sổ
 * (đơn hàng, hóa đơn, phiếu trả): vẫn hiện để người dùng biết, nhưng
 * không mời họ đổi một thứ không lưu.
 */
export function SubHeaderDate({
  value,
  onChange,
  label = "Ngày chứng từ",
  readOnly,
}: {
  value: string
  onChange?: (v: string) => void
  label?: string
  readOnly?: boolean
}) {
  return (
    <div
      className={`flex h-[38px] shrink-0 items-center gap-[7px] rounded-[10px] border-[1.5px] border-[var(--pos-edge)] px-2.5 ${
        readOnly ? "bg-[var(--pos-head)]" : "bg-white"
      }`}
      title={readOnly ? `${label} ghi theo lúc lưu` : undefined}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--pos-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <input
        className={`n w-[132px] border-none bg-transparent text-[13px] font-bold outline-none ${
          readOnly ? "text-[var(--pos-muted)]" : "text-[var(--pos-ink)]"
        }`}
        type="date"
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}

/**
 * BANNER ĐẦU CỘT TRÁI — spec §7.
 *
 * ⚠ BANNER MÔ TẢ CƠ CHẾ ĐANG CÓ, không mô tả một cơ chế mới. Spec ghi
 * rõ: "Chỉnh lại câu chữ cho khớp hành vi thật nếu khác". Một banner
 * hứa điều phần mềm không làm còn tệ hơn không có banner.
 */
export function DocBanner({
  tone = "blue",
  children,
}: {
  tone?: "blue" | "warn"
  children: ReactNode
}) {
  const t =
    tone === "warn"
      ? { bg: "var(--pos-warn-soft)", border: "var(--pos-warn-border)", fg: "var(--pos-warn)" }
      : { bg: "var(--pos-primary-faint)", border: "var(--pos-primary-border)", fg: "var(--pos-primary-deep)" }
  return (
    <div
      className="shrink-0 rounded-[10px] border px-3.5 py-2.5 text-[12px] font-bold leading-relaxed"
      style={{ background: t.bg, borderColor: t.border, color: t.fg }}
    >
      {children}
    </div>
  )
}
