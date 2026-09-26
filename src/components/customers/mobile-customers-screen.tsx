"use client"

/**
 * DANH SÁCH KHÁCH HÀNG TRÊN ĐIỆN THOẠI — theo mẫu chủ nhà gửi 26/09/2026 ("Thiết kế lại màn
 * Khách hàng trên mobile theo mẫu").
 *
 * Đầu trang xanh (tiêu đề, dòng phụ, chuông, ảnh đại diện, ô tìm) → thẻ trắng (ba ô Cần ghé /
 * Nợ quá hạn / Tất cả là bộ lọc nhanh, hai ô chọn trạng thái + tuyến) → Tuyến hôm nay + Thêm KH
 * → "Tất cả · N" + sắp xếp → thẻ khách (chữ đầu, tên, nợ, chủ quán · tuyến, lần đặt gần nhất,
 * địa chỉ, SĐT, nhãn) → "Tải thêm 20".
 */

import { UserMenu } from "@/components/layout/user-menu"
import Link from "next/link"
import { Search, MapPin, Plus, X } from "lucide-react"
import { NotificationBell } from "@/components/layout/notification-bell"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { daysSinceVN, shortMoney, type QuickFilter } from "@/lib/customers/list-view"

export const BUOC_TAI_KHACH = 20

export type SapXepKhach = "name" | "debt"

export interface NhanKhach {
  label: string
  tone: "danger" | "warning" | "success"
}

export interface KhachMobile {
  id: string
  name: string
  /** Chữ trong ô tròn: chữ đầu tên, số điểm dừng, hoặc ✓ đã ghé. */
  avatar: string
  /** `null` = chưa đọc được nợ — KHÔNG hiện thành "Không nợ". */
  debt: number | null
  overdue: boolean
  /** Dòng phụ: chủ quán · tuyến · người phụ trách. */
  meta: string
  lastOrderDate: string | null
  address: string
  phone: string
  tags: NhanKhach[]
  visited?: boolean
}

/** "Nợ 2,2 tr" · "Dư có 300k" (công nợ âm, mig 186) · "Không nợ" · "—" (chưa đọc được). */
export function noNgan(debt: number | null): string {
  if (debt === null) return "—"
  if (debt > 0) return `Nợ ${shortMoney(debt)}`
  if (debt < 0) return `Dư có ${shortMoney(-debt)}`
  return "Không nợ"
}

/** "Đặt 15 ngày trước" · "Đặt hôm nay" · "Đặt hôm qua" · "Chưa đặt đơn". */
export function datGanNhat(date: string | null | undefined): string {
  if (!date) return "Chưa đặt đơn"
  const d = daysSinceVN(date)
  if (d <= 0) return "Đặt hôm nay"
  if (d === 1) return "Đặt hôm qua"
  return `Đặt ${d} ngày trước`
}

/** "Số 199 Hàng Kênh, Cát Dài, Lê Chân" — bỏ phần trống, không lặp, không kèm tỉnh. */
export function diaChiNgan(c: { address?: string | null; ward?: string | null; district?: string | null }): string {
  const ds = [c.address, c.ward, c.district].map((x) => (x ?? "").trim()).filter(Boolean)
  const out: string[] = []
  for (const x of ds) if (!out.some((y) => y.includes(x))) out.push(x)
  return out.join(", ")
}

const TONE_NHAN: Record<NhanKhach["tone"], string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-[#fdb022]/15 text-[#b54708]",
  success: "bg-[#12b76a]/10 text-[#067647]",
}

