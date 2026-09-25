"use client"

/**
 * XEM NHANH PHIẾU TRẢ TỪ DANH SÁCH — cùng khuôn ngăn xem nhanh đơn / hóa đơn.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần xem nhanh Đơn hàng/Hóa đơn/Phiếu trả từ Danh
 *   sách, Khách hàng hiển thị đầy đủ thông tin địa chỉ và số điện thoại luôn".
 *   Danh sách phiếu trả trước nay bấm là sang thẳng màn chi tiết — mất bộ lọc.
 */

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { NewTabLink } from "@/components/ui/new-tab-link"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { RETURN_REASONS, RETURN_STATUS_MAP } from "@/lib/constants"
import { CustomerQuickInfo, type QuickCustomer } from "@/components/orders/customer-quick-info"
import { docMaPhieuTra, tenPhieuTra } from "@/lib/returns/ma-phieu"
import { laNhapTheoDon, laPhieuTuSinh } from "@/lib/returns/loai-phieu"

interface DrawerReturn {
  id: string
  status: string
  credit_with_invoice?: boolean | null
  invoice_id?: string | null
  order_id?: string | null
  return_code?: string | null
  created_at: string
  return_date?: string | null
  reason: string | null
  notes: string | null
  credit_note_amount: number | null
  customer?: QuickCustomer | null
  seller?: { full_name?: string | null } | null
  requester?: { full_name?: string | null } | null
  invoice?: { id?: string | null; invoice_code?: string | null } | null
  order?: { order_code?: string | null } | null
  lines?: Array<{
    id: string
    quantity: number
    unit_name: string
    unit_price: number
    line_total: number
    is_exchange: boolean | null
    note: string | null
    product?: { name?: string | null } | null
  }> | null
}

const COT =
  "id, status, created_at, reason, notes, credit_note_amount, credit_with_invoice, invoice_id, order_id, " +
  "customer:customers(store_name, phone, address, ward, district, province), " +
  "seller:users!returns_sales_user_id_fkey(full_name), requester:users!returns_requested_by_fkey(full_name), " +
  "invoice:sales_invoices(id, invoice_code), order:sales_orders(order_code), " +
  "lines:return_lines(id, quantity, unit_name, unit_price, line_total, is_exchange, note, product:products(name))"

const lyDo = (v: string | null) => RETURN_REASONS.find((r) => r.value === v)?.label || v || "—"

