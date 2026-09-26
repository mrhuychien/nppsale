"use client"

/**
 * DANH SÁCH ĐƠN HÀNG TRÊN ĐIỆN THOẠI — theo mẫu chủ nhà gửi 26/09/2026 ("Viết lại màn danh
 * sách đơn hàng trên mobile theo mẫu … Load 20 đơn hàng 1 lần thôi cho nhanh. Khi nhân viên
 * xem thì danh sách không cần hiện tên nhân viên nữa").
 *
 * Đầu trang xanh (tiêu đề, chuông, ảnh đại diện, ô tìm) → thẻ trắng (tab trạng thái có số,
 * "Tổng tiền hàng · kỳ" + số đơn) → đơn nhóm theo ngày (tên khách, tiền, giờ · mã · NV,
 * trạng thái, địa chỉ, SĐT) → "Tải thêm 20 đơn".
 */

import { UserMenu } from "@/components/layout/user-menu"
import Link from "@/components/ui/link"
import { Search, MapPin, Phone, SlidersHorizontal } from "lucide-react"
import { NotificationBell } from "@/components/layout/notification-bell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatCurrency } from "@/lib/utils"
import { groupOrdersByDay, orderTone, vnTime } from "@/lib/orders/status-tone"
import { LIST_PERIOD_LABEL, type ListPeriod } from "@/lib/orders/list-summary"

export const BUOC_TAI_DON = 20

export interface DonMobile {
  id: string
  order_code: string
  order_date: string
  created_at?: string | null
  status: string
  total: number
  customer?: {
    store_name?: string | null
    phone?: string | null
    address?: string | null
    ward?: string | null
    district?: string | null
    province?: string | null
  } | null
  sales_user?: { full_name?: string | null } | null
}

/** "Số 195 Hàng Kênh, P. Vĩnh Niệm, Lê Chân, Hải Phòng" — bỏ phần trống, không lặp. */
export function diaChiKhach(c: DonMobile["customer"]): string {
  if (!c) return ""
  const ds = [c.address, c.ward, c.district, c.province].map((x) => (x ?? "").trim()).filter(Boolean)
  const out: string[] = []
  for (const x of ds) if (!out.some((y) => y.includes(x))) out.push(x)
  return out.join(", ")
}

/** Dòng phụ của thẻ đơn: giờ · mã · NV (NVBH xem thì không có tên NV). */
export function dongPhuDon(o: DonMobile, hienNhanVien: boolean): string {
  return [
    o.created_at ? vnTime(o.created_at) : null,
    o.order_code,
    hienNhanVien && o.sales_user?.full_name ? `NV ${o.sales_user.full_name}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function MobileOrdersScreen({
  title,
  userInitials,
  search,
  onSearch,
  tabs,
  activeTab,
  onPickTab,
  period,
  onCyclePeriod,
  onOpenFilter,
  filtersActive,
  total,
  count,
  orders,
  showSalesName,
  loading,
  empty,
  loaded,
  onLoadMore,
  notice,
}: {
  title: string
  userInitials: string
  search: string
  onSearch: (v: string) => void
  tabs: Array<{ key: string; label: string; count: number }>
  activeTab: string
  onPickTab: (key: string) => void
  period: ListPeriod
  onCyclePeriod: () => void
  onOpenFilter: () => void
  filtersActive: boolean
  /** Tổng tiền của CẢ bộ lọc, đã định dạng; `null` = chưa cộng được. */
  total: string | null
  /** Tổng số đơn khớp bộ lọc. */
  count: number
  orders: DonMobile[]
  showSalesName: boolean
  loading: boolean
  /** Khối hiện khi rỗng (nơi gọi quyết định câu chữ). */
  empty: React.ReactNode
  /** Số đơn đã tải. */
  loaded: number
  onLoadMore: () => void
  notice?: React.ReactNode
}) {
  const groups = groupOrdersByDay(orders)
  const conNua = loaded < count

  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="don-mobile">
      <div className="bg-primary px-4 pb-14 pt-4 text-primary-foreground">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 truncate text-xl font-extrabold">{title}</h1>
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
            placeholder="Tìm mã đơn, tên KH, SĐT"
            aria-label="Tìm đơn hàng"
            className="w-full bg-transparent text-[15px] text-primary-foreground outline-none placeholder:text-primary-foreground/70"
          />
        </label>
      </div>

      <div className="-mt-10 space-y-4 px-4">
        <section className="rounded-2xl border bg-card p-3 shadow-sm">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1" role="tablist">
            {tabs.map((t) => {
              const on = activeTab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  data-tab-don={t.key}
                  onClick={() => onPickTab(t.key)}
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
          <div className="mt-3 flex items-end justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Tổng tiền hàng ·</span>
                <button type="button" onClick={onCyclePeriod} className="font-semibold text-foreground underline-offset-2 hover:underline">
                  {LIST_PERIOD_LABEL[period]}
                </button>
                <button
                  type="button"
                  onClick={onOpenFilter}
                  aria-label="Bộ lọc"
                  className={cn("ml-1 grid h-6 w-6 place-items-center rounded-full", filtersActive ? "bg-primary text-primary-foreground" : "bg-muted")}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 truncate text-[26px] font-black tabular-nums" data-testid="tong-tien-don">
                {total ?? "—"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-black text-primary tabular-nums">{count}</p>
              <p className="text-xs text-muted-foreground">đơn hàng</p>
            </div>
          </div>
        </section>

        {notice}

        {loading && orders.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : orders.length === 0 ? (
          empty
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-base font-bold">{g.label}</h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {g.items.length} đơn · {formatCurrency(g.total)}
                  </span>
                </div>
                <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
                  {g.items.map((o) => {
                    const tone = orderTone(o.status)
                    const diaChi = diaChiKhach(o.customer)
                    const sdt = (o.customer?.phone ?? "").trim()
                    return (
                      <div key={o.id} className="relative px-4 py-3" data-testid="the-don">
                        <Link href={`/orders/${o.id}`} className="absolute inset-0" aria-label={`Mở đơn ${o.order_code}`} />
                        <div className="pointer-events-none relative">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 truncate text-[15px] font-bold">{o.customer?.store_name || "Khách lẻ"}</p>
                            <p className="shrink-0 text-[15px] font-bold tabular-nums">{formatCurrency(o.total)}</p>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-[12.5px] text-muted-foreground">{dongPhuDon(o, showSalesName)}</p>
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: tone.bg, color: tone.fg }}>
                              {tone.label}
                            </span>
                          </div>
                          {diaChi && (
                            <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug">
                              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0">{diaChi}</span>
                            </p>
                          )}
                        </div>
                        {sdt && (
                          <a
                            href={`tel:${sdt.replace(/\s+/g, "")}`}
                            className="relative mt-1 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary"
                          >
                            <Phone className="h-3.5 w-3.5" /> {sdt}
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
            <div className="pb-2 text-center">
              {conNua && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="h-11 w-full rounded-xl border bg-card text-sm font-semibold text-primary shadow-sm disabled:opacity-60"
                >
                  {loading ? "Đang tải…" : `Tải thêm ${BUOC_TAI_DON} đơn`}
                </button>
              )}
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                Đã hiển thị {Math.min(loaded, count)} / {count} đơn
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
