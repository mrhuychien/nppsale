import React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ReportColumn<T> {
  key: string
  label: string
  align?: "left" | "right"
  render: (row: T) => React.ReactNode
  className?: string
  /** Force header colspan (used for the totals row) */
}

interface ReportTableProps<T> {
  columns: ReportColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Render an expanded panel below the row */
  expandable?: (row: T) => React.ReactNode
  /** Optional totals row content */
  totalsRow?: React.ReactNode
  /** Empty state text */
  emptyText?: string
}

// Context dùng để báo cho <TotalsRow> biết bảng có cột "mở rộng" (chevron)
// ở đầu hay không, để TotalsRow chèn thêm 1 ô trống dẫn đầu → khỏi lệch cột.
const ReportTableCtx = React.createContext<{ hasExpandColumn: boolean }>({ hasExpandColumn: false })

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  expandable,
  totalsRow,
  emptyText = "Không có dữ liệu trong kỳ",
}: ReportTableProps<T>) {
  const [openKeys, setOpenKeys] = React.useState<Set<string>>(new Set())
  const toggle = (k: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  return (
    <ReportTableCtx.Provider value={{ hasExpandColumn: !!expandable }}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-sky-50 text-foreground print:bg-sky-100">
              {expandable ? <th className="w-8 border-b border-border/40 px-2 py-2"></th> : null}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "border-b border-border/40 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide",
                    c.align === "right" ? "text-right" : "text-left",
                    c.className
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
            {totalsRow ? <>{totalsRow}</> : null}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (expandable ? 1 : 0)}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row)
                const isOpen = expandable && openKeys.has(key)
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={cn(
                        "border-b border-border/30 hover:bg-muted/20",
                        expandable ? "cursor-pointer" : ""
                      )}
                      onClick={expandable ? () => toggle(key) : undefined}
                    >
                      {expandable ? (
                        <td className="px-2 py-3 text-muted-foreground">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                      ) : null}
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 py-3",
                            c.align === "right" ? "text-right" : "text-left",
                            c.className
                          )}
                        >
                          {c.render(row)}
                        </td>
                      ))}
                    </tr>
                    {expandable && isOpen ? (
                      <tr className="bg-emerald-50/40 print:bg-transparent">
                        <td colSpan={columns.length + 1} className="px-2 py-3">
                          {expandable(row)}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </ReportTableCtx.Provider>
  )
}

export function TotalsRow({
  cells,
}: {
  cells: { content: React.ReactNode; colSpan?: number; align?: "left" | "right"; className?: string }[]
}) {
  const { hasExpandColumn } = React.useContext(ReportTableCtx)
  return (
    <tr className="bg-amber-50 font-semibold text-foreground print:bg-amber-100">
      {hasExpandColumn ? <td className="border-b border-border/40 px-2 py-2.5 w-8"></td> : null}
      {cells.map((c, i) => (
        <td
          key={i}
          colSpan={c.colSpan}
          className={cn(
            "border-b border-border/40 px-3 py-2.5",
            c.align === "right" ? "text-right" : "text-left",
            c.className
          )}
        >
          {c.content}
        </td>
      ))}
    </tr>
  )
}
