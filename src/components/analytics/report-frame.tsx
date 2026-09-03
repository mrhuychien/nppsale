"use client"

import { useState } from "react"
import { Printer, Download, SlidersHorizontal } from "lucide-react"
import { DateRangePicker } from "./date-range-picker"
import { cn } from "@/lib/utils"
import { type DateRange, type PeriodPreset, formatRangeLabel } from "@/lib/analytics/period"
import { useClientNow } from "@/hooks/use-client-now"

interface ReportFrameProps {
  title: string
  subtitle?: string
  range?: DateRange
  preset?: PeriodPreset
  onChangeRange?: (preset: PeriodPreset, range: DateRange) => void
  onExportCsv?: () => void
  children: React.ReactNode
  /** Optional company / branch name */
  branchName?: string
  /** Left filter sidebar — same slot pattern as ReportShell */
  filters?: React.ReactNode
}

export function ReportFrame({
  title,
  subtitle,
  range,
  preset,
  onChangeRange,
  onExportCsv,
  children,
  branchName,
  filters,
}: ReportFrameProps) {
  const printedAt = useClientNow()
  const [filtersOpen, setFiltersOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {range && preset && onChangeRange ? (
            <DateRangePicker value={range} preset={preset} onChange={onChangeRange} />
          ) : null}
          {filters ? (
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 text-sm font-medium hover:bg-muted/30 lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" /> Bộ lọc
            </button>
          ) : null}
          {onExportCsv ? (
            <button
              type="button"
              onClick={onExportCsv}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 text-sm font-medium hover:bg-muted/30"
            >
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">Xuất Excel</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => typeof window !== "undefined" && window.print()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">In báo cáo</span>
          </button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <p className="text-xs text-muted-foreground">
          Ngày lập: {printedAt}
        </p>
        <h1 className="mt-1 text-center text-xl font-bold uppercase">{title}</h1>
        {range ? (
          <p className="text-center text-sm">
            Từ ngày {formatRangeLabel(range).split(" - ")[0]} đến ngày {formatRangeLabel(range).split(" - ")[1]}
          </p>
        ) : null}
        {branchName ? <p className="text-center text-sm">Chi nhánh: {branchName}</p> : null}
      </div>

      {filters ? (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr] print:block">
          <aside className={cn("space-y-4 print:hidden", filtersOpen ? "block" : "hidden lg:block")}>{filters}</aside>
          <div className="min-w-0">
            <div className="rounded-xl border border-border/40 bg-card p-4 sm:p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          {children}
        </div>
      )}
    </div>
  )
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((c) => {
          const s = String(c ?? "")
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`
          }
          return s
        })
        .join(",")
    )
    .join("\n")
  const bom = "﻿"
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export rows as a real .xlsx workbook. The xlsx library is loaded
 * dynamically so it doesn't bloat the initial bundle for users who
 * never click the export button.
 *
 * The first row is treated as the header. Numeric values are written
 * as numbers (not strings) so Excel keeps them right-aligned and
 * formula-friendly.
 */
export async function downloadXlsx(
  filename: string,
  rows: (string | number)[][],
  sheetName: string = "Sheet1"
) {
  const XLSX = await import("xlsx")

  // Auto-fit column widths based on the longest cell string in each
  // column (capped so very long descriptions don't blow up the layout).
  const ws = XLSX.utils.aoa_to_sheet(rows)
  if (rows.length > 0) {
    const cols = rows[0].map((_, colIdx) => {
      let max = 8
      for (const row of rows) {
        const v = row[colIdx]
        if (v === null || v === undefined) continue
        const len = String(v).length
        if (len > max) max = len
      }
      return { wch: Math.min(max + 2, 60) }
    })
    ws["!cols"] = cols
  }
  // Make the header row bold by referencing a stand-alone bold style;
  // SheetJS community edition does not write styles, but assigning
  // !rows[0].s won't error and helps when users open in Google Sheets.
  ws["!rows"] = [{ hpt: 20 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)) // Excel cap
  // Ensure the filename ends with .xlsx
  const safe = filename.replace(/\.(csv|xls|xlsx)$/i, "") + ".xlsx"
  XLSX.writeFile(wb, safe)
}
