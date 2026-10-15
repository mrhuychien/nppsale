"use client"

import { cn } from "@/lib/utils"
import { MOC_THOI_GIAN, type MocThoiGian } from "@/lib/customers/ban-giao"

/** Mốc "đã lấy hàng": 3 / 6 / 12 tháng / Tất cả (chủ nhà 15/10/2026: "Cho chọn các mốc"). */
export function ChonMocThoiGian({
  value,
  onChange,
  disabled,
  className,
}: {
  value: MocThoiGian
  onChange: (m: MocThoiGian) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div role="group" aria-label="Thời gian đã lấy hàng" className={cn("inline-flex flex-wrap gap-1", className)}>
      {MOC_THOI_GIAN.map((m) => (
        <button
          key={m.key}
          type="button"
          disabled={disabled}
          aria-pressed={value === m.key}
          data-testid={`moc-${m.key}`}
          onClick={() => onChange(m.key)}
          className={cn(
            "h-9 rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            value === m.key ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/40"
          )}
        >
          {m.nhan}
        </button>
      ))}
    </div>
  )
}
