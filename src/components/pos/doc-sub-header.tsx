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
    <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[#e2e8f0] bg-white px-4">
      <span className="shrink-0 text-[15px] font-bold text-[#0f172a]">{title}</span>
      {code && <span className="n shrink-0 text-[13px] text-[#64748b]">{code}</span>}
      {badge && (
        <span
          className="shrink-0 rounded-[5px] px-2 py-1 text-[10px] font-bold tracking-[0.05em]"
          style={{ background: POS_BADGE_STYLE[badge.tone].bg, color: POS_BADGE_STYLE[badge.tone].fg }}
        >
          {badge.label}
        </span>
      )}
      {subtitle && <span className="ml-1 truncate text-[12px] text-[#64748b]">{subtitle}</span>}
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
      <label htmlFor={id} className="text-[11px] text-[#64748b]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[168px] rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px] font-medium text-[#0f172a]"
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

/** Ô ngày giờ của chứng từ — spec §2, có icon lịch. */
export function SubHeaderDate({
  value,
  onChange,
  label = "Thời điểm phiếu",
}: {
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-[7px] rounded-[7px] border border-[#cbd5e1] bg-white px-2.5">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <input
        className="n w-[124px] border-none text-[12px] text-[#0f172a] outline-none"
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
      ? { bg: "#fffbeb", border: "#fde68a", fg: "#92400e" }
      : { bg: "#eff6ff", border: "#bfdbfe", fg: "#1e3a8a" }
  return (
    <div
      className="shrink-0 rounded-[10px] border px-3.5 py-2.5 text-[12px] font-medium leading-snug"
      style={{ background: t.bg, borderColor: t.border, color: t.fg }}
    >
      {children}
    </div>
  )
}
