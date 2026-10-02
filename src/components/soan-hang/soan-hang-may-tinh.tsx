"use client"

/**
 * SOẠN HÀNG — MÁY TÍNH, theo mẫu chủ nhà 02/10/2026 (https://claude.ai/artifact/6HY8qFLNzZ5Sr2fPZ9w4oP):
 * ba bước Chọn hóa đơn · Nhặt tổng · Chia theo đơn; cột trái chọn hoá đơn (rổ A, B…); bên phải nhặt tổng theo
 * vị trí kệ / nhà cung cấp, rồi ma trận mặt hàng × rổ để chia. Bước cuối "Hoàn tất soạn" (đánh dấu hoá đơn đã
 * soạn, không trừ kho). Lõi: `lib/orders/luot-soan.ts`; lưu lượt: `use-luot-soan.ts` (mig 225).
 */
import { useEffect, useMemo, useState } from "react"
import Link from "@/components/ui/link"
import { ChevronRight, FileText, Tag, Check, Plus, X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  chiaVaoRo, hienSoLuong, khoaChia, nhomDong, thieuTheoHd, tongKet, CHU_RO, type DongNhat, type NhomTheo,
} from "@/lib/orders/luot-soan"
import { ChonHoaDon, type Nguoi, type Tuyen } from "./chon-hoa-don"
import type { LuotSoan } from "./use-luot-soan"
import { inNhanRo, inPhieuNhat } from "./to-in-soan-hang"

const tien = (n: number) => `${new Intl.NumberFormat("vi-VN").format(Math.round(n))}đ`

