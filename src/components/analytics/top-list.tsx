import Link from "next/link"
import { ArrowUpDown } from "lucide-react"
import { cn, formatCurrency } from "@/lib/utils"

export interface TopListColumn<T> {
  key: string
  label: string
  align?: "left" | "right"
  /** Render the cell value. Use string or number with formatter. */
  render: (row: T) => React.ReactNode
  className?: string
}

interface TopListProps<T> {
  title: string
  description?: string
  detailHref?: string
  rows: T[]
  columns: TopListColumn<T>[]
  emptyText?: string
  rowKey: (row: T) => string
}

export function TopListCard<T>({
  title,
  description,
  detailHref,
  rows,
  columns,
  emptyText = "Chưa có dữ liệu",
  rowKey,
}: TopListProps<T>) {
  return (
    <div className="rounded-xl border border-border/40 bg-card shadow-sm">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {detailHref ? (
          <Link
            href={detailHref}
            className="text-sm font-medium text-primary hover:underline"
          >
            Chi tiết
          </Link>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border/40 bg-muted/30 text-muted-foreground">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-5 py-2 text-xs font-semibold uppercase tracking-wide",
                    c.align === "right" ? "text-right" : "text-left",
                    c.className
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-border/30 hover:bg-muted/20"
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-5 py-3",
                        c.align === "right" ? "text-right" : "text-left",
                        c.className
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-on-surface-variant">—</span>
  const positive = pct >= 0
  return (
    <span className={cn("font-semibold tabular-data", positive ? "text-tertiary" : "text-error")}>
      {positive ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  )
}

export function MoneyCell({ value }: { value: number }) {
  return <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
}

export function NumberCell({ value }: { value: number }) {
  return (
    <span className="font-medium tabular-nums">
      {new Intl.NumberFormat("vi-VN").format(Math.round(value))}
    </span>
  )
}
