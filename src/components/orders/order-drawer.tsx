"use client"

import { useEffect, useMemo, useState } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { TriangleAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { NewTabLink } from "@/components/ui/new-tab-link"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { stockMapFrom } from "@/lib/sell/ref-data"
import { useOrg } from "@/hooks/use-org"
import {
  previewOrderStock,
  totalShortBase,
  splitWarnings,
  type StockPreviewLine,
} from "@/lib/orders/order-stock-preview"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import {
  ReturnSummary,
  RETURN_SUMMARY_SELECT,
  type ReturnSummaryRow,
} from "@/components/orders/return-summary"
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
  product_id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_total: number
  note: string | null
  /**
   * ⚠ ẢNH CHỤP HỆ SỐ LÚC TẠO ĐƠN (migration 039) — đúng cột mà
   * `complete_order` dùng để quy ra đơn vị cơ sở. Tra danh mục thay cho
   * cột này là lệch với RPC ở những đơn có quy cách đóng gói đã đổi.
   */
  conversion_factor: number | null
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
  canCancel,
  cancelling,
  onCancel,
}: {
  order: SalesOrder | null
  routeName: string | null
  onClose: () => void
  canApprove: boolean
  canEdit: boolean
  approving: boolean
  onApprove: (order: SalesOrder) => void
  /** Vai có quyền huỷ đơn. Đơn ĐÃ XUẤT vẫn không huỷ ở đây — xem dưới. */
  canCancel: boolean
  cancelling: boolean
  onCancel: (order: SalesOrder) => void
}) {
  const { org } = useOrg()
  const [lines, setLines] = useState<DrawerLine[] | null>(null)
  const [stock, setStock] = useState<Record<string, number> | null>(null)
  const [stockError, setStockError] = useState<string | null>(null)
  const [exchangeLines, setExchangeLines] = useState<StockPreviewLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [returns, setReturns] = useState<ReturnSummaryRow[]>([])

  const orderId = order?.id ?? null
  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    setLines(null)
    setStock(null)
    setError(null)
    setStockError(null)
    setReturns([])
    ;(async () => {
      const supabase = createClient()

      /**
       * Hàng đổi / trả kèm đơn — chủ nhà muốn thấy ngay ở màn xem nhanh.
       *
       * ⚠ BỎ PHIẾU ĐÃ HUỶ. Phiếu huỷ không trừ gì và không phải làm gì với
       *   nó; để nó nằm đó là một dòng đỏ vô nghĩa ngay cạnh những dòng
       *   đang thật sự chờ xử lý.
       *
       * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN. Đây là phần phụ của màn xem nhanh;
       *   ném lỗi ở đây là đóng cả màn vì một khối bổ sung.
       */
      supabase
        .from("returns")
        .select(RETURN_SUMMARY_SELECT)
        .eq("order_id", orderId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .then(({ data: retData }) => {
          if (cancelled) return
          setReturns(((retData as unknown) as ReturnSummaryRow[]) ?? [])
        })

      const { data, error } = await supabase
        .from("sales_order_lines")
        .select(
          "id, product_id, quantity, unit_name, unit_price, line_total, note, conversion_factor, product:products(name)"
        )
        .eq("order_id", orderId)
        .order("product_id", { ascending: true })
      if (cancelled) return
      if (error) {
        setError(errorMessage(error))
        return
      }
      const rows = ((data as unknown) as DrawerLine[]) ?? []
      setLines(rows)

      /**
       * Hàng ĐỔI của phiếu trả còn nháp cũng rời kho trong chính chuyến
       * này — `complete_order` gộp chúng vào cùng lệnh xuất. Bỏ qua là
       * cột Tồn báo xanh cho một đơn mà RPC sẽ ném lỗi.
       *
       * ⚠ CHỈ phiếu `draft`: chính `complete_order` đẩy chúng sang
       * `submitted` ngay sau khi xuất, nên đếm cả submitted là trừ hai
       * lần cho một lần đổi hàng.
       *
       * ⚠ Dòng trả KHÔNG có cột hệ số, phải tra `product_units` — y như
       * RPC làm, fallback 1.
       */
      const { data: exRows, error: exErr } = await supabase
        .from("return_lines")
        .select("product_id, quantity, unit_name, returns!inner(order_id, status)")
        .eq("returns.order_id", orderId)
        .eq("returns.status", "draft")
        .eq("is_exchange", true)
      if (cancelled) return
      const exchanges = ((exRows as unknown) as Array<{
        product_id: string
        quantity: number
        unit_name: string
      }>) ?? []

      const productIds = Array.from(
        new Set([...rows.map((l) => l.product_id), ...exchanges.map((e) => e.product_id)])
      ).filter(Boolean)
      if (productIds.length === 0) {
        setStock({})
        return
      }

      const [batchRes, unitRes] = await Promise.all([
        /**
         * ⚠ LỌC ĐÚNG NHỮNG GÌ RPC LỌC: org (ngầm qua RLS), sản phẩm, và
         * `qty_on_hand > 0`. KHÔNG lọc theo khu vực kho hay hạn dùng —
         * `post_stock_export` không lọc, nên thêm điều kiện là cột này
         * nói khác thứ sẽ bị trừ.
         *
         * ⚠ PHẢI PHÂN TRANG. PostgREST cắt ở `db.max_rows` và trả HTTP
         * 200 KHÔNG kèm lỗi — lô nằm sau ngưỡng đó biến mất, và sản phẩm
         * của chúng hiện tồn 0, tức báo thiếu hàng cho một đơn xuất được.
         */
        fetchAllForAggregate<{ product_id: string; qty_on_hand: number }>((from, to) =>
          supabase
            .from("batches")
            .select("product_id, qty_on_hand", { count: "exact" })
            .in("product_id", productIds)
            .gt("qty_on_hand", 0)
            .range(from, to)
        ),
        exchanges.length > 0
          ? supabase
              .from("product_units")
              .select("product_id, unit_name, conversion")
              .in(
                "product_id",
                Array.from(new Set(exchanges.map((e) => e.product_id)))
              )
          : Promise.resolve({ data: [], error: null }),
      ])
      if (cancelled) return

      // ⚠ Đọc hỏng thì NÓI RA. Hiện tồn 0 cho một lỗi mạng là đẩy nhà
      // phân phối đi tìm hàng không thiếu.
      if (batchRes.error || exErr) {
        setStockError(batchRes.error ?? errorMessage(exErr))
        return
      }
      const conv: Record<string, number> = {}
      for (const u of ((unitRes.data as unknown) as Array<{
        product_id: string
        unit_name: string
        conversion: number
      }>) ?? []) {
        conv[`${u.product_id}|${u.unit_name}`] = Number(u.conversion) || 1
      }
      setExchangeLines(
        exchanges.map((e) => ({
          productId: e.product_id,
          quantity: Number(e.quantity) || 0,
          conversionFactor: conv[`${e.product_id}|${e.unit_name}`] ?? 1,
        }))
      )
      setStock(stockMapFrom(batchRes.rows))
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  const tone = order ? orderTone(order.status) : null
  /**
   * ⚠ GỒM CẢ ĐƠN XUẤT MỘT PHẦN — nó vẫn còn hàng phải giao. Xem chú
   * thích cùng việc ở `desktop-order-table`.
   */
  const pending =
    !!order && (order.status === "submitted" || order.status === "partially_invoiced")

  /**
   * Đối chiếu tồn — CHỈ cho phiếu tạm. Đơn đã xuất thì kho đã trừ rồi,
   * hiện lại "thiếu 24" trên đó là nói về một việc đã xong.
   */
  const stockRows = useMemo(() => {
    if (!pending || !lines || !stock) return null
    return previewOrderStock(
      lines.map((l) => ({
        productId: l.product_id,
        quantity: l.quantity,
        conversionFactor: l.conversion_factor,
      })),
      exchangeLines,
      stock
    )
  }, [pending, lines, stock, exchangeLines])
  const shortByProduct = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of stockRows ?? []) m[r.productId] = r.shortBase
    return m
  }, [stockRows])
  const shortTotal = stockRows ? totalShortBase(stockRows) : 0
  /**
   * ⚠ THIẾU TỒN KHÔNG PHẢI LÚC NÀO CŨNG LÀ CHẶN. Khi đơn vị bật cho phép
   * bán âm, RPC vẫn xuất và chỉ trả `short_qty` — nên ở đó đây là cảnh
   * báo hổ phách, không phải vạch đỏ. Tô đỏ nhầm là nhà phân phối không
   * dám bấm một nút vốn bấm được.
   */
  const oversellAllowed = org?.allow_oversell === true
  const warnings = splitWarnings(order?.approval_reason)
  const terms = order
    ? (PAYMENT_TERMS.find((t) => t.value === order.payment_terms)?.label ?? order.payment_terms ?? "—")
    : ""
  const discount = Number(order?.discount || 0)

  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      {/*
        ⚠ `w-full max-w-[460px]`, KHÔNG PHẢI `w-[460px]`. Bề ngang cứng
          460px rộng hơn màn hình 375px của điện thoại, nên ngăn kéo tự nó
          tràn ra ngoài mép phải — và chỉ lộ ra khi bên trong có nội dung
          rộng (hàng đổi/trả) đẩy cho thấy.
      */}
      <SheetContent side="right" className="flex w-full max-w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
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
                <Cell label="Khách hàng" main={order.customer?.store_name || "Khách lẻ"} sub={routeName ?? order.customer?.phone ?? ""} />
                <Cell label="Tính cho NV" main={order.sales_user?.full_name || "—"} sub={terms} />
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
                {lines?.map((l) => {
                  /**
                   * ⚠ THIẾU TÍNH THEO SẢN PHẨM, KHÔNG THEO DÒNG. Hai dòng
                   * cùng một mặt hàng, mỗi dòng 6 thùng trên tồn 10 thùng
                   * thì từng dòng đều "hợp lệ" — chỉ tổng mới thiếu. Nên
                   * cả hai dòng cùng đeo dấu thiếu, đúng như RPC sẽ thấy.
                   */
                  const short = shortByProduct[l.product_id] ?? 0
                  return (
                  <div
                    key={l.id}
                    className={cn(
                      "flex items-start gap-2.5 border-t border-outline-variant/30 px-3 py-2.5",
                      short > 0 && (oversellAllowed ? "bg-[#fff7e6]" : "bg-error/5")
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold leading-snug">
                        {l.product?.name || <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold tabular-data text-on-surface-variant">
                        {l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}
                        {l.note ? ` · “${l.note}”` : ""}
                      </span>
                      {/* ⚠ NÓI BẰNG ĐƠN VỊ CƠ SỞ và nói rõ là đơn vị cơ sở.
                          `short` cùng thang với `short_qty` của RPC: đơn 2
                          thùng loại 24 thiếu một thùng thì số này là 24. Ghép
                          thẳng nó với chữ "thùng" là báo sai 24 lần. */}
                      {short > 0 && (
                        <span
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold",
                            oversellAllowed ? "bg-[#fff4e0] text-[#8a5a00]" : "bg-error-container text-on-error-container"
                          )}
                        >
                          <TriangleAlert className="h-3 w-3" />
                          Thiếu {short} đơn vị cơ sở
                        </span>
                      )}
                    </span>
                    <span className="grid shrink-0 justify-items-end gap-0.5">
                      <span className="text-[13px] font-extrabold tabular-data">{formatCurrency(l.line_total)}</span>
                      {/* Cột Tồn: cùng phép lọc lô mà RPC dùng, nên con số
                          này là con số sẽ bị trừ. */}
                      <span className="text-[11px] font-semibold tabular-data text-on-surface-variant">
                        {stockError ? "tồn ?" : stock ? `tồn ${stock[l.product_id] ?? 0}` : "…"}
                      </span>
                    </span>
                  </div>
                  )
                })}
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
                  gác bằng mỗi `pending` sẽ vẽ ra một hộp hổ phách trống.
                  ⚠ Mỗi lý do MỘT huy hiệu, và KHÔNG cắt chữ: mảnh thật dài
                  40-70 ký tự và phần quan trọng nhất — con số — nằm ở cuối.
                  Chip một hàng sẽ cắt mất đúng phần đó. */}
              {pending && warnings.length > 0 && (
                <div className="grid gap-1.5">
                  {warnings.map((w, i) => (
                    <span
                      key={i}
                      className="flex items-start gap-1.5 rounded-xl bg-[#fff7e6] px-3 py-2 text-[12px] font-bold leading-snug text-[#7a4b00]"
                    >
                      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">{w}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* ⚠ Đọc tồn HỎNG thì nói ra. Hiện "tồn 0" cho một lỗi mạng là
                  đẩy nhà phân phối đi tìm hàng không hề thiếu. */}
              {pending && stockError && (
                <div className="rounded-xl bg-error-container px-3 py-2.5 text-[12px] font-bold leading-snug text-on-error-container">
                  Không đọc được tồn kho — {stockError}. Cột Tồn bên trên chưa đáng tin.
                </div>
              )}

              {pending && shortTotal > 0 && (
                <div
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-[12px] font-bold leading-snug",
                    oversellAllowed ? "bg-[#fff7e6] text-[#7a4b00]" : "bg-error-container text-on-error-container"
                  )}
                >
                  {oversellAllowed
                    ? `Thiếu tổng ${shortTotal} đơn vị cơ sở. Đơn vị cho phép bán âm nên vẫn xuất được — tồn kho sẽ âm.`
                    : `Thiếu tổng ${shortTotal} đơn vị cơ sở. Bấm Xuất hàng sẽ bị từ chối cho tới khi nhập đủ.`}
                </div>
              )}
              <ReturnSummary returns={returns} />

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
              {/* ⚠ SANG TAB MỚI, KHÔNG CHUYỂN TRANG CÙNG TAB (chủ nhà chốt
                  20/09/2026). Người đối chiếu sổ đang đứng ở trang 3 của
                  một danh sách đã lọc; đi rồi bấm Back là mất cả bộ lọc
                  lẫn chỗ đang đứng. Xem `NewTabLink`. */}
              {canEdit && (
                <NewTabLink
                  href={isSellEditable(order.status) ? `/sell/edit/${order.id}` : `/orders/${order.id}`}
                  className="h-11 flex-1 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest text-sm font-extrabold text-on-surface"
                >
                  Sửa đơn
                </NewTabLink>
              )}
              {/*
                ⚠ CHỈ ĐƠN CHƯA XUẤT MỚI HUỶ Ở ĐÂY. Đơn đã xuất phải đi qua
                  RPC huỷ hóa đơn (hoàn kho theo đúng lô đã lấy, xoá công
                  nợ) — một lệnh UPDATE trạng thái từ trình duyệt sẽ để kho
                  thiếu hàng mà sổ nói đã huỷ. Hiện nút ở đó là mời người
                  dùng làm hỏng sổ.
              */}
              {canCancel && (order.status === "draft" || order.status === "submitted") && (
                <button
                  type="button"
                  onClick={() => onCancel(order)}
                  disabled={cancelling}
                  className="h-11 rounded-xl border-[1.5px] border-error/40 bg-surface-container-lowest px-4 text-sm font-extrabold text-on-error-container disabled:opacity-50"
                >
                  {cancelling ? "Đang huỷ…" : "Huỷ đơn"}
                </button>
              )}
              <NewTabLink
                href={`/orders/${order.id}`}
                className="h-11 rounded-xl border-[1.5px] border-outline-variant bg-surface-container-lowest px-4 text-sm font-extrabold text-on-surface"
              >
                Chi tiết
              </NewTabLink>
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
