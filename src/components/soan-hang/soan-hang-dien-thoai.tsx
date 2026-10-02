"use client"

/**
 * SOẠN HÀNG — ĐIỆN THOẠI, theo mẫu chủ nhà 02/10/2026 (https://claude.ai/artifact/Hd9fqcePGUAqJVtokEpnBb):
 * "Cùng lượt soạn với màn máy tính. Nhặt theo đường đi kệ, rồi chia từng mặt hàng vào rổ A–D."
 * Màn: lượt đang soạn / tạo lượt → Chuẩn bị rổ + đường đi → Nhặt tổng (Lần lượt | Danh sách, Thiếu hàng) →
 * Chia vào rổ → Kiểm tra & Hoàn tất soạn (thiếu thì báo để sửa hoá đơn — không tự đổi tiền / kho).
 */
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "@/components/ui/link"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  chiaVaoRo, chuaChiaKeTiep, chuaNhatKeTiep, hienSoLuong, khoaChia, khuKe, nhomDong, thieuTheoHd, tongKet, CHU_RO,
} from "@/lib/orders/luot-soan"
import { ChonHoaDon, type Nguoi, type Tuyen } from "./chon-hoa-don"
import type { LuotSoan } from "./use-luot-soan"

type Man = "ds" | "chon" | "dau" | "nhat" | "chia" | "xong"
const tienGon = (n: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n / 1e6)} tr`

export function SoanHangDienThoai({
  L, orgId, tuyen, nguoi, tenTuyen, choDanhDau,
}: {
  L: LuotSoan
  orgId: string | null | undefined
  tuyen: Tuyen[]
  nguoi: Nguoi[]
  tenTuyen: (c: string | null | undefined) => string
  choDanhDau: boolean
}) {
  const router = useRouter()
  const [man, setMan] = useState<Man>(L.luot ? "dau" : "ds")
  const [cheDo, setCheDo] = useState<"lan" | "ds">("lan")
  const [cur, setCur] = useState(0)
  const [si, setSi] = useState(0)
  const [sheet, setSheet] = useState<{ productId: string; val: number } | null>(null)
  const { rows, tienDo: t, hd, chon } = L
  // Lượt vừa mở (đường dẫn `?luot=`, danh sách) → vào màn chuẩn bị rổ.
  const luotId = L.luot?.id
  useEffect(() => {
    if (luotId) setMan((m) => (m === "ds" || m === "chon" ? "dau" : m))
  }, [luotId])
  const k = useMemo(() => tongKet(rows, t), [rows, t])
  const nhom = useMemo(() => nhomDong(rows, "ke"), [rows])
  const thieu = useMemo(() => thieuTheoHd(rows, t), [rows, t])
  const dangMo = !!L.luot || chon.length > 0
  const manThat: Man = !dangMo && man !== "chon" ? "ds" : man

  // Dòng nhặt hiện tại: bỏ qua dòng đã nhặt.
  const ci = rows.length ? (t.nhat[rows[Math.min(cur, rows.length - 1)]?.productId] === undefined ? Math.min(cur, rows.length - 1) : chuaNhatKeTiep(rows, t, cur)) : -1
  const r = ci >= 0 ? rows[ci] : null
  // Tối đa 3 mặt hàng chưa nhặt kế tiếp (theo đường đi kệ, vòng lại đầu).
  const tiepTheo: number[] = []
  for (let d = 1; ci >= 0 && d < rows.length && tiepTheo.length < 3; d++) {
    const i = (ci + d) % rows.length
    if (t.nhat[rows[i].productId] === undefined) tiepTheo.push(i)
  }
  const ghiNhat = (productId: string, v: number | null, tu: number) => {
    void L.ghi({ nhat: { [productId]: v } })
    const tiep = chuaNhatKeTiep(rows, { ...t, nhat: { ...t.nhat, [productId]: v ?? 0 } }, tu)
    if (tiep >= 0) setCur(tiep)
    setSheet(null)
  }

  const dongChia = rows.filter((x) => chiaVaoRo(x, t.nhat[x.productId]).some((p) => p.duoc > 0))
  const sIdx = Math.min(si, Math.max(dongChia.length - 1, 0))
  const sr = dongChia[sIdx]
  const xongDong = (x: (typeof rows)[number], chia = t.chia) => chiaVaoRo(x, t.nhat[x.productId]).every((p) => p.duoc <= 0 || chia[khoaChia(x.productId, p.invoiceId)])
  const chiaO = (productId: string, invoiceId: string) => {
    const kk = khoaChia(productId, invoiceId)
    const chia = { ...t.chia, [kk]: !t.chia[kk] }
    void L.ghi({ chia: { [kk]: !t.chia[kk] } })
    if (sr && xongDong(sr, chia)) {
      const n = dongChia.findIndex((x, i) => i > sIdx && !xongDong(x, chia))
      const m = n >= 0 ? n : dongChia.findIndex((x) => !xongDong(x, chia))
      if (m >= 0) setSi(m)
    }
  }
  const chiaCaDong = () => {
    if (!sr) return
    const p: Record<string, boolean> = {}
    for (const x of chiaVaoRo(sr, t.nhat[sr.productId])) if (x.duoc > 0) p[khoaChia(sr.productId, x.invoiceId)] = true
    void L.ghi({ chia: p })
    const tiep = chuaChiaKeTiep(dongChia, { ...t, chia: { ...t.chia, ...p } }, sIdx)
    if (tiep >= 0) setSi(tiep)
  }

  const tieuDe: Record<Man, [string, string]> = {
    ds: ["Soạn hàng", `${L.dsLuot.length} lượt đang soạn`],
    chon: ["Tạo lượt soạn", `${chon.length} hóa đơn đã chọn`],
    dau: [L.luot?.ma || "Lượt soạn mới", Array.from(new Set(hd.map((h) => h.tuyen).filter(Boolean))).map((x) => `Tuyến ${x}`).join(", ") || `${chon.length} hóa đơn`],
    nhat: ["Nhặt tổng", `${k.soMat - k.daNhat} mặt hàng còn lại`],
    chia: ["Chia vào rổ", `${chon.length} rổ · ${dongChia.filter((x) => xongDong(x)).length}/${dongChia.length} mặt hàng xong`],
    xong: ["Kiểm tra & hoàn tất", `${chon.length} hóa đơn`],
  }
  const lui: Record<Man, () => void> = {
    ds: () => router.push("/inventory"),
    chon: () => setMan("ds"),
    dau: () => { L.dongLuot(); setMan("ds") },
    nhat: () => setMan("dau"),
    chia: () => setMan("nhat"),
    xong: () => setMan("chia"),
  }
  const buoc = ["Nhặt tổng", "Chia rổ", "Hoàn tất"].map((label, i) => {
    const xong = (i === 0 && k.xongNhat) || (i === 1 && k.xongChia)
    const dang = { nhat: 0, chia: 1, xong: 2 }[manThat as "nhat"] === i
    return { label, xong, dang }
  })
  const day = "fixed inset-x-0 bottom-0 z-30 border-t bg-card px-3.5 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]"
  const nutChinh = "h-[52px] w-full rounded-[14px] bg-primary text-base font-semibold text-primary-foreground disabled:bg-primary/40"

  return (
    <div className="no-print -mx-4 -mt-4 flex min-h-screen flex-col bg-muted/40 pb-36" data-testid="soan-hang-dien-thoai">
      <div className="sticky top-0 z-20 bg-card">
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <button type="button" aria-label="Quay lại" onClick={lui[manThat]} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold leading-tight">{tieuDe[manThat][0]}</h1>
            <p className="truncate text-xs text-muted-foreground">{tieuDe[manThat][1]}</p>
          </div>
          {manThat === "nhat" && <span className="text-sm font-bold tabular-nums text-primary">{k.daNhat}/{k.soMat}</span>}
          {manThat === "chia" && <span className="text-sm font-bold tabular-nums text-primary">{k.roDu.size}/{chon.length} rổ</span>}
        </div>
        {["dau", "nhat", "chia", "xong"].includes(manThat) && (
          <div className="grid grid-cols-3 gap-1.5 border-b px-3.5 pb-2.5">
            {buoc.map((b) => (
              <div key={b.label}>
                <div className={cn("h-1 rounded-full", b.xong ? "bg-emerald-600" : b.dang ? "bg-primary" : "bg-muted")} />
                <span className={cn("mt-1 block text-[11px] font-semibold", b.xong ? "text-emerald-700" : b.dang ? "text-primary" : "text-muted-foreground")}>{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!L.coLuot && (
        <p className="m-3.5 mb-0 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">Máy chủ chưa chạy migration 225 — tiến độ chỉ giữ trên máy này.</p>
      )}

      {/* ---- Lượt đang soạn ---- */}
      {manThat === "ds" && (
        <div className="space-y-3 p-3.5">
          {L.dsLuot.length === 0 ? (
            <p className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">Chưa có lượt soạn nào đang dở.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card" data-testid="ds-luot">
              {L.dsLuot.map((l) => {
                const n = Object.keys(((l.tien_do as { nhat?: object })?.nhat) ?? {}).length
                return (
                  <button key={l.id} type="button" onClick={async () => { if (await L.moLuot(l.id)) setMan("dau") }} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{l.ma}</span>
                      <span className="block text-xs text-muted-foreground">{l.invoice_ids.length} hóa đơn · đã nhặt {n} mặt hàng</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {manThat === "ds" && choDanhDau && (
        <div className={day}>
          <button type="button" className={cn(nutChinh, "flex items-center justify-center gap-2")} onClick={() => { L.dongLuot(); setMan("chon") }}>
            <Plus className="h-5 w-5" /> Tạo lượt soạn mới
          </button>
        </div>
      )}

      {/* ---- Chọn hoá đơn cho lượt mới ---- */}
      {manThat === "chon" && (
        <>
          <div className="m-3.5 overflow-hidden rounded-2xl border bg-card">
            <ChonHoaDon
              orgId={orgId}
              tuyen={tuyen}
              nguoi={nguoi}
              chonIds={chon.map((d) => d.id)}
              soMat={L.soMatCuaHd}
              onToggle={(d) => (chon.some((x) => x.id === d.id) ? L.bo(d.id) : L.them(d))}
              onThem={(ds) => L.them(ds)}
              tenTuyen={tenTuyen}
            />
          </div>
          <div className={day}>
            <button type="button" className={nutChinh} disabled={!chon.length} onClick={async () => { if (await L.damBaoLuot() || !L.coLuot) setMan("dau") }} data-testid="tao-luot">
              {chon.length ? `Tạo lượt soạn (${chon.length} hóa đơn)` : "Chọn hóa đơn để soạn"}
            </button>
          </div>
        </>
      )}

      {/* ---- Chuẩn bị rổ ---- */}
      {manThat === "dau" && (
        <>
          <div className="space-y-4 p-3.5">
            <div className="grid grid-cols-3 rounded-2xl border bg-card px-4 py-3.5">
              <div><p className="text-2xl font-bold">{chon.length}</p><p className="text-xs text-muted-foreground">đơn · rổ {chon.length > 1 ? `${CHU_RO[0]}–${CHU_RO[chon.length - 1]}` : CHU_RO[0]}</p></div>
              <div><p className="text-2xl font-bold">{rows.length}</p><p className="text-xs text-muted-foreground">mặt hàng</p></div>
              <div><p className="text-2xl font-bold">{nhom.length}</p><p className="text-xs text-muted-foreground">khu kệ</p></div>
            </div>
            <div>
              <div className="mb-2 flex items-baseline justify-between"><h2 className="text-[15px] font-bold">Chuẩn bị rổ</h2><span className="text-xs text-muted-foreground">Dán nhãn chữ lên rổ</span></div>
              <div className="overflow-hidden rounded-2xl border bg-card" data-testid="ds-ro">
                {hd.map((h, i) => (
                  <div key={h.id} className="flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl font-bold text-primary">{CHU_RO[i]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{h.khach}</span>
                      <span className="block text-xs text-muted-foreground">{h.ma} · {L.soMatCuaHd.get(h.id) ?? 0} mặt hàng</span>
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums">{tienGon(h.tong ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-[15px] font-bold">Đường đi</h2>
              <div className="overflow-hidden rounded-2xl border bg-card">
                {nhom.map((g, i) => (
                  <div key={g.ten} className="flex items-center justify-between border-b px-3.5 py-2.5 text-sm last:border-b-0">
                    <span><b className="mr-3 text-muted-foreground">{i + 1}</b>{g.ten}</span>
                    <span className="text-xs text-muted-foreground">{g.rows.length} mặt hàng</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className={day}>
            <button type="button" className={nutChinh} disabled={!rows.length} onClick={() => setMan(k.xongNhat ? "chia" : "nhat")} data-testid="bat-dau-nhat">
              {k.daNhat ? (k.xongNhat ? "Tiếp tục chia rổ" : "Tiếp tục nhặt") : "Bắt đầu nhặt"}
            </button>
          </div>
        </>
      )}

      {/* ---- Nhặt tổng ---- */}
      {manThat === "nhat" && (
        <>
          <div className="px-3.5 pt-3">
            <div className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]" role="group" aria-label="Cách nhặt">
              {([["lan", "Lần lượt"], ["ds", "Danh sách"]] as const).map(([kk, nhan]) => (
                <button key={kk} type="button" aria-pressed={cheDo === kk} onClick={() => setCheDo(kk)} className={cn("h-8 flex-1 rounded-lg text-[13px] font-semibold", cheDo === kk ? "bg-card shadow-sm" : "text-muted-foreground")}>{nhan}</button>
              ))}
            </div>
          </div>
          {cheDo === "lan" ? (
            <div className="space-y-3 p-3.5">
              {r && (
                <div className="overflow-hidden rounded-2xl border bg-card" data-testid="the-nhat">
                  <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
                    <span><span className="block text-xs opacity-85">{khuKe(r.viTri)}</span><span className="text-2xl font-bold">{r.viTri || "—"}</span></span>
                    <span className="text-right text-xs opacity-85">Mặt hàng<br /><b className="text-base">{ci + 1}/{rows.length}</b></span>
                  </div>
                  <div className="space-y-3 px-4 py-3.5">
                    <div><p className="text-base font-bold leading-snug">{r.ten}</p><p className="text-xs text-muted-foreground">{[r.sku, r.ncc].filter(Boolean).join(" · ")}</p></div>
                    <div className="rounded-xl bg-muted/50 px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">Nhặt tổng</p>
                      <p className="text-2xl font-bold tabular-nums" data-testid="sl-nhat">{hienSoLuong(r.tong, r).chinh}</p>
                      {hienSoLuong(r.tong, r).phu && <p className="text-xs text-muted-foreground">{hienSoLuong(r.tong, r).phu}</p>}
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs text-muted-foreground">Sẽ chia vào rổ</p>
                      <div className="flex flex-wrap gap-1.5">
                        {r.phan.map((p) => <span key={p.invoiceId} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm"><b className="text-primary">{p.ro}</b>{p.sl}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {k.xongNhat && (
                <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-4" data-testid="nhat-xong">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-5 w-5" /></span>
                  <span><span className="block text-sm font-bold">Đã nhặt xong {k.soMat} mặt hàng</span><span className="block text-xs text-muted-foreground">{k.matThieu ? `${k.matThieu} mặt hàng thiếu, sẽ báo ở bước kiểm tra` : "Không thiếu mặt hàng nào"}</span></span>
                </div>
              )}
              {!k.xongNhat && tiepTheo.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between"><span className="text-xs font-semibold text-muted-foreground">Tiếp theo</span><button type="button" className="text-xs font-semibold text-primary" onClick={() => setCheDo("ds")}>Xem tất cả</button></div>
                  <div className="overflow-hidden rounded-2xl border bg-card">
                    {tiepTheo.map((i) => (
                      <button key={rows[i].productId} type="button" onClick={() => setCur(i)} className="grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3.5 py-2.5 text-left text-sm last:border-b-0">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-bold">{rows[i].viTri || "—"}</span>
                        <span className="truncate">{rows[i].ten}</span>
                        <span className="text-xs font-semibold">{hienSoLuong(rows[i].tong, rows[i]).chinh}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-3.5">
              {nhom.map((g) => (
                <div key={g.ten}>
                  <div className="mb-1.5 flex justify-between text-xs font-semibold text-muted-foreground"><span>{g.ten}</span><span>{g.rows.filter((x) => t.nhat[x.productId] !== undefined).length}/{g.rows.length}</span></div>
                  <div className="overflow-hidden rounded-2xl border bg-card">
                    {g.rows.map((x) => {
                      const got = t.nhat[x.productId]
                      const da = got !== undefined
                      const sh = da && got < x.tong
                      return (
                        <button key={x.productId} type="button" data-testid="dong-nhat" disabled={!choDanhDau} onClick={() => void L.ghi({ nhat: { [x.productId]: da ? null : x.tong } })} className={cn("grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3.5 py-3 text-left last:border-b-0", da && "bg-muted/40")}>
                          <span className={cn("grid h-5 w-5 place-items-center rounded-md border-[1.5px] text-white", da ? (sh ? "border-destructive bg-destructive" : "border-emerald-600 bg-emerald-600") : "border-muted-foreground/60")}>{da && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                          <span className="min-w-0">
                            <span className={cn("block truncate text-sm font-semibold", da && "text-muted-foreground")}>{x.ten}</span>
                            <span className={cn("block text-xs", sh ? "text-destructive" : "text-muted-foreground")}>{x.viTri || "—"} · {sh ? `Thiếu ${x.tong - got} ${x.donViCoSo}` : x.phan.map((p) => `${p.ro} ${p.sl}`).join(", ")}</span>
                          </span>
                          <span className="text-sm font-bold tabular-nums">{hienSoLuong(x.tong, x).chinh}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className={day}>
            {cheDo === "lan" && r && choDanhDau ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <button type="button" onClick={() => setSheet({ productId: r.productId, val: Math.max(r.tong - 1, 0) })} className="h-[52px] rounded-[14px] border border-destructive/40 text-[15px] font-semibold text-destructive">Thiếu hàng</button>
                  <button type="button" onClick={() => ghiNhat(r.productId, r.tong, ci)} className={cn(nutChinh, "flex items-center justify-center gap-2")} data-testid="nhat-du"><Check className="h-5 w-5" /> Đã nhặt đủ</button>
                </div>
                <button type="button" onClick={() => { const n = chuaNhatKeTiep(rows, t, ci); if (n >= 0) setCur(n) }} className="w-full text-center text-[13px] font-semibold text-muted-foreground">Để sau, nhặt mặt hàng khác</button>
              </div>
            ) : (
              <button type="button" className={nutChinh} disabled={!k.xongNhat} onClick={() => { setSi(Math.max(chuaChiaKeTiep(dongChia, t, -1), 0)); setMan("chia") }} data-testid="sang-chia">
                {k.xongNhat ? "Sang bước chia rổ" : `Còn ${k.soMat - k.daNhat} mặt hàng chưa nhặt`}
              </button>
            )}
          </div>
        </>
      )}

      {/* ---- Chia vào rổ ---- */}
      {manThat === "chia" && (
        <>
          {sr ? (
            <div className="space-y-3 p-3.5">
              <div className="rounded-2xl border bg-card px-4 py-3.5">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{sr.viTri || "—"} · Mặt hàng {sIdx + 1}/{dongChia.length}</span><span className={cn("font-semibold", xongDong(sr) ? "text-emerald-700" : "text-primary")}>{xongDong(sr) ? "Đã chia xong" : `${chiaVaoRo(sr, t.nhat[sr.productId]).filter((p) => p.duoc > 0 && t.chia[khoaChia(sr.productId, p.invoiceId)]).length}/${chiaVaoRo(sr, t.nhat[sr.productId]).filter((p) => p.duoc > 0).length} rổ`}</span></div>
                <p className="mt-1 text-base font-bold">{sr.ten}</p>
                <p className="text-xs text-muted-foreground">Đã nhặt {hienSoLuong(t.nhat[sr.productId] ?? sr.tong, sr).chinh}</p>
              </div>
              <p className="text-xs text-muted-foreground">Bỏ đúng số lượng vào rổ rồi chạm ô để xác nhận.</p>
              <div className="grid grid-cols-2 gap-2.5">
                {chiaVaoRo(sr, t.nhat[sr.productId]).map((p) => {
                  const on = !!t.chia[khoaChia(sr.productId, p.invoiceId)]
                  const het = p.duoc <= 0
                  return (
                    <button key={p.invoiceId} type="button" disabled={het || !choDanhDau} onClick={() => chiaO(sr.productId, p.invoiceId)} data-testid="o-chia" aria-pressed={on} className={cn("rounded-2xl border-2 px-3.5 py-3 text-left", het ? "border-muted bg-muted/50" : on ? "border-emerald-600 bg-emerald-50" : "border-primary/30 bg-card")}>
                      <span className="flex items-center justify-between">
                        <span className={cn("text-2xl font-bold", het ? "text-muted-foreground" : on ? "text-emerald-700" : "text-primary")}>{p.ro}</span>
                        <span className={cn("text-[11px] font-semibold", on ? "text-emerald-700" : "text-destructive")}>{het ? "Hết hàng" : on ? "Đã bỏ" : p.duoc < p.sl ? `Thiếu ${p.sl - p.duoc}` : ""}</span>
                      </span>
                      <span className="block text-lg font-bold tabular-nums">{p.duoc} {sr.donViCoSo}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.khach}</span>
                    </button>
                  )
                })}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Tình trạng rổ</p>
                <div className="flex flex-wrap gap-1.5">
                  {hd.map((h, i) => (
                    <span key={h.id} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs", k.roDu.has(h.id) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-card")}>
                      <b>{CHU_RO[i]}</b>{k.roDu.has(h.id) ? "Đủ" : `${rows.reduce((s, x) => s + (chiaVaoRo(x, t.nhat[x.productId]).some((p) => p.invoiceId === h.id && p.duoc > 0) && t.chia[khoaChia(x.productId, h.id)] ? 1 : 0), 0)}/${rows.reduce((s, x) => s + (chiaVaoRo(x, t.nhat[x.productId]).some((p) => p.invoiceId === h.id && p.duoc > 0) ? 1 : 0), 0)}`}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="m-3.5 rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">Không có hàng để chia.</p>
          )}
          <div className={cn(day, "flex gap-2")}>
            <button type="button" aria-label="Mặt hàng trước" onClick={() => setSi((sIdx - 1 + dongChia.length) % Math.max(dongChia.length, 1))} className="grid h-[52px] w-[52px] place-items-center rounded-[14px] border"><ChevronLeft className="h-5 w-5" /></button>
            <button
              type="button"
              className={nutChinh}
              disabled={!choDanhDau && !k.xongChia}
              onClick={() => (k.xongChia ? setMan("xong") : chiaCaDong())}
              data-testid="chia-chinh"
            >
              {k.xongChia ? "Kiểm tra rổ" : "Bỏ đủ cả mặt hàng"}
            </button>
            <button type="button" aria-label="Mặt hàng sau" onClick={() => setSi((sIdx + 1) % Math.max(dongChia.length, 1))} className="grid h-[52px] w-[52px] place-items-center rounded-[14px] border"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </>
      )}

      {/* ---- Kiểm tra & hoàn tất ---- */}
      {manThat === "xong" && (
        <>
          <div className="space-y-3 p-3.5">
            <div className={cn("flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold", thieu.size ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700")} data-testid="ghi-chu-xong">
              {thieu.size ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {thieu.size ? `${thieu.size} rổ thiếu hàng — sửa hóa đơn theo số thực giao` : "Tất cả rổ đủ hàng"}
            </div>
            {hd.map((h, i) => {
              const sh = thieu.get(h.id) ?? []
              return (
                <div key={h.id} className="overflow-hidden rounded-2xl border bg-card" data-testid="the-ro-xong">
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl font-bold text-primary">{CHU_RO[i]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{h.khach}</span>
                      <span className="block text-xs text-muted-foreground">{h.ma} · {L.soMatCuaHd.get(h.id) ?? 0} mặt hàng</span>
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", sh.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{sh.length ? `Thiếu ${sh.length}` : "Đủ hàng"}</span>
                  </div>
                  {sh.length > 0 && (
                    <div className="space-y-1 border-t bg-amber-50/50 px-3.5 py-2.5 text-xs text-amber-900">
                      {sh.map((x) => <p key={x}>{x}</p>)}
                      <Link href={`/sales-invoices/${h.id}`} className="font-semibold text-primary underline">Mở hóa đơn để sửa</Link>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {choDanhDau && (
            <div className={day}>
              <button type="button" className={nutChinh} disabled={L.dangGhi || !k.xongChia} onClick={async () => { if (await L.hoanTat()) setMan("ds") }} data-testid="hoan-tat-soan">
                {L.dangGhi ? "Đang lưu…" : "Hoàn tất soạn"}
              </button>
            </div>
          )}
        </>
      )}

      {/* ---- Sheet thiếu hàng ---- */}
      {sheet && (() => {
        const x = rows.find((y) => y.productId === sheet.productId)
        if (!x) return null
        const thieuRo = chiaVaoRo(x, sheet.val).filter((p) => p.duoc < p.sl)
        return (
          <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setSheet(null)} data-testid="sheet-thieu">
            <div className="w-full rounded-t-3xl bg-card px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)]" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-bold">Nhặt được bao nhiêu?</p>
              <p className="text-xs text-muted-foreground">{x.ten} · cần {x.tong} {x.donViCoSo}</p>
              <div className="my-4 flex items-center justify-between">
                <button type="button" aria-label="Bớt" onClick={() => setSheet({ ...sheet, val: Math.max(sheet.val - 1, 0) })} className="grid h-14 w-14 place-items-center rounded-2xl border text-2xl">−</button>
                <span className="text-center"><span className="block text-3xl font-bold tabular-nums" data-testid="sheet-so">{sheet.val}</span><span className="text-xs text-muted-foreground">{hienSoLuong(sheet.val, x).chinh}</span></span>
                <button type="button" aria-label="Thêm" onClick={() => setSheet({ ...sheet, val: Math.min(sheet.val + 1, x.tong) })} className="grid h-14 w-14 place-items-center rounded-2xl border text-2xl">+</button>
              </div>
              <p className="mb-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {thieuRo.length ? `Chia đủ theo thứ tự rổ. Thiếu ở ${thieuRo.map((p) => `rổ ${p.ro} (${p.sl - p.duoc})`).join(", ")}.` : "Đủ cho mọi rổ."}
              </p>
              <button type="button" className={nutChinh} onClick={() => ghiNhat(x.productId, sheet.val, ci)} data-testid="luu-thieu">Lưu số lượng thiếu</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
