"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/hooks/use-toast"
import { cancelInvoice } from "@/lib/orders/post-invoice"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { NewTabLink } from "@/components/ui/new-tab-link"
import { formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { INVOICE_STATUS_MAP } from "@/lib/constants"
import {
  ReturnSummary,
  RETURN_SUMMARY_SELECT,
  type ReturnSummaryRow,
} from "@/components/orders/return-summary"
import { InvoiceMoneySummary } from "@/components/orders/invoice-money-summary"
import { noteBlocksOf } from "@/components/printing/sales-invoice"
import type { InvoiceRow } from "@/components/sales-invoices/desktop-invoice-table"

/**
 * Ngăn XEM NHANH hóa đơn bán — cùng khuôn với `order-drawer`.
 *
 * Chạm một dòng là ngăn trượt ra: số hóa đơn · ngày · số mặt hàng, huy
 * hiệu trạng thái, hai ô Khách hàng / NV bán hàng, danh sách dòng hàng +
 * tổng, và ba nút Sửa / In / Chi tiết.
 *
 * ⚠ DÒNG HÀNG TẢI KHI MỞ — danh sách 50 hóa đơn không kéo 50 bộ dòng về
 * sẵn. Tải hỏng thì NÓI RA trong ngăn, không hiện "0 mặt hàng": số 0 cho
 * một lỗi mạng đọc như một hóa đơn rỗng, và đó là một câu nói dối.
 *
 * ⚠ TỔNG LẤY TỪ HÓA ĐƠN ĐÃ LƯU, không cộng lại từ dòng. Cộng lại ở đây
 * là dựng một phép tính thứ hai cạnh phép tính của RPC — hai phép thì sẽ
 * có ngày lệch, và con số trên màn không còn là con số trong sổ.
 */
interface DrawerLine {
  id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_total: number
  is_exchange: boolean
  note: string | null
  product: { name: string } | null
}

export function InvoiceDrawer({
  invoice,
  routeName,
  canEdit,
  onClose,
  onChanged,
}: {
  invoice: InvoiceRow | null
  routeName: string | null
  canEdit: boolean
  onClose: () => void
  /** Huỷ xong thì danh sách phải đọc lại — trạng thái và tổng tiền đều đổi. */
  onChanged?: () => void
}) {
  const [lines, setLines] = useState<DrawerLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])
  /**
   * Ghi chú chung — của ĐƠN và của HÓA ĐƠN (chủ nhà chốt 20/09/2026).
   *
   * ⚠ ĐỌC KHI MỞ, KHÔNG KÉO SẴN TRONG DANH SÁCH. Cùng lý do với dòng
   * hàng: danh sách 50 hóa đơn không cần mang theo 50 đoạn chữ, và ghi
   * chú của ĐƠN còn phải nhúng thêm một bảng nữa.
   *
   * ⚠ GHI CHÚ CỦA ĐƠN NẰM Ở `sales_orders.notes`, KHÔNG được chép sang
   * hóa đơn lúc xuất — `post_invoice` chỉ lưu câu người dùng gõ ở màn
   * Xuất hàng. Đọc thẳng từ đơn thì mọi hóa đơn CŨ cũng hiện ra.
   */
  const [notes, setNotes] = useState<{ label: string; text: string }[]>([])
  /**
   * Tiền hàng + thuế của tờ hóa đơn.
   *
   * ⚠ ĐI NHỜ ĐÚNG LƯỢT ĐỌC ĐANG CÓ, không mở thêm một lượt nữa và cũng
   *   không bắt danh sách 50 hóa đơn kéo thêm hai cột. Lượt ấy vốn đọc
   *   ghi chú, nên chỉ thêm hai tên cột vào `select`.
   *
   * ⚠ `null` LÀ "CHƯA ĐỌC ĐƯỢC", và khi đó hai dòng ấy KHÔNG vẽ. Điền 0
   *   cho một lỗi mạng đọc như một hóa đơn không thuế. Phần còn lại của
   *   khối vẫn đúng vì nó chỉ cần `total` — số đã có sẵn từ danh sách.
   */
  const [tien, setTien] = useState<{ subtotal: number; vat: number } | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)

  const invoiceId = invoice?.id ?? null
  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false
    setLines(null)
    setError(null)
    setReturns([])
    setNotes([])
    setTien(null)
    ;(async () => {
      const supabase = createClient()

      /**
       * Hàng đổi / trả của hóa đơn này.
       *
       * ⚠ HỎI THEO `invoice_id`, KHÔNG THEO `order_id`. Một đơn nay có thể
       *   có nhiều hóa đơn; hỏi theo đơn là tờ hóa đơn này hiện cả hàng
       *   trả của tờ khác, và người đọc trừ nhầm công nợ.
       *
       * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN — phần phụ của màn xem nhanh.
       */
      supabase
        .from("returns")
        .select(RETURN_SUMMARY_SELECT)
        .eq("invoice_id", invoiceId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .then(({ data: retData }) => {
          if (cancelled) return
          setReturns(((retData as unknown) as ReturnSummaryRow[]) ?? [])
        })

      /**
       * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN — phần phụ của màn xem nhanh, và
       *   dòng hàng mới là thứ người ta mở ngăn ra để xem.
       */
      supabase
        .from("sales_invoices")
        .select("subtotal, vat, notes, order:sales_orders(notes)")
        .eq("id", invoiceId)
        .maybeSingle()
        .then(({ data: nRow }) => {
          if (cancelled || !nRow) return
          const r = (nRow as unknown) as {
            subtotal?: number | null
            vat?: number | null
            notes?: string | null
            order?: { notes?: string | null } | null
          }
          if (r.subtotal != null && r.vat != null) {
            setTien({ subtotal: Number(r.subtotal), vat: Number(r.vat) })
          }
          setNotes(
            noteBlocksOf([
              { label: "Ghi chú đơn hàng", text: r.order?.notes },
              { label: "Ghi chú hóa đơn", text: r.notes },
            ])
          )
        })

      const { data, error } = await supabase
        .from("sales_invoice_lines")
        .select("id, quantity, unit_name, unit_price, line_total, is_exchange, note, product:products(name)")
        .eq("invoice_id", invoiceId)
        .order("sort_order", { ascending: true })
      if (cancelled) return
      if (error) {
        setError(errorMessage(error))
        return
      }
      setLines(((data as unknown) as DrawerLine[]) ?? [])
    })()
    return () => { cancelled = true }
  }, [invoiceId])

  const posted = invoice?.status === "posted"

  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      {/*
        ⚠ `w-full max-w-[460px]`, KHÔNG PHẢI `w-[460px]`. Bề ngang cứng
          460px rộng hơn màn hình 375px của điện thoại, nên ngăn kéo tự nó
          tràn ra ngoài mép phải — và chỉ lộ ra khi bên trong có nội dung
          rộng (hàng đổi/trả) đẩy cho thấy.
      */}
      <SheetContent side="right" className="flex w-full max-w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
        {invoice && (
          <>
            <div className="flex items-center gap-2.5 border-b border-outline-variant/40 py-4 pl-5 pr-14">
              <span className="min-w-0 flex-1">
                <SheetTitle className="block truncate text-lg font-extrabold text-on-surface">
                  {invoice.invoice_code}
                </SheetTitle>
                <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                  {formatDate(invoice.invoice_date)}
                  {lines ? ` · ${lines.length} mặt hàng` : ""}
                </span>
              </span>
              <Badge variant={INVOICE_STATUS_MAP[invoice.status]?.variant ?? "secondary"}>
                {INVOICE_STATUS_MAP[invoice.status]?.label ?? invoice.status}
              </Badge>
            </div>

            {/*
              ⚠ `min-h-0` LÀ BẮT BUỘC, KHÔNG PHẢI TRANG TRÍ. Đây là con của
                một flex cột; flex item mặc định `min-height: auto`, tức là
                KHÔNG co xuống dưới chiều cao nội dung. Thiếu nó thì
                `overflow-y-auto` không bao giờ chạy: khối này phình theo nội
                dung và đẩy hàng nút dưới đáy ra ngoài ngăn kéo.

                Vì thế lỗi chỉ lộ ra KHI NỘI DUNG ĐỦ DÀI — ví dụ đơn có thêm
                khối hàng đổi/trả — nên nhìn như lỗi của khối hàng trả.

              ⚠ `min-w-0` cùng lý do cho chiều ngang: ô lưới mặc định không
                co dưới min-content, nên một dòng dài bên trong đẩy ngang cả
                ngăn kéo thay vì bị cắt.
            */}
            <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2.5">
                <Cell
                  label="Khách hàng"
                  main={invoice.customer?.store_name || "Khách lẻ"}
                  sub={routeName ?? invoice.customer?.phone ?? ""}
                />
                <Cell
                  label="NV bán hàng"
                  main={invoice.sales_user?.full_name || "—"}
                  sub={invoice.order?.order_code ?? ""}
                />
              </div>

              {invoice.customer?.address && (
                <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant">
                  Địa chỉ: <span className="text-on-surface">{invoice.customer.address}</span>
                </div>
              )}

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
                        {l.product?.name || (
                          <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>
                        )}
                        {l.is_exchange && <Badge variant="secondary" className="ml-1.5">Hàng đổi</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                        {l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}
                      </span>
                      {l.note && (
                        <span className="mt-0.5 block text-xs italic text-on-surface-variant">{l.note}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[13px] font-extrabold tabular-data">
                      {formatCurrency(l.line_total)}
                    </span>
                  </div>
                ))}
                {/*
                  ⚠ CÙNG MỘT KHỐI VỚI MÀN CHI TIẾT (chủ nhà chốt
                    21/09/2026: "Xem nhanh bên ngoài cũng phải hiện chi
                    tiết thế này chứ"). Trước đây chỗ này chỉ có một dòng
                    "Tổng tiền": người mở ngăn nhìn 1.000.000 trong khi
                    khối hàng trả ngay dưới nói −164.000, và không có
                    dòng nào trên màn nói số phải thu thật là 836.000.
                */}
                <div className="border-t border-outline-variant/30 px-3 py-3">
                  <InvoiceMoneySummary
                    invoice={{
                      total: invoice.total,
                      subtotal: tien?.subtotal ?? null,
                      vat: tien?.vat ?? null,
                    }}
                    returns={returns}
                  />
                </div>
              </div>

              {/*
                ⚠ HÓA ĐƠN LẬP LẠI / ĐÃ BỊ THAY PHẢI NÓI RA Ở ĐÂY NỮA. Người
                  mở ngăn xem nhanh không nhất thiết đã nhìn cái nhãn nhỏ
                  trên bảng, và "vì sao tờ này bị huỷ" là câu hỏi đầu tiên
                  họ có.
              */}
              <ReturnSummary returns={returns} />

              {/* ⚠ HAI GHI CHÚ LÀ HAI THỨ KHÁC NHAU, ghi rõ của ai: ghi
                  chú ĐƠN là lời người bán dặn lúc đặt hàng, ghi chú HÓA
                  ĐƠN là lời người xuất kho dặn lúc giao. `noteBlocksOf`
                  bỏ khối rỗng và gộp hai khối trùng chữ. */}
              {notes.map((n) => (
                <div
                  key={n.label}
                  className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant [overflow-wrap:anywhere]"
                >
                  {n.label}:{" "}
                  <span className="whitespace-pre-wrap text-on-surface">{n.text}</span>
                </div>
              ))}

              {invoice.replaced_by && (
                <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[12px] font-bold leading-snug text-[#7a4b00]">
                  Hóa đơn này đã bị một bản lập lại thay thế. Mở Chi tiết để sang bản mới.
                </div>
              )}
              {invoice.replaced_from && (
                <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[12px] font-bold leading-snug text-on-surface-variant">
                  Đây là bản lập lại của một hóa đơn đã huỷ.
                </div>
              )}
            </div>

            <div className="flex gap-2 border-t border-outline-variant/40 px-5 pb-5 pt-3">
              {/* ⚠ CHỈ HÓA ĐƠN ĐÃ XUẤT MỚI SỬA ĐƯỢC. Hiện nút trên một hóa
                  đơn đã huỷ là mời người ta đi vào một màn sẽ từ chối họ. */}
              {/* ⚠ BA NÚT NÀY SANG TAB MỚI (chủ nhà chốt 20/09/2026).
                  Kế toán lướt danh sách để đối chiếu; đi sang một màn
                  khác rồi bấm Back là mất bộ lọc và chỗ đang đứng, phải
                  cuộn lại từ đầu cho từng hóa đơn. Xem `NewTabLink`.
                  Riêng "In hóa đơn" còn một lý do nữa: màn in tự bật hộp
                  thoại in, đóng nó ở cùng tab là quay về một danh sách
                  vừa tải lại từ đầu. */}
              {canEdit && posted && (
                <NewTabLink
                  href={`/sales-invoices/${invoice.id}/edit`}
                  className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary"
                >
                  Sửa hóa đơn
                </NewTabLink>
              )}
              {/* ⚠ `?auto=1` — BẬT THẲNG CỬA SỔ IN (chủ nhà chốt
                  20/09/2026). Người bấm "In hóa đơn" đã nói rõ họ muốn
                  in; bắt bấm thêm một nút In nữa ở màn sau là tính thuế
                  lên mỗi tờ giấy. Màn in tự rời đi khi đóng hộp thoại —
                  xem `useLeaveAfterPrint`. */}
              <NewTabLink
                href={`/sales-invoices/${invoice.id}/print?auto=1`}
                className="h-11 flex-1 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest text-sm font-extrabold text-on-surface"
              >
                In hóa đơn
              </NewTabLink>
              {/* ⚠ HUỶ ĐI QUA RPC `cancel_invoice`, KHÔNG UPDATE THẲNG.
                  Huỷ một hóa đơn là hoàn hàng về ĐÚNG các lô đã lấy, xoá
                  công nợ và lùi trạng thái đơn — ba việc trong một giao
                  dịch. Một lệnh ghi trạng thái từ trình duyệt để kho
                  thiếu hàng mà sổ nói đã huỷ.
                  ⚠ KHÔNG tự mờ nút theo hóa đơn điện tử ở đây: ngăn xem
                  nhanh không đọc bảng `invoices`, và chốt chặn thật nằm
                  trong RPC (`LOCKED_EINVOICE`). Bấm vào sẽ nhận đúng câu
                  giải thích, không phải một thất bại im lặng. */}
              {canEdit && posted && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="h-11 shrink-0 rounded-xl border-[1.5px] border-error/40 bg-surface-container-lowest px-4 text-sm font-extrabold text-on-error-container"
                >
                  Huỷ đơn
                </button>
              )}
              <NewTabLink
                href={`/sales-invoices/${invoice.id}`}
                className="h-11 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest px-4 text-sm font-extrabold text-on-surface"
              >
                Chi tiết
              </NewTabLink>
            </div>
          </>
        )}
      </SheetContent>

      {invoice && (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={(o) => !cancelling && setCancelOpen(o)}
          title={`Huỷ hóa đơn ${invoice.invoice_code}?`}
          description="Hàng hoàn về đúng các lô đã lấy, công nợ của hóa đơn này bị xoá, và đơn quay lại trạng thái tương ứng. Không hoàn tác được."
          confirmLabel="Huỷ hóa đơn"
          variant="destructive"
          loading={cancelling}
          onConfirm={async () => {
            setCancelling(true)
            try {
              await cancelInvoice(createClient(), invoice.id, cancelReason.trim())
              toast({ title: `Đã huỷ hóa đơn ${invoice.invoice_code}` })
              setCancelOpen(false)
              setCancelReason("")
              onChanged?.()
              onClose()
            } catch (e) {
              toast({ title: "Không huỷ được", description: errorMessage(e), variant: "destructive" })
            } finally {
              setCancelling(false)
            }
          }}
        >
          <div>
            <Label htmlFor="drawer-cancel-reason" className="text-xs uppercase tracking-wider text-muted-foreground">
              Lý do (bắt buộc)
            </Label>
            <Textarea
              id="drawer-cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ví dụ: giao nhầm hàng, khách trả lại toàn bộ"
            />
          </div>
        </ConfirmDialog>
      )}
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
