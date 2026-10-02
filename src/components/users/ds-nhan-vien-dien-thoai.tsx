"use client"

/**
 * DANH SÁCH NHÂN VIÊN TRÊN ĐIỆN THOẠI — thiết kế "ds-nhan-vien" (chủ nhà 30/09/2026: "Làm lại các màn").
 *
 * Đầu xanh ("Nhân viên" · "N đang hoạt động · N tạm khoá") → khối trắng dính trên: ô tìm + nút "+"
 * (chỉ khi có quyền tạo) · chip có số (Đang hoạt động · theo vai · Tạm khoá · Tất cả) → thẻ: ô chữ
 * viết tắt · tên · "Vai trò · SĐT" · nút đăng nhập (Safari, luật ở trang) · ›. Chạm thẻ = xem nhanh.
 */

import { trangThaiNv } from "@/lib/users/nghi-viec"
import type { KeyboardEvent, ReactNode } from "react"
import { ChevronRight, Plus, Search, X } from "lucide-react"
import Link from "@/components/ui/link"
import { Skeleton } from "@/components/ui/skeleton"
import { DauTrangXanh } from "@/components/mobile/dau-trang"
import { SEARCH_FIELD_PROPS } from "@/lib/ui/search-field"
import { cn } from "@/lib/utils"
import { dongPhuTheNv, vietTatTenNv, type ChipNv, type NvDong } from "@/lib/users/mobile-list"

export function DsNhanVienDienThoai<T extends NvDong>({
  subtitle,
  search,
  onSearch,
  canCreate,
  chips,
  loc,
  onPickLoc,
  items,
  loading,
  nutDangNhap,
  onOpen,
}: {
  subtitle: string
  search: string
  onSearch: (v: string) => void
  canCreate: boolean
  chips: ChipNv[]
  loc: string
  onPickLoc: (k: string) => void
  items: T[]
  loading: boolean
  /** Nút đăng nhập của MỘT người — `null` khi không được (luật ở trang). */
  nutDangNhap: (u: T) => ReactNode
  onOpen: (u: T) => void
}) {
  return (
    <div className="-mx-4 !-mt-4 lg:hidden" data-testid="nv-mobile">
      <DauTrangXanh title="Nhân viên" subtitle={subtitle} testId="nv-dau-xanh" />

      <div className="sticky top-0 z-20 space-y-2.5 border-b border-outline-variant/60 bg-card py-3">
        <div className="flex gap-2 px-3.5">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/60 bg-card px-3 text-muted-foreground">
            <Search className="h-[18px] w-[18px] shrink-0" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Họ tên hoặc số điện thoại"
              aria-label="Tìm nhân viên"
              {...SEARCH_FIELD_PROPS}
              className="w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/80"
            />
            {search && (
              <button type="button" onClick={() => onSearch("")} aria-label="Xoá tìm kiếm" className="shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          {canCreate && (
            <Link
              href="/settings/users/new"
              aria-label="Tạo nhân viên"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground active:opacity-90"
            >
              <Plus className="h-[22px] w-[22px]" />
            </Link>
          )}
        </div>

        <div className="row-scroll gap-1.5 px-3.5" data-testid="nv-chip">
          {chips.map((c) => {
            const on = loc === c.key
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => onPickLoc(c.key)}
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

      <div className="px-3.5 pb-4 pt-3">
        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant/60 bg-card px-4 py-7 text-center text-[13px] text-muted-foreground">
            Không tìm thấy nhân viên
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-outline-variant/60 bg-card" data-testid="nv-ds">
            {items.map((u) => {
              const tt = trangThaiNv(u)
              const khoa = tt !== "active"
              const chu = u.role === "owner"
              /* Nút đăng nhập nằm trong thẻ nhưng tự chặn nổi bọt (stopPropagation) → không mở xem nhanh. */
              const phim = (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.target !== e.currentTarget) return
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onOpen(u)
                }
              }
              return (
                <div
                  key={u.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(u)}
                  onKeyDown={phim}
                  data-testid="nv-the"
                  className="flex cursor-pointer items-center gap-3 px-3.5 py-3 active:bg-muted/50"
                >
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold",
                      khoa
                        ? "bg-muted text-muted-foreground"
                        : chu
                          ? "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300"
                          : "bg-primary/10 text-primary"
                    )}
                    aria-hidden
                  >
                    {vietTatTenNv(u.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{u.full_name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{dongPhuTheNv(u)}</div>
                  </div>
                  {khoa && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
                      {tt === "left" ? "Đã nghỉ" : "Tạm khoá"}
                    </span>
                  )}
                  {nutDangNhap(u)}
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground/70" aria-hidden />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
