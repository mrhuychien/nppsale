"use client"

/**
 * Màn KHO HÀNG trên điện thoại — thiết kế "quan-ly-kho" (chủ nhà 30/09/2026). Máy tính giữ bố cục cũ
 * ở `inventory/page.tsx`; mọi số ở đây là số trang đó đã đọc (không truy vấn riêng).
 */

import type { ReactNode } from "react"
import Link from "@/components/ui/link"
import { DauTrangXanh } from "@/components/mobile/dau-trang"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, cn } from "@/lib/utils"
import { tienGon } from "@/lib/home/sales-home"
import { canhBaoLo, tomTatTonKho } from "@/lib/inventory/kho-hang-mobile"
import type { UsePaginationReturn } from "@/hooks/use-pagination"
import type { Batch, Product } from "@/types"
import {
  AlertTriangle, ArrowDownToLine, Check, ClipboardList, Search,
} from "lucide-react"

type BatchWithProduct = Batch & { product?: Product }
type TrangThaiHsd = "expired" | "critical" | "push" | "safe"

export interface FefoDienThoai {
  search: string
  onSearch: (s: string) => void
  batches: BatchWithProduct[]
  loading: boolean
  loadError: string | null
  truncated: boolean
  pg: UsePaginationReturn
  brands: string[]
  locations: string[]
  brandFilter: string
  onBrand: (v: string) => void
  locationFilter: string
  onLocation: (v: string) => void
  expiryState: (b: BatchWithProduct) => TrangThaiHsd
  daysUntil: (d: string) => number
}

const THAO_TAC = [
  { href: "/inventory/stock-in", label: "Nhập kho", meta: "Tạo phiếu nhập", icon: ArrowDownToLine, tone: "bg-tertiary/10 text-tertiary" },
  { href: "/inventory/stocktake-adjust", label: "Kiểm kê", meta: "Đếm tồn", icon: ClipboardList, tone: "bg-violet-100 text-violet-700" },
  { href: "/inventory/adjustments", label: "Duyệt phiếu", meta: "", icon: Check, tone: "bg-amber-100 text-amber-700" },
  { href: "/inventory/audit", label: "Tra soát", meta: "Lịch sử kho", icon: Search, tone: "bg-primary/10 text-primary" },
] as const

