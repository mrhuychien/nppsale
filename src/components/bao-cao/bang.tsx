"use client"

/**
 * BẢNG SỐ LIỆU CHUẨN của Báo cáo tổng hợp (spec mục 2.7):
 * - Cột đầu = tên chiều đang xem; cột chỉ số căn phải, chữ số thẳng cột.
 * - Nút "Cột" bật / tắt cột phụ. Bấm tiêu đề để sắp. DÒNG TỔNG ghim ngay dưới tiêu đề.
 * - Cột "% tổng" vẽ thanh mảnh trong ô. 50 dòng / trang (máy tính), "Tải thêm 20" (điện thoại).
 * - Điện thoại: bảng thành danh sách thẻ — tên, số chính bên phải, 2–3 số phụ dòng dưới.
 * - Cột giá vốn / lãi: không có quyền thì ẩn hẳn (không để trống, không "***").
 */
import { useMemo, useState, type MutableRefObject } from "react"
import { Check, ChevronRight, Columns3 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { soDu, phanTram } from "@/lib/bao-cao/so"
import { ngayDu } from "@/lib/bao-cao/ky"

export interface DongBang {
  _n: string
  _sub?: string
  _bold?: boolean
  _indent?: boolean
  /** Khoá sắp mặc định cho cột đầu (thứ tự tự nhiên: ngày, nhóm tuổi nợ…). */
  _s?: number | string
}

export type KieuCot = "money" | "int" | "pct" | "share" | "date" | "text" | "qty" | "days"

export interface CotBang<G> {
  k: string
  label: string
  f: KieuCot
  v: (g: G) => unknown
  bold?: boolean
  /** Cột phụ — bật / tắt bằng nút "Cột". */
  opt?: boolean
  /** Cột phụ bật sẵn. */
  on?: boolean
  /** Cần quyền giá vốn. */
  cost?: boolean
  /** Dòng Tổng để trống ở cột này. */
  noTot?: boolean
  tone?: (g: G) => "danger" | "warning" | "muted" | "primary" | "success" | undefined
  render?: (g: G) => { t: string; tone?: "danger" | "warning" | "muted" | "primary" | "success"; sub?: string }
}

const mau = {
  danger: "text-destructive",
  warning: "text-amber-600",
  muted: "text-muted-foreground",
  primary: "text-primary",
  success: "text-emerald-600",
}

interface O {
  t: string
  sub: string
  right: boolean
  cls: string
  bar: number | null
}

function oCua<G>(c: CotBang<G>, g: G, laTong: boolean, coSo: number): O {
  const right = c.f !== "text" && c.f !== "date"
  if (laTong && (c.noTot || c.f === "text" || c.f === "date" || c.f === "qty")) return { t: "", sub: "", right, cls: "", bar: null }
  let v: unknown
  try {
    v = c.v(g)
  } catch {
    v = null
  }
  let t = ""
  let sub = ""
  let cls = ""
  let bar: number | null = null
  const n = typeof v === "number" ? v : null
  switch (c.f) {
    case "money":
      t = n == null ? "—" : soDu(n)
      if (n != null && n < 0) cls = mau.danger
      break
    case "int":
      t = n == null ? "" : soDu(n)
      break
    case "pct":
      t = n == null || !isFinite(n) ? "—" : phanTram(n)
      break
    case "share": {
      const s = laTong ? 1 : coSo ? (n || 0) / coSo : 0
      t = phanTram(s)
      bar = Math.max(0, Math.min(100, s * 100))
      break
    }
    case "date":
      t = typeof v === "string" && v ? ngayDu(v) : "—"
      cls = "text-muted-foreground"
      break
    case "days":
      t = n == null ? "—" : `${soDu(n)} ngày`
      break
    case "qty": {
      const q = v as { t: string; sub: string } | null
      t = q?.t ?? ""
      sub = q?.sub ?? ""
      break
    }
    default:
      t = v == null ? "" : String(v)
      cls = "text-muted-foreground"
  }
  if (!laTong) {
    const tn = c.tone?.(g)
    if (tn) cls = mau[tn]
    if (c.render) {
      const r = c.render(g)
      t = r.t
      if (r.tone) cls = mau[r.tone]
      if (r.sub) sub = r.sub
    }
  }
  return { t, sub, right, cls, bar }
}

export interface BangProps<G extends DongBang> {
  khoa: string
  tieuDe: string
  phu?: string
  cotDau: string
  cot: CotBang<G>[]
  dong: G[]
  tong?: G | null
  nhanTong?: string
  phuTong?: string
  sapMacDinh?: { k: string; dir: 1 | -1 }
  /** Cột làm số chính của thẻ điện thoại. */
  chinh: string
  onDong?: (g: G) => (() => void) | null
  xemGiaVon: boolean
  khongSap?: boolean
  coSo?: number
  /** Cột phụ bật thêm từ ngoài (vd bấm thẻ Lãi gộp). */
  batThem?: string[]
  /** Hàm xuất đúng những gì đang thấy — cho nút Xuất Excel ở đầu trang. */
  xuatRef?: MutableRefObject<(() => (string | number)[][]) | null>
  testId?: string
}

export function BangBaoCao<G extends DongBang>(p: BangProps<G>) {
  const { cot, xemGiaVon } = p
  const coQuyen = useMemo(() => cot.filter((c) => !c.cost || xemGiaVon), [cot, xemGiaVon])
  const batThem = (p.batThem || []).join(",")
  const khoaTT = `${p.khoa}|${batThem}`
  const macDinh = () => ({
    khoa: khoaTT,
    bat: [...coQuyen.filter((c) => c.opt && c.on).map((c) => c.k), ...(batThem ? batThem.split(",") : [])],
    sap: p.sapMacDinh ?? { k: "_n", dir: 1 as 1 | -1 },
    trang: 0,
    them: 20,
    dong: p.dong,
  })
  const [tt, setTt] = useState(macDinh)
  /* ⚠ ĐỔI CHẾ ĐỘ XEM (khoá mới) → cột / thứ tự / trang mặc định NGAY TRONG LƯỢT VẼ ĐÓ. Đặt lại
     bằng useEffect thì có một lượt vẽ với thứ tự của chế độ cũ — dòng đổi chỗ dưới tay người
     đang bấm (đã bắt được bằng e2e: bấm "Cô Ba" mở sổ của khách khác). */
  const cur = tt.khoa === khoaTT ? (tt.dong === p.dong ? tt : { ...tt, trang: 0, them: 20, dong: p.dong }) : macDinh()
  const dat = (x: Partial<typeof cur>) => setTt({ ...cur, ...x })
  const { bat, sap, trang, them } = cur
  const setBat = (f: (b: string[]) => string[]) => dat({ bat: f(bat) })
  const setSap = (f: (s: typeof sap) => typeof sap) => dat({ sap: f(sap) })
  const setTrang = (n: number) => dat({ trang: n })
  const setThem = (f: (m: number) => number) => dat({ them: f(them) })

  const hien = coQuyen.filter((c) => !c.opt || bat.includes(c.k))
  const coSo = p.coSo ?? 1
  const dong = useMemo(() => {
    if (p.khongSap) return p.dong
    const c = hien.find((x) => x.k === sap.k)
    const vf = c ? (g: G) => c.v(g) : (g: G) => (g._s != null ? g._s : g._n)
    return p.dong.slice().sort((x, y) => {
      const a = vf(x) as unknown
      const b = vf(y) as unknown
      if (typeof a === "string" || typeof b === "string") return String(a ?? "").localeCompare(String(b ?? ""), "vi") * sap.dir
      if (a && typeof a === "object" && "t" in (a as object)) return 0
      return ((Number(a) || 0) - (Number(b) || 0)) * sap.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dong, sap, p.khongSap, hien.map((c) => c.k).join()])

  const CO_TRANG = 50
  const soTrang = Math.max(1, Math.ceil(dong.length / CO_TRANG))
  const trangNay = Math.min(trang, soTrang - 1)
  const dongMay = dong.slice(trangNay * CO_TRANG, (trangNay + 1) * CO_TRANG)
  const dongDt = dong.slice(0, them)
  const iChinh = hien.findIndex((c) => c.k === p.chinh)

  if (p.xuatRef) {
    p.xuatRef.current = () => {
      const out: (string | number)[][] = [[p.cotDau, ...hien.map((c) => c.label)]]
      const giaTri = (c: CotBang<G>, g: G): string | number => {
        const v = c.v(g)
        if (c.f === "qty") return (v as { sub?: string; t?: string })?.sub || (v as { t?: string })?.t || ""
        if (c.f === "share") return p.coSo ? Math.round(((Number(v) || 0) / p.coSo) * 10000) / 100 : 0
        if (c.f === "pct") return typeof v === "number" && isFinite(v) ? Math.round(v * 10000) / 100 : ""
        if (c.f === "date") return typeof v === "string" && v ? ngayDu(v) : ""
        return typeof v === "number" ? Math.round(v) : v == null ? "" : String(v)
      }
      if (p.tong) out.push([p.nhanTong || "Tổng", ...hien.map((c) => (c.noTot || c.f === "text" || c.f === "date" || c.f === "qty" ? "" : giaTri(c, p.tong!)))])
      for (const g of dong) out.push([g._n, ...hien.map((c) => giaTri(c, g))])
      return out
    }
  }

  const bamSap = (k: string) => {
    if (p.khongSap) return
    setSap((s) => (s.k === k ? { k, dir: (s.dir * -1) as 1 | -1 } : { k, dir: k === "_n" ? 1 : -1 }))
  }
  const cotPhu = coQuyen.filter((c) => c.opt)
  const tongO = p.tong ? hien.map((c) => oCua(c, p.tong!, true, coSo)) : null

  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid={p.testId || "bc-bang"}>
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">{p.tieuDe}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{p.phu ?? `${p.dong.length} dòng`}</div>
        </div>
        {cotPhu.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="hidden h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold hover:bg-muted/50 lg:flex">
                <Columns3 className="h-4 w-4" />
                Cột
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <div className="px-1 pb-1.5 text-[15px] font-bold">Cột hiển thị</div>
              {coQuyen.map((c) => {
                const on = !c.opt || bat.includes(c.k)
                return (
                  <button
                    key={c.k}
                    type="button"
                    disabled={!c.opt}
                    onClick={() => setBat((b) => (b.includes(c.k) ? b.filter((x) => x !== c.k) : [...b, c.k]))}
                    className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted/60 disabled:cursor-default"
                  >
                    <span className={cn("grid h-[18px] w-[18px] place-items-center rounded-[5px] border-[1.5px]", on ? (c.opt ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-muted-foreground/50 text-white") : "border-muted-foreground/50")}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">{c.label}</span>
                    {!c.opt && <span className="text-xs text-muted-foreground">mặc định</span>}
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Máy tính */}
      <div className="hidden max-h-[600px] overflow-auto border-t lg:block">
        <table className="w-full border-separate border-spacing-0 tabular-nums">
          <thead>
            <tr>
              {[{ k: "_n", label: p.cotDau, right: false }, ...hien.map((c) => ({ k: c.k, label: c.label, right: c.f !== "text" && c.f !== "date" }))].map((h) => (
                <th
                  key={h.k}
                  onClick={() => bamSap(h.k)}
                  className={cn(
                    "sticky top-0 z-[2] whitespace-nowrap border-b bg-muted/60 px-3.5 py-2.5 text-xs font-semibold text-muted-foreground backdrop-blur",
                    h.right ? "text-right" : "text-left",
                    !p.khongSap && "cursor-pointer"
                  )}
                >
                  {h.label} {sap.k === h.k && !p.khongSap ? (sap.dir > 0 ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
            {tongO && (
              <tr data-testid="bc-dong-tong">
                <td style={{ top: 37 }} className="sticky z-[2] whitespace-nowrap border-b border-primary/20 bg-primary/10 px-3.5 py-2 text-[13px] font-bold">
                  {p.nhanTong || "Tổng"}
                  <span className="text-xs font-medium text-muted-foreground"> · {p.phuTong ?? `${p.dong.length} dòng`}</span>
                </td>
                {tongO.map((o, i) => (
                  <td key={i} style={{ top: 37 }} className={cn("sticky z-[2] whitespace-nowrap border-b border-primary/20 bg-primary/10 px-3.5 py-2 text-[13px] font-bold", o.right ? "text-right" : "text-left", o.cls)}>
                    {o.t}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {dongMay.map((g, ri) => {
              const bam = p.onDong?.(g) || null
              return (
                <tr key={`${g._n}|${g._sub ?? ""}|${ri}`} onClick={bam || undefined} className={cn(bam && "cursor-pointer", g._bold ? "bg-muted/40" : "", "hover:bg-muted/40")}>
                  <td className={cn("whitespace-nowrap border-b px-3.5 py-2 text-[13px]", g._bold ? "font-bold" : "font-semibold")} style={{ paddingLeft: g._indent ? 30 : undefined }}>
                    <div>{g._n}</div>
                    {g._sub && <div className="mt-px text-[11px] font-normal text-muted-foreground">{g._sub}</div>}
                  </td>
                  {hien.map((c) => {
                    const o = oCua(c, g, false, coSo)
                    return (
                      <td key={c.k} className={cn("whitespace-nowrap border-b px-3.5 py-2 align-middle text-[13px]", o.right ? "text-right" : "text-left", c.bold || g._bold ? "font-semibold" : "font-medium", o.cls)}>
                        {o.bar != null ? (
                          <div className="flex items-center justify-end gap-2">
                            <span>{o.t}</span>
                            <div className="h-1 w-[60px] overflow-hidden rounded-sm bg-muted">
                              <div className="h-full bg-primary/60" style={{ width: `${o.bar}%` }} />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div>{o.t}</div>
                            {o.sub && <div className="mt-px text-[11px] font-normal text-muted-foreground">{o.sub}</div>}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {soTrang > 1 && (
        <div className="hidden items-center justify-end gap-2 border-t px-3.5 py-2.5 text-xs text-muted-foreground lg:flex">
          {trangNay * CO_TRANG + 1}–{Math.min(dong.length, (trangNay + 1) * CO_TRANG)} / {dong.length}
          <button type="button" aria-label="Trang trước" onClick={() => setTrang(Math.max(0, trangNay - 1))} className="h-8 w-8 rounded-lg border bg-card">
            ‹
          </button>
          <button type="button" aria-label="Trang sau" onClick={() => setTrang(Math.min(soTrang - 1, trangNay + 1))} className="h-8 w-8 rounded-lg border bg-card">
            ›
          </button>
        </div>
      )}

      {/* Điện thoại */}
      <div className="lg:hidden">
        {tongO && (
          <div className="flex items-center gap-2.5 border-t border-primary/20 bg-primary/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{p.nhanTong || "Tổng"}</div>
              <div className="text-xs text-muted-foreground">{p.phuTong ?? `${p.dong.length} dòng`}</div>
            </div>
            <div className="text-[15px] font-bold tabular-nums">{iChinh >= 0 ? tongO[iChinh].t : ""}</div>
          </div>
        )}
        {dongDt.map((g, ri) => {
          const bam = p.onDong?.(g) || null
          const os = hien.map((c) => oCua(c, g, false, coSo))
          const chinh = iChinh >= 0 ? os[iChinh] : os[os.length - 1]
          const phu = hien
            .map((c, i) => (i === iChinh || c.f === "share" || !os[i].t ? null : `${c.label} ${os[i].t}`))
            .filter(Boolean)
            .slice(0, 3)
            .join(" · ")
          return (
            <div key={`${g._n}|${g._sub ?? ""}|${ri}`} role={bam ? "button" : undefined} onClick={bam || undefined} className={cn("flex min-h-11 items-center gap-2.5 border-t py-3 pr-4", g._indent ? "pl-[30px]" : "pl-4", g._bold && "bg-muted/40", bam && "cursor-pointer")}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g._n}</span>
                  <span className={cn("whitespace-nowrap text-sm font-bold tabular-nums", chinh?.cls)}>{chinh?.t}</span>
                </div>
                {g._sub && <div className="text-xs text-muted-foreground">{g._sub}</div>}
                {phu && <div className="text-xs tabular-nums">{phu}</div>}
              </div>
              {bam && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
            </div>
          )
        })}
        {dong.length > them && (
          <button type="button" onClick={() => setThem((m) => m + 20)} className="h-12 w-full border-t text-sm font-semibold text-primary">
            Tải thêm 20 · còn {dong.length - them}
          </button>
        )}
      </div>
      {p.dong.length === 0 && (
        <div className="flex items-center gap-2 border-t px-4 py-4 text-[13px] text-muted-foreground" data-testid="bc-bang-rong">
          <Check className="h-4 w-4" />
          Không có dòng nào khớp.
        </div>
      )}
    </div>
  )
}
