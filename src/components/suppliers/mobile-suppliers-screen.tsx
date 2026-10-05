"use client"

/**
 * DANH SÁCH NHÀ CUNG CẤP TRÊN ĐIỆN THOẠI — thiết kế "ds-ncc" (chủ nhà 30/09/2026).
 *
 * Đầu xanh (☰ · "Nhà cung cấp" · "N nhà cung cấp" · chuông · ảnh) → khối trắng: ô tìm (nút lọc bên
 * trong) + nút "+" (có quyền tạo) → băng "N nhà cung cấp bị trùng tên · <tên>" + "Gộp" → danh sách nhóm
 * theo chữ cái (ô chữ cái · tên · mã · SĐT · "Trùng tên" · ›) → "Xem thêm · đang hiện 20/N".
 *
 * ⚠ "Gộp": nút lọc danh sách về các NCC trùng tên; gộp thật làm ở chi tiết NCC ("Gộp vào NCC khác…") hoặc chọn
 *   2+ NCC ở bảng máy tính (RPC `gop_nha_cung_cap`, mig 232).
 */

import type { ReactNode } from "react"
import { AlertTriangle, ChevronRight, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import Link from "@/components/ui/link"
import { Skeleton } from "@/components/ui/skeleton"
import { DauTrangXanh } from "@/components/mobile/dau-trang"
import { SEARCH_FIELD_PROPS } from "@/lib/ui/search-field"
import { cn } from "@/lib/utils"
import { chuCaiDau, dongPhuNcc, khoaTrungTen, nhomTheoChuCai } from "@/lib/suppliers/mobile-list"

export interface NccDong {
  id: string
  name: string
  code: string | null
  phone: string | null
  is_active: boolean
}

export function MobileSuppliersScreen({
  subtitle,
  search,
  onSearch,
  canCreate,
  filter,
  trung,
  locTrung,
  onLocTrung,
  items,
  loading,
  empty,
  moreLabel,
  onMore,
  onOpen,
  notice,
}: {
  subtitle: string
  search: string
  onSearch: (v: string) => void
  canCreate: boolean
  filter: { activeCount: number; onOpen: () => void }
  /** Băng trùng tên — `null` khi không có tên nào trùng. `khoa` để gắn huy hiệu trên dòng. */
  trung: { tieuDe: string; phu: string; khoa: Set<string> } | null
  /** Đang lọc về các NCC trùng tên (bấm "Gộp"). */
  locTrung: boolean
  onLocTrung: (on: boolean) => void
  items: NccDong[]
  loading: boolean
  empty: ReactNode
  /** `null` = đã hiện hết. */
  moreLabel: string | null
  onMore: () => void
  onOpen: (s: NccDong) => void
  notice?: ReactNode
}) {
  const nhom = nhomTheoChuCai(items)
  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="ncc-mobile">
      <DauTrangXanh title="Nhà cung cấp" subtitle={subtitle} testId="ncc-dau-xanh" />

      <div className="sticky top-0 z-20 border-b border-outline-variant/60 bg-card py-3">
        <div className="flex gap-2 px-3.5">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/60 bg-card px-3 text-muted-foreground">
            <Search className="h-[18px] w-[18px] shrink-0" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Tìm tên nhà cung cấp"
              aria-label="Tìm nhà cung cấp"
              {...SEARCH_FIELD_PROPS}
              className="w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80"
            />
            {search && (
              <button type="button" onClick={() => onSearch("")} aria-label="Xoá tìm kiếm" className="shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={filter.onOpen}
              aria-label={filter.activeCount > 0 ? `Bộ lọc (${filter.activeCount} đang bật)` : "Bộ lọc"}
              data-testid="ncc-mo-loc"
              className={cn(
                "relative grid h-7 w-7 shrink-0 place-items-center rounded-full",
                filter.activeCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {filter.activeCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {filter.activeCount}
                </span>
              )}
            </button>
          </label>
          {canCreate && (
            <Link
              href="/suppliers/new"
              aria-label="Thêm nhà cung cấp"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground active:opacity-90"
            >
              <Plus className="h-[22px] w-[22px]" />
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-3 px-3.5 pb-4 pt-3">
        {notice}

        {locTrung ? (
          <div
            className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-2.5"
            data-testid="ncc-dang-loc-trung"
          >
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-primary">Đang xem các NCC trùng tên</span>
            <button type="button" onClick={() => onLocTrung(false)} className="h-8 shrink-0 px-2 text-[13px] font-semibold text-primary">
              Bỏ lọc
            </button>
          </div>
        ) : (
          trung && (
            <div
              className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-card px-3.5 py-3"
              data-testid="ncc-bang-trung"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700" aria-hidden>
                <AlertTriangle className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-foreground">{trung.tieuDe}</span>
                <span className="block truncate text-xs text-muted-foreground">{trung.phu}</span>
              </span>
              <button
                type="button"
                onClick={() => onLocTrung(true)}
                className="h-9 shrink-0 rounded-lg border border-outline-variant/60 bg-card px-3 text-[13px] font-bold text-primary active:bg-surface-container-low"
              >
                Gộp
              </button>
            </div>
          )
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6">{empty}</div>
        ) : (
          <>
            {nhom.map((g) => (
              <section key={g.chu} data-testid="ncc-nhom" aria-label={`Nhóm ${g.chu}`}>
                <h2 className="px-1 pb-1.5 pt-1 text-xs font-bold text-muted-foreground">{g.chu}</h2>
                <div className="divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
                  {g.items.map((s) => {
                    const biTrung = !!trung?.khoa.has(khoaTrungTen(s.name))
                    const phu = dongPhuNcc(s)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        data-testid="dong-ncc"
                        onClick={() => onOpen(s)}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-container-low"
                      >
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-bold text-primary"
                          aria-hidden
                        >
                          {chuCaiDau(s.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{s.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{phu || "—"}</span>
                        </span>
                        {biTrung && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Trùng tên
                          </span>
                        )}
                        {!s.is_active && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            Ngưng
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
            {moreLabel && (
              <button
                type="button"
                onClick={onMore}
                disabled={loading}
                className="h-11 w-full rounded-xl border border-outline-variant/60 bg-card text-sm font-semibold text-primary disabled:opacity-60"
              >
                {loading ? "Đang tải…" : moreLabel}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
