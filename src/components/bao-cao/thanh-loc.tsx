"use client"

/**
 * THANH LỌC CHUNG của Báo cáo tổng hợp (spec mục 2.3, thiết kế 26/09/2026):
 * [Kỳ ▾] [So với kỳ trước] | [+ Thêm lọc] [Khách: Cô Ba ✕] … [Bỏ hết lọc]   Cập nhật 14:05 ⟳
 * Điện thoại: [Kỳ] [Lọc (2)] — bấm Lọc mở bảng lọc từ dưới lên.
 */
import { createContext, useContext, useMemo, useState } from "react"
import { Calendar, ChevronDown, Lock, Plus, RefreshCw, Search, X, Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { DS_KY, kyTheoMa, nhanKhoang, ngayDu, ngayThang, THU_VN, thu, congNgay, tenKy, type MaKy } from "@/lib/bao-cao/ky"
import { LOAI_LOC, type BoLoc, type LoaiLoc } from "@/lib/bao-cao/cong"
import { boDau } from "@/lib/bao-cao/so"

export type CheDoKy = "range" | "day" | "asof" | "static"

/**
 * Khung đặt thanh lọc ở hai chỗ (đầu trang máy tính / thẻ nổi điện thoại) — mỗi chỗ chỉ vẽ bản
 * của mình. Vẽ cả hai ở cả hai chỗ là bốn thanh lọc trong DOM, bốn bộ trạng thái popover.
 */
export const NoiThanhLoc = createContext<"may" | "dt" | null>(null)

export interface ThanhLocProps {
  che: CheDoKy
  homNay: string
  /** range */
  maKy?: MaKy
  ca?: string | null
  cb?: string | null
  onKy?: (ma: MaKy, ca?: string, cb?: string) => void
  /** day / asof */
  ngay?: string
  onNgay?: (d: string) => void
  /** static */
  nhanTinh?: string
  soSanh?: { bat: boolean; nhan: string; onDoi: () => void } | null
  loai: LoaiLoc[]
  loc: BoLoc
  luaChon: (k: LoaiLoc) => ReadonlyArray<readonly [string, string]>
  onLoc: (k: LoaiLoc, vals: string[]) => void
  onBoHet: () => void
  /** NVBH: thẻ "Nhân viên: <tên>" khoá, không bỏ được. */
  khoaNV?: string | null
  capNhat: string
  onTaiLai: () => void
}

const nhanLoc = (k: LoaiLoc, vals: string[], luaChon: ThanhLocProps["luaChon"]) => {
  const t = LOAI_LOC[k]
  const ten = t.short || t.label
  if (vals.length === 1) return `${ten}: ${luaChon(k).find(([v]) => v === vals[0])?.[1] ?? vals[0]}`
  return `${ten}: ${vals.length} ${t.unit}`
}

function nhanNgay(d: string, homNay: string) {
  return `${d === homNay ? "Hôm nay" : THU_VN[thu(d)]} ${ngayThang(d)}`
}

// ---------------------------------------------------------------- chọn kỳ

function DanhSachKy({ p, dong }: { p: ThanhLocProps; dong: () => void }) {
  const hien = kyTheoMa(p.maKy || "month", p.homNay, p.ca, p.cb)
  const [a, setA] = useState(hien.a)
  const [b, setB] = useState(hien.b)
  return (
    <div className="flex flex-col" data-testid="bc-chon-ky">
      {DS_KY.filter(([k]) => k !== "custom").map(([k, label]) => {
        const r = kyTheoMa(k, p.homNay)
        const on = k === p.maKy
        return (
          <button
            key={k}
            type="button"
            onClick={() => {
              p.onKy?.(k)
              dong()
            }}
            className={cn("flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-muted/60", on && "bg-primary/10 font-semibold text-primary")}
          >
            <span className="flex-1">{label}</span>
            <span className="text-xs text-muted-foreground">{nhanKhoang(r.a, r.b)}</span>
          </button>
        )
      })}
      <div className="mt-1 flex flex-col gap-2 border-t px-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <input type="date" aria-label="Từ ngày" value={a} max={p.homNay} onChange={(e) => e.target.value && setA(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" />
          <span className="text-muted-foreground">–</span>
          <input type="date" aria-label="Đến ngày" value={b} max={p.homNay} onChange={(e) => e.target.value && setB(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm" />
        </div>
        <button
          type="button"
          onClick={() => {
            p.onKy?.("custom", a < b ? a : b, a < b ? b : a)
            dong()
          }}
          className="h-10 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          Áp dụng
        </button>
      </div>
    </div>
  )
}

function ChonNgay({ p, dong }: { p: ThanhLocProps; dong: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 p-1">
      <input
        type="date"
        aria-label={p.che === "day" ? "Chọn ngày" : "Tính đến ngày"}
        value={p.ngay}
        max={p.homNay}
        onChange={(e) => {
          if (e.target.value) {
            p.onNgay?.(e.target.value > p.homNay ? p.homNay : e.target.value)
            dong()
          }
        }}
        className="h-10 rounded-lg border bg-background px-2.5 text-sm"
      />
      <button type="button" onClick={() => (p.onNgay?.(p.homNay), dong())} className="h-10 rounded-xl border text-sm font-semibold hover:bg-muted/60">
        Về hôm nay
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- sửa một lọc

function SuaLoc({ p, k, xong }: { p: ThanhLocProps; k: LoaiLoc; xong: () => void }) {
  const [chon, setChon] = useState<string[]>(p.loc[k] ?? [])
  const [q, setQ] = useState("")
  const tat = p.luaChon(k)
  const ds = useMemo(() => {
    const n = boDau(q.trim())
    return n ? tat.filter(([, l]) => boDau(l).includes(n)) : tat
  }, [tat, q])
  return (
    <div className="flex flex-col" data-testid={`bc-sua-loc-${k}`}>
      <div className="px-1 pb-2 text-[15px] font-bold">{LOAI_LOC[k].label}</div>
      <label className="mx-1 flex h-10 items-center gap-2 rounded-lg border px-2.5 text-muted-foreground">
        <Search className="h-4 w-4" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm, gõ không dấu cũng được" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" />
      </label>
      <div className="mt-1 max-h-64 overflow-auto">
        {ds.slice(0, 300).map(([v, l]) => {
          const on = chon.includes(v)
          return (
            <button
              key={v}
              type="button"
              onClick={() => setChon((c) => (on ? c.filter((x) => x !== v) : [...c, v]))}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted/60"
            >
              <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px]", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="truncate">{l}</span>
            </button>
          )
        })}
        {ds.length === 0 && <div className="px-2.5 py-3 text-sm text-muted-foreground">Không tìm thấy “{q}”.</div>}
        {ds.length > 300 && <div className="px-2.5 py-2 text-xs text-muted-foreground">Còn {ds.length - 300} lựa chọn — gõ để thu hẹp.</div>}
      </div>
      <div className="mt-1.5 flex gap-2 border-t px-1 pt-2.5">
        <button type="button" onClick={xong} className="h-10 flex-1 rounded-xl border text-sm font-semibold">
          Huỷ
        </button>
        <button
          type="button"
          onClick={() => {
            p.onLoc(k, chon)
            xong()
          }}
          className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          Áp dụng{chon.length ? ` (${chon.length})` : ""}
        </button>
      </div>
    </div>
  )
}

function DanhSachLoai({ p, chon }: { p: ThanhLocProps; chon: (k: LoaiLoc) => void }) {
  return (
    <div className="flex flex-col">
      {p.loai.map((k) => (
        <button key={k} type="button" onClick={() => chon(k)} className="flex min-h-10 items-center rounded-lg px-2.5 text-left text-sm hover:bg-muted/60">
          <span className="flex-1">{LOAI_LOC[k].label}</span>
          {!!p.loc[k]?.length && <span className="text-xs font-semibold text-primary">{p.loc[k]!.length} đã chọn</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- thanh

function NutKy({ p, className }: { p: ThanhLocProps; className?: string }) {
  const [mo, setMo] = useState(false)
  if (p.che === "static") return <span className={cn("px-1.5 text-[13px] text-muted-foreground", className)}>{p.nhanTinh}</span>
  if (p.che === "day") {
    const d = p.ngay || p.homNay
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <button type="button" aria-label="Ngày trước" onClick={() => p.onNgay?.(congNgay(d, -1))} className="h-9 w-9 rounded-lg border bg-card text-lg hover:bg-muted/60 lg:h-9 max-lg:h-11 max-lg:w-11">
          ‹
        </button>
        <Popover open={mo} onOpenChange={setMo}>
          <PopoverTrigger asChild>
            <button type="button" data-testid="bc-nut-ngay" className="h-9 flex-1 rounded-lg border bg-card px-3.5 text-[13px] font-semibold max-lg:h-11">
              {nhanNgay(d, p.homNay)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <ChonNgay p={p} dong={() => setMo(false)} />
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label="Ngày sau"
          disabled={d >= p.homNay}
          onClick={() => p.onNgay?.(congNgay(d, 1))}
          className="h-9 w-9 rounded-lg border bg-card text-lg hover:bg-muted/60 disabled:text-muted-foreground/40 max-lg:h-11 max-lg:w-11"
        >
          ›
        </button>
      </div>
    )
  }
  const nhan = p.che === "asof" ? `Tính đến ngày ${ngayDu(p.ngay || p.homNay)}` : (() => {
    const r = kyTheoMa(p.maKy || "month", p.homNay, p.ca, p.cb)
    return `${tenKy(p.maKy || "month")} · ${nhanKhoang(r.a, r.b)}`
  })()
  return (
    <Popover open={mo} onOpenChange={setMo}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="bc-nut-ky" className={cn("flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] font-semibold hover:bg-muted/60", className)}>
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="truncate">{nhan}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-2">
        <div className="px-1 pb-1.5 text-[15px] font-bold">{p.che === "asof" ? "Tính đến ngày" : "Chọn kỳ"}</div>
        {p.che === "asof" ? <ChonNgay p={p} dong={() => setMo(false)} /> : <DanhSachKy p={p} dong={() => setMo(false)} />}
      </PopoverContent>
    </Popover>
  )
}

function CongTacSoSanh({ s }: { s: NonNullable<ThanhLocProps["soSanh"]> }) {
  return (
    <button type="button" role="switch" aria-checked={s.bat} onClick={s.onDoi} className="flex h-9 items-center gap-2 px-2 text-[13px]">
      <span className={cn("relative inline-block h-[18px] w-8 rounded-full transition-colors", s.bat ? "bg-primary" : "bg-muted-foreground/40")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all", s.bat ? "left-4" : "left-0.5")} />
      </span>
      {s.nhan}
    </button>
  )
}

function TheLoc({ p, k, onSua }: { p: ThanhLocProps; k: LoaiLoc; onSua: () => void }) {
  return (
    <div className="flex h-8 items-center rounded-full border border-primary/25 bg-primary/10">
      <button type="button" onClick={onSua} className="h-full pl-3 pr-1 text-[13px] font-medium">
        {nhanLoc(k, p.loc[k]!, p.luaChon)}
      </button>
      <button type="button" title="Bỏ lọc" aria-label="Bỏ lọc" onClick={() => p.onLoc(k, [])} className="grid h-full w-7 place-items-center text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ThanhLoc(p: ThanhLocProps) {
  const noi = useContext(NoiThanhLoc)
  const dangLoc = p.loai.filter((k) => p.loc[k]?.length)
  const [moThem, setMoThem] = useState<LoaiLoc | "ds" | null>(null)
  const [suaK, setSuaK] = useState<LoaiLoc | null>(null)
  const [moMobile, setMoMobile] = useState<LoaiLoc | "ds" | null>(null)
  const coNutLoc = p.loai.length > 0 || !!p.soSanh
  return (
    <>
      {/* Máy tính */}
      {noi !== "dt" && (
      <div className="hidden flex-wrap items-center gap-2 rounded-2xl border bg-card px-2.5 py-2 lg:flex" data-testid="bc-thanh-loc">
        <NutKy p={p} />
        {p.soSanh && <CongTacSoSanh s={p.soSanh} />}
        {p.loai.length > 0 && (
          <>
            <span className="h-[22px] w-px bg-border" />
            <Popover open={!!moThem} onOpenChange={(o) => setMoThem(o ? "ds" : null)}>
              <PopoverTrigger asChild>
                <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/50 px-2.5 text-[13px] font-semibold text-primary hover:bg-primary/10">
                  <Plus className="h-3.5 w-3.5" />
                  Thêm lọc
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] p-2">
                {moThem === "ds" ? (
                  <>
                    <div className="px-1 pb-1.5 text-[15px] font-bold">Thêm lọc</div>
                    <DanhSachLoai p={p} chon={(k) => setMoThem(k)} />
                  </>
                ) : moThem ? (
                  <SuaLoc key={moThem} p={p} k={moThem} xong={() => setMoThem(null)} />
                ) : null}
              </PopoverContent>
            </Popover>
          </>
        )}
        {p.khoaNV && (
          <div className="flex h-8 items-center gap-1.5 rounded-full border bg-muted/50 pl-3 pr-2.5 text-[13px] font-medium" title="Khoá theo tài khoản đăng nhập">
            Nhân viên: {p.khoaNV}
            <Lock className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
        {dangLoc.map((k) => (
          <Popover key={k} open={suaK === k} onOpenChange={(o) => setSuaK(o ? k : null)}>
            <PopoverTrigger asChild>
              <div>
                <TheLoc p={p} k={k} onSua={() => setSuaK(k)} />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[340px] p-2">
              <SuaLoc p={p} k={k} xong={() => setSuaK(null)} />
            </PopoverContent>
          </Popover>
        ))}
        {dangLoc.length >= 2 && (
          <button type="button" onClick={p.onBoHet} className="h-8 px-1.5 text-[13px] font-semibold text-primary">
            Bỏ hết lọc
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Cập nhật {p.capNhat}
          <button type="button" title="Tải lại" aria-label="Tải lại" onClick={p.onTaiLai} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted/60">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* Điện thoại */}
      {noi !== "may" && (
      <div className="relative flex gap-2 rounded-2xl bg-card p-2.5 shadow-md lg:hidden" data-testid="bc-thanh-loc-mobile">
        <NutKy p={p} className="h-11 min-w-0 flex-1 rounded-xl" />
        {coNutLoc && (
          <button
            type="button"
            onClick={() => setMoMobile("ds")}
            className={cn("h-11 whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-semibold", dangLoc.length ? "border-primary/30 bg-primary/10 text-primary" : "bg-card")}
          >
            {dangLoc.length ? `Lọc (${dangLoc.length})` : "Lọc"}
          </button>
        )}
      </div>
      )}
      {noi !== "may" && (
      <Sheet open={!!moMobile} onOpenChange={(o) => setMoMobile(o ? "ds" : null)}>
        <SheetContent side="bottom" className="max-h-[82vh] overflow-auto rounded-t-3xl p-3">
          <SheetTitle className="px-1 pb-2 text-[15px]">{moMobile && moMobile !== "ds" ? LOAI_LOC[moMobile].label : "Lọc"}</SheetTitle>
          {moMobile && moMobile !== "ds" ? (
            <SuaLoc key={moMobile} p={p} k={moMobile} xong={() => setMoMobile("ds")} />
          ) : (
            <div className="flex flex-col">
              {p.soSanh && <CongTacSoSanh s={p.soSanh} />}
              {(dangLoc.length > 0 || p.khoaNV) && (
                <>
                  <div className="px-2.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground">Đang lọc</div>
                  <div className="flex flex-wrap gap-1.5 px-2.5 pb-1.5">
                    {p.khoaNV && <span className="flex h-9 items-center rounded-full border bg-muted/50 px-3 text-[13px]">Nhân viên: {p.khoaNV}</span>}
                    {dangLoc.map((k) => (
                      <TheLoc key={k} p={p} k={k} onSua={() => setMoMobile(k)} />
                    ))}
                  </div>
                </>
              )}
              {p.loai.length > 0 && (
                <>
                  <div className="px-2.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground">Thêm lọc</div>
                  <DanhSachLoai p={p} chon={(k) => setMoMobile(k)} />
                </>
              )}
              <div className="flex gap-2 p-2.5">
                {dangLoc.length > 0 && (
                  <button type="button" onClick={p.onBoHet} className="h-11 flex-1 rounded-xl border text-sm font-semibold">
                    Bỏ hết lọc
                  </button>
                )}
                <button type="button" onClick={() => setMoMobile(null)} className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                  Xong
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      )}
    </>
  )
}