export function SoanHangMayTinh({
  L, orgId, tuyen, nguoi, tenTuyen, choDanhDau,
}: {
  L: LuotSoan
  orgId: string | null | undefined
  tuyen: Tuyen[]
  nguoi: Nguoi[]
  tenTuyen: (c: string | null | undefined) => string
  /** Vai được soạn (ghi tiến độ, hoàn tất). */
  choDanhDau: boolean
}) {
  const [buoc, setBuoc] = useState<"nhat" | "chia">("nhat")
  const [theo, setTheo] = useState<NhomTheo>("ke")
  const [lamMoi, setLamMoi] = useState(0)
  const [thieuMo, setThieuMo] = useState<string | null>(null)
  const [thieuSo, setThieuSo] = useState("")
  const { rows, tienDo: t, chon, hd } = L
  const k = useMemo(() => tongKet(rows, t), [rows, t])
  const thieu = useMemo(() => thieuTheoHd(rows, t), [rows, t])
  const nhom = useMemo(() => nhomDong(rows, theo), [rows, theo])
  const tongTien = hd.reduce((s, h) => s + (h.tong ?? 0), 0)
  const rong = chon.length === 0

  // Nhặt đủ hết → tự sang bước chia (như mẫu).
  const [daTuSang, setDaTuSang] = useState(false)
  useEffect(() => {
    if (k.xongNhat && !daTuSang && buoc === "nhat") {
      setBuoc("chia")
      setDaTuSang(true)
    }
    if (!k.xongNhat) setDaTuSang(false)
  }, [k.xongNhat, daTuSang, buoc])

  const nhatDu = (r: DongNhat) => {
    if (!choDanhDau) return
    const da = t.nhat[r.productId] !== undefined
    void L.ghi({ nhat: { [r.productId]: da ? null : r.tong } })
  }
  const luuThieu = (r: DongNhat) => {
    const n = Math.max(0, Math.min(r.tong, Number(thieuSo.replace(",", ".")) || 0))
    void L.ghi({ nhat: { [r.productId]: n } })
    setThieuMo(null)
  }
  const nhatHet = () => void L.ghi({ nhat: Object.fromEntries(rows.filter((r) => t.nhat[r.productId] === undefined).map((r) => [r.productId, r.tong])) })
  const chiaO = (r: DongNhat, invoiceId: string) => {
    if (!choDanhDau) return
    const kk = khoaChia(r.productId, invoiceId)
    void L.ghi({ chia: { [kk]: !t.chia[kk] } })
  }
  const chiaCaRo = (invoiceId: string, du: boolean) => {
    if (!choDanhDau) return
    const p: Record<string, boolean> = {}
    for (const r of rows) for (const x of chiaVaoRo(r, t.nhat[r.productId])) if (x.invoiceId === invoiceId && x.duoc > 0) p[khoaChia(r.productId, invoiceId)] = !du
    void L.ghi({ chia: p })
  }
  const hoanTat = async () => {
    if (await L.hoanTat()) {
      setBuoc("nhat")
      setLamMoi((n) => n + 1)
    }
  }

  const buocO = (so: number, ten: string, phu: string, on: boolean, xong: boolean, onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={`buoc-${so}`}
      aria-current={on ? "step" : undefined}
      className={cn("flex items-center gap-3 border-r px-4 py-3.5 text-left last:border-r-0", on ? "bg-muted/40" : "bg-card", onClick && "hover:bg-muted/30")}
    >
      <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-[10px] text-sm font-bold", xong ? "bg-emerald-50 text-emerald-700" : on ? "bg-primary text-primary-foreground" : so === 1 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{so}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{ten}</span>
        <span className="block text-xs text-muted-foreground">{phu}</span>
      </span>
    </button>
  )

  return (
    <div className="no-print space-y-4" data-testid="soan-hang-may-tinh">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Soạn hàng</h1>
          <p className="text-[13px] text-muted-foreground">Gộp hóa đơn thành một lượt nhặt, rồi chia vào rổ theo từng đơn.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={inPhieuNhat} disabled={rong} className="flex h-10 items-center gap-2 rounded-[10px] border bg-card px-3.5 text-[13px] font-semibold hover:bg-muted/40 disabled:opacity-50">
            <FileText className="h-4 w-4" /> In phiếu nhặt
          </button>
          <button type="button" onClick={inNhanRo} disabled={rong} className="flex h-10 items-center gap-2 rounded-[10px] border bg-card px-3.5 text-[13px] font-semibold hover:bg-muted/40 disabled:opacity-50">
            <Tag className="h-4 w-4" /> In nhãn rổ
          </button>
        </div>
      </div>

      {/* Lượt đang soạn — mở lại trên máy này hoặc máy khác (điện thoại). */}
      {L.coLuot ? (
        (L.dsLuot.length > 0 || L.luot) && (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="ds-luot">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lượt đang soạn</span>
            {L.dsLuot.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => void L.moLuot(l.id)}
                aria-pressed={L.luot?.id === l.id}
                className={cn("h-8 rounded-full border px-3 text-xs font-semibold", L.luot?.id === l.id ? "border-primary/40 bg-primary/10 text-primary" : "bg-card hover:bg-muted/40")}
              >
                {l.ma} · {l.invoice_ids.length} HĐ
              </button>
            ))}
            {L.luot && (
              <>
                <button type="button" onClick={L.dongLuot} className="flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/40">
                  <Plus className="h-3.5 w-3.5" /> Lượt mới
                </button>
                {choDanhDau && (
                  <button type="button" onClick={() => void L.huy()} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-destructive" data-testid="huy-luot">
                    Huỷ lượt {L.luot.ma}
                  </button>
                )}
              </>
            )}
          </div>
        )
      ) : (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Máy chủ chưa chạy migration 225 — tiến độ nhặt / chia chỉ giữ trên máy này, tải lại trang là mất.
        </p>
      )}

      <div className="grid grid-cols-3 overflow-hidden rounded-2xl border bg-card">
        {buocO(1, "Chọn hóa đơn", `${chon.length} hóa đơn · ${tien(tongTien)}`, false, false)}
        {buocO(2, "Nhặt tổng", `${k.daNhat}/${k.soMat} mặt hàng`, buoc === "nhat" && !rong, k.xongNhat, rong ? undefined : () => setBuoc("nhat"))}
        {buocO(3, "Chia theo đơn", `${k.daChia}/${k.soO} phần · ${k.roDu.size}/${chon.length} đơn đủ`, buoc === "chia" && !rong, k.xongChia, rong ? undefined : () => setBuoc("chia"))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="sticky top-4 flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-2xl border bg-card">
          <ChonHoaDon
            orgId={orgId}
            tuyen={tuyen}
            nguoi={nguoi}
            chonIds={chon.map((d) => d.id)}
            soMat={L.soMatCuaHd}
            onToggle={(d) => (chon.some((x) => x.id === d.id) ? L.bo(d.id) : L.them(d))}
            onThem={(ds) => L.them(ds)}
            tenTuyen={tenTuyen}
            lamMoi={lamMoi}
          />
          <div className="flex items-center justify-between border-t bg-muted/20 px-3.5 py-3 text-[13px]">
            <span><b>{chon.length}</b> <span className="text-muted-foreground">đã chọn · {rows.length} mặt hàng</span></span>
            {chon.length > 0 && <button type="button" className="text-xs font-semibold text-primary" onClick={L.boHet}>Bỏ hết</button>}
          </div>
        </section>

        <section className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-2xl border bg-card">
          {L.loiDong && <p className="border-b bg-destructive/5 px-4 py-2.5 text-sm text-destructive">Không đọc được dòng hóa đơn — {L.loiDong}</p>}
          {rong ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
              <p className="text-base font-bold">Chưa chọn hóa đơn nào</p>
              <p className="text-[13px] text-muted-foreground">Chọn các hóa đơn cùng tuyến bên trái để gộp thành một lượt nhặt.</p>
            </div>
          ) : L.dangNapDong && rows.length === 0 ? (
            <Skeleton className="m-4 h-40" />
          ) : buoc === "nhat" ? (
            <>
              <div className="flex flex-wrap items-center gap-4 border-b px-4 py-3.5">
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="font-semibold" data-testid="tien-do-nhat">Đã nhặt {k.daNhat}/{k.soMat} mặt hàng</span>
                    <span className="text-muted-foreground">{k.soMat - k.daNhat ? `Còn ${k.soMat - k.daNhat} mặt hàng` : "Đã nhặt đủ"}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${k.soMat ? Math.round((k.daNhat / k.soMat) * 100) : 0}%` }} />
                  </div>
                </div>
                <div className="flex gap-0.5 rounded-[10px] bg-muted/60 p-[3px]" role="group" aria-label="Nhóm theo">
                  {([["ke", "Theo vị trí kệ"], ["ncc", "Theo nhà cung cấp"]] as const).map(([kk, nhan]) => (
                    <button key={kk} type="button" aria-pressed={theo === kk} onClick={() => setTheo(kk)} className={cn("h-[30px] rounded-lg px-3 text-xs font-semibold", theo === kk ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                      {nhan}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-[22px_64px_minmax(0,1fr)_auto] gap-3 border-b bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                <span /><span>Vị trí</span><span>Mặt hàng</span><span className="text-right">Tổng cần nhặt</span>
              </div>
              {nhom.map((g) => (
                <div key={g.ten}>
                  <div className="flex justify-between border-b bg-muted/40 px-4 py-2.5 text-xs font-bold text-foreground/80" data-testid="nhom-nhat">
                    <span>{g.ten}</span>
                    <span className="font-medium text-muted-foreground">{g.rows.filter((r) => t.nhat[r.productId] !== undefined).length}/{g.rows.length}</span>
                  </div>
                  {g.rows.map((r) => {
                    const got = t.nhat[r.productId]
                    const da = got !== undefined
                    const thieuR = da && got < r.tong
                    const q = hienSoLuong(r.tong, r)
                    return (
                      <div key={r.productId} data-testid="dong-nhat" className={cn("grid grid-cols-[22px_64px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b px-4 py-3", da && !thieuR && "opacity-55")}>
                        <button
                          type="button"
                          onClick={() => nhatDu(r)}
                          aria-label={`${da ? "Bỏ nhặt" : "Đã nhặt"} ${r.ten}`}
                          aria-pressed={da}
                          className={cn("grid h-5 w-5 place-items-center rounded-md border-[1.5px] text-white", da ? (thieuR ? "border-destructive bg-destructive" : "border-emerald-600 bg-emerald-600") : "border-muted-foreground/60 bg-card")}
                        >
                          {da && <Check className="h-3 w-3" strokeWidth={3} />}
                        </button>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-foreground/80">{r.viTri || "—"}</span>
                        <button type="button" onClick={() => nhatDu(r)} className="min-w-0 text-left">
                          <span className={cn("block text-sm font-semibold", da && !thieuR && "line-through")}>{r.ten}</span>
                          <span className="block text-xs text-muted-foreground">{[r.sku, r.ncc].filter(Boolean).join(" · ")}{r.coDoi ? " · có hàng đổi" : ""}</span>
                        </button>
                        <span className="text-right">
                          <span className="block text-[15px] font-bold tabular-nums" data-testid="sl-nhat">{q.chinh}</span>
                          {q.phu && <span className="block text-xs text-muted-foreground">{q.phu}</span>}
                        </span>
                        <div className="col-[3/5] flex flex-wrap items-center gap-1">
                          {r.phan.map((p) => (
                            <span key={p.invoiceId} className="inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs text-foreground/80" data-testid="phan-ro">
                              <b className="text-primary">{p.ro}</b>{p.sl}
                            </span>
                          ))}
                          {thieuR && <span className="text-xs font-semibold text-destructive" data-testid="thieu-nhat">Thiếu {r.tong - got} {r.donViCoSo}</span>}
                          {choDanhDau && thieuMo !== r.productId && (
                            <button type="button" className="ml-auto text-xs font-semibold text-muted-foreground hover:text-destructive" onClick={() => { setThieuMo(r.productId); setThieuSo(String(da ? got : Math.max(r.tong - 1, 0))) }}>
                              Thiếu hàng
                            </button>
                          )}
                          {thieuMo === r.productId && (
                            <span className="ml-auto flex items-center gap-1.5 text-xs">
                              Nhặt được
                              <Input value={thieuSo} onChange={(e) => setThieuSo(e.target.value)} inputMode="decimal" className="h-7 w-20" aria-label={`Số nhặt được ${r.ten}`} />
                              {r.donViCoSo}
                              <button type="button" className="font-semibold text-primary" onClick={() => luuThieu(r)}>Lưu</button>
                              <button type="button" aria-label="Đóng" onClick={() => setThieuMo(null)}><X className="h-3.5 w-3.5" /></button>
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-3.5">
                {choDanhDau ? <button type="button" className="text-[13px] font-semibold text-primary" onClick={nhatHet} disabled={k.xongNhat}>Đánh dấu đã nhặt hết</button> : <span />}
                <button type="button" onClick={() => setBuoc("chia")} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
                  Sang bước chia hàng <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5">
                <div>
                  <p className="text-sm font-semibold">Xếp {chon.length} rổ, dán nhãn {chon.length > 1 ? `${CHU_RO[0]}–${CHU_RO[chon.length - 1]}` : CHU_RO[0]}</p>
                  <p className="text-xs text-muted-foreground">Bấm ô khi đã bỏ hàng vào rổ. Bấm tiêu đề cột để chia đủ cả đơn.</p>
                </div>
                <span className="text-[13px] text-muted-foreground" data-testid="tien-do-chia">{k.daChia}/{k.soO} phần</span>
              </div>
              <div className="overflow-x-auto">
                <div style={{ minWidth: 220 + chon.length * 96 }}>
                  <div className="grid border-b bg-muted/20" style={{ gridTemplateColumns: `minmax(220px,1.6fr) repeat(${chon.length}, minmax(96px,1fr))` }}>
                    <div className="flex items-end px-4 py-2.5 text-xs text-muted-foreground">Mặt hàng</div>
                    {hd.map((h, i) => {
                      const du = k.roDu.has(h.id)
                      const o = rows.reduce((s, r) => s + chiaVaoRo(r, t.nhat[r.productId]).filter((p) => p.invoiceId === h.id && p.duoc > 0).length, 0)
                      const d = rows.reduce((s, r) => s + (chiaVaoRo(r, t.nhat[r.productId]).some((p) => p.invoiceId === h.id && p.duoc > 0) && t.chia[khoaChia(r.productId, h.id)] ? 1 : 0), 0)
                      return (
                        <button key={h.id} type="button" onClick={() => chiaCaRo(h.id, du)} data-testid="cot-ro" className={cn("flex flex-col items-center gap-0.5 border-l px-1.5 py-2.5 hover:bg-muted/40", du && "bg-emerald-50")}>
                          <span className={cn("text-lg font-bold", du ? "text-emerald-700" : "text-primary")}>{CHU_RO[i]}</span>
                          <span className="text-[11px] font-semibold text-foreground/80">{h.ma}</span>
                          <span className="max-w-full truncate text-[11px] text-muted-foreground">{h.khach}</span>
                          <span className={cn("text-[11px] font-semibold", du ? "text-emerald-700" : "text-primary")}>{du ? "Đủ hàng" : `${d}/${o}`}</span>
                        </button>
                      )
                    })}
                  </div>
                  {rows.map((r) => {
                    const al = chiaVaoRo(r, t.nhat[r.productId])
                    return (
                      <div key={r.productId} className="grid border-b" style={{ gridTemplateColumns: `minmax(220px,1.6fr) repeat(${chon.length}, minmax(96px,1fr))` }} data-testid="dong-chia">
                        <div className="min-w-0 px-4 py-2.5">
                          <span className="block truncate text-[13px] font-semibold">{r.ten}</span>
                          <span className="block text-xs text-muted-foreground">{r.viTri || "—"} · tổng {hienSoLuong(r.tong, r).chinh}</span>
                        </div>
                        {hd.map((h) => {
                          const p = al.find((x) => x.invoiceId === h.id)
                          if (!p) return <div key={h.id} className="border-l" />
                          const on = !!t.chia[khoaChia(r.productId, h.id)]
                          const het = p.duoc <= 0
                          return (
                            <div key={h.id} className="flex border-l p-1.5">
                              <button
                                type="button"
                                disabled={het}
                                onClick={() => chiaO(r, h.id)}
                                data-testid="o-chia"
                                aria-pressed={on}
                                className={cn("min-h-10 flex-1 rounded-[10px] border text-[13px] font-semibold tabular-nums", het ? "bg-muted/50 text-muted-foreground" : on ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "bg-card hover:bg-muted/30")}
                              >
                                {het ? "Hết hàng" : on ? `Đã chia ${p.duoc}` : `${p.duoc} ${r.donViCoSo}`}
                                {!het && p.duoc < p.sl && <span className="block text-[10px] font-semibold text-destructive">thiếu {p.sl - p.duoc}</span>}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
              {thieu.size > 0 && (
                <div className="space-y-1.5 border-b bg-amber-50 px-4 py-3 text-[13px] text-amber-900" data-testid="ds-thieu">
                  <p className="font-semibold">Hóa đơn thiếu hàng — sửa hóa đơn theo số thực giao:</p>
                  {hd.filter((h) => thieu.has(h.id)).map((h) => (
                    <div key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                      <b>Rổ {CHU_RO[hd.indexOf(h)]} · {h.ma}</b>
                      <span>{thieu.get(h.id)!.join("; ")}</span>
                      <Link href={`/sales-invoices/${h.id}`} className="font-semibold text-primary underline">Mở hóa đơn</Link>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-3.5">
                <span className={cn("text-[13px] font-semibold", k.xongChia ? "text-emerald-700" : "text-muted-foreground")} data-testid="ghi-chu-chia">
                  {!k.xongNhat ? `Còn ${k.soMat - k.daNhat} mặt hàng chưa nhặt` : k.xongChia ? "Tất cả rổ đã đủ hàng" : `Còn ${k.soO - k.daChia} phần chưa chia · ${chon.length - k.roDu.size} đơn chưa đủ`}
                </span>
                {choDanhDau && (
                  <button
                    type="button"
                    disabled={!k.xongChia || L.dangGhi}
                    onClick={() => void hoanTat()}
                    data-testid="hoan-tat-soan"
                    className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:bg-primary/40"
                  >
                    {L.dangGhi ? "Đang lưu…" : "Hoàn tất soạn"}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
