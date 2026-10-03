"use client"

/**
 * DANH SÁCH PHIẾU KHO trên điện thoại — thiết kế "ds-phieu-kho" (chủ nhà 30/09/2026): đầu trắng
 * (← · Phiếu kho · + Tạo phiếu), chip loại có số, ô tìm, băng kiểm kê chờ duyệt, nhóm theo ngày.
 * Lọc / đếm / thao tác vẫn là của `inventory/entries/page.tsx`; ở đây chỉ vẽ và đọc thêm SỐ LƯỢNG
 * của các dòng đang hiện (quy về đơn vị cơ sở).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { docTheoLoId } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { cn } from "@/lib/utils"
import {
  dongPhuPhieu, nhanSoLuong, nhomPhieuTheoNgay, soLuongPhieu, trangThaiPhieu,
  type DongSoLuong, type TonePhieu,
} from "@/lib/inventory/phieu-kho-mobile"
import type { StockEntry } from "@/types"
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, FileText, Plus, Search, SlidersHorizontal, Warehouse,
} from "lucide-react"

type PhieuDong = StockEntry & {
  warehouse_zone?: string | null
  dest_warehouse_zone?: string | null
}
type DongPhieu = DongSoLuong & { entry_id: string; product_id: string | null }

export const ICON_LOAI: Record<string, { icon: typeof ArrowDownToLine; tone: string }> = {
  import: { icon: ArrowDownToLine, tone: "bg-tertiary/10 text-tertiary" },
  export: { icon: ArrowUpFromLine, tone: "bg-primary/10 text-primary" },
  transfer: { icon: Warehouse, tone: "bg-violet-100 text-violet-700" },
  stocktake: { icon: FileText, tone: "bg-amber-100 text-amber-700" },
}

export const TONE_TRANG_THAI: Record<TonePhieu, string> = {
  xanh: "text-on-surface-variant",
  vang: "rounded-full bg-amber-100 px-2 py-0.5 text-amber-800",
  xam: "rounded-full bg-muted px-2 py-0.5 text-on-surface-variant",
  do: "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive",
}

const BUOC = 20

export function PhieuKhoDienThoai({
  rows, chips, activeType, onType, search, onSearch, canCreate, choDuyetKiemKe,
  loading, loadError, truncatedNote, onOpen, filter, empty,
}: {
  /** Đã lọc (tìm + loại + trạng thái + lọc nâng cao) — của trang. */
  rows: PhieuDong[]
  chips: Array<{ key: string; label: string; count: number }>
  activeType: string
  onType: (k: string) => void
  search: string
  onSearch: (s: string) => void
  canCreate: boolean
  choDuyetKiemKe: number
  loading: boolean
  loadError: string | null
  truncatedNote: string | null
  onOpen: (e: PhieuDong) => void
  filter: { activeCount: number; onClear: () => void; open: boolean; onOpenChange: (o: boolean) => void; sheet: ReactNode }
  empty: ReactNode
}) {
  const khoMay = useKhoMay()
  const [moTao, setMoTao] = useState(false)
  const [soHien, setSoHien] = useState(BUOC)
  const [now] = useState(() => new Date())
  const [dong, setDong] = useState<Map<string, DongPhieu[]>>(new Map())
  const khoaLoc = `${activeType}|${search}|${rows.length}`
  useEffect(() => { setSoHien(BUOC) }, [khoaLoc])

  const hien = useMemo(() => rows.slice(0, soHien), [rows, soHien])
  const nhom = useMemo(() => nhomPhieuTheoNgay(hien, now), [hien, now])
  const ids = useMemo(() => hien.map((e) => e.id), [hien])

  /* SL của các phiếu ĐANG HIỆN — chỉ trên điện thoại, chỉ các id còn thiếu. */
  useEffect(() => {
    if (khoMay !== false) return
    const thieu = ids.filter((id) => !dong.has(id))
    if (thieu.length === 0) return
    let huy = false
    const supabase = createClient()
    /* ⚠ ĐỌC THEO LÔ ID, MỖI LÔ PHÂN TRANG ĐỦ (rà soát 03/10/2026). Một `.in()` trơn: (1) URL vỡ khi
       quá ~150 phiếu, (2) PostgREST cắt ở 1.000 DÒNG — vài phiếu kiểm kê / nhập lớn là phiếu sau
       hiện SL thiếu mà không báo gì. `docTheoLoId` chia lô 150 id, phân trang theo `id` (khoá duy
       nhất), hỏng thì NÉM — không ghi "0 dòng" cho phiếu chưa đọc được. */
    docTheoLoId<DongPhieu>(
      thieu,
      (lo, from, to) =>
        supabase
          .from("stock_entry_lines")
          .select("id, entry_id, product_id, quantity, qty_in_base_uom, conversion_factor_snapshot", { count: "exact" })
          .in("entry_id", lo)
          .order("id")
          .range(from, to),
      "Dòng phiếu kho"
    )
      .then((data) => {
        if (huy) return
        setDong((cu) => {
          const m = new Map(cu)
          for (const id of thieu) m.set(id, [])
          for (const l of data) m.get(l.entry_id)?.push(l)
          return m
        })
      })
      .catch((err: unknown) => {
        if (!huy) console.error("[inventory/entries] đọc dòng phiếu lỗi:", errorMessage(err))
      })
    return () => { huy = true }
  }, [ids, khoMay]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="-mx-4 -mt-4 lg:hidden" data-testid="phieu-kho-dien-thoai">
      <DauTrangTrang
        title="Phiếu kho"
        subtitle="Nhập · xuất · chuyển · kiểm kê"
        backHref="/inventory"
        action={canCreate ? (
          <Button className="h-10 rounded-xl px-3.5" onClick={() => setMoTao((v) => !v)} aria-expanded={moTao}>
            <Plus className="mr-1 h-4 w-4" /> Tạo phiếu
          </Button>
        ) : undefined}
      />

      <div className="space-y-3 px-3.5 pt-3.5">
        {moTao && (
          <div data-testid="tao-phieu">
            <div className="grid grid-cols-2 gap-2">
              <Link href="/inventory/stock-in" className="flex min-h-[52px] items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-tertiary/10 text-tertiary"><ArrowDownToLine className="h-4 w-4" /></span>
                <span><span className="block text-sm font-semibold">Phiếu nhập</span><span className="block text-[11px] text-muted-foreground">Nhập từ NCC</span></span>
              </Link>
              <Link href="/inventory/stocktake-adjust" className="flex min-h-[52px] items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-700"><FileText className="h-4 w-4" /></span>
                <span><span className="block text-sm font-semibold">Kiểm kê</span><span className="block text-[11px] text-muted-foreground">Đếm tồn</span></span>
              </Link>
            </div>
            {/* Phiếu xuất lẻ vẫn giữ đường vào (chủ nhà 20/09/2026 thêm "Phiếu xuất kho" vào nút Tạo phiếu). */}
            <p className="px-0.5 pt-1.5 text-xs text-muted-foreground">
              Phiếu xuất được tạo tự động khi giao đơn hàng.{" "}
              <Link href="/inventory/stock-issue" className="font-semibold text-primary">Xuất lẻ</Link>
            </p>
          </div>
        )}

        <SegmentedScroller
          ariaLabel="Loại phiếu"
          segments={chips}
          value={activeType}
          onChange={(k) => onType(k ?? "all")}
          className="-mx-3.5 px-3.5 py-0"
        />

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Tìm mã phiếu hoặc ghi chú"
              className="h-11 rounded-xl bg-card pl-9 text-base"
            />
          </div>
          <button
            type="button"
            onClick={() => filter.onOpenChange(true)}
            aria-label="Lọc phiếu"
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-card"
            data-testid="phieu-mo-loc"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {filter.activeCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {filter.activeCount}
              </span>
            )}
          </button>
        </div>

        {choDuyetKiemKe > 0 && (
          <Link
            href="/inventory/adjustments"
            className="flex items-center gap-3 rounded-2xl border bg-card px-3.5 py-3"
            data-testid="bang-cho-duyet"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{choDuyetKiemKe} phiếu kiểm kê chờ duyệt</span>
              <span className="block text-xs text-muted-foreground">Tồn kho chưa cập nhật đến khi duyệt</span>
            </span>
            <span className="text-sm font-semibold text-primary">Duyệt</span>
          </Link>
        )}

        {loadError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="font-semibold">Không tải được danh sách phiếu kho</p>
            <p className="break-words text-xs">{loadError}</p>
          </div>
        )}
        {truncatedNote && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">Danh sách phiếu chưa đầy đủ</p>
            <p>{truncatedNote}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border bg-card py-6">{empty}</div>
        ) : (
          <div className="space-y-3 pb-2">
            {nhom.map((g) => (
              <section key={g.key} className="space-y-1.5">
                <h3 className="px-0.5 text-[13px] font-semibold text-on-surface-variant">{g.label}</h3>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {g.items.map((e) => {
                    const ls = dong.get(e.id)
                    const sl = ls ? soLuongPhieu(e.type, ls) : null
                    const sku = ls ? new Set(ls.map((l) => l.product_id)).size : null
                    const st = trangThaiPhieu(e.type, e.status)
                    const ic = ICON_LOAI[e.type] ?? ICON_LOAI.stocktake
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(e)}
                          className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-muted/40"
                          data-testid="dong-phieu-kho"
                        >
                          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", ic.tone)}>
                            <ic.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm font-bold text-on-surface">{e.entry_code}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {dongPhuPhieu(e, ls ? ls.length : null, sku) || "—"}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            {ls && (
                              <span
                                className={cn(
                                  "block text-sm font-bold tabular-nums",
                                  e.type !== "transfer" && sl != null && sl > 0 ? "text-tertiary" : "text-on-surface"
                                )}
                                data-testid="sl-phieu"
                              >
                                {nhanSoLuong(e.type, sl)}
                              </span>
                            )}
                            <span className={cn("mt-0.5 inline-block text-[11px] font-semibold", TONE_TRANG_THAI[st.tone])}>{st.label}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {hien.length < rows.length && (
              <button
                type="button"
                onClick={() => setSoHien((n) => n + BUOC)}
                className="h-12 w-full rounded-2xl border bg-card text-sm font-semibold text-primary"
              >
                Xem thêm · đang hiện {hien.length}/{rows.length}
              </button>
            )}
          </div>
        )}
      </div>

      <Sheet open={filter.open} onOpenChange={filter.onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader><SheetTitle>Lọc phiếu kho</SheetTitle></SheetHeader>
          <div className="mt-4 grid gap-4">{filter.sheet}</div>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={filter.onClear} disabled={filter.activeCount === 0}>Xoá lọc</Button>
            <Button className="h-11 flex-1" onClick={() => filter.onOpenChange(false)}>Xem kết quả</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