export function ReturnDrawer({ returnId, onClose }: { returnId: string | null; onClose: () => void }) {
  const [r, setR] = useState<DrawerReturn | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setR(null)
    setError(null)
    if (!returnId) return
    let huy = false
    ;(async () => {
      const sb = createClient()
      /* `return_date` (mig 188) đọc riêng — sổ chưa có cột thì không hỏng cả ngăn. */
      const [{ data, error: e }, ngay, ma] = await Promise.all([
        sb.from("returns").select(COT).eq("id", returnId).maybeSingle(),
        sb.from("returns").select("return_date").eq("id", returnId).maybeSingle(),
        docMaPhieuTra(sb, [returnId]),
      ])
      if (huy) return
      if (e) { setError(errorMessage(e)); return }
      if (!data) { setError("Không tìm thấy phiếu trả."); return }
      setR({
        ...((data as unknown) as DrawerReturn),
        return_date: ((ngay.data as unknown) as { return_date?: string | null } | null)?.return_date ?? null,
        return_code: ma.get(returnId) ?? null,
      })
    })()
    return () => { huy = true }
  }, [returnId])

  const st = r ? RETURN_STATUS_MAP[r.status] : null
  const tra = (r?.lines ?? []).filter((l) => !l.is_exchange)
  const doi = (r?.lines ?? []).filter((l) => l.is_exchange)
  /**
   * ⚠ NÚT SỬA THEO LOẠI PHIẾU (chủ nhà 25/09/2026): phiếu TỰ SINH → sửa HÓA ĐƠN (phiếu
   *   ăn theo hóa đơn, mig 191); phiếu TỰ LẬP → POS sửa phiếu. Hàng trả còn nằm trong
   *   ĐƠN chưa xuất → sửa đơn. Phiếu đã huỷ thì không sửa.
   */
  const suaHref = !r || r.status === "cancelled"
    ? null
    : laPhieuTuSinh(r)
      ? (r.invoice_id ? `/sales-invoices/${r.invoice_id}/edit` : null)
      : laNhapTheoDon(r)
        ? (r.order_id ? `/pos/don-hang/${r.order_id}` : null)
        : `/pos/tra-hang/${r.id}`

  return (
    <Sheet open={!!returnId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
        <div className="flex items-center gap-2.5 border-b border-outline-variant/40 py-4 pl-5 pr-14">
          <span className="min-w-0 flex-1">
            <SheetTitle className="block truncate font-mono text-lg font-extrabold text-on-surface">
              {r ? tenPhieuTra(r.return_code) : "Phiếu trả hàng"}
            </SheetTitle>
            <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
              {r ? formatDate(r.return_date || r.created_at) : "…"}
              {r?.lines ? ` · ${r.lines.length} mặt hàng` : ""}
            </span>
          </span>
          {st && <Badge variant={st.variant}>{st.label}</Badge>}
        </div>

        <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm font-semibold text-error">Không tải được phiếu trả — {error}</p>}
          {!error && !r && (
            <div className="grid gap-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <CustomerQuickInfo customer={r.customer} className="col-span-2" />
                <Cell label="Tính cho NV" main={r.seller?.full_name || "—"} sub={r.requester?.full_name ? `Tạo: ${r.requester.full_name}` : ""} />
                <Cell
                  label="Hóa đơn gốc"
                  main={r.invoice?.invoice_code || "—"}
                  sub={r.order?.order_code ? `Đơn ${r.order.order_code}` : ""}
                />
              </div>

              <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold text-on-surface-variant">
                Lý do: <span className="text-on-surface">{lyDo(r.reason)}</span>
              </div>

              {[{ ten: "Hàng trả", ds: tra }, { ten: "Hàng đổi", ds: doi }].map((k) =>
                k.ds.length === 0 ? null : (
                  <div key={k.ten} className="overflow-hidden rounded-xl border border-outline-variant/40">
                    <div className="bg-surface-container-low px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
                      {k.ten} · {k.ds.length}
                    </div>
                    {k.ds.map((l) => (
                      <div key={l.id} className="flex items-start gap-2.5 border-t border-outline-variant/30 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold leading-snug">
                            {l.product?.name || <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>}
                          </span>
                          <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                            {l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}
                          </span>
                          {l.note && <span className="mt-0.5 block text-xs italic text-on-surface-variant">{l.note}</span>}
                        </span>
                        <span className="shrink-0 text-[13px] font-extrabold tabular-data">{formatCurrency(l.line_total)}</span>
                      </div>
                    ))}
                  </div>
                )
              )}

              <div className="flex justify-between rounded-xl bg-surface-container-low px-3 py-3 text-sm font-extrabold">
                <span>Tiền trả cho khách</span>
                <span className="tabular-data">{formatCurrency(Number(r.credit_note_amount) || 0)}</span>
              </div>

              {r.notes && (
                <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant [overflow-wrap:anywhere]">
                  Ghi chú: <span className="whitespace-pre-wrap text-on-surface">{r.notes}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sang tab mới như ngăn hóa đơn — giữ bộ lọc của danh sách. */}
        {returnId && (
          <div className="flex gap-2 border-t border-outline-variant/40 px-5 pb-5 pt-3">
            <NewTabLink
              href={`/returns/${returnId}/print?auto=1`}
              className="h-11 flex-1 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest text-sm font-extrabold text-on-surface"
            >
              In
            </NewTabLink>
            {suaHref && (
              <NewTabLink
                href={suaHref}
                className="h-11 flex-1 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest text-sm font-extrabold text-on-surface"
              >
                {r && laPhieuTuSinh(r) ? "Sửa hóa đơn" : "Sửa"}
              </NewTabLink>
            )}
            <NewTabLink
              href={`/returns/${returnId}`}
              className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary"
            >
              Chi tiết
            </NewTabLink>
          </div>
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