export function MobileCustomersScreen({
  title,
  subtitle,
  userInitials,
  search,
  onSearch,
  stats,
  quick,
  onPickQuick,
  statusFilter,
  onStatus,
  channelFilter,
  onChannel,
  routes,
  route,
  canCreate,
  listLabel,
  count,
  sort,
  onToggleSort,
  items,
  loading,
  empty,
  loaded,
  onLoadMore,
  notice,
}: {
  title: string
  subtitle: string
  userInitials: string
  search: string
  onSearch: (v: string) => void
  stats: Array<{ key: QuickFilter; label: string; count: number; tone: "primary" | "danger" | "default" }>
  quick: QuickFilter
  onPickQuick: (k: QuickFilter) => void
  statusFilter: string
  onStatus: (v: string) => void
  channelFilter: string
  onChannel: (v: string) => void
  routes: Array<{ code: string; name: string }>
  /** Tuyến hôm nay: đã ghé / tổng điểm. */
  route: { visited: number; total: number }
  canCreate: boolean
  listLabel: string
  count: number
  /** `null` = không cho đổi cách sắp (đang xem tuyến / nợ quá hạn — đã có thứ tự riêng). */
  sort: SapXepKhach | null
  onToggleSort: () => void
  items: KhachMobile[]
  loading: boolean
  empty: React.ReactNode
  loaded: number
  onLoadMore: () => void
  notice?: React.ReactNode
}) {
  const conNua = loaded < count

  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="kh-mobile">
      <div className="bg-primary px-4 pb-14 pt-4 text-primary-foreground">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold">{title}</h1>
            <p className="truncate text-[12.5px] opacity-85">{subtitle}</p>
          </div>
          <div className="rounded-xl bg-primary-foreground/15 [&_button]:text-primary-foreground">
            <NotificationBell />
          </div>
          <UserMenu className="grid h-10 w-10 place-items-center rounded-full bg-primary-foreground text-sm font-black text-primary">{userInitials}</UserMenu>
        </div>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-xl bg-primary-foreground/15 px-3">
          <Search className="h-4 w-4 shrink-0 opacity-80" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Tên cửa hàng, chủ quán, SĐT, địa chỉ"
            aria-label="Tìm khách hàng"
            className="w-full bg-transparent text-[15px] text-primary-foreground outline-none placeholder:text-primary-foreground/70 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button type="button" aria-label="Xoá ô tìm" onClick={() => onSearch("")} className="grid h-7 w-7 place-items-center rounded-full">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      <div className="-mt-10 space-y-4 px-4">
        <section className="rounded-2xl border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1" role="tablist">
            {stats.map((s) => {
              const on = quick === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-o-khach={s.key}
                  onClick={() => onPickQuick(s.key)}
                  className={cn("rounded-lg px-2.5 py-1.5 text-left", on && "bg-card shadow-sm")}
                >
                  <span
                    className={cn(
                      "block text-[22px] font-black leading-tight tabular-nums",
                      s.tone === "primary" ? "text-primary" : s.tone === "danger" ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {s.count}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{s.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Select value={statusFilter} onValueChange={onStatus}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Trạng thái"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mọi trạng thái</SelectItem>
                <SelectItem value="active">Đang hoạt động</SelectItem>
                <SelectItem value="suspended">Tạm ngưng</SelectItem>
                <SelectItem value="locked">Đã khoá</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={onChannel}>
              <SelectTrigger className="h-10 rounded-xl" aria-label="Tuyến"><SelectValue placeholder="Tuyến" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mọi tuyến</SelectItem>
                {routes.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.name || r.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <div className={cn("grid gap-2", canCreate ? "grid-cols-2" : "grid-cols-1")}>
          <Link href="/sales/pjp" className="flex items-center gap-2.5 rounded-2xl border bg-card px-3 py-2.5 shadow-sm">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#12b76a]/10 text-[#067647]">
              <MapPin className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">Tuyến hôm nay</span>
              <span className="block truncate text-xs text-muted-foreground tabular-nums">
                {route.total === 0 ? "Chưa xếp điểm" : `${route.visited}/${route.total} điểm`}
              </span>
            </span>
          </Link>
          {canCreate && (
            <Link
              href="/customers/new"
              className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground shadow-sm"
            >
              <Plus className="h-4 w-4" /> Thêm KH
            </Link>
          )}
        </div>

        {notice}

        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-base font-bold tabular-nums">{listLabel} · {count}</h2>
          {sort && (
            <button type="button" onClick={onToggleSort} className="text-sm font-semibold text-primary">
              {sort === "debt" ? "Nợ nhiều nhất" : "Tên A–Z"}
            </button>
          )}
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          empty
        ) : (
          <>
            <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
              {items.map((k) => (
                <div key={k.id} className="relative flex gap-3 px-4 py-3" data-testid="the-khach">
                  <Link href={`/customers/${k.id}`} className="absolute inset-0" aria-label={`Mở khách ${k.name}`} />
                  <span
                    className={cn(
                      "pointer-events-none relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black",
                      k.visited ? "bg-[#12b76a]/10 text-[#067647]" : k.overdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}
                  >
                    {k.avatar}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="pointer-events-none relative">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-[15px] font-bold">{k.name}</p>
                        <p
                          className={cn(
                            "shrink-0 text-[14px] font-bold tabular-nums",
                            k.debt === null || k.debt <= 0 ? "text-muted-foreground" : k.overdue ? "text-destructive" : "text-foreground"
                          )}
                        >
                          {noNgan(k.debt)}
                        </p>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
                        <p className="min-w-0 truncate">{k.meta || "—"}</p>
                        <p className="shrink-0">{datGanNhat(k.lastOrderDate)}</p>
                      </div>
                      {k.address && <p className="mt-1 truncate text-[13px]">{k.address}</p>}
                    </div>
                    {(k.phone || k.tags.length > 0) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {k.phone && (
                          <a href={`tel:${k.phone.replace(/\s+/g, "")}`} className="relative text-[13.5px] font-semibold text-primary tabular-nums">
                            {k.phone}
                          </a>
                        )}
                        {k.tags.map((t) => (
                          <span key={t.label} className={cn("pointer-events-none relative rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TONE_NHAN[t.tone])}>
                            {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="pb-2 text-center">
              {conNua && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="h-11 w-full rounded-xl border bg-card text-sm font-semibold text-primary shadow-sm disabled:opacity-60"
                >
                  {loading ? "Đang tải…" : `Tải thêm ${BUOC_TAI_KHACH}`}
                </button>
              )}
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                Đã hiển thị {Math.min(loaded, count)} / {count} khách
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
