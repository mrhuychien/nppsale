import { cn, formatCurrency } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: number | string
  /** Average per day (or any sub-metric) shown as small caption. */
  avgValue?: number | string
  avgLabel?: string
  /** Percent change vs previous period. Positive = green, negative = red. */
  changePct?: number | null
  changeLabel?: string
  /**
   * `compactCurrency` được giữ lại cho tương thích nơi gọi, nhưng giờ hiện
   * ĐỦ SỐ như `currency` (9.000.000đ). Chủ nhà chốt: "Các hiển thị số tiền
   * thêm dấu . tách khối 3 số VD 9.000.000" — bản rút gọn "9.00 triệu" /
   * "500K" vừa sai dấu thập phân kiểu Việt vừa không đối chiếu được.
   */
  format?: "currency" | "number" | "compactCurrency" | "raw"
}

/** Cỡ chữ theo độ dài: số tiền đủ chữ số (1.234.567.890đ) không được tràn
 *  thẻ ở lưới 4 cột. */
function valueSizeClass(text: string): string {
  if (text.length <= 11) return "text-3xl"
  if (text.length <= 14) return "text-2xl"
  return "text-xl"
}

function format(value: number | string, kind?: KpiCardProps["format"]): string {
  if (typeof value === "string") return value
  switch (kind) {
    case "currency":
    case "compactCurrency":
      return formatCurrency(value)
    case "raw":
      return String(value)
    case "number":
    default:
      return new Intl.NumberFormat("vi-VN").format(Math.round(value))
  }
}

export function KpiCard({
  label,
  value,
  avgValue,
  avgLabel = "Trung bình/ngày",
  changePct,
  changeLabel = "So với kỳ trước",
  format: fmt = "compactCurrency",
}: KpiCardProps) {
  const change = typeof changePct === "number" ? changePct : null
  const shown = format(value, fmt)
  return (
    <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-card">
      <p className="text-label-md uppercase text-on-surface-variant">{label}</p>
      <p
        title={shown}
        className={cn(
          "mt-1 font-bold tracking-tight text-on-surface tabular-data tabular-nums [overflow-wrap:anywhere]",
          valueSizeClass(shown)
        )}
      >
        {shown}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-xs">
        <div>
          <p className="text-on-surface-variant">{avgLabel}</p>
          <p className="font-semibold text-on-surface tabular-data">
            {avgValue !== undefined ? format(avgValue, fmt) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-on-surface-variant">{changeLabel}</p>
          <p
            className={cn(
              "font-semibold tabular-data",
              change === null
                ? "text-on-surface-variant"
                : change >= 0
                  ? "text-tertiary"
                  : "text-error"
            )}
          >
            {change === null
              ? "—"
              : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
          </p>
        </div>
      </div>
    </div>
  )
}
