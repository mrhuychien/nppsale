"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, CheckCircle2, Eye, FileText } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { PaymentStatusBadge } from "@/components/ui/status-badge"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { orderTone, vnTime } from "@/lib/orders/status-tone"
import type { Invoice, SalesOrder } from "@/types"

/**
 * Bảng đơn hàng trên MÁY TÍNH — theo mẫu thiết kế "Đơn hàng".
 *
 * Cột: chọn · Mã đơn · Khách hàng (+ tuyến) · NV bán hàng (avatar chữ
 * cái) · Ngày đặt (+ giờ) · SL MH · Tổng tiền · Trạng thái (huy hiệu có
 * chấm màu, "Cần duyệt") · thao tác (Duyệt / xem).
 *
 * ⚠ SẮP XẾP Ở ĐÂY LÀ TRÊN TRANG ĐANG XEM (50 dòng), không phải trên toàn
 * bộ kết quả — máy chủ vẫn trả mới nhất trước. Nói rõ ở tiêu đề cột để
 * người dùng không tưởng "đơn to nhất tháng" nằm đầu bảng.
 */
export type OrderSortKey = "customer" | "date" | "total"
export interface OrderSort {
  key: OrderSortKey
  dir: "asc" | "desc"
}

export type OrderColumn = "customer" | "salesUser" | "date" | "total" | "status"

