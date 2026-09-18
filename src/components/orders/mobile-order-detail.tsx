"use client"

import Link from "next/link"
import { ChevronLeft, ChevronRight, Phone } from "lucide-react"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { misaStatusBadge } from "@/lib/misa/labels"
import { returnReasonLabel } from "@/lib/sell/returns"
import {
  buildOrderTimeline,
  orderTone,
  vnTime,
  type TimelineHistoryEntry,
} from "@/lib/orders/status-tone"
import type { Invoice, SalesOrder, SalesOrderLine } from "@/types"

/**
 * Chi tiết đơn trên ĐIỆN THOẠI — theo mẫu thiết kế "Chi tiết đơn".
 *
 * BỐ CỤC, TỪ TRÊN XUỐNG
 *   đầu trang riêng (lùi · mã đơn · huy hiệu) → khung cảnh báo (nếu có)
 *   → thẻ khách → thẻ dòng hàng + tổng → hàng thông tin → dòng thời gian
 *   → các hàng "xem thêm" (công nợ, hoá đơn, giao hàng, hàng trả, lịch sử
 *   sửa dòng). Thanh hành động dính đáy do TRANG dựng, vì nó cần các
 *   handler của trang.
 *
 * ⚠ ĐÂY LÀ MÀN ĐỌC. Sửa dòng hàng trên điện thoại đi qua màn bán hàng
 * (`/sell/edit/[id]`); còn sửa số lượng ở bước lấy hàng (kho/quản lý) thì
 * trang tự chuyển sang bản có ô nhập — component này không vẽ ô nhập nào.
 *
 * ⚠ Mọi con số lấy từ ĐƠN ĐÃ LƯU (`subtotal`, `discount`, `vat`, `total`),
 * không cộng lại từ dòng: hai phép cộng cho hai con số là mở đường cho
 * "màn này nói một đằng, hoá đơn nói một nẻo".
 */
export interface MobileDeliveryLine {
  id: string
  status: string
  delivered_at: string | null
  delivery?: {
    id: string
    route_name?: string | null
    driver?: { full_name?: string | null } | null
  } | null
}

export interface MobileLinkedReturn {
  id: string
  status: string
  reason: string
  credit_note_amount: number | null
}

export interface MobileActivityEntry {
  id: string
  action: "add_line" | "edit_line" | "remove_line"
  created_at: string
  actor?: { full_name?: string | null } | null
}

