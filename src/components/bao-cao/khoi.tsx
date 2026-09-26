"use client"

/**
 * Các khối dùng chung của Báo cáo tổng hợp: thẻ KPI, hàng "Xem theo", công tắc nguồn, khối Top,
 * ô số nhanh, khối gập/mở, băng thông báo, trạng thái đang tải / không có số / lỗi / chưa đủ.
 */
import { useState, type ReactNode } from "react"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Info, type LucideIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { SoSanh } from "@/lib/bao-cao/so"

export type Tone = "danger" | "warning" | "primary" | "muted"

const mauTone: Record<Tone, string> = {
  danger: "text-destructive",
  warning: "text-amber-600",
  primary: "text-primary",
  muted: "text-muted-foreground",
}

export interface TheKpi {
  id: string
  label: string
  value: string
  info?: string
  sub?: string
  subTone?: Tone
  delta?: SoSanh | null
  spark?: string
  tone?: Tone
  onClick?: () => void
}

function ChuThich({ text }: { text: string }) {
  const [mo, setMo] = useState(false)
  return (
    <span
      className="relative flex cursor-help p-0.5 text-muted-foreground/70"
      onMouseEnter={() => setMo(true)}
      onMouseLeave={() => setMo(false)}
      onClick={(e) => {
        e.stopPropagation()
        setMo((m) => !m)
      }}
    >
      <Info className="h-3.5 w-3.5" />
      {mo && (
        <span role="tooltip" className="absolute left-0 top-5 z-20 w-60 rounded-lg bg-foreground px-2.5 py-2 text-xs font-normal leading-relaxed text-background shadow-lg">
          {text}
        </span>
      )}
    </span>
  )
}

