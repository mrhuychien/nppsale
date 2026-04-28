"use client"

import { Printer, Download, FileSpreadsheet } from "lucide-react"
import { DateRangePicker } from "./date-range-picker"
import {
  type DateRange,
  type PeriodPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { cn } from "@/lib/utils"

export interface VariantOption<T extends string> {
  key: T
  label: string
}

interface ReportShellProps<T extends string> {
  title: string
  variants: readonly VariantOption<T>[]
  variant: T
  onVariantChange: (v: T) => void
  range: DateRange
  preset: PeriodPreset
  onChangeRange: (preset: PeriodPreset, range: DateRange) => void
  /** Extra filter widgets to show inside the left panel */
  filters?: React.ReactNode
  /** Optional CSV export handler. If omitted the button is hidden. */
  onExportCsv?: () => void
  children: React.ReactNode
  branchName?: string
  /** Additional toggles like "Gộp hàng cùng loại" */
  extraOptions?: React.ReactNode
}

export function ReportShell<T extends string>({
  title,
  variants,
  variant,
  onVariantChange,
  range,
  preset,
  onChangeRange,
  filters,
  onExportCsv,
  children,
  branchName,
  extraOptions,
}: ReportShellProps<T>) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => typeof window !== "undefined" && window.print()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Printer className="h-4 w-4" /> In báo cáo
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr] print:block">
        {/* Left filter panel */}
        <aside className="space-y-4 print:hidden">
          {onExportCsv ? (
            <button
              type="button"
              onClick={onExportCsv}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm font-semibold hover:bg-muted/30"
            >
              <FileSpreadsheet className="h-4 w-4" /> Xuất tất cả
            </button>
          ) : null}

          <div>
            <p className="mb-1.5 text-xs font-semibold text-foreground">
              Mối quan tâm <span className="text-primary">•</span>
            </p>
            <select
              value={variant}
              onChange={(e) => onVariantChange(e.target.value as T)}
              className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
            >
              {variants.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {extraOptions}

          <div>
            <p className="mb-1.5 text-xs font-semibold text-foreground">Thời gian</p>
            <DateRangePicker value={range} preset={preset} onChange={onChangeRange} />
            <p className="mt-1.5 text-xs text-muted-foreground">{formatRangeLabel(range)}</p>
          </div>

          {filters}
        </aside>

        {/* Right content */}
        <div className="min-w-0 space-y-4">
          <div className="hidden print:block">
            <p className="text-xs text-muted-foreground">
              Ngày lập: {new Date().toLocaleString("vi-VN")}
            </p>
            <h1 className="mt-1 text-center text-xl font-bold uppercase">{title}</h1>
            <p className="text-center text-sm">
              Từ ngày {formatRangeLabel(range).split(" - ")[0]} đến ngày{" "}
              {formatRangeLabel(range).split(" - ")[1]}
            </p>
            {branchName ? <p className="text-center text-sm">Chi nhánh: {branchName}</p> : null}
          </div>
          <div className="rounded-xl border border-border/40 bg-card p-4 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FilterField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
      {children}
    </div>
  )
}

export function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border/60"
      />
      <span>{label}</span>
    </label>
  )
}

export function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | ""
  onChange: (v: T | "") => void
  options: { key: T; label: string }[]
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T | "")}
      className={cn(
        "h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm",
        value === "" ? "text-muted-foreground" : "text-foreground"
      )}
    >
      <option value="">{placeholder || "Tất cả"}</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export { Download, Printer }
