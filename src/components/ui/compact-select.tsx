"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * Ô chọn gọn thay `<select>` gốc của trình duyệt — để mọi danh sách thả
 * xuống có ô tìm (chủ nhà yêu cầu 23/09/2026). Dựng trên `Select` dùng
 * chung, nên ô tìm tự hiện khi có từ `NGUONG_O_TIM` lựa chọn.
 *
 * ⚠ GIÁ TRỊ RỖNG. `<select>` gốc hay có `<option value="">chưa chọn…</option>`;
 *   `SelectItem` của Radix KHÔNG nhận `value=""`. Ô này đổi rỗng ↔ một khoá
 *   riêng ở trong, nơi gọi vẫn nhận và đưa chuỗi rỗng như cũ.
 */
const RONG = "__rong__"

export interface CompactOption {
  value: string
  label: string
}

export function CompactSelect({
  value,
  onChange,
  options,
  emptyLabel,
  ariaLabel,
  className,
  disabled,
  title,
  id,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly CompactOption[]
  /** Có thì thêm dòng "rỗng" đứng đầu với nhãn này. */
  emptyLabel?: string
  ariaLabel: string
  className?: string
  disabled?: boolean
  title?: string
  id?: string
}) {
  return (
    <Select
      /* ⚠ Luôn CÓ ĐIỀU KHIỂN: "" (Radix hiện chữ mờ) chứ không `undefined` —
         `undefined` là Select tự giữ giá trị, và nơi gọi đặt lại "" sau khi
         người dùng đã chọn thì ô vẫn hiện lựa chọn cũ. */
      value={value === "" ? (emptyLabel !== undefined ? RONG : "") : value}
      onValueChange={(v) => onChange(v === RONG ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} title={title} className={cn("h-7 px-1.5 text-[11.5px]", className)}>
        <SelectValue placeholder={emptyLabel ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel !== undefined && <SelectItem value={RONG}>{emptyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
