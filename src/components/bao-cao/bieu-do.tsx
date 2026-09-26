"use client"

/**
 * Biểu đồ của Báo cáo tổng hợp (spec mục 2.8): mỗi màn tối đa một biểu đồ chính.
 * - Cột theo thời gian (+ đường mảnh đứt nét cho kỳ so sánh, + cột thứ hai cho Thu / Chi).
 * - Thanh ngang top 10, phần còn lại gộp "Khác".
 * - Thanh xếp chồng tuổi nợ.
 * Bấm cột / thanh = đào sâu như bấm dòng bảng. Không thêm thư viện: vẽ bằng div + SVG.
 */
import { cn } from "@/lib/utils"
import { soGon, phanTram } from "@/lib/bao-cao/so"

export interface ChuGiai {
  label: string
  kieu: "cot" | "cot2" | "duong"
}

function KhungBieuDo({ tieuDe, chuGiai, children }: { tieuDe: string; chuGiai?: ChuGiai[]; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card px-4 pb-3 pt-3.5" data-testid="bc-bieu-do">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-[15px] font-bold">{tieuDe}</div>
        {chuGiai?.map((c) => (
          <div key={c.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("w-3 rounded-sm", c.kieu === "duong" ? "h-0.5 bg-muted-foreground" : c.kieu === "cot2" ? "h-2.5 bg-primary/30" : "h-2.5 bg-primary")} />
            {c.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  )
}

export interface CotBD {
  label: string
  v: number
  v2?: number
  title: string
  onClick?: () => void
}

export function BieuDoCot({ tieuDe, chuGiai, cot, soSanh, nhat }: { tieuDe: string; chuGiai?: ChuGiai[]; cot: CotBD[]; soSanh?: number[] | null; nhat?: boolean }) {
  const n = cot.length
  const mx = Math.max(1, ...cot.map((c) => c.v), ...cot.map((c) => c.v2 || 0), ...(soSanh || []))
  const moi = Math.ceil(n / 14)
  const khe = n > 40 ? "gap-px" : "gap-0.5 lg:gap-1"
  const duong = soSanh?.length
    ? cot.map((_, i) => (i < soSanh.length ? `${(((i + 0.5) / n) * 100).toFixed(2)},${(100 - (soSanh[i] / mx) * 100).toFixed(2)}` : null)).filter(Boolean).join(" ")
    : ""
  return (
    <KhungBieuDo tieuDe={tieuDe} chuGiai={chuGiai}>
      <div className="flex flex-col gap-1.5">
        <div className="relative h-[180px] border-b lg:h-[220px]">
          <div className="absolute left-0 top-0 text-[11px] text-muted-foreground/70">{soGon(mx)}</div>
          <div className={cn("absolute inset-0 top-4 flex items-end", khe)}>
            {cot.map((c, i) => (
              <div key={i} role={c.onClick ? "button" : undefined} title={c.title} onClick={c.onClick} className={cn("flex h-full min-w-0 flex-1 items-end gap-0.5", c.onClick && "cursor-pointer")}>
                <div className={cn("flex-1 rounded-t-[3px]", nhat ? "bg-primary/60 hover:bg-primary/80" : "bg-primary hover:bg-primary/80")} style={{ height: `${Math.max(c.v > 0 ? 1.5 : 0, (c.v / mx) * 100)}%` }} />
                {c.v2 != null && <div className="flex-1 rounded-t-[3px] bg-primary/30" style={{ height: `${Math.max(0, (c.v2 / mx) * 100)}%` }} />}
              </div>
            ))}
            {duong && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                <polyline points={duong} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
              </svg>
            )}
          </div>
        </div>
        <div className={cn("flex", khe)}>
          {cot.map((c, i) => (
            <div key={i} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-[10px] text-muted-foreground">
              {i % moi === 0 ? c.label : ""}
            </div>
          ))}
        </div>
      </div>
    </KhungBieuDo>
  )
}

export interface ThanhBD {
  label: string
  v: number
  khac?: boolean
  onClick?: () => void
}

export function BieuDoNgang({ tieuDe, ds }: { tieuDe: string; ds: ThanhBD[] }) {
  const mx = Math.max(1, ...ds.map((i) => i.v))
  return (
    <KhungBieuDo tieuDe={tieuDe}>
      <div className="flex flex-col gap-1.5">
        {ds.map((h, i) => (
          <div
            key={i}
            role={h.onClick ? "button" : undefined}
            onClick={h.onClick}
            className={cn("grid grid-cols-[minmax(0,120px)_1fr_56px] items-center gap-2.5 rounded-lg px-1 py-0.5 lg:grid-cols-[minmax(0,240px)_1fr_70px]", h.onClick && "cursor-pointer hover:bg-muted/40")}
          >
            <div className="truncate text-[13px]">{h.label}</div>
            <div className="h-3.5 overflow-hidden rounded bg-muted">
              <div className={cn("h-full rounded", h.khac ? "bg-primary/30" : "bg-primary/70")} style={{ width: `${Math.max(0, (h.v / mx) * 100)}%` }} />
            </div>
            <div className="text-right text-[13px] font-semibold tabular-nums">{soGon(h.v)}</div>
          </div>
        ))}
      </div>
    </KhungBieuDo>
  )
}

export interface KhucBD {
  label: string
  v: number
  /** Lớp màu Tailwind. */
  mau: string
  onClick?: () => void
}

export function BieuDoChong({ tieuDe, ds }: { tieuDe: string; ds: KhucBD[] }) {
  const tong = ds.reduce((s, x) => s + Math.max(0, x.v), 0) || 1
  return (
    <KhungBieuDo tieuDe={tieuDe}>
      <div className="flex flex-col gap-3">
        <div className="flex h-[22px] overflow-hidden rounded-md bg-muted">
          {ds.map((s) => (
            <div key={s.label} title={`${s.label}: ${soGon(s.v)}`} className={s.mau} style={{ width: `${(Math.max(0, s.v) / tong) * 100}%` }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {ds.map((s) => (
            <div key={s.label} role={s.onClick ? "button" : undefined} onClick={s.onClick} className={cn("flex flex-col gap-0.5 rounded-[10px] border px-2.5 py-2", s.onClick && "cursor-pointer hover:bg-muted/40")}>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-[3px]", s.mau)} />
                {s.label}
              </div>
              <div className="text-[15px] font-bold tabular-nums">{soGon(s.v)}</div>
              <div className="text-xs text-muted-foreground">{phanTram(Math.max(0, s.v) / tong, 0)}</div>
            </div>
          ))}
        </div>
      </div>
    </KhungBieuDo>
  )
}
