"use client"

import { useMemo } from "react"
import Link from "@/components/ui/link"
import { ArrowDown, ArrowUp, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { vnTime } from "@/lib/orders/status-tone"
import { repAvatar } from "@/components/orders/desktop-order-table"
import { INVOICE_STATUS_MAP } from "@/lib/constants"
import type { InvoiceColumnKey } from "@/app/(dashboard)/sales-invoices/list-config"

/**
 * Bảng HÓA ĐƠN BÁN trên MÁY TÍNH — cùng khuôn với `desktop-order-table`.
 *
 * ⚠ DÙNG LẠI `repAvatar` CỦA BẢNG ĐƠN, không chép sang. Hai màn đứng
 * cạnh nhau trong cùng một nhóm; avatar cùng một nhân viên mà ra hai màu
 * khác nhau thì người dùng tưởng là hai người.
 *
 * ⚠ SẮP XẾP Ở ĐÂY LÀ TRÊN TRANG ĐANG XEM (50 dòng), không phải trên toàn
 * bộ kết quả — y như bảng đơn. Máy chủ vẫn trả mới nhất trước.
 */
export type InvoiceSortKey = "customer" | "date" | "total"
export interface InvoiceSort {
  key: InvoiceSortKey
  dir: "asc" | "desc"
}

export interface InvoiceRow {
  id: string
  invoice_code: string
  invoice_date: string
  /**
   * ⚠ GIỜ GHI SỔ. `invoice_date` là cột kiểu `date` — không mang giờ, nên
   * cột "Ngày xuất" chỉ hiện được giờ khi đọc từ đây. Chủ nhà chốt: cột
   * Ngày phải hiện thêm giờ.
   */
  created_at?: string | null
  payment_terms?: string | null
  status: string
  /**
   * ⚠ SỐ TIỀN CÒN LẠI sau hàng trả (chủ nhà 25/09/2026: "HD 0403 thực chất số tiền
   * còn 2988500 (sau khi trừ hàng trả)", mig 192) — trang danh sách trừ sẵn.
   * `tong_hoa_don` giữ tổng trên tờ hóa đơn.
   */
  total: number
  tong_hoa_don?: number
  tra_hang?: number
  order_id: string
  replaced_from: string | null
  replaced_by: string | null
  customer?: {
    store_name?: string | null
    phone?: string | null
    channel?: string | null
    ward?: string | null
    address?: string | null
    district?: string | null
    province?: string | null
  } | null
  sales_user?: { full_name?: string | null } | null
  /** Khách của tờ — xem nhanh dùng cho nút Trả hàng / Thu tiền. */
  customer_id?: string | null
  /** Người xuất hóa đơn (`posted_by`). */
  creator?: { full_name?: string | null } | null
  order?: { order_code?: string | null } | null
}

export function DesktopInvoiceTable({
  invoices,
  routeNameByCode,
  show,
  activeId,
  onOpen,
  sort,
  onSort,
}: {
  invoices: InvoiceRow[]
  routeNameByCode: Record<string, string>
  show: (k: InvoiceColumnKey) => boolean
  /** Hóa đơn đang mở ở ngăn xem nhanh — tô nền để biết đang xem dòng nào. */
  activeId: string | null
  onOpen: (inv: InvoiceRow) => void
  sort: InvoiceSort | null
  onSort: (key: InvoiceSortKey) => void
}) {
  const rows = useMemo(() => {
    if (!sort) return invoices
    const dir = sort.dir === "asc" ? 1 : -1
    return [...invoices].sort((a, b) => {
      if (sort.key === "customer") {
        return dir * (a.customer?.store_name ?? "").localeCompare(b.customer?.store_name ?? "", "vi")
      }
      if (sort.key === "total") return dir * (Number(a.total) - Number(b.total))
      return dir * (a.invoice_date ?? "").localeCompare(b.invoice_date ?? "")
    })
  }, [invoices, sort])

  const SortIcon = ({ k }: { k: InvoiceSortKey }) =>
    sort?.key === k ? (
      sort.dir === "asc" ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />
    ) : null

  /**
   * ⚠ MỘT PHÉP DỰNG CỘT, DÙNG CHO CẢ TIÊU ĐỀ LẪN DÒNG. Chép ra hai chỗ
   * là một ngày nào đó bật một cột lên và tiêu đề lệch khỏi dữ liệu đúng
   * một ô — lỗi khó thấy nhất trong các lỗi dựng hình.
   */
  const cols = [
    "170px",
    show("customer") ? "minmax(200px,1.5fr)" : null,
    show("route") ? "140px" : null,
    show("ward") ? "150px" : null,
    show("address") ? "minmax(200px,1.5fr)" : null,
    show("salesUser") ? "170px" : null,
    show("createdBy") ? "150px" : null,
    show("date") ? "110px" : null,
    show("order") ? "140px" : null,
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
      <div className="min-w-[980px]">
        <div
          className="grid h-[42px] items-center border-b border-outline-variant/40 bg-surface-container-low px-2"
          style={{ gridTemplateColumns: cols }}
        >
          <span className={head}>Số hóa đơn</span>
          {show("customer") && (
            <button type="button" onClick={() => onSort("customer")} className={sortBtn}>
              Khách hàng <SortIcon k="customer" />
            </button>
          )}
          {show("route") && <span className={head}>Tuyến bán</span>}
          {show("ward") && <span className={head}>Phường</span>}
          {show("address") && <span className={head}>Địa chỉ</span>}
          {show("salesUser") && <span className={head}>Tính cho NV</span>}
          {show("createdBy") && <span className={head}>Người tạo</span>}
          {show("date") && (
            <button type="button" onClick={() => onSort("date")} className={sortBtn}>
              Ngày xuất <SortIcon k="date" />
            </button>
          )}
          {show("order") && <span className={head}>Đơn gốc</span>}
          {show("total") && (
            <button type="button" onClick={() => onSort("total")} className={cn(sortBtn, "justify-end")}>
              Tổng tiền <SortIcon k="total" />
            </button>
          )}
          {show("status") && <span className={head}>Trạng thái</span>}
          <span className={head} />
        </div>

        {rows.map((r) => {
          const route = r.customer?.channel
            ? (routeNameByCode[r.customer.channel] ?? r.customer.channel)
            : null
          const rep = repAvatar(r.sales_user?.full_name)
          return (
            <div
              key={r.id}
              role="row"
              onClick={() => onOpen(r)}
              className={cn(
                "grid min-h-[52px] cursor-pointer items-center border-b border-outline-variant/30 px-2 transition-colors hover:bg-surface-container-low",
                activeId === r.id ? "bg-surface-container-low" : "bg-transparent"
              )}
              style={{ gridTemplateColumns: cols }}
            >
              <span className="min-w-0 px-2">
                <Link
                  href={`/sales-invoices/${r.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="whitespace-nowrap text-[13px] font-extrabold tabular-data text-primary hover:underline"
                >
                  {r.invoice_code}
                </Link>
                {/*
                  ⚠ NÓI RA KHI HÓA ĐƠN LÀ BẢN LẬP LẠI. Không có dấu này thì
                    một hóa đơn đã huỷ nằm cạnh một hóa đơn gần như y hệt,
                    và người tra sổ không biết cái nào thay cái nào.
                */}
                {r.replaced_from && <Badge variant="secondary" className="ml-1.5">Lập lại</Badge>}
                {r.replaced_by && <Badge variant="outline" className="ml-1.5">Đã bị thay</Badge>}
              </span>
              {show("customer") && (
                <span className="min-w-0 px-2">
                  <span className="block truncate text-sm font-bold text-on-surface">
                    {r.customer?.store_name || "Khách lẻ"}
                  </span>
                  {/* ⚠ KHÔNG IN TUYẾN HAI LẦN khi cột Tuyến bán đang bật. */}
                  {route && !show("route") && (
                    <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">{route}</span>
                  )}
                </span>
              )}
              {show("route") && (
                <span className="min-w-0 px-2 text-[13px] font-semibold text-on-surface">
                  <span className="block truncate">{route || "—"}</span>
                </span>
              )}
              {show("ward") && (
                <span className="min-w-0 px-2 text-[13px] text-on-surface-variant">
                  <span className="block truncate">{r.customer?.ward || "—"}</span>
                </span>
              )}
              {show("address") && (
                <span className="min-w-0 px-2 text-[13px] text-on-surface-variant">
                  {/* ⚠ CHƯA CÓ ĐỊA CHỈ THÌ NÓI LÀ CHƯA CÓ — ô trống đọc như
                      một lỗi tải dữ liệu. */}
                  <span className="block truncate" title={r.customer?.address || undefined}>
                    {r.customer?.address || "—"}
                  </span>
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
                  <span className="truncate">{r.sales_user?.full_name || "—"}</span>
                </span>
              )}
              {show("createdBy") && (
                <span data-testid="nguoi-tao-dong" className="truncate px-2 text-[13px] text-on-surface-variant">
                  {r.creator?.full_name || "—"}
                </span>
              )}
              {show("date") && (
                <span className="px-2 text-[13px] font-semibold tabular-data text-on-surface">
                  {/* Cùng cách trình bày với bảng đơn hàng: ngày ở trên,
                      giờ nhỏ ở dưới — hai màn không được đọc khác nhau. */}
                  <span className="block">{formatDate(r.invoice_date)}</span>
                  {r.created_at && (
                    <span className="block text-xs text-on-surface-variant">{vnTime(r.created_at)}</span>
                  )}
                </span>
              )}
              {show("order") && (
                <span className="min-w-0 px-2" onClick={(e) => e.stopPropagation()}>
                  {/*
                    ⚠ CHẶN NỔI BỌT. Cả hàng đã mở ngăn xem nhanh; không chặn
                      thì bấm mã đơn là chạy cả hai lệnh và người dùng đáp
                      xuống đúng chỗ họ không chọn.
                  */}
                  <Link
                    href={`/orders/${r.order_id}`}
                    className="block truncate font-mono text-xs text-primary hover:underline"
                  >
                    {r.order?.order_code || "—"}
                  </Link>
                </span>
              )}
              {show("total") && (
                <span className="px-2 text-right text-[13px] font-extrabold tabular-data text-on-surface">
                  {formatCurrency(r.total)}
                  {(r.tra_hang ?? 0) > 0 && (
                    <span className="block text-[11px] font-medium text-muted-foreground">
                      HĐ {formatCurrency(r.tong_hoa_don ?? r.total)} · trả {formatCurrency(r.tra_hang ?? 0)}
                    </span>
                  )}
                </span>
              )}
              {show("status") && (
                <span className="px-2">
                  <Badge variant={INVOICE_STATUS_MAP[r.status]?.variant ?? "secondary"}>
                    {INVOICE_STATUS_MAP[r.status]?.label ?? r.status}
                  </Badge>
                </span>
              )}
              <span className="grid place-items-center">
                <Eye className="h-4 w-4 text-on-surface-variant" />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
