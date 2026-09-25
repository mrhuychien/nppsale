"use client"

/**
 * IN ĐƠN ĐẶT HÀNG.
 *
 * Chủ nhà chốt: "Làm thêm mẫu in Đơn đặt hàng giống Hoá đơn bán."
 *
 * ⚠ DÙNG CHUNG KHUÔN `SalesInvoice`, chỉ đổi tiêu đề và nhãn số chứng
 * từ. Chép ra một khuôn thứ hai là ít lâu sau sửa mẫu ở một bên rồi hai
 * tờ giấy của cùng một nhà phân phối không còn giống nhau — mà thứ hay
 * phải sửa nhất (địa chỉ NPP, số cột, ô ký) lại là phần dùng chung.
 *
 * ⚠ ĐÂY LÀ LỜI ĐẶT, CHƯA PHẢI HÀNG ĐÃ GIAO. Bản in này liệt kê TOÀN BỘ
 * dòng của đơn, kể cả phần chưa xuất — khác hẳn hóa đơn bán, vốn chỉ in
 * đúng những gì đã lên xe. Vì thế dòng chân trang nói rõ nó không có giá
 * trị thanh toán; người cầm tờ này đi thu tiền là thu theo một con số
 * chưa chắc đã giao đủ.
 *
 * ⚠ KHÔNG CÓ PHÉP QUY ĐỔI THUẾ NÀO KHÁC HÓA ĐƠN. `sales_orders.total`
 * cũng đã gồm VAT (`subtotal + vat`), nên `grossUpLines` xử lý y như
 * hóa đơn — xem chú thích trong `printing/sales-invoice.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton, moHopThoaiIn } from "@/components/ui/print-button"
import { useLeaveAfterPrint } from "@/hooks/use-leave-after-print"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SalesInvoice, type SalesInvoiceLine, type SalesInvoiceReturnLine,
} from "@/components/printing/sales-invoice"
import { invoiceAddressOf } from "@/lib/customers/address"
import { docStampAt } from "@/lib/printing/doc-stamp"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import { giamCuaHoaDon } from "@/lib/pos/invoice-discount"

interface OrderRow {
  id: string
  org_id: string
  order_code: string
  order_date: string
  status: string
  total: number
  /** SAU giảm giá đơn, CHƯA trừ hàng trả — tiền hàng thật của đơn. */
  subtotal?: number | null
  vat?: number | null
  created_at: string | null
  notes: string | null
  customer?: {
    store_name?: string | null
    billing_name?: string | null
    billing_address?: string | null
    address?: string | null
    ward?: string | null
    district?: string | null
    province?: string | null
    phone?: string | null
  } | null
  sales_user?: { full_name?: string | null; phone?: string | null } | null
}

interface LineRow {
  id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  /** Ghi chú riêng của dòng hàng (`sales_order_lines.note`). */
  note?: string | null
  product?: { name?: string | null; sku?: string | null } | null
}

interface ReturnLineRow {
  id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number
  is_exchange: boolean | null
  product?: { name?: string | null } | null
}

interface ReturnRow {
  id: string
  status: string
  lines?: ReturnLineRow[] | null
}

