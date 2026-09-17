"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, MapPin, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { viMatchAllWords } from "@/lib/search"
import { cn } from "@/lib/utils"

/**
 * Bộ lọc TUYẾN của danh sách đơn.
 *
 * NGƯỜI DÙNG YÊU CẦU (trên máy tính): "bộ lọc tuyến cho xuống cạnh Tìm mã
 * đơn hàng; khi mở lọc phải có tìm kiếm, các tuyến có đơn ở trên kèm số
 * đơn (trạng thái đã duyệt)". Một NPP có vài chục tuyến; ô chọn xổ xuống
 * bắt người ta cuộn và đọc từng dòng, trong khi câu hỏi thật là "tuyến
 * nào đang có đơn phải giao".
 *
 * ⚠ Số trên tuyến là số đơn ĐÃ DUYỆT (chưa giao) — là hàng đang chờ ra
 * xe, không phải tổng đơn mọi thời. Tuyến không có đơn đã duyệt xếp xuống
 * dưới một vạch, vẫn chọn được.
 */
export interface RouteOption {
  code: string
  name: string
}

export function RouteFilter({
  routes,
  counts,
  value,
  onChange,
  className,
}: {
  routes: RouteOption[]
  /** mã tuyến → số đơn đã duyệt. */
  counts: Record<string, number>
  /** "all" hoặc mã tuyến. */
  value: string
  onChange: (code: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")

  const { active, idle } = useMemo(() => {
    const term = q.trim()
    const visible = routes.filter((r) => !term || viMatchAllWords(term, r.name, r.code))
    const active = visible
      .filter((r) => (counts[r.code] ?? 0) > 0)
      .sort((a, b) => (counts[b.code] ?? 0) - (counts[a.code] ?? 0) || a.name.localeCompare(b.name, "vi"))
    const idle = visible.filter((r) => !(counts[r.code] ?? 0))
    return { active, idle }
  }, [routes, counts, q])

  const current = routes.find((r) => r.code === value)
  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
    setQ("")
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ("") }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Lọc theo tuyến"
          className={cn(
            "flex h-10 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-sm font-semibold",
            current ? "text-primary" : "text-on-surface-variant",
            className
          )}
        >
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="min-w-0 max-w-[180px] truncate">{current ? current.name : "Tất cả tuyến"}</span>
          {current && (counts[current.code] ?? 0) > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-extrabold text-primary">
              {counts[current.code]}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="relative border-b border-outline-variant/60 p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tuyến…"
            aria-label="Tìm tuyến"
            className="h-10 w-full rounded-lg border-0 bg-surface-container pl-8 pr-3 text-sm font-semibold outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {!q.trim() && (
            <Row selected={value === "all"} onClick={() => pick("all")} label="Tất cả tuyến" />
          )}
          {active.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant">
              Đang có đơn đã duyệt
            </p>
          )}
          {active.map((r) => (
            <Row
              key={r.code}
              selected={value === r.code}
              onClick={() => pick(r.code)}
              label={r.name}
              hint={r.code}
              count={counts[r.code]}
            />
          ))}
          {idle.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-on-surface-variant">
              {active.length > 0 ? "Chưa có đơn đã duyệt" : "Tuyến"}
            </p>
          )}
          {idle.map((r) => (
            <Row key={r.code} selected={value === r.code} onClick={() => pick(r.code)} label={r.name} hint={r.code} />
          ))}
          {active.length === 0 && idle.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-on-surface-variant">Không có tuyến khớp “{q.trim()}”</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Row({
  label,
  hint,
  count,
  selected,
  onClick,
}: {
  label: string
  hint?: string
  count?: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-container-low",
        selected ? "font-extrabold text-primary" : "font-semibold text-on-surface"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 font-mono text-[11px] text-on-surface-variant">{hint}</span>}
      {count != null && count > 0 && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[11px] font-extrabold text-primary">
          {count} đơn
        </span>
      )}
      {selected && <Check className="h-4 w-4 shrink-0" />}
    </button>
  )
}
