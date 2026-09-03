"use client"

import { useEffect, useRef, useState } from "react"
import { Printer, Download, FileSpreadsheet, ChevronDown, X, SlidersHorizontal } from "lucide-react"
import { DateRangePicker } from "./date-range-picker"
import {
  type DateRange,
  type PeriodPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { cn } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { useClientNow } from "@/hooks/use-client-now"

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
  // On mobile the filter panel is collapsed by default so the report
  // data is visible immediately. Tapping "Bộ lọc" expands it.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const printedAt = useClientNow()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 text-sm font-semibold hover:bg-muted/30 lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" /> Bộ lọc
          </button>
          <button
            type="button"
            onClick={() => typeof window !== "undefined" && window.print()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">In báo cáo</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr] print:block">
        {/* Left filter panel — collapsed on mobile unless toggled */}
        <aside className={cn("space-y-4 print:hidden", filtersOpen ? "block" : "hidden lg:block")}>
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
              Ngày lập: {printedAt}
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

// =====================================================================
// FilterSearchSelect — searchable dropdown linked to DB-backed lists.
// Use for "Khách hàng / Nhân viên / Hàng hóa / Bảng giá" filters where
// admin picks 1 record from many.
// =====================================================================

export interface FilterOption {
  id: string
  label: string
  /** Optional secondary label shown smaller (vd: SKU / phone). */
  hint?: string
}

export function FilterSearchSelect({
  value,
  onChange,
  options,
  placeholder = "Tất cả",
  emptyText = "Không có dữ liệu",
  loading = false,
}: {
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
  placeholder?: string
  emptyText?: string
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const selected = options.find((o) => o.id === value)
  const q = viNormalize(query)
  const filtered = !q
    ? options
    : options.filter(
        (o) =>
          viIncludes(o.label, q) ||
          viIncludes((o.hint || ""), q)
      )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2 text-sm",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span className="truncate">
          {selected ? selected.label : loading ? "Đang tải..." : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Xoá lựa chọn"
              onClick={(e) => {
                e.stopPropagation()
                onChange("")
              }}
              className="rounded p-0.5 hover:bg-muted/60 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border/60 bg-card shadow-lg">
          <div className="border-b border-border/50 p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm…"
              className="h-8 w-full rounded-md border border-border/40 bg-background px-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("")
                  setOpen(false)
                  setQuery("")
                }}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40 text-muted-foreground"
              >
                <span>{placeholder}</span>
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-center text-xs text-muted-foreground">
                {emptyText}
              </li>
            ) : (
              filtered.slice(0, 100).map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id)
                      setOpen(false)
                      setQuery("")
                    }}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40",
                      value === o.id ? "bg-primary/10 font-semibold" : ""
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                        {o.hint}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
            {filtered.length > 100 && (
              <li className="px-2 py-1.5 text-center text-[10px] text-muted-foreground">
                Hiển thị 100/{filtered.length} kết quả — gõ để lọc
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// FilterMultiSelect — chọn NHIỀU bản ghi cùng lúc (sản phẩm 1 + sản
// phẩm 2 + …). Dùng cho các bộ lọc báo cáo cho phép chọn nhiều biến.
// value = mảng id đã chọn; onChange trả về mảng mới.
// =====================================================================

export function FilterMultiSelect({
  value,
  onChange,
  options,
  placeholder = "Tất cả",
  emptyText = "Không có dữ liệu",
  loading = false,
}: {
  value: string[]
  onChange: (v: string[]) => void
  options: FilterOption[]
  placeholder?: string
  emptyText?: string
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const selectedSet = new Set(value)
  const selectedOpts = options.filter((o) => selectedSet.has(o.id))
  const q = viNormalize(query)
  const filtered = !q
    ? options
    : options.filter(
        (o) =>
          viIncludes(o.label, q) ||
          viIncludes((o.hint || ""), q)
      )

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((v) => v !== id))
    else onChange([...value, id])
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2 py-1 text-sm",
          value.length > 0 ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span className="flex flex-1 flex-wrap items-center gap-1 text-left">
          {value.length === 0 ? (
            <span>{loading ? "Đang tải..." : placeholder}</span>
          ) : selectedOpts.length <= 2 ? (
            selectedOpts.map((o) => (
              <span key={o.id} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {o.label}
                <X
                  className="h-2.5 w-2.5 cursor-pointer hover:text-primary/70"
                  onClick={(e) => { e.stopPropagation(); toggle(o.id) }}
                />
              </span>
            ))
          ) : (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              Đã chọn {value.length}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Xoá tất cả"
              onClick={(e) => { e.stopPropagation(); onChange([]) }}
              className="rounded p-0.5 hover:bg-muted/60 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border/60 bg-card shadow-lg">
          <div className="flex items-center gap-1 border-b border-border/50 p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm…"
              className="h-8 w-full rounded-md border border-border/40 bg-background px-2 text-sm focus:outline-none focus:border-primary"
            />
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted/60"
              >
                Bỏ chọn
              </button>
            )}
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-center text-xs text-muted-foreground">{emptyText}</li>
            ) : (
              filtered.slice(0, 200).map((o) => {
                const checked = selectedSet.has(o.id)
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/40",
                        checked ? "bg-primary/5" : ""
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border/60"
                      )}>
                        {checked && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className="flex-1 truncate">{o.label}</span>
                      {o.hint && (
                        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">{o.hint}</span>
                      )}
                    </button>
                  </li>
                )
              })
            )}
            {filtered.length > 200 && (
              <li className="px-2 py-1.5 text-center text-[10px] text-muted-foreground">
                Hiển thị 200/{filtered.length} — gõ để lọc
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