export default function OrderPrintPage() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [ordRes, lineRes, retRes] = await Promise.all([
      supabase
        .from("sales_orders")
        .select(
          "id, org_id, order_code, order_date, status, subtotal, vat, total, created_at, notes, " +
            "customer:customers(store_name, billing_name, billing_address, address, ward, district, province, phone), " +
            "sales_user:users!sales_orders_sales_user_id_fkey(full_name, phone)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("sales_order_lines")
        .select("id, unit_name, quantity, unit_price, line_discount, line_total, note, product:products(name, sku)")
        .eq("order_id", id),
      /**
       * Phiếu đổi / trả kèm đơn.
       *
       * ⚠ BỎ PHIẾU ĐÃ HUỶ. Phiếu huỷ không còn ràng buộc gì với lô hàng
       *   này; in nó ra là tờ giấy hứa trừ một khoản đã bị bỏ.
       */
      supabase
        .from("returns")
        .select(
          "id, status, lines:return_lines(id, unit_name, quantity, unit_price, line_total, is_exchange, product:products(name))"
        )
        .eq("order_id", id)
        .neq("status", "cancelled"),
    ])
    const qErr = ([ordRes, lineRes, retRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[orders/print] truy vấn lỗi:", qErr.message)

    const row = ((ordRes.data as unknown) as OrderRow) || null
    setOrder(row)
    setLines(((lineRes.data as unknown) as LineRow[]) || [])
    setReturns(((retRes.data as unknown) as ReturnRow[]) || [])
    if (row?.org_id) {
      // ⚠ QUA `loadOrgHeader` — địa chỉ và điện thoại NẰM TRONG
      //   `settings` jsonb, không phải cột trên `organizations`.
      setOrg(await loadOrgHeader(supabase, row.org_id))
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  /**
   * IN NGAY khi tới từ nút "In đơn" (`?auto=1`).
   *
   * ⚠ CHỜ DỮ LIỆU XONG MỚI IN, và CHỈ MỘT LẦN — xem cùng khối ở màn in
   *   hóa đơn: in sớm ra một trang khung xương, in lại là hộp thoại bật
   *   lên lần nữa mà người dùng không thoát ra được.
   */
  const printedRef = useRef(false)
  useEffect(() => {
    if (loading || !order || printedRef.current) return
    if (params.get("auto") !== "1") return
    printedRef.current = true
    moHopThoaiIn()
  }, [loading, order, params])

  /**
   * ⚠ IN XONG LÀ RỜI MÀN IN (chủ nhà chốt 20/09/2026). Bật sau khi dữ
   *   liệu về: gắn sớm hơn thì một lần in của trang KHÁC còn đang dở
   *   cũng bắn `afterprint` vào đây. Xem `useLeaveAfterPrint`.
   */
  useLeaveAfterPrint(!loading)

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!order) {
    return <PageHeader title="Không tìm thấy đơn hàng" backHref="/orders" />
  }

  const printLines: SalesInvoiceLine[] = lines.map((l) => ({
    id: l.id,
    name: l.product?.name || "—",
    spec: l.product?.sku || null,
    unitName: l.unit_name,
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unit_price) || 0,
    discount: Number(l.line_discount) || 0,
    lineTotal: Number(l.line_total) || 0,
    note: l.note ?? null,
  }))

  /**
   * Dòng hàng đổi / trả kèm đơn — giữ nguyên cách hóa đơn đang hiện
   * (chủ nhà chốt): ghi rõ "(Hàng đổi)" / "(Hàng trả)" đầu tên hàng,
   * dòng đổi ghi "không trừ".
   *
   * ⚠ CHỦ NHÀ 25/09/2026: "Mẫu in đơn đặt hàng in ra sai bét" + "phần còn phải
   *   thu phải in cả số âm". In "Tổng cộng" (tiền hàng) → "Trừ hàng trả" →
   *   "Còn phải thu", y như hóa đơn — âm là khách được ghi có.
   */
  const printReturnLines: SalesInvoiceReturnLine[] = returns.flatMap((r) =>
    (r.lines ?? []).map((l) => ({
      id: l.id,
      name: l.product?.name || "Sản phẩm đã xoá",
      unitName: l.unit_name,
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unit_price) || 0,
      credit: l.is_exchange ? 0 : Math.max(0, Number(l.line_total || 0)),
      isExchange: l.is_exchange === true,
    }))
  )

  const st = ORDER_STATUS_MAP[order.status]

  /**
   * ⚠ TIỀN HÀNG LẤY TỪ `subtotal + vat`, KHÔNG TỪ `total`. `sales_orders.total`
   *   ĐÃ TRỪ hàng trả rồi KẸP VỀ 0 lúc lưu đơn (`cartTotals`, màn POS). Đưa nó
   *   vào khuôn là `grossUpLines` giãn các dòng bán cho khớp 0 — đúng tờ chủ nhà
   *   chụp: đơn giá 0đ, Tổng tiền hàng 0đ, "Không đồng", mà hàng trả vẫn −250.000.
   *   Đơn cũ thiếu hai cột → lùi về `total` như trước.
   */
  const tienHang =
    order.subtotal != null ? (Number(order.subtotal) || 0) + (Number(order.vat) || 0) : Number(order.total) || 0
  const traHang = printReturnLines.reduce((s, l) => s + (l.credit || 0), 0)
  /** Giảm giá cả đơn (mig 183) — suy từ dòng và `subtotal`, như hóa đơn. */
  const giamDon = order.subtotal == null ? 0 : giamCuaHoaDon(lines, order.subtotal)

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="In đơn đặt hàng"
          description={`Đơn ${order.order_code}`}
          backHref={`/orders/${id}`}
        >
          <PrintButton label="In đơn hàng" />
        </PageHeader>
      </div>

      <div className="rounded-lg border border-border/40 bg-white p-8 print:border-none print:p-0">
        <SalesInvoice
          org={{ name: org.name, address: org.address, phone: org.phone }}
          title="ĐƠN ĐẶT HÀNG"
          numberLabel="Số ĐH"
          invoiceNumber={order.order_code}
          issuedAt={docStampAt(order.created_at, order.order_date).at}
          customerName={order.customer?.billing_name || order.customer?.store_name || ""}
          customerAddress={invoiceAddressOf(order.customer ?? {})}
          customerPhone={order.customer?.phone}
          salesPersonName={order.sales_user?.full_name}
          salesPersonPhone={order.sales_user?.phone}
          lines={printLines}
          /**
           * ⚠ GHI CHÚ ĐƠN RA KHỐI RIÊNG, KHÔNG NHÉT VÀO `footerNote`.
           *   Bản trước ghép nó vào cuối câu cảnh báo ở cỡ chữ nhỏ nhất
           *   tờ giấy — tức là in ra cho đủ chứ không cho ai đọc. Người
           *   nhận hàng cần đọc được "giao trước 8h".
           */
          notes={[{ label: "Ghi chú đơn hàng", text: order.notes }]}
          total={tienHang}
          invoiceDiscount={giamDon}
          returnCredit={traHang}
          returnLines={printReturnLines}
          /**
           * ⚠ NÓI RÕ ĐÂY LÀ LỜI ĐẶT, KHÔNG PHẢI CHỨNG TỪ THANH TOÁN.
           *   Tờ này trông y hệt hóa đơn bán; thiếu câu dưới đây thì ai
           *   cầm nó cũng có thể đi thu tiền theo một con số hàng chưa
           *   chắc đã giao đủ.
           */
          footerNote={
            order.status === "cancelled"
              ? "⚠ ĐƠN ĐÃ HUỶ — không có giá trị."
              : `Đơn đặt hàng — chưa phải chứng từ thanh toán.${st ? ` Trạng thái: ${st.label}.` : ""}`
          }
        />
      </div>
    </div>
  )
}
