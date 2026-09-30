"use client"

/**
 * ĐẦU DANH SÁCH TRÊN ĐIỆN THOẠI THEO MẪU MÀN ĐƠN HÀNG — chủ nhà 30/09/2026: "Mobile cho NPP: viết lại
 * tất cả các trang danh sách chưa theo phong cách trang Đơn hàng theo phong cách trang danh sách Đơn
 * hàng".
 *
 * Đầu trang xanh (☰ · tiêu đề · chuông · ảnh đại diện, ô tìm) → thẻ trắng nổi lên (tab trạng thái có
 * số, "Tổng tiền · nút lọc" + số phiếu) → nút tạo mới của màn. Y như `MobileOrdersScreen`.
 * ⚠ Màn dùng đầu này phải có tên trong `DOC_LIST_MOBILE_ROUTES` (@/lib/nav/mobile-chrome) — không thì
 *   app bar chuẩn chồng lên, thành hai hàng tiêu đề.
 */

import type { ReactNode } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { NutMenuDauTrang } from "@/components/layout/mo-menu-context"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { StatusChips, type StatusChip } from "@/components/ui/status-chips"
import { useAuth } from "@/hooks/use-auth"
import { viTatTen } from "@/lib/returns/mobile-list"
import { SEARCH_FIELD_PROPS } from "@/lib/ui/search-field"
import { cn } from "@/lib/utils"
import { LIST_PERIOD_LABEL, type ListPeriod } from "@/lib/orders/list-summary"

export interface DocListMobileHeadProps {
  title: string
  search: string
  onSearch: (v: string) => void
  searchPlaceholder: string
  /** Dải trạng thái — cùng props với `StatusChips` của máy tính. */
  chips?: { chips: StatusChip[]; active: string; onPick: (key: string) => void; multi?: boolean }
  /** Ngăn lọc — cùng props với `MobileFilterBar`; `sheet` là nội dung ngăn. */
  filter?: {
    activeCount: number
    onClear?: () => void
    open: boolean
    onOpenChange: (o: boolean) => void
    sheet: ReactNode
  }
  /** Nút tạo mới / thao tác của màn (máy tính nằm ở `PageHeader`). */
  actions?: ReactNode
  /** Kỳ đang xem — bấm để đổi, như "Tổng tiền hàng · Tháng này" của màn Đơn hàng. */
  ky?: { period: ListPeriod; onCycle: () => void }
}

/** "12 phiếu thu" → ["12", "phiếu thu"]. */
export function tachSoDem(text: string): [string, string] {
  const m = /^([\d.,]+)\s*(.*)$/.exec(text.trim())
  return m ? [m[1], m[2]] : ["", text]
}

export function DocListMobileHead({
  head,
  totalLabel,
  total,
  countText,
}: {
  head: DocListMobileHeadProps
  /** "Tổng tiền phiếu thu"; `null` = màn không có tiền để cộng. */
  totalLabel: string | null
  total: string | null
  countText: string
}) {
  const { user } = useAuth()
  const [so, nhan] = tachSoDem(countText)
  const f = head.filter
  const nutLoc = f && (
    <button
      type="button"
      onClick={() => f.onOpenChange(true)}
      aria-label={f.activeCount > 0 ? `Bộ lọc (${f.activeCount} đang bật)` : "Bộ lọc"}
      data-testid="ds-mo-loc"
      className={cn(
        "relative grid h-7 w-7 shrink-0 place-items-center rounded-full",
        f.activeCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted"
      )}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {f.activeCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
          {f.activeCount}
        </span>
      )}
    </button>
  )

  return (
    <>
      <div className="bg-primary px-4 pb-14 pt-4 text-primary-foreground" data-testid="ds-dau-xanh">
        <div className="flex items-center gap-2">
          <NutMenuDauTrang />
          <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold">{head.title}</h1>
          <div className="rounded-xl bg-primary-foreground/15 [&_button]:text-primary-foreground">
            <NotificationBell />
          </div>
          <UserMenu className="grid h-10 w-10 place-items-center rounded-full bg-primary-foreground text-sm font-black text-primary">
            {viTatTen(user?.full_name)}
          </UserMenu>
        </div>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-xl bg-primary-foreground/15 px-3">
          <Search className="h-4 w-4 shrink-0 opacity-80" />
          <input
            value={head.search}
            onChange={(e) => head.onSearch(e.target.value)}
            placeholder={head.searchPlaceholder}
            aria-label={head.searchPlaceholder}
            {...SEARCH_FIELD_PROPS}
            className="w-full min-w-0 bg-transparent text-base text-primary-foreground outline-none placeholder:text-primary-foreground/70"
          />
          {head.search && (
            <button type="button" onClick={() => head.onSearch("")} aria-label="Xoá tìm kiếm" className="shrink-0 opacity-80">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      <div className="-mt-10 space-y-3 px-4">
        <section className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="ds-the-tong">
          {head.chips && (head.chips.multi ? (
            <StatusChips chips={head.chips.chips} active={head.chips.active} onPick={head.chips.onPick} multi className="mb-3" />
          ) : (
            /* Tab ô liền như màn Đơn hàng. */
            <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1" role="tablist">
              {head.chips.chips.map((t) => {
                const on = head.chips!.active === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => head.chips!.onPick(t.key)}
                    className={cn(
                      "flex-1 shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold",
                      on ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                    )}
                  >
                    {t.label} <span className={on ? "" : "opacity-70"}>{t.count}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {totalLabel ? (
            <div className="flex items-end justify-between gap-2 px-1">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">{totalLabel}{head.ky && " ·"}</span>
                  {head.ky && (
                    <button type="button" onClick={head.ky.onCycle} data-testid="ds-doi-ky" className="shrink-0 font-semibold text-foreground underline-offset-2 hover:underline">
                      {LIST_PERIOD_LABEL[head.ky.period]}
                    </button>
                  )}
                  {nutLoc}
                </div>
                <p className="mt-1 truncate text-[26px] font-black tabular-nums" data-testid="ds-tong-tien">
                  {total ?? "—"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-black tabular-nums text-primary" data-testid="ds-so-dem">{so}</p>
                <p className="text-xs text-muted-foreground">{nhan}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="min-w-0 truncate">
                <span className="text-2xl font-black tabular-nums text-primary" data-testid="ds-so-dem">{so}</span>
                <span className="ml-1.5 text-sm text-muted-foreground">{nhan}</span>
              </p>
              {nutLoc}
            </div>
          )}
        </section>
        {head.actions && <div className="flex flex-wrap gap-2 [&>*]:flex-1">{head.actions}</div>}
      </div>

      {f && (
        <MobileFilterBar
          chiNganLoc
          value={head.search}
          onChange={head.onSearch}
          activeCount={f.activeCount}
          onClear={f.onClear}
          open={f.open}
          onOpenChange={f.onOpenChange}
        >
          {f.sheet}
        </MobileFilterBar>
      )}
    </>
  )
}
