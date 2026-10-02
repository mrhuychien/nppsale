"use client"

/**
 * KHỐI CHỌN HOÁ ĐƠN của màn Soạn hàng (máy tính: cột trái; điện thoại: màn tạo lượt) — theo mẫu chủ nhà
 * 02/10/2026: ô tìm "Mã hóa đơn, tên khách", chip tuyến, "N hóa đơn chờ soạn · Chọn tất cả", mỗi dòng có ô tích +
 * nhãn "Rổ A". Giữ bộ lọc đợt trước (mig 224): ngày HĐ, nhân viên, Chưa soạn / Đã soạn / Tất cả.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Search, SlidersHorizontal } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KHONG_DONG_NAO, menhDeTimDanhSach } from "@/lib/search/list-search"
import {
  LOC_SOAN_MAC_DINH, NHAN_TRANG_THAI_SOAN, apLocSoan, cotHoaDonSoan, khoaCuaTuyen, nhanDaSoan, soLocDangBat,
  thieuCotSoan, type LocSoan, type TrangThaiSoan,
} from "@/lib/orders/soan-hang-loc"
import { CHU_RO } from "@/lib/orders/luot-soan"
import { cn } from "@/lib/utils"
import type { HoaDonSoan } from "./use-luot-soan"

export interface Tuyen { id: string; code: string | null; name: string }
export interface Nguoi { id: string; full_name: string | null; role: string; is_active?: boolean | null }

/** Trần kết quả — đủ cho một ngày giao hàng, không kéo cả sổ về. */
const TRAN_TIM = 50
const tienGon = (n: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n / 1e6)} tr`

export function ChonHoaDon({
  orgId, tuyen, nguoi, chonIds, soMat, onToggle, onThem, tenTuyen, lamMoi,
}: {
  orgId: string | null | undefined
  tuyen: Tuyen[]
  nguoi: Nguoi[]
  chonIds: string[]
  /** Số mặt hàng của hoá đơn đã chọn (đã đọc dòng). */
  soMat: Map<string, number>
  onToggle: (d: HoaDonSoan) => void
  onThem: (ds: HoaDonSoan[]) => void
  tenTuyen: (channel: string | null | undefined) => string
  /** Đổi khoá này để đọc lại (sau khi hoàn tất / đánh dấu). */
  lamMoi?: number
}) {
  const supabase = useMemo(() => createClient(), [])
  const [q, setQ] = useState("")
  const [loc, setLoc] = useState<LocSoan>(LOC_SOAN_MAC_DINH)
  const [moLoc, setMoLoc] = useState(false)
  const [coCotSoan, setCoCotSoan] = useState(true)
  const [ketQua, setKetQua] = useState<HoaDonSoan[] | null>(null)
  const [dangTim, setDangTim] = useState(false)
  const datLoc = (x: Partial<LocSoan>) => setLoc((l) => ({ ...l, ...x }))
  const nguoiBan = nguoi.filter((u) => ["sales", "manager", "owner"].includes(u.role))
  const tenNguoi = (id: string | null | undefined) => (id && nguoi.find((u) => u.id === id)?.full_name) || null

  const luotRef = useRef(0)
  const tim = useCallback(async () => {
    const term = q.trim()
    const luot = ++luotRef.current
    setDangTim(true)
    let dieuKien: string | null = null
    if (term) {
      /* Ô tìm chung (chủ nhà 27/09/2026): từng từ, không dấu, mã viết liền — như mọi danh sách. */
      const or = await menhDeTimDanhSach(supabase, "sales_invoices", term, orgId, ["invoice_code"], [
        { column: "customer_id", table: "customers", columns: ["store_name", "phone", "owner_name"] },
        { column: "order_id", table: "sales_orders", columns: ["order_code"] },
      ])
      if (luot !== luotRef.current) return
      dieuKien = or.filter ?? KHONG_DONG_NAO
    }
    const chay = (co: boolean) => {
      let qd = supabase
        .from("sales_invoices")
        .select(cotHoaDonSoan(loc, co))
        .eq("status", "posted")
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(TRAN_TIM)
      qd = apLocSoan(qd, loc, co, khoaCuaTuyen(tuyen.find((r) => r.id === loc.tuyen)))
      if (dieuKien) qd = qd.or(dieuKien)
      return qd
    }
    let { data, error } = await chay(coCotSoan)
    if (error && coCotSoan && thieuCotSoan(error.message)) {
      setCoCotSoan(false)
      ;({ data, error } = await chay(false))
    }
    if (luot !== luotRef.current) return
    if (error) console.error("[soan-hang] tìm hóa đơn lỗi:", error.message)
    setKetQua((data as unknown as HoaDonSoan[]) ?? [])
    setDangTim(false)
  }, [supabase, q, loc, coCotSoan, tuyen, orgId])

  useEffect(() => {
    if (!orgId) return
    const t = setTimeout(() => void tim(), 250)
    return () => clearTimeout(t)
  }, [tim, orgId, lamMoi])

  const ds = ketQua ?? []
  const chuaChon = ds.filter((d) => !chonIds.includes(d.id))
  const chip = (on: boolean) =>
    cn("h-[30px] shrink-0 rounded-full border px-3 text-xs font-semibold", on ? "border-primary/40 bg-primary/10 text-primary" : "bg-card text-foreground/80 hover:bg-muted/40")

  return (
    <div className="flex min-h-0 flex-col" data-testid="chon-hoa-don">
      <div className="space-y-2.5 p-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã hóa đơn, tên khách" className="h-10 rounded-[10px] pl-9" aria-label="Tìm hóa đơn để gộp" />
          </div>
          <button
            type="button"
            onClick={() => setMoLoc((x) => !x)}
            aria-expanded={moLoc}
            aria-label="Lọc thêm"
            className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border", moLoc ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40")}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {soLocDangBat({ ...loc, tuyen: "" }) > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tuyến">
          <button type="button" aria-pressed={!loc.tuyen} className={chip(!loc.tuyen)} onClick={() => datLoc({ tuyen: "" })}>Tất cả</button>
          {tuyen.map((r) => (
            <button key={r.id} type="button" aria-pressed={loc.tuyen === r.id} className={chip(loc.tuyen === r.id)} onClick={() => datLoc({ tuyen: r.id })}>
              Tuyến {r.code || r.name}
            </button>
          ))}
        </div>
        {moLoc && (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-2.5" data-testid="loc-soan">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Từ ngày HĐ
                <Input type="date" value={loc.tu} max={loc.den || undefined} onChange={(e) => datLoc({ tu: e.target.value })} aria-label="Từ ngày hóa đơn" className="h-9" />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Đến ngày HĐ
                <Input type="date" value={loc.den} min={loc.tu || undefined} onChange={(e) => datLoc({ den: e.target.value })} aria-label="Đến ngày hóa đơn" className="h-9" />
              </label>
            </div>
            <Select value={loc.nv || "all"} onValueChange={(v) => datLoc({ nv: v === "all" ? "" : v })}>
              <SelectTrigger aria-label="Nhân viên bán" className="h-9"><SelectValue placeholder="Nhân viên" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mọi nhân viên</SelectItem>
                {nguoiBan.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name || "—"}{u.is_active === false ? " (đã khoá)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {coCotSoan ? (
              <div className="flex items-center gap-1.5" role="group" aria-label="Trạng thái soạn">
                {(["chua", "da", "tat"] as TrangThaiSoan[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={loc.soan === k}
                    onClick={() => datLoc({ soan: k })}
                    className={cn("h-8 flex-1 rounded-lg border text-xs font-semibold", loc.soan === k ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:bg-muted/40")}
                  >
                    {NHAN_TRANG_THAI_SOAN[k]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">Máy chủ chưa chạy migration 224 — chưa lọc được hóa đơn đã soạn.</p>
            )}
            {soLocDangBat(loc) > 0 && (
              <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setLoc(LOC_SOAN_MAC_DINH)}>
                Bỏ lọc
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="so-hd-cho">
            {dangTim || !ketQua
              ? "Đang tải…"
              : `${ds.length} hóa đơn ${loc.soan === "chua" && coCotSoan ? "chờ soạn" : ""}${ds.length >= TRAN_TIM ? " (hiện 50)" : ""}`}
          </span>
          {chuaChon.length > 0 && (
            <button type="button" className="font-semibold text-primary" onClick={() => onThem(chuaChon)}>
              Chọn tất cả
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t md:max-h-[460px]">
        {!ketQua ? (
          <Skeleton className="m-3 h-24" />
        ) : ds.length === 0 && !dangTim ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Không có hóa đơn nào khớp.</p>
        ) : (
          ds.map((d) => {
            const i = chonIds.indexOf(d.id)
            const on = i >= 0
            const n = soMat.get(d.id)
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onToggle(d)}
                data-testid="ket-qua-hoa-don"
                aria-pressed={on}
                className={cn("grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3.5 py-2.5 text-left hover:bg-muted/30", on && "bg-muted/30")}
              >
                <span className={cn("grid h-[18px] w-[18px] place-items-center rounded-[5px] border-[1.5px] text-white", on ? "border-primary bg-primary" : "border-muted-foreground/60 bg-card")}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold tabular-nums">{d.invoice_code}</span>
                    {on && <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-bold text-primary" data-testid="nhan-ro">Rổ {CHU_RO[i]}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {d.customer?.store_name || "Khách lẻ"}
                    {d.customer?.channel ? ` · Tuyến ${tenTuyen(d.customer.channel)}` : ""}
                    {n ? ` · ${n} SKU` : ""}
                  </span>
                  {d.soan_luc && (
                    <span className="block text-[11px] font-semibold text-emerald-700" data-testid="da-soan">{nhanDaSoan(d.soan_luc, tenNguoi(d.soan_boi))}</span>
                  )}
                </span>
                <span className="text-xs font-semibold tabular-nums text-foreground/80">{tienGon(Number(d.total) || 0)}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
