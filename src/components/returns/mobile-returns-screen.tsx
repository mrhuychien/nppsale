"use client"

/**
 * DANH SÁCH TRẢ HÀNG TRÊN ĐIỆN THOẠI — theo mẫu chủ nhà 27/09/2026 ("Viết lại giao diện danh sách
 * trả hàng trên mobile của nhân viên bán hàng theo mẫu").
 *
 * Đầu trang xanh (tiêu đề, "N phiếu · tên", chuông, ảnh đại diện) → thẻ nổi "Chờ xử lý · N phiếu"
 * + tổng tiền + "Xử lý ngay" → nút "Tạo phiếu trả" → chip trạng thái có số → ô tìm + lý do →
 * phiếu nhóm theo ngày (khách, lý do · mã đơn, mã phiếu · mã HĐ, tiền, trạng thái) → ngăn phiếu.
 */

import { Search, Undo2, Check, ChevronRight } from "lucide-react"
import { UserMenu } from "@/components/layout/user-menu"
import { NutMenuDauTrang } from "@/components/layout/mo-menu-context"
import { NotificationBell } from "@/components/layout/notification-bell"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "@/components/ui/link"
import { cn, formatCurrency } from "@/lib/utils"
import { RETURN_REASONS, nhanLyDoTra } from "@/lib/constants"
import { tenPhieuTra } from "@/lib/returns/ma-phieu"
import { nhomTraTheoNgay, toneTra } from "@/lib/returns/mobile-list"
import type { ThongKeNgay } from "@/lib/list/thong-ke-ngay"

export const BUOC_TAI_TRA = 20

export interface PhieuTraMobile {
  id: string
  status: string
  reason: string | null
  credit_note_amount: number | null
  created_at: string
  return_date?: string | null
  customer?: { store_name?: string | null } | null
  order?: { order_code?: string | null } | null
  invoice?: { invoice_code?: string | null } | null
}

