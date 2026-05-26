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
  format?: "currency" | "number" | "compactCurrency" | "raw"
}

function formatCompactCurrency(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} triệu`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return new Intl.NumberFormat("vi-VN").format(Math.round(n))
}

function format(value: number | string, kind?: KpiCardProps["format"]): string {
  if (typeof value === "string") return value
  switch (kind) {
    case "currency":
      return formatCurrency(value)
    case "compactCurrency":
      return formatCompactCurrency(value)
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
  return (
    <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-card">
      <p className="text-label-md uppercase text-on-surface-variant">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-on-surface tabular-data">
        {format(value, fmt)}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-xs">
        <div>
          <p className="text-on-surface-variant">{avgLabel}</p>
          <p className="font-semibold text-on-surface tabular-data">
            {avgValue !== undefined ? format(avgValue, fmt === "compactCurrency" ? "number" : fmt) : "—"}
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
