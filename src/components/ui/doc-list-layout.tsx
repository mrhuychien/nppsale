"use client"

/**
 * KHUÔN DANH SÁCH CHỨNG TỪ DÙNG CHUNG — bố cục của màn Đơn hàng / Hóa đơn bán.
 *
 * ⚠ CHỦ NHÀ 27/09/2026: "Làm danh sách Phiếu thu format giống Danh sách đơn hàng / Hóa đơn
 *   đi, giờ đang 1 mình 1 format. Làm chung form hiển thị danh sách cho toàn bộ các danh
 *   sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng."
 *
 * Khuôn gồm (máy tính): MỘT thẻ chứa thanh công cụ (ô tìm · bộ lọc · kỳ | lọc nâng cao ·
 * chọn bộ lọc · chọn cột) → khung "Lọc nhanh" (khi mở) → dòng thống kê "Tổng tiền · N
 * phiếu" → lưới → phân trang. Điện thoại: dải tóm tắt (tổng của CẢ bộ lọc) → danh sách thẻ →
 * phân trang. Dải trạng thái (`StatusChips`), `MobileFilterBar` và ngăn xem nhanh nằm
 * ngoài khuôn, do trang đặt — giống hệt màn hóa đơn.
 *
 * ⚠ MỘT KHUÔN, KHÔNG CHÉP TAY. Mỗi màn tự dựng lại thẻ ấy là ít lâu sau một màn có dòng
 *   tổng, màn kia không; một màn phân trang 50, màn kia 20 — đúng thứ vừa bị chủ nhà nhắc.
 * ⚠ TỔNG LÀ CỦA CẢ BỘ LỌC — nơi gọi cộng bằng truy vấn riêng; `total = null` hiện "—".
 */

import type { ReactNode } from "react"
import { ChevronDown, ChevronUp, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DocSearchBox } from "@/components/ui/doc-search-box"
import { MATCH_CAP } from "@/lib/search/list-search"
import type { TruongTim } from "@/lib/search/field-search"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { DataPagination } from "@/components/ui/data-pagination"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import type { UsePaginationReturn } from "@/hooks/use-pagination"
import { DocListMobileHead, type DocListMobileHeadProps } from "@/components/ui/doc-list-mobile-head"

export interface DocListTotalsInfo {
  /** "Tổng tiền phiếu thu". */
  label: string
  /** "12 phiếu thu" — đã định dạng. */
  countText: string
  /** Đã định dạng; `null` = chưa cộng được → "—". */
  total: string | null
}