export function MobileReturnsScreen({
  title,
  subtitle,
  userInitials,
  pending,
  onOpenFirstPending,
  tabs,
  isTabOn,
  onPickTab,
  search,
  onSearch,
  reason,
  onReason,
  rows,
  codes,
  loading,
  count,
  onLoadMore,
  onOpen,
  notice,
  canCreate = true,
  dayStats,
}: {
  title: string
  subtitle: string
  userInitials: string
  /** Phiếu Chờ xử lý: số + tổng tiền; `null` = chưa đọc xong. */
  pending: { count: number; total: number } | null
  onOpenFirstPending: () => void
  tabs: Array<{ key: string; label: string; count: number | null }>
  isTabOn: (key: string) => boolean
  onPickTab: (key: string) => void
  search: string
  onSearch: (v: string) => void
  reason: string
  onReason: (v: string) => void
  rows: PhieuTraMobile[]
  codes: Map<string, string>
  loading: boolean
  /** Tổng số phiếu khớp bộ lọc. */
  count: number
  onLoadMore: () => void
  onOpen: (id: string) => void
  notice?: React.ReactNode
  /** Có quyền tạo phiếu trả (`returns.create`) — mẫu NVBH chỉ XEM thì không hiện nút tạo. */
  canCreate?: boolean
  /**
   * Số phiếu + tổng tiền của TỪNG NGÀY đang hiện, đếm trên máy chủ cùng bộ lọc (`docThongKeNgay`, khoá ngày như
   * `ngayNhomTra`). Thiếu ngày nào thì đầu nhóm ngày đó cộng các phiếu đã tải. Rà soát 03/10/2026: ngày cuối đang
   * hiện bị cắt giữa chừng nên "N phiếu · tổng" cộng trên các phiếu đã tải là THIẾU.
   */
  dayStats?: ThongKeNgay | null
}) {
  const groups = nhomTraTheoNgay(rows)
  const conNua = rows.length < count

  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="tra-mobile">
      <div className="bg-primary px-4 pb-16 pt-5 text-primary-foreground">
        <div className="flex items-center gap-2">
          <NutMenuDauTrang />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{title}</h1>
            <p className="mt-0.5 truncate text-xs opacity-85">{subtitle}</p>
          </div>
          <div className="rounded-xl bg-primary-foreground/15 [&_button]:text-primary-foreground">
            <NotificationBell />
          </div>
          <UserMenu className="grid h-10 w-10 place-items-center rounded-full bg-primary-foreground text-sm font-bold text-primary">{userInitials}</UserMenu>
        </div>
      </div>

      <div className="-mt-12 space-y-3.5 px-3.5 pb-4">
        <section className="rounded-2xl bg-card p-4 shadow-lg" data-testid="the-cho-xu-ly">
          {pending === null ? (
            <Skeleton className="h-16" />
          ) : pending.count > 0 ? (
            <div className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Chờ xử lý · {pending.count} phiếu</p>
                  <p className="mt-0.5 truncate text-[28px] font-bold tabular-nums tracking-tight">{formatCurrency(pending.total)}</p>
                </div>
                <button
                  type="button"
                  onClick={onOpenFirstPending}
                  className="h-10 shrink-0 rounded-xl bg-primary/10 px-3.5 text-sm font-semibold text-primary"
                >
                  Xử lý ngay
                </button>
              </div>
              <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-700">
                Hàng chưa vào kho, công nợ chưa giảm. Mở phiếu, chọn kho nhận rồi bấm Hoàn thành.
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <Check className="h-[18px] w-[18px]" /> Không còn phiếu chờ xử lý
            </p>
          )}
        </section>

        {canCreate && (
        <Link
          href="/returns/new"
          className="flex h-14 items-center gap-3 rounded-2xl bg-primary px-4 text-primary-foreground shadow-sm active:scale-[0.99]"
        >
          <Undo2 className="h-5 w-5" />
          <span className="text-base font-semibold">Tạo phiếu trả</span>
          <ChevronRight className="ml-auto h-5 w-5" />
        </Link>
        )}

        <div className="-mx-3.5 flex gap-2 overflow-x-auto px-3.5 [scrollbar-width:none]" role="tablist" aria-label="Trạng thái phiếu trả">
          {tabs.map((t) => {
            const on = isTabOn(t.key)
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                data-tab-tra={t.key}
                onClick={() => onPickTab(t.key)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground"
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                    on
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : t.key === "submitted"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {t.count ?? "…"}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-3 text-muted-foreground">
            <Search className="h-[18px] w-[18px] shrink-0" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Khách, mã phiếu, mã đơn"
              aria-label="Tìm phiếu trả"
              className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
            />
          </label>
          <select
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            aria-label="Lọc theo lý do"
            className="h-11 w-[124px] shrink-0 rounded-xl border bg-card px-2.5 text-[13px] font-medium"
          >
            <option value="all">Mọi lý do</option>
            {RETURN_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {notice}

        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border bg-card px-4 py-7 text-center text-sm text-muted-foreground">Không có phiếu phù hợp</div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} className="grid gap-2">
                <div className="flex items-baseline justify-between px-0.5">
                  <h2 className="text-[13px] font-bold">{g.label}</h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {dayStats?.[g.key]?.count ?? g.items.length} phiếu · {formatCurrency(dayStats?.[g.key]?.total ?? g.total)}
                  </span>
                </div>
                <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {g.items.map((r) => {
                    const tone = toneTra(r.status)
                    const phu = [nhanLyDoTra(r.reason), r.order?.order_code].filter(Boolean).join(" · ")
                    const ma = [tenPhieuTra(codes.get(r.id)), r.invoice?.invoice_code].filter(Boolean).join(" · ")
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => onOpen(r.id)}
                        data-testid="the-tra"
                        className="flex w-full gap-3 px-3.5 py-3 text-left active:bg-muted/40"
                      >
                        <span className="grid min-w-0 flex-1 gap-[3px]">
                          <span className="truncate text-sm font-semibold">{r.customer?.store_name || "—"}</span>
                          {phu && <span className="truncate text-xs text-muted-foreground">{phu}</span>}
                          <span className="truncate text-xs text-muted-foreground/80">{ma}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="text-sm font-bold tabular-nums">{formatCurrency(Number(r.credit_note_amount) || 0)}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.cls)}>{tone.label}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
            <div className="text-center">
              {conNua && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="h-11 w-full rounded-xl border bg-card text-sm font-semibold text-primary disabled:opacity-60"
                >
                  {loading ? "Đang tải…" : `Tải thêm ${BUOC_TAI_TRA} phiếu`}
                </button>
              )}
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                Đã hiển thị {Math.min(rows.length, count)} / {count} phiếu
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

