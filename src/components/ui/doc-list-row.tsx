"use client"

/**
 * MỘT DÒNG CHỨNG TỪ trên điện thoại — khuôn chung cho danh sách ĐƠN HÀNG
 * và danh sách HÓA ĐƠN BÁN, theo mẫu chủ nhà gửi.
 *
 * BỐN DÒNG, theo đúng thứ tự người bán đọc:
 *   1. Tên khách        ·  Tổng tiền
 *   2. Giờ · mã chứng từ ·  Điều khoản thanh toán
 *   3. Mặt hàng chính + số lượng
 *   4. Huy hiệu trạng thái (chỉ khi còn việc phải làm)
 *
 * ⚠ MỘT KHUÔN CHO CẢ HAI DANH SÁCH. Đơn và hóa đơn là hai màn khác nhau
 * nhưng cùng một cách đọc; dựng hai bản là ít lâu sau một bên có giờ, bên
 * kia không, và người dùng phải học hai cách nhìn cho cùng một việc.
 *
 * ⚠ CẢ DÒNG LÀ MỘT VÙNG CHẠM, không nút con nào. Đây là chỗ bản danh sách
 * cũ từng rải hơn 50 vùng chạm 16px; mọi hành động nằm ở màn chi tiết.
 *
 * ⚠ MỌI Ô CHỮ DÀI PHẢI `min-w-0` + `truncate`. Tên khách và tên hàng ở
 * kho này dài tới 70 ký tự; thiếu một trong hai là dòng đẩy ngang cả màn
 * hình thay vì bị cắt.
 */

import { cn } from "@/lib/utils"

export interface DocListBadge {
  label: string
  bg: string
  fg: string
}

export function DocListRow({
  accent,
  title,
  total,
  meta,
  payment,
  paymentCredit,
  summary,
  qtyText,
  badge,
  trailing,
  first,
}: {
  /** Vạch màu trạng thái bên trái — mã màu từ `orderTone` / `invoiceTone`. */
  accent: string
  title: string
  total: string
  /** "HH:mm · MÃ-CHỨNG-TỪ" — xem `vnTime`. */
  meta: string
  /** Điều khoản thanh toán đã rút gọn; rỗng thì không in. */
  payment?: string
  /** Còn nợ thì tô hổ phách; trả ngay thì chữ trung tính. */
  paymentCredit?: boolean
  /** Mặt hàng đại diện; rỗng khi chưa đọc được dòng hàng. */
  summary?: string
  /** "x2 +3 SP" — in đậm ngay sau `summary`. */
  qtyText?: string
  /** `null` = không còn việc phải làm, không cần huy hiệu. */
  badge: DocListBadge | null
  /** Ô đánh dấu của chế độ chọn nhiều, nếu có. */
  trailing?: React.ReactNode
  first: boolean
}) {
  return (
    <span
      className={cn(
        "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 pl-3 pr-3",
        !first && "border-t border-outline-variant/30"
      )}
    >
      {/* Vạch màu tuyệt đối để nó cao bằng cả dòng, không đẩy lưới. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />

      <span className="min-w-0 truncate text-[17px] font-bold leading-tight text-on-surface">
        {title}
      </span>
      <span className="whitespace-nowrap text-[17px] font-bold tabular-data text-on-surface">
        {total}
      </span>

      <span className="min-w-0 truncate text-[13px] font-semibold tabular-data text-on-surface-variant">
        {meta}
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-[13px] font-bold",
          paymentCredit ? "text-[#8a5a00]" : "text-on-surface-variant"
        )}
      >
        {payment || ""}
      </span>

      {/* ⚠ `overflow-wrap:anywhere` — tên hàng ở kho này có cụm dài không
          dấu cách như "30g(30cái/bịch"; thiếu nó là chữ tràn ra ngoài. */}
      {summary ? (
        <span className="col-span-2 min-w-0 text-[14px] font-semibold leading-snug text-on-surface-variant [overflow-wrap:anywhere]">
          {summary}
          {qtyText ? <b className="ml-1 text-on-surface">{qtyText}</b> : null}
        </span>
      ) : null}

      {badge && (
        <span
          className="col-span-2 justify-self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
      )}

      {trailing}
    </span>
  )
}

/**
 * Đầu mỗi nhóm ngày: "HÔM NAY · N đơn · tổng tiền".
 *
 * ⚠ TỔNG CỦA NHÓM PHẢI Ở ĐÂY, không dồn hết xuống dải tổng phía trên.
 * Người bán cuộn tới ngày nào là muốn biết ngày ấy bán được bao nhiêu.
 */
export function DocListGroupHeader({
  label,
  count,
  total,
  unit = "đơn",
}: {
  label: string
  count: number
  total: string
  unit?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-y border-outline-variant/40 bg-surface-container-low px-4 py-2">
      <span className="min-w-0 truncate text-[12px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
        {label}
      </span>
      <span className="whitespace-nowrap text-[12px] font-bold tabular-data text-on-surface-variant">
        {count} {unit} · {total}
      </span>
    </div>
  )
}
