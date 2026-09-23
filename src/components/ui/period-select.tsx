"use client"

/**
 * Ô CHỌN KỲ cho các danh sách — Hôm nay / Tuần này / Tháng này / Tất cả.
 *
 * ⚠ CHỦ NHÀ CHỐT 23/09/2026: "Các danh sách có bộ lọc thời gian: Mặc định để
 *   tháng này. Tuỳ chọn: Hôm nay, Tuần này, Tháng này, Tất cả". Một ô dùng
 *   chung để mọi danh sách nói cùng một bộ chữ và cùng một phép tính kỳ
 *   (`periodFrom` — giờ Việt Nam, tuần từ thứ Hai).
 *
 * ⚠ "Tuỳ chọn" chỉ hiện khi hai ô ngày đang giữ một khoảng không trùng kỳ
 *   nào — để ô này không nói "Tháng này" trong khi danh sách lọc thứ khác.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LIST_PERIODS, LIST_PERIOD_LABEL, type ListPeriod } from "@/lib/orders/list-summary"
import { cn } from "@/lib/utils"

export function PeriodSelect({
  value,
  onChange,
  className,
}: {
  value: ListPeriod | "custom"
  onChange: (p: ListPeriod) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => { if (v !== "custom") onChange(v as ListPeriod) }}>
      <SelectTrigger aria-label="Khoảng thời gian" className={cn("h-10 w-[130px] rounded-xl font-semibold", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LIST_PERIODS.map((k) => (
          <SelectItem key={k} value={k}>{LIST_PERIOD_LABEL[k]}</SelectItem>
        ))}
        {value === "custom" && <SelectItem value="custom">Tuỳ chọn</SelectItem>}
      </SelectContent>
    </Select>
  )
}
