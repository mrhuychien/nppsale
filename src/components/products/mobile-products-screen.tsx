"use client"

/**
 * DANH SÁCH SẢN PHẨM TRÊN ĐIỆN THOẠI — thiết kế "ds-san-pham" (chủ nhà 30/09/2026: "Làm lại các màn
 * … Danh sách sản phẩm").
 *
 * Đầu xanh (☰ · "Sản phẩm" · "N đang bán" · chuông · ảnh) → khối trắng dính trên: ô tìm + nút "+"
 * (có quyền tạo) · Đang bán / Ngừng bán (khi có hàng ngừng) · chip NCC chính có số → "N sản phẩm" ·
 * sắp xếp · "Chọn" → thẻ (tên, "SKU · đơn vị · NCC", giá bán) → "Xem thêm · đang hiện 20/N".
 * Giá bán = `giaMacDinh` — cùng công thức lưới máy tính và ngăn xem nhanh.
 */

import type { ReactNode } from "react"
import { Check, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import Link from "@/components/ui/link"
import { Skeleton } from "@/components/ui/skeleton"
import { DauTrangXanh } from "@/components/mobile/dau-trang"
import { giaMacDinh, type ProductRow } from "@/components/products/product-table"
import { SEARCH_FIELD_PROPS } from "@/lib/ui/search-field"
import { formatCurrency, cn } from "@/lib/utils"
import { dongPhuSanPham, type ChipNcc } from "@/lib/products/mobile-list"

export function MobileProductsScreen({
  subtitle,
  search,
  onSearch,
  canCreate,
  filter,
  status,
  chips,
  ncc,
  onPickNcc,
  countText,
  sortLabel,
  onToggleSort,
  selectable,
  selecting,
  onToggleSelecting,
  selectedIds,
  onToggleSelect,
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
  /** Nút mở ngăn lọc (danh mục · NCC · lọc nâng cao) — số trên nút là số bộ lọc đang bật. */
  filter: { activeCount: number; onOpen: () => void }
  /** Đang bán / Ngừng bán / Tất cả — `null` khi không có hàng ngừng bán (như thiết kế). */
  status: { chips: Array<{ key: string; label: string; count: number }>; active: string; onPick: (k: string) => void } | null
  chips: ChipNcc[]
  ncc: string
  onPickNcc: (k: string) => void
  countText: string
  sortLabel: string
  onToggleSort: () => void
  /** Có thao tác hàng loạt (quyền sửa) → có nút "Chọn". */
  selectable: boolean
  selecting: boolean
  onToggleSelecting: () => void
  selectedIds: Set<string>
  onToggleSelect: (id: string, next: boolean) => void
  items: ProductRow[]
  loading: boolean
  empty: ReactNode
  /** `null` = đã hiện hết. */
  moreLabel: string | null
  onMore: () => void
  onOpen: (p: ProductRow) => void
  notice?: ReactNode
}) {
  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="sp-mobile">
      <DauTrangXanh title="Sản phẩm" subtitle={subtitle} testId="sp-dau-xanh" />

      <div className="sticky top-0 z-20 space-y-2.5 border-b border-outline-variant/60 bg-surface py-3">
        <div className="flex gap-2 px-3.5">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/60 bg-card px-3 text-muted-foreground">
            <Search className="h-[18px] w-[18px] shrink-0" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Tên, SKU hoặc nhãn hàng"
              aria-label="Tìm sản phẩm"
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
              data-testid="sp-mo-loc"
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
              href="/products/new"
              aria-label="Thêm sản phẩm"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground active:opacity-90"
            >
              <Plus className="h-[22px] w-[22px]" />
            </Link>
          )}
        </div>

        {status && (
          <div className="px-3.5">
            <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="tablist" aria-label="Trạng thái">
              {status.chips.map((t) => {
                const on = status.active === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => status.onPick(t.key)}
                    className={cn(
                      "flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-semibold",
                      on ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="row-scroll px-3.5" data-testid="sp-chip-ncc">
          {chips.map((c) => {
            const on = ncc === c.key
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => onPickNcc(c.key)}
                className={cn(
                  "h-8 whitespace-nowrap rounded-full border px-3 text-[13px]",
                  on ? "border-primary/30 bg-primary/10 font-semibold text-primary" : "border-outline-variant/60 bg-card font-medium text-foreground"
                )}
              >
                {c.label} <span className={cn("tabular-nums", on ? "font-medium" : "text-muted-foreground")}>{c.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2.5 px-3.5 pb-4 pt-2.5">
        {notice}

        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="sp-so-dem">{countText}</span>
          <div className="flex gap-3.5">
            <button type="button" onClick={onToggleSort} className="h-8 text-[13px] font-semibold text-foreground">
              {sortLabel}
            </button>
            {selectable && (
              <button type="button" onClick={onToggleSelecting} className="h-8 text-[13px] font-semibold text-primary">
                {selecting ? "Xong" : "Chọn"}
              </button>
            )}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6">{empty}</div>
        ) : (
          <>
            <div className="divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
              {items.map((p) => {
                const gia = giaMacDinh(p)
                const chon = selectedIds.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="the-san-pham"
                    aria-pressed={selecting ? chon : undefined}
                    onClick={() => (selecting ? onToggleSelect(p.id, !chon) : onOpen(p))}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-surface-container-low"
                  >
                    {selecting && (
                      <span
                        className={cn(
                          "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px]",
                          chon ? "bg-primary text-primary-foreground" : "border-[1.5px] border-muted-foreground/60"
                        )}
                        aria-hidden
                      >
                        {chon && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{p.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{dongPhuSanPham(p) || "—"}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums text-foreground">
                        {gia > 0 ? formatCurrency(gia) : "-"}
                      </span>
                      {p.status !== "active" && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Ngừng bán</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
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
