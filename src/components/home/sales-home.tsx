"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Plus, ChevronRight, MapPin, CreditCard, Pencil, Warehouse, Check, Search, type LucideIcon,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { loadSellStock } from "@/lib/sell/ref-data"
import { newOrderHref } from "@/lib/nav/new-order"
import { vnDateKey, orderTone } from "@/lib/orders/status-tone"
import { NotificationBell } from "@/components/layout/notification-bell"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/errors"
import { cn, formatCurrency } from "@/lib/utils"
import {
  KY_TRANG_CHU, khoangKy, ngayDauCanDoc, mucTieuKy, doanhSoKy, theoKhach, theoKenh, tienGon,
  loiNhacMucTieu, nhanNgay, congNgay, traCuaToi, ngayTuyen, nhanTuyen, type KyTrangChu, type HoaDonTC, type TraTC,
} from "@/lib/home/sales-home"

export interface OChucNang { label: string; href: string; icon: LucideIcon; color: string }

interface DuLieu {
  hd: HoaDonTC[]
  tra: TraTC[]
  don: Array<{ order_date: string }>
  tham: Array<{ customer_id: string | null; visit_date: string }>
  nhap: { count: number; dau: { store: string; total: number } | null }
  no: { tong: number; quaHan: number; vuotHanMuc: number }
  tuyen: { tong: number; daTham: number }
  ganDay: Array<{ id: string; order_code: string; total: number; status: string; store: string }>
  khach: Map<string, { store: string; channel: string | null }>
  kenhTen: Map<string, string>
  mucTieuThang: number
  tonThap: number | null
  loSapHet: number
}

const HUE_KENH = ["bg-primary", "bg-[#12b76a]", "bg-[#fdb022]", "bg-[#6941c6]", "bg-[#0891b2]", "bg-muted-foreground"]

/**
 * Trang chủ NVBH theo mẫu thiết kế (chủ nhà 25/09/2026). Số liệu đọc bằng quyền của chính
 * NVBH (RLS) và lọc `sales_user_id = mình`. Doanh số theo HÓA ĐƠN trừ hàng trả.
 */