export function DocListLayout({
  toolbar,
  toolbarEnd,
  advanced,
  totals,
  totalsNote,
  mobileSummary,
  loading,
  isEmpty,
  empty,
  table,
  cards,
  pg,
  shownCount,
  mobilePager,
  mobileHead,
  mobileCountUnit = "mục",
}: {
  /** Nửa trái thanh công cụ: ô tìm, bộ lọc nhanh, kỳ, "Xoá lọc", nút "Lọc nhanh". */
  toolbar: ReactNode
  /** Nửa phải: `AdvancedFilter` · `FilterPicker` · `ColumnPicker`. */
  toolbarEnd?: ReactNode
  /** Khung "Lọc nhanh" — `null` / `false` là đang đóng. */
  advanced?: ReactNode
  /** Dòng thống kê. `null` = màn không có tiền để cộng. */
  totals: DocListTotalsInfo | null
  /** Một dòng phụ ngay dưới dòng tổng (vd "Đã trả · Chưa trả") — cả máy tính lẫn điện thoại. */
  totalsNote?: ReactNode
  /** Dải tóm tắt của điện thoại (`DocListSummary`); bỏ trống thì dùng dòng thống kê. */
  mobileSummary?: ReactNode
  loading: boolean
  isEmpty: boolean
  empty: ReactNode
  /** Lưới máy tính — `DocTable`. */
  table: ReactNode
  /**
   * Danh sách thẻ điện thoại — `DocCardList`. `null` = màn có màn điện thoại RIÊNG theo mẫu
   * chủ nhà (đơn hàng, khách hàng) — khuôn chỉ dựng phần máy tính.
   */
  cards: ReactNode | null
  pg: UsePaginationReturn
  shownCount?: number
  /** Thay phân trang điện thoại — vd `LoadMore` của màn công nợ (NVBH cuộn để đi thu). */
  mobilePager?: ReactNode
  /**
   * Đầu trang xanh theo mẫu màn Đơn hàng (chủ nhà 30/09/2026). Có thì điện thoại dựng đầu này thay
   * cho `PageHeader` / `StatusChips` / `MobileFilterBar` của trang (trang ẩn chúng trên điện thoại).
   */
  mobileHead?: DocListMobileHeadProps
  /** Chữ dưới số đếm khi màn không có dòng tổng tiền — "nhân viên", "sản phẩm"… */
  mobileCountUnit?: string
}) {
  return (
    <>
      {/* ---------------- Máy tính: một thẻ ---------------- */}
      <div
        data-doc-list="desktop"
        className="hidden flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest lg:flex"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3">
          {toolbar}
          {toolbarEnd && <div className="ml-auto flex items-center gap-2">{toolbarEnd}</div>}
        </div>

        {advanced ? (
          <Card className="mx-4 my-3 rounded-2xl border-dashed">
            <CardContent className="grid gap-4 pt-6 md:grid-cols-3">{advanced}</CardContent>
          </Card>
        ) : null}

        {totals && (
          <DocListTotals desktopOnly label={totals.label} countText={totals.countText} total={totals.total} />
        )}
        {totalsNote && <div className="border-b border-outline-variant/40 px-4 py-2">{totalsNote}</div>}

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : isEmpty ? (
          <div className="px-4 py-10">{empty}</div>
        ) : (
          table
        )}

        <div className="px-4 pb-3 pt-1">
          <DataPagination pg={pg} shownCount={shownCount} />
        </div>
      </div>

      {/* ---------------- Điện thoại: dải tóm tắt + thẻ ---------------- */}
      {cards !== null && mobileHead && (
      <div data-doc-list="mobile" className="-mx-4 !-mt-4 lg:hidden">
        <DocListMobileHead
          head={mobileHead}
          totalLabel={totals?.label ?? null}
          total={totals?.total ?? null}
          countText={totals?.countText ?? `${pg.total} ${mobileCountUnit}`}
        />
        <div className="mt-3 space-y-3 px-4 pb-2">
          {mobileSummary}
          {totalsNote && <div className="px-1">{totalsNote}</div>}
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
          ) : isEmpty ? (
            <div className="rounded-2xl border bg-card p-6">{empty}</div>
          ) : (
            <>
              {cards}
              {mobilePager ?? <DataPagination pg={pg} shownCount={shownCount} />}
            </>
          )}
        </div>
      </div>
      )}

      {cards !== null && !mobileHead && (
      <div data-doc-list="mobile" className="space-y-3 lg:hidden">
        {mobileSummary ??
          (totals && (
            <DocListTotals className="rounded-xl border" label={totals.label} countText={totals.countText} total={totals.total} />
          ))}
        {totalsNote && <div className="px-1">{totalsNote}</div>}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : isEmpty ? (
          <div className="rounded-xl border bg-card p-6">{empty}</div>
        ) : (
          <>
            {cards}
            {mobilePager ?? <DataPagination pg={pg} shownCount={shownCount} />}
          </>
        )}
      </div>
      )}
    </>
  )
}

const KHONG_TRUONG: readonly TruongTim[] = []
const KHONG_AP: Record<string, string> = {}
const boQua = () => {}

/** Ô tìm của thanh công cụ cho màn CHƯA có tìm theo trường — cùng ô với `DocSearchBox`. */
export function DocListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <DocSearchBox
      className="min-w-[260px] max-w-md flex-1"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      fields={KHONG_TRUONG}
      applied={KHONG_AP}
      onApply={boQua}
    />
  )
}

/** Nút "Lọc nhanh" của thanh công cụ — cùng chữ, cùng biểu tượng với màn đơn / hóa đơn. */
export function LocNhanhButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" onClick={onToggle} className="gap-2" aria-expanded={open}>
      <Filter className="h-4 w-4" />
      Lọc nhanh
      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </Button>
  )
}

/** "Xoá lọc" của thanh công cụ máy tính — chỉ hiện khi có gì để xoá. */
export function XoaLocButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null
  return (
    <Button variant="ghost" size="sm" className="font-extrabold text-primary" onClick={onClick}>
      Xoá lọc
    </Button>
  )
}

/**
 * ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt lúc đủ — đúng cái lỗi
 *   "chỉ tìm trang 1" chủ nhà báo 21/09/2026, chỉ đổi chỗ.
 */
export function KetQuaThieu({ show, term }: { show: boolean; term: string }) {
  if (!show) return null
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
      <p className="font-semibold">Kết quả tìm đang thiếu</p>
      <p className="mt-0.5">
        Có hơn {MATCH_CAP} mục khớp{term ? <> &ldquo;{term}&rdquo;</> : null} — danh sách dưới chưa đủ. Gõ thêm cho hẹp lại.
      </p>
    </div>
  )
}

/** Nhãn + ô của khung "Lọc nhanh" — cùng cỡ chữ với màn hóa đơn. */
export function LocNhanhField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
