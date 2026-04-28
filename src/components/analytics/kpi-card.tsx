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
    <div className="rounded-xl border border-border/40 bg-card p-4 shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
        {format(value, fmt)}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">{avgLabel}</p>
          <p className="font-semibold text-foreground">
            {avgValue !== undefined ? format(avgValue, fmt === "compactCurrency" ? "number" : fmt) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">{changeLabel}</p>
          <p
            className={cn(
              "font-semibold",
              change === null
                ? "text-muted-foreground"
                : change >= 0
                  ? "text-emerald-600"
                  : "text-red-600"
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