export function KhoHangDienThoai({
  timeLabel, statsError, statsTruncated, statsBatches, stats, xemGiaTri, choDuyet, tab, onTab, tonHienTai, fefo,
}: {
  timeLabel: string
  statsError: string | null
  statsTruncated: boolean
  statsBatches: ReadonlyArray<{ product_id?: string | null; qty_on_hand?: number | null }>
  stats: { expiringSoon: number; needsPush: number; totalValue: number }
  /** NVBH không xem giá trị tồn của NPP (chủ nhà 25/09/2026). */
  xemGiaTri: boolean
  choDuyet: number
  tab: string
  onTab: (t: string) => void
  /** Bảng tồn hiện tại bản điện thoại — nhận đầu mục (tiêu đề + tab) để đặt nút Xuất Excel cạnh tiêu đề. */
  tonHienTai: ((dauMuc: (nutXuat: ReactNode) => ReactNode) => ReactNode) | null
  fefo: FefoDienThoai
}) {
  const tom = tomTatTonKho(statsBatches)
  const canhBao = canhBaoLo(stats.expiringSoon, stats.needsPush)

  const dauMuc = (nutXuat: ReactNode) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-on-surface">Tồn kho</h2>
        {nutXuat}
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
        {[
          { k: "current", label: "Tồn hiện tại" },
          { k: "fefo", label: "Theo lô (FEFO)" },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={tab === t.k}
            onClick={() => onTab(t.k)}
            className={cn(
              "h-9 rounded-lg text-sm font-semibold",
              tab === t.k ? "bg-card text-primary shadow-sm" : "text-on-surface-variant"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="-mx-4 -mt-4 lg:hidden" data-testid="kho-dien-thoai">
      <DauTrangXanh
        title="Kho hàng"
        subtitle={`${statsError ? "Không đọc được số liệu" : "Hệ thống ổn định"} · Cập nhật ${timeLabel}`}
        className="pb-12"
      />

      <div className="space-y-5 px-3.5">
        {/* Thẻ trắng nổi lên dải xanh */}
        <div className="relative -mt-9 overflow-hidden rounded-2xl border bg-card shadow-sm" data-testid="the-gia-tri-kho">
          <div className="px-4 pb-3 pt-3.5">
            {xemGiaTri && (
              <>
                <p className="text-xs text-muted-foreground">Giá trị tồn kho</p>
                <p className="mt-0.5 text-[28px] font-bold leading-tight tabular-nums text-on-surface" data-testid="gia-tri-kho">
                  {statsError ? "—" : tienGon(stats.totalValue)}
                </p>
              </>
            )}
            <p className={cn("text-xs text-muted-foreground", xemGiaTri ? "mt-1" : "")}>
              {statsError
                ? "Chưa có số — không phải kho trống"
                : `${tom.soSku.toLocaleString("vi-VN")} SKU · ${tom.soDonVi.toLocaleString("vi-VN")} đơn vị${xemGiaTri ? " · giá vốn trung bình" : ""}`}
            </p>
            {statsTruncated && <p className="mt-1 text-xs font-semibold text-amber-700">⚠ Quá nhiều lô — con số này còn THIẾU</p>}
          </div>
          {statsError ? (
            <div className="flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Không đọc được số liệu tồn kho: {statsError}</span>
            </div>
          ) : canhBao ? (
            <button
              type="button"
              onClick={() => onTab("fefo")}
              className="flex w-full items-center gap-2 border-t bg-amber-50 px-4 py-2.5 text-left text-xs font-semibold text-amber-700"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {canhBao} — xem theo lô
            </button>
          ) : (
            <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs font-semibold text-tertiary">
              <Check className="h-3.5 w-3.5 shrink-0" /> Không có lô sắp hết hạn hay cần đẩy hàng
            </div>
          )}
        </div>

        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface">Thao tác kho</h2>
            <Link href="/inventory/entries" className="text-sm font-semibold text-primary">Danh sách phiếu</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {THAO_TAC.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="flex min-h-[52px] items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 active:bg-muted/40"
              >
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", t.tone)}>
                  <t.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-on-surface">{t.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t.href === "/inventory/adjustments" ? `${choDuyet} chờ duyệt` : t.meta}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3 pb-2">
          {tab === "fefo" ? (
            <>
              {dauMuc(null)}
              <FefoList {...fefo} />
            </>
          ) : (
            tonHienTai?.(dauMuc) ?? (
              <>
                {dauMuc(null)}
                <Skeleton className="h-64 rounded-2xl" />
              </>
            )
          )}
        </section>
      </div>
    </div>
  )
}

function FefoList({
  search, onSearch, batches, loading, loadError, truncated, pg, brands, locations,
  brandFilter, onBrand, locationFilter, onLocation, expiryState, daysUntil,
}: FefoDienThoai) {
  return (
    <div className="space-y-3" data-testid="fefo-dien-thoai">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Tìm tên, SKU hoặc mã lô"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-11 rounded-xl bg-card pl-9 text-base"
        />
      </div>
      {(brands.length > 0 || locations.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <Select value={brandFilter} onValueChange={onBrand}>
            <SelectTrigger className="h-10 rounded-xl bg-card" aria-label="Thương hiệu"><SelectValue placeholder="Thương hiệu" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả thương hiệu</SelectItem>
              {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={locationFilter} onValueChange={onLocation}>
            <SelectTrigger className="h-10 rounded-xl bg-card" aria-label="Vị trí"><SelectValue placeholder="Vị trí" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả vị trí</SelectItem>
              {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {truncated && !loading && (
        <p className="rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          Kết quả tìm đang thiếu — gõ thêm cho hẹp lại.
        </p>
      )}
      {loadError && !loading && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Không tải được danh sách lô hàng: {loadError}
        </p>
      )}
      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : batches.length === 0 ? (
        <div className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Không có lô hàng phù hợp.
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {batches.map((b) => {
            const st = expiryState(b)
            const d = daysUntil(b.expires_at)
            const nhan =
              st === "expired" ? { t: `Hết hạn ${Math.abs(d)} ngày`, c: "text-destructive" }
              : st === "critical" ? { t: `Còn ${d} ngày`, c: "text-destructive" }
              : st === "push" ? { t: "Cần đẩy hàng", c: "text-amber-700" }
              : { t: "An toàn", c: "text-tertiary" }
            return (
              <li key={b.id}>
                <Link href={`/inventory/batches/${b.id}`} className="flex items-start gap-3 px-3.5 py-3 active:bg-muted/40" data-testid="dong-lo">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-on-surface">{b.product?.name || "—"}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <span className="font-mono">{b.batch_code}</span> · HSD {formatDate(b.expires_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm tabular-nums">
                      <span className="font-bold">{Number(b.qty_on_hand).toLocaleString("vi-VN")}</span>{" "}
                      <span className="text-xs text-muted-foreground">{b.product?.base_unit || ""}</span>
                    </p>
                    <p className={cn("text-xs font-semibold", nhan.c)}>{nhan.t}</p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {!loading && batches.length < pg.total && (
        <button
          type="button"
          onClick={() => pg.setPageSize(pg.pageSize + 20)}
          className="h-12 w-full rounded-2xl border bg-card text-sm font-semibold text-primary"
        >
          Xem thêm · đang hiện {batches.length}/{pg.total}
        </button>
      )}
    </div>
  )
}

