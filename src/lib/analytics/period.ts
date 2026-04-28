export type PeriodPreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "custom"

export interface DateRange {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Hôm nay",
  yesterday: "Hôm qua",
  this_week: "Tuần này",
  last_week: "Tuần trước",
  this_month: "Tháng này",
  last_month: "Tháng trước",
  this_quarter: "Quý này",
  this_year: "Năm nay",
  custom: "Tùy chỉnh",
}

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay() // Sun=0
  const diff = day === 0 ? 6 : day - 1
  out.setDate(out.getDate() - diff)
  out.setHours(0, 0, 0, 0)
  return out
}

export function rangeFromPreset(preset: PeriodPreset, custom?: DateRange): DateRange {
  const now = new Date()
  let from: Date
  let to: Date = new Date(now)

  switch (preset) {
    case "today":
      from = new Date(now)
      from.setHours(0, 0, 0, 0)
      break
    case "yesterday": {
      from = new Date(now)
      from.setDate(now.getDate() - 1)
      from.setHours(0, 0, 0, 0)
      to = new Date(from)
      to.setHours(23, 59, 59, 999)
      break
    }
    case "this_week":
      from = startOfWeek(now)
      break
    case "last_week": {
      const endLast = startOfWeek(now)
      endLast.setDate(endLast.getDate() - 1)
      from = startOfWeek(endLast)
      to = endLast
      break
    }
    case "this_month":
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case "last_month":
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      to = new Date(now.getFullYear(), now.getMonth(), 0)
      break
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3)
      from = new Date(now.getFullYear(), q * 3, 1)
      break
    }
    case "this_year":
      from = new Date(now.getFullYear(), 0, 1)
      break
    case "custom":
    default:
      if (custom) return { from: custom.from, to: custom.to }
      from = new Date(now)
      from.setHours(0, 0, 0, 0)
      break
  }
  return { from: fmt(from), to: fmt(to) }
}

export function previousRange(range: DateRange): DateRange {
  const fromD = new Date(range.from + "T00:00:00")
  const toD = new Date(range.to + "T00:00:00")
  const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1)
  const prevTo = new Date(fromD)
  prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevTo.getDate() - days + 1)
  return { from: fmt(prevFrom), to: fmt(prevTo) }
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

export function formatRangeLabel(r: DateRange): string {
  const f = new Date(r.from + "T00:00:00")
  const t = new Date(r.to + "T00:00:00")
  const fmt2 = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
  return `${fmt2(f)} - ${fmt2(t)}`
}

export function daysBetween(r: DateRange): number {
  const f = new Date(r.from + "T00:00:00")
  const t = new Date(r.to + "T00:00:00")
  return Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1)
}

export function dailyBuckets(r: DateRange): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = []
  const start = new Date(r.from + "T00:00:00")
  const end = new Date(r.to + "T00:00:00")
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    out.push({ date: fmt(d), label: `${dd}/${mm}` })
  }
  return out
}