export function HangKpi({ kpis }: { kpis: TheKpi[] }) {
  if (!kpis.length) return null
  return (
    <div className={cn("flex gap-2.5", kpis.length > 4 ? "max-lg:overflow-x-auto max-lg:pb-1" : "max-lg:flex-wrap")} data-testid="bc-kpi">
      {kpis.map((k) => (
        <div
          key={k.id}
          role={k.onClick ? "button" : undefined}
          tabIndex={k.onClick ? 0 : undefined}
          onClick={k.onClick}
          onKeyDown={(e) => k.onClick && (e.key === "Enter" || e.key === " ") && k.onClick()}
          data-testid={`bc-kpi-${k.id}`}
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-2xl border bg-card p-3.5 pb-3 lg:flex-1",
            "max-lg:flex-[0_0_calc(50%-5px)]",
            k.onClick && "cursor-pointer hover:bg-muted/40"
          )}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="truncate">{k.label}</span>
            {k.info && <ChuThich text={k.info} />}
          </div>
          <div className={cn("text-[22px] font-bold leading-tight tracking-tight tabular-nums lg:text-2xl", k.tone ? mauTone[k.tone] : "text-foreground")}>{k.value}</div>
          {k.sub && <div className={cn("text-xs font-medium", mauTone[k.subTone || "muted"])}>{k.sub}</div>}
          <div className="mt-auto flex flex-col gap-1.5">
            {k.delta && (
              <span className={cn("truncate text-xs font-semibold", k.delta.tone === "tot" ? "text-emerald-600" : k.delta.tone === "xau" ? "text-destructive" : "text-muted-foreground")}>
                {k.delta.t}
              </span>
            )}
            {k.spark && (
              <svg width="100%" height="24" viewBox="0 0 100 30" preserveAspectRatio="none" className="block" aria-hidden>
                <polyline points={k.spark} fill="none" className="stroke-primary/70" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function HangChon({ nhan, ds }: { nhan: string; ds: { k: string; label: string; on: boolean; onClick: () => void }[] }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 max-lg:flex-nowrap lg:flex-wrap" data-testid="bc-xem-theo">
      <span className="mr-0.5 whitespace-nowrap text-[13px] text-muted-foreground">{nhan}:</span>
      {ds.map((c) => (
        <button
          key={c.k}
          type="button"
          aria-pressed={c.on}
          onClick={c.onClick}
          className={cn("h-9 flex-none whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold", c.on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/50")}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

export function CongTacDoan<T extends string>({ ds, value, onChange, className }: { ds: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("flex gap-0.5 rounded-xl bg-muted p-[3px]", className)} role="tablist">
      {ds.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("h-[30px] flex-1 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold", o.value === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function BangHoPhach({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-sm font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" data-testid="bc-bang-ho-phach">
      <AlertTriangle className="h-[18px] w-[18px] shrink-0" />
      {children}
    </div>
  )
}

export function GhiChu({ text, link }: { text: string; link?: { label: string; href?: string; onClick?: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs leading-relaxed text-muted-foreground">
      <span>{text}</span>
      {link &&
        (link.href ? (
          <a href={link.href} className="font-semibold text-primary">
            {link.label}
          </a>
        ) : (
          <button type="button" onClick={link.onClick} className="font-semibold text-primary">
            {link.label}
          </button>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------- khối danh sách (Top / Tiền trong ngày)

export interface DongKhoi {
  label: string
  sub?: string
  value: string
  valueTone?: Tone
  bold?: boolean
  info?: string
  /** Thanh % mảnh dưới tên (Top 5). */
  bar?: { w: number; text: string }
  onClick?: () => void
}

export function KhoiDanhSach({ tieuDe, phai, dong, chan, testId }: { tieuDe: string; phai?: string; dong: DongKhoi[]; chan?: { label: string; onClick: () => void }; testId?: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card" data-testid={testId}>
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
        <div className="flex-1 text-[15px] font-bold">{tieuDe}</div>
        {phai && <div className="text-xs text-muted-foreground">{phai}</div>}
      </div>
      {dong.map((r, i) => (
        <div
          key={i}
          role={r.onClick ? "button" : undefined}
          onClick={r.onClick}
          className={cn("flex min-h-11 items-center gap-2.5 border-t px-4 py-2.5", r.onClick && "cursor-pointer hover:bg-muted/40", r.bold && "bg-muted/30")}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={cn("truncate text-sm", r.bold ? "font-bold" : "font-medium")}>{r.label}</span>
              {r.info && <ChuThich text={r.info} />}
            </div>
            {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
            {r.bar && (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div className="h-full bg-primary/60" style={{ width: `${Math.max(0, Math.min(100, r.bar.w))}%` }} />
                </div>
                <span className="w-10 text-right text-[11px] text-muted-foreground">{r.bar.text}</span>
              </div>
            )}
          </div>
          <div className={cn("whitespace-nowrap text-sm tabular-nums", r.bold ? "font-bold" : "font-medium", r.valueTone ? mauTone[r.valueTone] : "")}>{r.value}</div>
        </div>
      ))}
      {dong.length === 0 && <div className="border-t px-4 py-3 text-sm text-muted-foreground">Chưa có số trong kỳ này.</div>}
      {chan && (
        <button type="button" onClick={chan.onClick} className="mt-auto border-t px-4 py-3 text-left text-[13px] font-semibold text-primary hover:bg-muted/40">
          {chan.label} →
        </button>
      )}
    </div>
  )
}

export interface OSoNhanh {
  label: string
  value: string
  sub: string
  icon: LucideIcon
  mau: "violet" | "amber" | "red" | "blue" | "green"
  tone?: Tone
  onClick?: () => void
}

const mauO: Record<OSoNhanh["mau"], string> = {
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/40",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40",
  red: "bg-red-50 text-red-600 dark:bg-red-950/40",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40",
}

export function HangSoNhanh({ ds }: { ds: OSoNhanh[] }) {
  if (!ds.length) return null
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="bc-so-nhanh">
      {ds.map((t) => (
        <button key={t.label} type="button" onClick={t.onClick} className="flex items-start gap-3 rounded-2xl border bg-card p-3.5 text-left hover:bg-muted/40">
          <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", mauO[t.mau])}>
            <t.icon className="h-[18px] w-[18px]" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={cn("text-lg font-bold tracking-tight", t.tone ? mauTone[t.tone] : "")}>{t.value}</div>
            <div className="text-xs text-muted-foreground">{t.sub}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

export function KhoiGap({ tieuDe, phai, dong, moSan = false, testId }: { tieuDe: string; phai: string; dong: DongKhoi[]; moSan?: boolean; testId?: string }) {
  const [mo, setMo] = useState(moSan)
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid={testId}>
      <button type="button" aria-expanded={mo} onClick={() => setMo((m) => !m)} className="flex w-full items-center gap-2 px-4 py-3.5 text-left hover:bg-muted/40">
        <span className="flex-1 text-[15px] font-bold">{tieuDe}</span>
        <span className="text-xs text-muted-foreground">{phai}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", mo && "rotate-180")} />
      </button>
      {mo && (
        <div className="max-h-[360px] overflow-auto">
          {dong.map((r, i) => (
            <div key={i} role={r.onClick ? "button" : undefined} onClick={r.onClick} className={cn("flex min-h-11 items-center gap-2.5 border-t px-4 py-2.5", r.onClick && "cursor-pointer hover:bg-muted/40")}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{r.label}</div>
                {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
              </div>
              <div className="text-sm font-semibold tabular-nums">{r.value}</div>
            </div>
          ))}
          {dong.length === 0 && (
            <div className="flex items-center gap-2 border-t px-4 py-3 text-[13px] text-emerald-600">
              <Check className="h-4 w-4" />
              Không có trong kỳ này.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- trạng thái

export function DangTai({ soThe = 4 }: { soThe?: number }) {
  return (
    <div className="flex flex-col gap-3.5" data-testid="bc-dang-tai">
      <div className="flex gap-2.5 max-lg:flex-wrap">
        {Array.from({ length: soThe }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl max-lg:flex-[0_0_calc(50%-5px)] lg:flex-1" />
        ))}
      </div>
      <Skeleton className="h-[220px] rounded-2xl lg:h-[260px]" />
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3.5">
        {[70, 92, 84, 60, 88, 76].map((w, i) => (
          <Skeleton key={i} className="h-[18px] rounded-md" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  )
}

export function KhongCoSo({ text, nut }: { text: string; nut?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card px-5 py-7" data-testid="bc-khong-co-so">
      <div className="text-[15px] font-semibold">{text}</div>
      {nut && (
        <button type="button" onClick={nut.onClick} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {nut.label}
        </button>
      )}
    </div>
  )
}

export function LoiDocSo({ text, onThuLai }: { text: string; onThuLai: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4" data-testid="bc-loi">
      <div className="flex items-center gap-2 text-sm font-bold text-destructive">
        <AlertTriangle className="h-[18px] w-[18px]" />
        Không đọc được số liệu
      </div>
      <div className="text-[13px]">{text}</div>
      <button type="button" onClick={onThuLai} className="h-9 rounded-lg border border-destructive bg-card px-3.5 text-[13px] font-semibold text-destructive">
        Thử lại
      </button>
    </div>
  )
}

export function ChuaDu({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" data-testid="bc-chua-du">
      <AlertTriangle className="h-[18px] w-[18px] shrink-0" />
      {text}
    </div>
  )
}

export { ChevronRight }
