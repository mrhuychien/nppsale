"use client"

/**
 * DANH SÁCH THẺ CHỨNG TỪ TRÊN ĐIỆN THOẠI — khuôn chung của mọi danh sách chứng từ.
 *
 * ⚠ DÙNG `DocListRow` + `DocListGroupHeader` Y NHƯ `MobileInvoiceList` / danh sách đơn
 *   (chủ nhà 27/09/2026: "làm chung form hiển thị danh sách cho toàn bộ các danh sách").
 *   Dòng 1 tên + TIỀN, dòng 2 giờ·mã + phụ, dòng 3 tóm tắt, dòng 4 huy hiệu khi còn việc.
 * ⚠ BẤM THẺ → XEM NHANH (nếu màn có ngăn xem nhanh), không thì sang chi tiết. Cả thẻ là
 *   MỘT vùng chạm, không nút con nào.
 * ⚠ NHÓM THEO NGÀY chỉ khi nơi gọi đưa `getDate` — đầu nhóm mang số phiếu + tổng tiền của
 *   ngày ấy, như danh sách hóa đơn.
 */

import { useRouter } from "next/navigation"
import { cn, formatCurrency } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { groupDocsByDay } from "@/lib/orders/status-tone"
import { DocListRow, DocListGroupHeader, type DocListBadge } from "@/components/ui/doc-list-row"

export interface DocCard {
  accent: string
  title: string
  total: string
  meta: string
  payment?: string
  paymentCredit?: boolean
  summary?: string
  badge: DocListBadge | null
}

export function DocCardList<T extends { id: string }>({
  items,
  card,
  onOpen,
  href,
  getDate,
  getTotal,
  unit,
  now,
  select,
}: {
  items: T[]
  card: (row: T) => DocCard
  /** Mở ngăn xem nhanh. */
  onOpen?: (row: T) => void
  /** Không có xem nhanh thì sang trang chi tiết. */
  href?: (row: T) => string
  /** Ngày chứng từ YYYY-MM-DD — có thì gom nhóm theo ngày. */
  getDate?: (row: T) => string
  getTotal?: (row: T) => number
  /** "phiếu thu" — cho đầu nhóm ngày. */
  unit?: string
  now?: Date
  /** Chế độ chọn nhiều (thao tác hàng loạt) — ô chọn đứng bên trái thẻ. */
  select?: { checked: (row: T) => boolean; onChange: (row: T, next: boolean) => void }
}) {
  const router = useRouter()
  const groups = getDate
    ? groupDocsByDay(items, getDate, getTotal ?? (() => 0), now)
    : [{ key: "all", label: "", items, total: 0 }]

  const open = (r: T) => {
    if (onOpen) onOpen(r)
    else if (href) router.push(href(r))
  }

  return (
    <div data-doc-card-list className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
      {groups.map((g) => (
        <section key={g.key}>
          {getDate && (
            <DocListGroupHeader
              label={g.label}
              count={g.items.length}
              total={formatCurrency(g.total)}
              unit={unit}
            />
          )}
          {g.items.map((r, i) => {
            const c = card(r)
            const nut = (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r)}
                className="relative block w-full min-w-0 text-left transition-colors active:bg-surface-container"
              >
                <DocListRow
                  first={i === 0}
                  accent={c.accent}
                  title={c.title}
                  total={c.total}
                  meta={c.meta}
                  payment={c.payment}
                  paymentCredit={c.paymentCredit}
                  summary={c.summary}
                  badge={c.badge}
                />
              </button>
            )
            if (!select) return nut
            /* ⚠ Ô CHỌN NẰM NGOÀI vùng chạm của thẻ (SKILL §2b-2) — bấm ô chọn không mở thẻ. */
            return (
              <div key={r.id} className={cn("flex min-w-0 items-stretch", i > 0 && "border-t border-outline-variant/30")}>
                <label className="tap flex shrink-0 items-center justify-center pl-3">
                  <Checkbox
                    checked={select.checked(r)}
                    onCheckedChange={(v) => select.onChange(r, !!v)}
                    aria-label={`Chọn ${c.title}`}
                  />
                </label>
                <div className="min-w-0 flex-1 [&>button>span]:border-t-0">{nut}</div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