export function SalesHome({
  userId, fullName, tiles, onSearch, xemKho = true,
}: {
  userId: string
  fullName: string
  tiles: OChucNang[]
  onSearch: () => void
  /** Được vào màn Sản phẩm / Kho không — không thì bỏ việc "Tồn kho thấp" và dòng lô sắp hết
   *  hạn (chủ nhà 26/09/2026: NVBH chỉ còn module bán hàng). */
  xemKho?: boolean
}) {
  const [ky, setKy] = useState<KyTrangChu>("month")
  const [homNay, setHomNay] = useState("")
  const [dl, setDl] = useState<DuLieu | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [moHet, setMoHet] = useState(false)

  useEffect(() => { setHomNay(vnDateKey(new Date())) }, [])

  useEffect(() => {
    if (!homNay || !userId) return
    let huy = false
    const sb = createClient()
    const dau = ngayDauCanDoc(homNay)
    const cuoi = khoangKy("quarter", homNay).to > khoangKy("week", homNay).to ? khoangKy("quarter", homNay).to : khoangKy("week", homNay).to
    ;(async () => {
      try {
        const [hdR, traR, donR, thamR, nhapR, noR, tuyenR, ganR, tgR] = await Promise.all([
          fetchAllForAggregate<HoaDonTC>((f, t) =>
            sb.from("sales_invoices").select("id, customer_id, invoice_date, total", { count: "exact" })
              .eq("sales_user_id", userId).eq("status", "posted")
              .gte("invoice_date", dau).lte("invoice_date", cuoi).order("id").range(f, t)),
          /* ⚠ KHÔNG lọc `sales_user_id` ở câu hỏi: phiếu tự sinh cũ có thể chưa ghi người (sổ
             chưa chạy mig 194). RLS (mig 198) chỉ trả phiếu thuộc về mình; `traCuaToi` chọn tiếp. */
          fetchAllForAggregate<TraTC & { sales_user_id: string | null }>((f, t) =>
            sb.from("returns").select("customer_id, revenue_date, credit_note_amount, sales_user_id", { count: "exact" })
              .gte("revenue_date", dau).lte("revenue_date", cuoi).order("id").range(f, t)),
          fetchAllForAggregate<{ order_date: string }>((f, t) =>
            sb.from("sales_orders").select("order_date", { count: "exact" })
              .eq("sales_user_id", userId).neq("status", "cancelled")
              .gte("order_date", dau).lte("order_date", cuoi).order("id").range(f, t)),
          fetchAllForAggregate<{ customer_id: string | null; visit_date: string }>((f, t) =>
            sb.from("visit_logs").select("customer_id, visit_date", { count: "exact" })
              .eq("sales_user_id", userId).gte("visit_date", dau).lte("visit_date", cuoi).order("id").range(f, t)),
          sb.from("sales_orders").select("id, total, customer:customers(store_name)", { count: "exact" })
            .eq("sales_user_id", userId).eq("status", "draft").order("created_at", { ascending: false }).limit(1),
          fetchAllForAggregate<{ amount: number; paid: number | null; due_date: string | null; customer_id: string | null }>((f, t) =>
            sb.from("receivables").select("amount, paid, due_date, customer_id", { count: "exact" })
              .eq("sales_user_id", userId).neq("status", "paid").order("id").range(f, t)),
          sb.from("pjp_routes").select("customer_id").eq("sales_user_id", userId)
            .eq("day_of_week", ngayTuyen(homNay)).eq("is_active", true),
          sb.from("sales_orders").select("id, order_code, total, status, customer:customers(store_name)")
            .eq("sales_user_id", userId).neq("status", "cancelled")
            .order("order_date", { ascending: false }).order("created_at", { ascending: false }).limit(5),
          sb.rpc("my_sales_target"),
        ])
        if (huy) return
        const baoLoi = [hdR.error, donR.error].find(Boolean)
        if (baoLoi) setLoi(baoLoi)

        // Công nợ: Σ(amount − paid) chưa 'paid', KHÔNG kẹp 0 từng dòng (luật mig 186).
        const noTheoKhach = new Map<string, number>()
        let tong = 0
        let quaHan = 0
        for (const r of noR.rows) {
          const con = Number(r.amount || 0) - Number(r.paid || 0)
          tong += con
          if (con > 0 && r.due_date && r.due_date < homNay) quaHan++
          if (r.customer_id) noTheoKhach.set(r.customer_id, (noTheoKhach.get(r.customer_id) ?? 0) + con)
        }

        const ids = new Set<string>()
        for (const h of hdR.rows) if (h.customer_id) ids.add(h.customer_id)
        for (const r of traR.rows) if (r.customer_id) ids.add(r.customer_id)
        for (const c of Array.from(noTheoKhach.keys())) ids.add(c)
        const khach = new Map<string, { store: string; channel: string | null }>()
        let vuotHanMuc = 0
        const ds = Array.from(ids)
        for (let i = 0; i < ds.length; i += 200) {
          const { data } = await sb.from("customers").select("id, store_name, channel, credit_limit").in("id", ds.slice(i, i + 200))
          for (const c of (data ?? []) as Array<{ id: string; store_name: string; channel: string | null; credit_limit: number | null }>) {
            khach.set(c.id, { store: c.store_name, channel: c.channel })
            const hm = Number(c.credit_limit || 0)
            if (hm > 0 && (noTheoKhach.get(c.id) ?? 0) > hm) vuotHanMuc++
          }
        }
        const { data: kenhData } = await sb.from("sales_routes").select("code, name")
        const kenhTen = new Map<string, string>()
        for (const r of (kenhData ?? []) as Array<{ code: string; name: string }>) kenhTen.set(r.code, r.name)

        let tonThap: number | null = null
        let loSapHet = 0
        if (xemKho) {
          const [ton, prod, lo] = await Promise.all([
            loadSellStock(sb),
            fetchAllForAggregate<{ id: string }>((f, t) =>
              sb.from("products").select("id", { count: "exact" }).eq("status", "active").order("id").range(f, t)),
            sb.from("batches").select("id", { count: "exact", head: true }).gt("qty_on_hand", 0)
              .eq("warehouse_zone", "sale").lte("expires_at", congNgay(homNay, 30)),
          ])
          if (huy) return
          tonThap = ton && !prod.error ? prod.rows.filter((p) => (ton[p.id] ?? 0) < 10).length : null
          loSapHet = lo.count ?? 0
        }

        const tuyenIds = new Set(((tuyenR.data ?? []) as Array<{ customer_id: string }>).map((r) => r.customer_id))
        const thamHomNay = new Set(thamR.rows.filter((v) => v.visit_date === homNay).map((v) => v.customer_id))
        const nhapDau = (nhapR.data ?? [])[0] as unknown as { total: number; customer: { store_name: string } | null } | undefined

        setDl({
          hd: hdR.rows.map((h) => ({ ...h, total: Number(h.total || 0) })),
          tra: traR.error ? [] : traCuaToi(traR.rows, userId),
          don: donR.rows,
          tham: thamR.rows,
          nhap: {
            count: nhapR.count ?? 0,
            dau: nhapDau ? { store: nhapDau.customer?.store_name ?? "Khách lẻ", total: Number(nhapDau.total || 0) } : null,
          },
          no: { tong, quaHan, vuotHanMuc },
          tuyen: { tong: tuyenIds.size, daTham: Array.from(tuyenIds).filter((c) => thamHomNay.has(c)).length },
          ganDay: ((ganR.data ?? []) as unknown as Array<{ id: string; order_code: string; total: number; status: string; customer: { store_name: string } | null }>)
            .map((o) => ({ id: o.id, order_code: o.order_code, total: Number(o.total || 0), status: o.status, store: o.customer?.store_name ?? "Khách lẻ" })),
          khach,
          kenhTen,
          mucTieuThang: tgR.error ? 0 : Number(tgR.data || 0),
          tonThap,
          loSapHet,
        })
      } catch (e) {
        if (!huy) setLoi(errorMessage(e))
      }
    })()
    return () => { huy = true }
  }, [homNay, userId, xemKho])

  const tinh = useMemo(() => {
    if (!dl || !homNay) return null
    const kk = khoangKy(ky, homNay)
    const doanhSo = doanhSoKy(dl.hd, dl.tra, kk)
    const mucTieu = mucTieuKy(dl.mucTieuThang, ky, homNay)
    const trong = (x: string) => x >= kk.from && x <= kk.to
    const khachKy = theoKhach(dl.hd, dl.tra, kk)
    return {
      doanhSo,
      mucTieu,
      phanTram: mucTieu > 0 ? Math.round((doanhSo / mucTieu) * 100) : null,
      loiNhac: loiNhacMucTieu(doanhSo, mucTieu, kk.conNgay),
      donTao: dl.don.filter((o) => trong(String(o.order_date).slice(0, 10))).length,
      diemTham: new Set(dl.tham.filter((v) => trong(v.visit_date)).map((v) => v.customer_id)).size,
      khHoatDong: khachKy.filter((x) => x.total !== 0).length,
      kenh: theoKenh(khachKy, (id) => {
        const c = dl.khach.get(id)?.channel
        return c ? dl.kenhTen.get(c) ?? c : null
      }),
      top: theoKhach(dl.hd, dl.tra, khoangKy("month", homNay)).slice(0, 5),
    }
  }, [dl, ky, homNay])

  const ten = (fullName.trim().split(/\s+/).pop() || "bạn")
  const chuDau = fullName.trim().split(/\s+/).filter(Boolean)
  const viet = chuDau.length ? ((chuDau[0][0] ?? "") + (chuDau.length > 1 ? chuDau[chuDau.length - 1][0] : "")).toUpperCase() : "U"
  const tamO = tiles.slice(0, 8)
  const oHien = moHet ? tiles : tamO
  const viec = dl
    ? (dl.nhap.count > 0 ? 1 : 0) + (dl.no.tong > 0 ? 1 : 0) + (xemKho && (dl.tonThap ?? 0) > 0 ? 1 : 0)
    : 0
  const tongKenh = tinh ? tinh.kenh.reduce((s, x) => s + x.total, 0) : 0
  const topMax = tinh?.top[0]?.total ?? 0

  return (
    <div className="min-h-screen bg-background pb-nav lg:pb-0" data-testid="trang-chu-nvbh">
      <div className="bg-primary px-4 pb-16 pt-4 text-primary-foreground">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-sm font-black text-primary">{viet}</div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold leading-tight">Chào {ten}</h1>
            <p className="truncate text-xs opacity-90">{homNay ? `${nhanNgay(homNay)} · Tuyến ${nhanTuyen(homNay)}` : " "}</p>
          </div>
          <button type="button" onClick={onSearch} aria-label="Tìm tính năng"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/15">
            <Search className="h-5 w-5" />
          </button>
          <div className="rounded-xl bg-primary-foreground/15 [&_button]:text-primary-foreground"><NotificationBell /></div>
        </div>
      </div>

      <main className="mx-auto -mt-12 max-w-xl space-y-4 px-4">
        {/* Doanh số của tôi */}
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted/60 p-1" role="tablist">
            {KY_TRANG_CHU.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={ky === t.key} onClick={() => setKy(t.key)}
                className={cn("rounded-lg py-1.5 text-sm font-semibold", ky === t.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}>
                {t.nhan}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Doanh số của tôi</p>
          {tinh ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <p className="text-3xl font-black tabular-nums" data-testid="doanh-so-cua-toi">{formatCurrency(tinh.doanhSo)}</p>
                {tinh.phanTram !== null && (
                  <div className="text-right">
                    <p className="text-2xl font-black text-primary tabular-nums">{tinh.phanTram}%</p>
                    <p className="text-xs text-muted-foreground">mục tiêu {tienGon(tinh.mucTieu)}</p>
                  </div>
                )}
              </div>
              {tinh.phanTram !== null && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, tinh.phanTram))}%` }} />
                </div>
              )}
              {tinh.loiNhac && <p className="mt-2 text-sm">{tinh.loiNhac}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3">
                {[
                  { n: tinh.donTao, nhan: "Đơn đã tạo" },
                  { n: tinh.diemTham, nhan: "Điểm đã thăm" },
                  { n: tinh.khHoatDong, nhan: "KH hoạt động" },
                ].map((x) => (
                  <div key={x.nhan}>
                    <p className="text-lg font-black tabular-nums">{x.n}</p>
                    <p className="text-xs text-muted-foreground">{x.nhan}</p>
                  </div>
                ))}
              </div>
            </>
          ) : loi ? (
            <p className="mt-2 text-sm text-destructive">Không tải được doanh số: {loi}</p>
          ) : (
            <Skeleton className="mt-2 h-28" />
          )}
        </section>

        <Link href={newOrderHref()} className="flex items-center gap-3 rounded-2xl bg-primary px-4 py-4 text-primary-foreground shadow-sm active:scale-[0.99]">
          <Plus className="h-5 w-5" />
          <span className="text-base font-bold">Tạo đơn hàng mới</span>
          <ChevronRight className="ml-auto h-5 w-5" />
        </Link>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/sales/visits" className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#12b76a]/10 text-[#067647]"><MapPin className="h-4 w-4" /></span>
            <span><span className="block text-sm font-bold">Đi tuyến</span>
              <span className="block text-xs text-muted-foreground">{dl ? `${dl.tuyen.daTham}/${dl.tuyen.tong} điểm` : "…"}</span></span>
          </Link>
          <Link href="/receivables" className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><CreditCard className="h-4 w-4" /></span>
            <span><span className="block text-sm font-bold">Thu công nợ</span>
              <span className="block text-xs text-muted-foreground">{dl ? tienGon(dl.no.tong) : "…"}</span></span>
          </Link>
        </div>

        {/* Cần xử lý */}
        {dl && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold">Cần xử lý</h2>
              {viec > 0 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{viec} việc</span>}
            </div>
            <div className="divide-y rounded-2xl border bg-card shadow-sm">
              {dl.nhap.count > 0 && (
                <Viec icon={Pencil} tone="bg-[#fdb022]/15 text-[#b54708]" tieuDe={`${dl.nhap.count} đơn nháp chưa gửi`}
                  phu={dl.nhap.dau ? `${dl.nhap.dau.store} · ${formatCurrency(dl.nhap.dau.total)}` : ""} href="/sell/drafts" nut="Gửi đơn" />
              )}
              {dl.no.tong > 0 && (
                <Viec icon={CreditCard} tone="bg-destructive/10 text-destructive" tieuDe="Công nợ khách hàng"
                  phu={`${formatCurrency(dl.no.tong)} · ${dl.no.quaHan} khoản quá hạn`} href="/receivables" nut="Nhắc nợ" />
              )}
              {xemKho && (dl.tonThap ?? 0) > 0 && (
                <Viec icon={Warehouse} tone="bg-primary/10 text-primary" tieuDe="Tồn kho thấp"
                  phu={`${dl.tonThap} SKU dưới 10 đơn vị`} href="/products" nut="Xem kho" />
              )}
              {viec === 0 && <p className="p-4 text-sm text-muted-foreground">Không có việc nào cần xử lý.</p>}
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-[#067647]">
              <Check className="h-3.5 w-3.5" />
              {xemKho && (
                <>
                  {dl.loSapHet > 0 ? `${dl.loSapHet} lô sắp hết hạn` : "Không có lô sắp hết hạn"}
                  {" · "}
                </>
              )}
              {dl.no.vuotHanMuc > 0 ? `${dl.no.vuotHanMuc} KH vượt hạn mức nợ` : "Không KH vượt hạn mức nợ"}
            </p>
          </section>
        )}

        {/* Chức năng */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold">Chức năng</h2>
            {tiles.length > tamO.length && (
              <button type="button" className="text-sm font-semibold text-primary" onClick={() => setMoHet((v) => !v)}>
                {moHet ? "Thu gọn" : `Tất cả (${tiles.length})`}
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-4 rounded-2xl border bg-card p-3 shadow-sm">
            {oHien.map((t) => {
              const Icon = t.icon
              return (
                <Link key={t.href} href={t.href} className="flex flex-col items-center gap-1.5 text-center">
                  <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", t.color)}><Icon className="h-5 w-5" /></span>
                  <span className="text-[11.5px] font-semibold leading-tight">{t.label}</span>
                </Link>
              )
            })}
          </div>
        </section>

        {/* Đơn gần đây */}
        {dl && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold">Đơn gần đây</h2>
              <Link href="/orders" className="text-sm font-semibold text-primary">Tất cả</Link>
            </div>
            <div className="divide-y rounded-2xl border bg-card shadow-sm">
              {dl.ganDay.length === 0 && <p className="p-4 text-sm text-muted-foreground">Chưa có đơn nào — bấm “Tạo đơn hàng mới”.</p>}
              {dl.ganDay.map((o) => {
                const tone = orderTone(o.status)
                return (
                  <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{o.store}</p>
                      <p className="text-xs text-muted-foreground">{o.order_code}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums">{formatCurrency(o.total)}</p>
                      <span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Top khách hàng tháng */}
        {tinh && tinh.top.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold">Top khách hàng tháng</h2>
              <Link href="/customers" className="text-sm font-semibold text-primary">Xem thêm</Link>
            </div>
            <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
              {tinh.top.map((x, i) => (
                <Link key={x.customerId} href={`/customers/${x.customerId}`} className="block">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 font-bold text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{dl?.khach.get(x.customerId)?.store ?? "Khách hàng"}</span>
                    <span className="font-bold tabular-nums">{formatCurrency(x.total)}</span>
                  </div>
                  <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${topMax > 0 ? Math.max(4, (x.total / topMax) * 100) : 0}%` }} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Doanh thu theo kênh — theo kỳ đang chọn */}
        {tinh && tinh.kenh.length > 0 && (
          <section className="pb-6">
            <h2 className="mb-2 text-base font-bold">Doanh thu theo kênh</h2>
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {tinh.kenh.map((x, i) => (
                  <div key={x.kenh} className={HUE_KENH[i % HUE_KENH.length]} style={{ width: `${(x.total / tongKenh) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {tinh.kenh.map((x, i) => (
                  <li key={x.kenh} className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", HUE_KENH[i % HUE_KENH.length])} />
                    <span className="flex-1">{x.kenh}</span>
                    <span className="text-muted-foreground tabular-nums">{Math.round((x.total / tongKenh) * 100)}%</span>
                    <span className="w-24 text-right font-semibold tabular-nums">{tienGon(x.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function Viec({ icon: Icon, tone, tieuDe, phu, href, nut }: { icon: LucideIcon; tone: string; tieuDe: string; phu: string; href: string; nut: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{tieuDe}</p>
        {phu && <p className="truncate text-xs text-muted-foreground">{phu}</p>}
      </div>
      <Link href={href} className="shrink-0 text-sm font-semibold text-primary">{nut}</Link>
    </div>
  )
}
