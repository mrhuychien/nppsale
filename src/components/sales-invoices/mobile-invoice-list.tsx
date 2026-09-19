"use client"

/**
 * Danh sách HÓA ĐƠN BÁN trên điện thoại — cùng một mẫu với danh sách đơn
 * hàng (chủ nhà chốt: "Danh sách đơn hàng và Danh sách Hoá đơn trên di
 * động theo mẫu này").
 *
 * ⚠ DÙNG CHUNG `DocListRow` VỚI DANH SÁCH ĐƠN. Hai màn khác nhau nhưng
 * cùng một cách đọc; dựng hai khuôn là ít lâu sau một bên có giờ, bên kia
 * không, và người dùng phải học hai cách nhìn cho cùng một việc.
 *
 * ⚠ MỞ NGĂN XEM NHANH, KHÔNG CHUYỂN TRANG. Bản cũ của màn này đã làm vậy
 * và đó là hành vi đúng: kế toán lướt danh sách để đối chiếu, mở hẳn
 * trang chi tiết rồi bấm Back cho từng hóa đơn là mất chỗ đang đứng.
 */

import { formatCurrency } from "@/lib/utils"
import { groupDocsByDay, invoiceTone, vnTime } from "@/lib/orders/status-tone"
import { DocListRow, DocListGroupHeader } from "@/components/ui/doc-list-row"
import {
  docQtyText, docSummaryText, isCreditTerm, shortTermLabel,
  type DocLineSummary,
} from "@/lib/orders/list-summary"

export interface MobileInvoiceRow {
  id: string
  invoice_code: string
  invoice_date: string
  created_at?: string | null
  status: string
  total: number
  payment_terms?: string | null
  replaced_from?: string | null
  replaced_by?: string | null
  customer?: { store_name?: string | null } | null
  sales_user?: { full_name?: string | null } | null
}

/**
 * ⚠ HÓA ĐƠN ĐÃ GHI SỔ KHÔNG CẦN HUY HIỆU. `posted` là trạng thái bình
 * thường của gần như mọi dòng; đeo huy hiệu xanh cho tất cả thì huy hiệu
 * hết nghĩa và mắt không bắt được dòng ĐÃ HUỶ.
 *
 * ⚠ NHƯNG BẢN LẬP LẠI / ĐÃ BỊ THAY THÌ PHẢI NÓI. Hai dấu ấy đổi hẳn
 * nghĩa của tờ giấy, và người đối chiếu cần thấy ngay.
 */
function badgeOf(r: MobileInvoiceRow) {
  const tone = invoiceTone(r.status)
  if (r.status !== "posted") return tone
  if (r.replaced_by) return { ...tone, label: "Đã bị thay", bg: "#eef1f5", fg: "#565a67" }
  if (r.replaced_from) return { ...tone, label: "Lập lại", bg: "#e3edfb", fg: "#1d4ed8" }
  return null
}

export function MobileInvoiceList({
  invoices,
  lineSummary,
  showSalesName,
  onOpen,
  now,
}: {
  invoices: MobileInvoiceRow[]
  /**
   * Mặt hàng đại diện của từng hóa đơn.
   *
   * ⚠ CHƯA ĐỌC XONG THÌ ĐỂ `undefined`, đừng truyền `{}` — xem
   * `docSummaryText`: `{}` làm mọi dòng in "0 mặt hàng".
   */
  lineSummary?: Record<string, DocLineSummary>
  /** Kế toán xem hóa đơn của nhiều NVBH thì cần biết của ai. */
  showSalesName: boolean
  onOpen: (id: string) => void
  /** Để kiểm thử — mặc định là bây giờ. */
  now?: Date
}) {
  const groups = groupDocsByDay(invoices, (r) => r.invoice_date, (r) => r.total, now)

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
      {groups.map((g) => (
        <section key={g.key}>
          <DocListGroupHeader
            label={g.label}
            count={g.items.length}
            total={formatCurrency(g.total)}
            unit="hóa đơn"
          />
          {g.items.map((r, i) => {
            const tone = invoiceTone(r.status)
            const sum = lineSummary?.[r.id]
            /**
             * ⚠ GIỜ TỪ `created_at`. `invoice_date` là cột kiểu `date`,
             * không mang giờ — dựng giờ từ nó là in "07:00" cho mọi hóa
             * đơn, một con số trông như dữ liệu thật mà không phải.
             */
            const meta = [r.created_at ? vnTime(r.created_at) : null, r.invoice_code]
              .filter(Boolean)
              .join(" · ")
            const summary = showSalesName && r.sales_user?.full_name
              ? [docSummaryText(sum), r.sales_user.full_name].filter(Boolean).join(" · ")
              : docSummaryText(sum)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r.id)}
                className="relative block w-full min-w-0 text-left transition-colors active:bg-surface-container"
              >
                <DocListRow
                  first={i === 0}
                  accent={tone.accent}
                  title={r.customer?.store_name || "Khách lẻ"}
                  meta={meta}
                  payment={shortTermLabel(r.payment_terms)}
                  paymentCredit={isCreditTerm(r.payment_terms)}
                  summary={summary}
                  qtyText={docQtyText(sum)}
                  total={formatCurrency(r.total)}
                  badge={badgeOf(r)}
                />
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