const REP_COLORS = ["#2563eb", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#0369a1"]

/** Chữ cái đầu của hai từ cuối ("Nguyễn Thị Hòa" → "TH"); màu ổn định theo tên. */
export function repAvatar(name: string | null | undefined): { initials: string; color: string } {
  const n = (name ?? "").trim()
  if (!n) return { initials: "?", color: "#8a8f9c" }
  const parts = n.split(/\s+/)
  const initials = parts
    .slice(-2)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase()
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
  return { initials, color: REP_COLORS[h % REP_COLORS.length] }
}

export function DesktopOrderTable({
  orders,
  routeNameByCode,
  lineCountByOrder,
  receivablesByOrder,
  invoiceMap,
  show,
  selectedIds,
  allSelected,
  someSelected,
  onToggleAll,
  onToggleOne,
  activeId,
  onOpen,
  canApprove,
  approvingId,
  onApprove,
  misaLoadingId,
  onInvoice,
  sort,
  onSort,
}: {
  orders: SalesOrder[]
  routeNameByCode: Record<string, string>
  /** Số mặt hàng của từng đơn — `undefined` = chưa đếm xong, hiện "…". */
  lineCountByOrder: Record<string, number>
  receivablesByOrder: Record<string, { amount: number; paid: number; status: string; due_date?: string | null }>
  invoiceMap: Record<string, Invoice>
  show: (col: OrderColumn) => boolean
  selectedIds: Set<string>
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
  onToggleOne: (id: string) => void
  /** Đơn đang mở ở ngăn chi tiết — tô nền để biết đang xem dòng nào. */
  activeId: string | null
  onOpen: (order: SalesOrder) => void
  canApprove: boolean
  approvingId: string | null
  onApprove: (order: SalesOrder) => void
  misaLoadingId: string | null
  onInvoice: (order: SalesOrder) => void
  sort: OrderSort | null
  onSort: (key: OrderSortKey) => void
}) {
  const rows = useMemo(() => {
    if (!sort) return orders
    const dir = sort.dir === "asc" ? 1 : -1
    return [...orders].sort((a, b) => {
      if (sort.key === "customer") {
        return dir * (a.customer?.store_name ?? "").localeCompare(b.customer?.store_name ?? "", "vi")
      }
      if (sort.key === "total") return dir * (Number(a.total) - Number(b.total))
      return dir * (a.created_at ?? a.order_date).localeCompare(b.created_at ?? b.order_date)
    })
  }, [orders, sort])

  const SortIcon = ({ k }: { k: OrderSortKey }) =>
    sort?.key === k ? (
      sort.dir === "asc" ? (
        <ArrowUp className="ml-1 inline h-3 w-3" />
      ) : (
        <ArrowDown className="ml-1 inline h-3 w-3" />
      )
    ) : null

  const cols = [
    "44px",
    "170px",
    show("customer") ? "minmax(200px,1.5fr)" : null,
    show("salesUser") ? "170px" : null,
    show("date") ? "110px" : null,
    "70px",
    show("total") ? "140px" : null,
    show("status") ? "160px" : null,
    "64px",
  ]
    .filter(Boolean)
    .join(" ")

  const head =
    "flex items-center px-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant"
  const sortBtn = cn(head, "h-full w-full text-left hover:text-on-surface")

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1040px]">
        <div
          className="grid h-[42px] items-center border-b border-outline-variant/40 bg-surface-container-low px-2"
          style={{ gridTemplateColumns: cols }}
        >
          <span className="grid place-items-center">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={onToggleAll}
              aria-label="Chọn tất cả"
            />
          </span>
          <span className={head}>Mã đơn</span>
          {show("customer") && (
            <button type="button" onClick={() => onSort("customer")} className={sortBtn}>
              Khách hàng <SortIcon k="customer" />
            </button>
          )}
          {show("salesUser") && <span className={head}>NV bán hàng</span>}
          {show("date") && (
            <button type="button" onClick={() => onSort("date")} className={sortBtn}>
              Ngày đặt <SortIcon k="date" />
            </button>
          )}
          <span className={cn(head, "justify-end")}>SL MH</span>
          {show("total") && (
            <button type="button" onClick={() => onSort("total")} className={cn(sortBtn, "justify-end")}>
              Tổng tiền <SortIcon k="total" />
            </button>
          )}
          {show("status") && <span className={head}>Trạng thái</span>}
          <span />
        </div>

        {rows.length === 0 && (
          <p className="px-6 py-12 text-center text-sm font-semibold text-on-surface-variant">
            Không có đơn phù hợp bộ lọc.
          </p>
        )}

        {rows.map((o) => {
          const checked = selectedIds.has(o.id)
          const tone = orderTone(o.status)
          const pending = o.status === "submitted"
          const rep = repAvatar(o.sales_user?.full_name)
          const route = o.customer?.channel ? (routeNameByCode[o.customer.channel] ?? o.customer.channel) : null
          const lines = lineCountByOrder[o.id]
          const invoice = invoiceMap[o.id]
          return (
            <div
              key={o.id}
              role="row"
              onClick={() => onOpen(o)}
              className={cn(
                "grid min-h-[52px] cursor-pointer items-center border-b border-outline-variant/30 px-2 transition-colors hover:bg-surface-container-low",
                checked ? "bg-primary/5" : activeId === o.id ? "bg-surface-container-low" : "bg-transparent"
              )}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="grid h-full place-items-center" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggleOne(o.id)}
                  aria-label={`Chọn ${o.order_code}`}
                />
              </span>
              <span className="px-2">
                <Link
                  href={`/orders/${o.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="whitespace-nowrap text-[13px] font-extrabold tabular-data text-primary hover:underline"
                >
                  {o.order_code}
                </Link>
              </span>
              {show("customer") && (
                <span className="min-w-0 px-2">
                  <span className="block truncate text-sm font-bold text-on-surface">
                    {o.customer?.store_name || "Khách lẻ"}
                  </span>
                  {route && (
                    <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">{route}</span>
                  )}
                </span>
              )}
              {show("salesUser") && (
                <span className="flex min-w-0 items-center gap-2 px-2 text-[13px] font-semibold text-on-surface">
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold text-white"
                    style={{ background: rep.color }}
                  >
                    {rep.initials}
                  </span>
                  <span className="truncate">{o.sales_user?.full_name || "—"}</span>
                </span>
              )}
              {show("date") && (
                <span className="px-2 text-[13px] font-semibold tabular-data text-on-surface">
                  <span className="block">{formatDate(o.order_date)}</span>
                  {o.created_at && (
                    <span className="block text-xs text-on-surface-variant">{vnTime(o.created_at)}</span>
                  )}
                </span>
              )}
              <span className="px-2 text-right text-[13px] font-semibold tabular-data text-on-surface">
                {lines == null ? "…" : lines}
              </span>
              {show("total") && (
                <span className="px-2 text-right text-sm font-extrabold tabular-data text-on-surface">
                  {formatCurrency(o.total)}
                </span>
              )}
              {show("status") && (
                <span className="flex flex-wrap items-center gap-1.5 px-2">
                  <span
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-extrabold"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
                    {tone.label}
                  </span>
                  <PaymentStatusBadge receivable={receivablesByOrder[o.id]} />
                  {pending && (
                    <span
                      className="whitespace-nowrap text-[11px] font-extrabold text-error"
                      title={o.approval_reason ?? undefined}
                    >
                      Cần duyệt
                    </span>
                  )}
                </span>
              )}
              <span className="flex items-center justify-end gap-1 pr-1" onClick={(e) => e.stopPropagation()}>
                {pending && canApprove ? (
                  <button
                    type="button"
                    onClick={() => onApprove(o)}
                    disabled={approvingId === o.id}
                    title="Duyệt đơn"
                    className="h-[30px] rounded-lg bg-primary px-2.5 text-xs font-extrabold text-on-primary disabled:opacity-50"
                  >
                    {approvingId === o.id ? "…" : "Duyệt"}
                  </button>
                ) : (
                  <>
                    {o.status === "completed" &&
                      (invoice?.misa_status === "signed" ? (
                        <span
                          title="Đã xuất hoá đơn"
                          className="grid h-8 w-8 place-items-center rounded-lg bg-[#ecfdf3] text-[#027a48]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <button
                          type="button"
                          title="Xuất hoá đơn"
                          disabled={misaLoadingId === o.id}
                          onClick={() => onInvoice(o)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      ))}
                    <button
                      type="button"
                      aria-label="Xem"
                      onClick={() => onOpen(o)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container"
                    >
                      <Eye className="h-[18px] w-[18px]" />
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
