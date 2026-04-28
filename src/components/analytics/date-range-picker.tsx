"use client"

import { useEffect, useRef, useState } from "react"
import { Calendar, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  PERIOD_LABELS,
  rangeFromPreset,
  formatRangeLabel,
  type DateRange,
  type PeriodPreset,
} from "@/lib/analytics/period"

interface Props {
  value: DateRange
  preset: PeriodPreset
  onChange: (preset: PeriodPreset, range: DateRange) => void
}

const PRESETS_PRIMARY: PeriodPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
]

export function DateRangePicker({ value, preset, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState(value.from)
  const [to, setTo] = useState(value.to)

  useEffect(() => {
    setFrom(value.from)
    setTo(value.to)
  }, [value.from, value.to])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/30"
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span>{formatRangeLabel(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[420px] rounded-xl border border-border/60 bg-card p-4 shadow-lg">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS_PRIMARY.map((p) => (
              <button
                key={p}
                onClick={() => {
                  const r = rangeFromPreset(p)
                  onChange(p, r)
                  setOpen(false)
                }}
                className={cn(
                  "rounded-md border border-transparent px-3 py-1.5 text-left text-sm font-medium",
                  preset === p
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/40"
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-border/50 pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Tùy chỉnh khoảng ngày
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] text-muted-foreground">Từ ngày</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[11px] text-muted-foreground">Đến ngày</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!from || !to) return
                  onChange("custom", { from, to })
                  setOpen(false)
                }}
                className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:brightness-110"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