export function MobileOrderDetail({
  order,
  lines,
  statusHistory,
  receivable,
  receivableId,
  invoice,
  deliveryLines,
  linkedReturns,
  activityLog,
  showSalesName,
  callout,
  onBack,
}: {
  order: SalesOrder
  lines: SalesOrderLine[]
  statusHistory: TimelineHistoryEntry[]
  receivable: { amount: number; paid: number; status: string; due_date: string | null } | null
  receivableId: string | null
  invoice: Invoice | null
  deliveryLines: MobileDeliveryLine[]
  linkedReturns: MobileLinkedReturn[]
  activityLog: MobileActivityEntry[]
  showSalesName: boolean
  /** Khung "chờ duyệt" / "nháp chưa gửi" — trang truyền vào vì nút Gửi duyệt cần handler của trang. */
  callout?: React.ReactNode
  onBack: () => void
}) {
  const tone = orderTone(order.status)
  const customer = order.customer
  const initial = (customer?.store_name ?? "?")
    .replace(/^(Tạp hoá|Tạp hóa|Siêu thị|Đại lý|Bách Hoá|Bách hóa|Cửa hàng) /i, "")
    .trim()
    .charAt(0)
    .toUpperCase()
  const customerSub = [
    customer?.owner_name,
    customer?.phone,
  ]
    .filter(Boolean)
    .join(" · ")
  const creditLine = customer?.credit_limit
    ? `Hạn mức ${formatCurrency(Number(customer.credit_limit))}${customer.group?.name ? ` · ${customer.group.name}` : ""}`
    : customer?.group?.name ?? null

  const termsLabel =
    PAYMENT_TERMS.find((t) => t.value === order.payment_terms)?.label ?? order.payment_terms ?? "—"
  const timeline = buildOrderTimeline(order, statusHistory)
  const discount = Number(order.discount || 0)
  const debtLeft = receivable ? Math.max(0, Number(receivable.amount) - Number(receivable.paid)) : null

  return (
    <div className="-mx-4 -mt-4 flex flex-col bg-surface">
      {/* Đầu trang riêng — app bar chuẩn đã ẩn trên điện thoại cho route này
          (xem `hidesMobileAppBar`). */}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold">{order.order_code}</h1>
        <span
          className="mr-2 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {tone.label}
        </span>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        {callout}

        {/* Khách */}
        <Card className="flex items-center gap-3 p-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e3edfb] text-[15px] font-extrabold text-[#1d4ed8]">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-extrabold text-on-surface">
              {customer?.store_name || "Khách lẻ"}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
              {customerSub || "—"}
            </span>
            {creditLine && (
              <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
                {creditLine}
              </span>
            )}
          </span>
          {/* ⚠ Nút gọi: khách đứng ở đầu kia điện thoại là chuyện thường
              khi mở đơn ra xem. */}
          {customer?.phone ? (
            <a
              href={`tel:${customer.phone}`}
              aria-label={`Gọi ${customer.store_name || "khách"}`}
              className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-container text-primary"
            >
              <Phone className="h-[18px] w-[18px]" />
            </a>
          ) : null}
        </Card>

        {/* Dòng hàng + tổng */}
        <Card className="overflow-hidden">
          <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            {lines.length} mặt hàng
          </div>
          {lines.length === 0 && (
            <p className="border-t border-outline-variant/30 px-3.5 py-5 text-center text-sm font-semibold text-on-surface-variant">
              Chưa có sản phẩm
            </p>
          )}
          {lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start gap-2.5 border-t border-outline-variant/30 px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-snug text-on-surface">
                  {/* "-" khiến người dùng tưởng giao diện hỏng. Sản phẩm bị
                      xoá khỏi danh mục sau khi lên đơn là chuyện có thật. */}
                  {line.product?.name || (
                    <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                  {line.quantity} {line.unit_name} × {formatCurrency(line.unit_price)}
                  {line.note ? (
                    <>
                      {" "}
                      · <i>“{line.note}”</i>
                    </>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-sm font-extrabold tabular-data text-on-surface">
                {formatCurrency(line.line_total)}
              </span>
            </div>
          ))}
          <div className="grid gap-1.5 border-t border-outline-variant/30 px-3.5 py-3 text-[13px] font-semibold text-on-surface-variant">
            <Row label="Tạm tính" value={formatCurrency(order.subtotal)} />
            {discount > 0 && <Row label="Chiết khấu" value={`−${formatCurrency(discount)}`} />}
            <Row label="VAT" value={formatCurrency(order.vat)} />
            <div className="flex items-baseline justify-between border-t border-outline-variant/30 pt-1.5 text-sm font-extrabold text-on-surface">
              <span>Tổng tiền</span>
              <span className="text-xl tabular-data">{formatCurrency(order.total)}</span>
            </div>
          </div>
        </Card>

        {/* Thông tin đơn */}
        <Card className="grid px-3.5 py-1">
          <InfoRow label="Ngày đặt" value={formatDate(order.order_date)} />
          <InfoRow label="Thanh toán" value={termsLabel} />
          <InfoRow
            label="Ngày giao"
            value={order.expected_delivery ? formatDate(order.expected_delivery) : "Chưa hẹn"}
          />
          {showSalesName && <InfoRow label="NVBH" value={order.sales_user?.full_name ?? "—"} />}
          <InfoRow label="Ghi chú" value={order.notes || "—"} last />
        </Card>

        {/* Dòng thời gian */}
        <Card className="px-3.5 py-2">
          {timeline.map((t, i) => {
            const last = i === timeline.length - 1
            const dot = t.error ? "#b00020" : t.done ? "#2563eb" : "#fff"
            const ring = t.error ? "#b00020" : t.done ? "#2563eb" : "#dadde5"
            const line = last ? "transparent" : t.done && timeline[i + 1]?.done ? "#2563eb" : "#e5e8ee"
            return (
              <div
                key={t.key}
                className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2.5"
              >
                <span className="grid h-full justify-items-center">
                  <span
                    className="mt-1.5 h-3 w-3 rounded-full border-2"
                    style={{ background: dot, borderColor: ring }}
                  />
                  <span className="block min-h-5 w-0.5 flex-1" style={{ background: line }} />
                </span>
                <span className="pb-2.5 pt-[3px]">
                  <span
                    className={cn(
                      "block text-sm",
                      t.error
                        ? "font-extrabold text-error"
                        : t.current
                          ? "font-extrabold text-on-surface"
                          : t.done
                            ? "font-bold text-on-surface"
                            : "font-semibold text-on-surface-variant/70"
                    )}
                  >
                    {t.label}
                  </span>
                  {t.by && (
                    <span className="block text-xs font-semibold text-on-surface-variant">{t.by}</span>
                  )}
                </span>
                <span className="pt-1 text-xs font-semibold tabular-data text-on-surface-variant">
                  {t.at ? `${formatDate(t.at)} ${vnTime(t.at)}` : ""}
                </span>
              </div>
            )
          })}
        </Card>

        {/* Xem thêm — chỉ hiện hàng nào CÓ chuyện để xem. */}
        {(order.status === "completed" ||
          deliveryLines.length > 0 ||
          linkedReturns.length > 0 ||
          activityLog.length > 0) && (
          <Card className="grid px-3.5 py-1">
            {order.status === "completed" && (
              <LinkRow
                label="Công nợ"
                value={
                  receivableId
                    ? debtLeft != null && debtLeft > 0
                      ? `Còn nợ ${formatCurrency(debtLeft)}`
                      : "Đã thanh toán"
                    : "Chưa ghi nhận"
                }
                href={receivableId ? `/receivables/${receivableId}` : undefined}
                tone={debtLeft != null && debtLeft > 0 ? "warn" : undefined}
              />
            )}
            {order.status === "completed" && (
              <LinkRow
                label="Hoá đơn"
                value={
                  invoice
                    ? invoice.misa_status
                      ? (misaStatusBadge(invoice.misa_status)?.label ?? invoice.misa_status)
                      : invoice.misa_inv_no || invoice.invoice_number || "Đã tạo"
                    : "Chưa xuất"
                }
                href={invoice ? `/invoices/${invoice.id}` : undefined}
                tone={invoice?.misa_status === "error" ? "error" : undefined}
              />
            )}
            {deliveryLines.length > 0 && (
              <LinkRow
                label="Giao hàng"
                value={
                  deliveryLines[0].delivery?.driver?.full_name
                    ? `Tài xế ${deliveryLines[0].delivery.driver.full_name}`
                    : deliveryLines[0].delivery?.route_name || `${deliveryLines.length} chuyến`
                }
                href={deliveryLines[0].delivery ? `/deliveries/${deliveryLines[0].delivery.id}` : undefined}
              />
            )}
            {linkedReturns.map((r) => (
              <LinkRow
                key={r.id}
                label="Hàng trả kèm"
                /* ⚠ SO VỚI TRẠNG THÁI CỦA V2. Hai nhánh này từng so với
                   'pending' — một giá trị `chk_returns_status_v2` (mig 119)
                   không còn cho tồn tại và backfill đã đổi hết đi. Nghĩa là
                   phiếu trả nào cũng rơi vào nhánh sai: không nhãn, không
                   tô màu, và người đọc tưởng phiếu đã xong. */
                value={`${returnReasonLabel(r.reason)} · −${formatCurrency(Number(r.credit_note_amount || 0))}${
                  r.status === "submitted" ? " · chờ xử lý" : r.status === "draft" ? " · nháp" : ""
                }`}
                href={`/returns/${r.id}`}
                tone={r.status === "submitted" ? "warn" : undefined}
              />
            ))}
            {activityLog.length > 0 && (
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-on-surface-variant">
                  <span>Lịch sử sửa dòng</span>
                  <span className="flex items-center gap-1 font-bold text-on-surface">
                    {activityLog.length} lần
                    <ChevronRight className="h-4 w-4 text-on-surface-variant transition-transform group-open:rotate-90" />
                  </span>
                </summary>
                <ul className="grid gap-1.5 pb-2.5 text-xs font-semibold text-on-surface-variant">
                  {activityLog.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span>
                        {a.action === "add_line" ? "Thêm dòng" : a.action === "remove_line" ? "Xoá dòng" : "Sửa dòng"}
                        {a.actor?.full_name ? ` · ${a.actor.full_name}` : ""}
                      </span>
                      <span className="shrink-0 tabular-data">{formatDate(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl bg-surface-container-lowest shadow-card", className)}>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-data text-on-surface">{value}</span>
    </div>
  )
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 py-1.5 text-[13px] font-semibold text-on-surface-variant",
        !last && "border-b border-outline-variant/30"
      )}
    >
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap text-right font-bold text-on-surface">{value}</span>
    </div>
  )
}

function LinkRow({
  label,
  value,
  href,
  tone,
}: {
  label: string
  value: string
  href?: string
  tone?: "warn" | "error"
}) {
  const inner = (
    <>
      <span className="shrink-0">{label}</span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1 text-right font-bold",
          tone === "error" ? "text-error" : tone === "warn" ? "text-[#8a5a00]" : "text-on-surface"
        )}
      >
        <span className="truncate">{value}</span>
        {href && <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />}
      </span>
    </>
  )
  const cls =
    "flex min-h-11 items-center justify-between gap-3 border-b border-outline-variant/30 py-1.5 text-[13px] font-semibold text-on-surface-variant last:border-0"
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
