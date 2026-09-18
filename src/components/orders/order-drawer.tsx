"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { orderTone, vnTime } from "@/lib/orders/status-tone"
import { isSellEditable } from "@/lib/sell/order-edit"
import { errorMessage } from "@/lib/errors"
import type { SalesOrder } from "@/types"

/**
 * Ngăn chi tiết đơn bên phải trên MÁY TÍNH — theo mẫu thiết kế "Đơn hàng".
 *
 * Chạm một dòng là ngăn trượt ra: mã · ngày giờ · số mặt hàng, huy hiệu,
 * hai ô Khách hàng / NV bán hàng, danh sách dòng hàng + tổng, lý do chờ
 * cảnh báo, và ba nút Xuất hàng / Sửa / Chi tiết. Nhà phân phối không
 * phải rời danh sách để xem đơn có gì trước khi cho hàng ra kho.
 *
 * ⚠ Dòng hàng tải khi mở — danh sách 50 đơn không kéo 50 bộ dòng về sẵn.
 * Tải hỏng thì NÓI RA trong ngăn, không hiện "0 mặt hàng".
 *
 * ⚠ Tổng lấy từ ĐƠN ĐÃ LƯU, không cộng lại từ dòng.
 */
interface DrawerLine {
  id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_total: number
  note: string | null
  product: { name: string } | null
}

export function OrderDrawer({
  order,
  routeName,
  onClose,
  canApprove,
  canEdit,
  approving,
  onApprove,
}: {
  order: SalesOrder | null
  routeName: string | null
  onClose: () => void
  canApprove: boolean
  canEdit: boolean
  approving: boolean
  onApprove: (order: SalesOrder) => void
}) {
  const router = useRouter()
  const [lines, setLines] = useState<DrawerLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const orderId = order?.id ?? null
  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    setLines(null)
    setError(null)
    ;(async () => {
      const { data, error } = await createClient()
        .from("sales_order_lines")
        .select("id, quantity, unit_name, unit_price, line_total, note, product:products(name)")
        .eq("order_id", orderId)
        .order("product_id", { ascending: true })
      if (cancelled) return
      if (error) {
        setError(errorMessage(error))
        return
      }
      setLines(((data as unknown) as DrawerLine[]) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  const tone = order ? orderTone(order.status) : null
  const pending = !!order && order.status === "submitted"
  const terms = order
    ? (PAYMENT_TERMS.find((t) => t.value === order.payment_terms)?.label ?? order.payment_terms ?? "—")
    : ""
  const discount = Number(order?.discount || 0)

  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
        {order && tone && (
          <>
            <div className="flex items-center gap-2.5 border-b border-outline-variant/40 py-4 pl-5 pr-14">
              <span className="min-w-0 flex-1">
                <SheetTitle className="block truncate text-lg font-extrabold text-on-surface">
                  {order.order_code}
                </SheetTitle>
                <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                  {formatDate(order.order_date)}
                  {order.created_at ? ` · ${vnTime(order.created_at)}` : ""}
                  {lines ? ` · ${lines.length} mặt hàng` : ""}
                </span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold"
                style={{ background: tone.bg, color: tone.fg }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.accent }} />
                {tone.label}
              </span>
            </div>

            <div className="grid flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2.5">
                <Cell label="Khách hàng" main={order.customer?.store_name || "Khách lẻ"} sub={routeName ?? order.customer?.phone ?? ""} />
                <Cell label="NV bán hàng" main={order.sales_user?.full_name || "—"} sub={terms} />
              </div>

              <div className="overflow-hidden rounded-xl border border-outline-variant/40">
                <div className="bg-surface-container-low px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
                  {lines ? `${lines.length} mặt hàng` : "Mặt hàng"}
                </div>
                {error && (
                  <p className="border-t border-outline-variant/30 px-3 py-3 text-sm font-semibold text-error">
                    Không tải được dòng hàng — {error}
                  </p>
                )}
                {!error && !lines && (
                  <div className="grid gap-2 p-3">
                    <Skeleton className="h-10" />
                    <Skeleton className="h-10" />
                  </div>
                )}
                {lines?.map((l) => (
                  <div key={l.id} className="flex items-start gap-2.5 border-t border-outline-variant/30 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold leading-snug">
                        {l.product?.name || <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold tabular-data text-on-surface-variant">
                        {l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}
                        {l.note ? ` · “${l.note}”` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-extrabold tabular-data">{formatCurrency(l.line_total)}</span>
                  </div>
                ))}
                <div className="grid gap-1.5 border-t border-outline-variant/30 px-3 py-3 text-[13px] font-semibold text-on-surface-variant">
                  <Row label="Tạm tính" value={formatCurrency(order.subtotal)} />
                  {discount > 0 && <Row label="Chiết khấu" value={`−${formatCurrency(discount)}`} />}
                  <Row label="VAT" value={formatCurrency(order.vat)} />
                  <div className="flex items-baseline justify-between border-t border-outline-variant/30 pt-1.5 text-sm font-extrabold text-on-surface">
                    <span>Tổng tiền</span>
                    <span className="text-xl tabular-data">{formatCurrency(order.total)}</span>
                  </div>
                </div>
              </div>

              {/* ⚠ Gác bằng CẢ NỘI DUNG, không chỉ trạng thái. Đơn sạch
                  có `approval_reason` là chuỗi RỖNG (xem `decideStatus`), nên
                  gác bằng mỗi `pending` sẽ vẽ ra một hộp hổ phách trống. */}
              {pending && !!order.approval_reason?.trim() && (
                <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
                  {order.approval_reason}
                </div>
              )}
              {order.notes && (
                <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant">
                  Ghi chú: <span className="text-on-surface">{order.notes}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t border-outline-variant/40 px-5 pb-5 pt-3">
              {pending && canApprove && (
                <button
                  type="button"
                  onClick={() => onApprove(order)}
                  disabled={approving}
                  className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary disabled:opacity-50"
                >
                  {approving ? "Đang xuất hàng…" : "Xuất hàng"}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(isSellEditable(order.status) ? `/sell/edit/${order.id}` : `/orders/${order.id}`)
                  }
                  className="h-11 flex-1 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest text-sm font-extrabold text-on-surface"
                >
                  Sửa đơn
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push(`/orders/${order.id}`)}
                className="h-11 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest px-4 text-sm font-extrabold text-on-surface"
              >
                Chi tiết
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Cell({ label, main, sub }: { label: string; main: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-3">
      <span className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">{label}</span>
      <span className="mt-1 block truncate text-sm font-extrabold text-on-surface">{main}</span>
      {sub && <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">{sub}</span>}
    </div>
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
