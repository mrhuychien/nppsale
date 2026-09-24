"use client"

/**
 * CỘNG TIỀN CỦA MỘT HÓA ĐƠN — khối dùng chung cho màn chi tiết và ngăn
 * XEM NHANH.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Xem nhanh bên ngoài cũng phải hiện chi
 * tiết thế này chứ" — kèm ảnh khối Cộng tiền của màn chi tiết, đặt cạnh
 * ngăn xem nhanh vốn chỉ có một dòng "Tổng tiền".
 *
 * ⚠ VÌ SAO DÙNG CHUNG, ĐÚNG LÝ DO CỦA `ReturnSummary`. Cùng một tờ hóa
 * đơn hiện ở hai chỗ; dựng riêng mỗi bên là ít lâu sau một bên nói "còn
 * phải thu 836.000" còn bên kia nói "1.000.000", và người đi đòi tiền
 * tin bên nào cũng có thể sai. Phép trừ chỉ được nằm ở MỘT chỗ
 * (`invoice-credit.ts`), và cách VẼ nó cũng vậy.
 *
 * ⚠ TỔNG HÓA ĐƠN KHÔNG ĐỔI khi có hàng trả — nó là giá trị lô hàng đã
 * giao, thứ tờ hóa đơn chứng nhận. Khoản trừ và số còn phải thu là hai
 * dòng THÊM, đúng như sổ công nợ tính. Ghi đè vào `total` là sửa một
 * chứng từ đã phát hành.
 */

import { DetailRow } from "@/components/detail/detail-chrome"
import { formatCurrency } from "@/lib/utils"
import {
  creditOnInvoice,
  creditCounted,
  netDueOnInvoice,
  type CreditInput,
} from "@/lib/orders/invoice-credit"

export interface InvoiceMoneyInput {
  total: number
  /**
   * Tiền hàng và thuế.
   *
   * ⚠ HAI SỐ NÀY CÓ THỂ CHƯA ĐỌC ĐƯỢC. Ngăn xem nhanh lấy chúng bằng một
   * lượt đọc phụ; hỏng thì phải ĐỂ TRỐNG hai dòng ấy chứ không được điền
   * 0 — "Thuế GTGT 0" cho một lỗi mạng đọc như một hóa đơn không thuế.
   * Phần còn lại của khối vẫn đúng vì nó chỉ cần `total`.
   */
  subtotal?: number | null
  /**
   * Giảm giá CẢ ĐƠN của tờ (mig 183). Có thì "Tiền hàng" hiện TRƯỚC giảm
   * (`subtotal` là số SAU giảm) và thêm một dòng giảm — ba dòng cộng khớp.
   */
  discount?: number | null
  vat?: number | null
}

/**
 * Các dòng của khối Cộng tiền. Nơi gọi tự bọc khung (thẻ `DetailCard` ở
 * màn chi tiết, khung dòng hàng ở ngăn xem nhanh).
 */
export function InvoiceMoneySummary({
  invoice,
  returns,
}: {
  invoice: InvoiceMoneyInput
  /** Phiếu trả CỦA CHÍNH TỜ HÓA ĐƠN NÀY — lọc theo `invoice_id`. */
  returns: readonly CreditInput[]
}) {
  const credit = creditOnInvoice(returns)
  const netDue = netDueOnInvoice(Number(invoice.total || 0), credit)
  /**
   * Phiếu trả CHƯA trừ vào công nợ — số phải thu sẽ còn giảm tiếp.
   *
   * ⚠ KHÔNG PHẢI "CHƯA HOÀN THÀNH". Từ mig 133, phiếu trả sinh ra từ đơn
   *   đã trừ ngay lúc xuất hóa đơn dù còn ở 'Chờ xử lý'; đếm nó vào đây
   *   là báo người đi đòi tiền rằng số sẽ giảm tiếp, trong khi nó đã
   *   giảm rồi — và họ đòi thiếu đúng bằng khoản ấy.
   */
  const chuaTru = returns.filter((r) => r.status !== "cancelled" && !creditCounted(r)).length

  return (
    <>
      {/* ⚠ KHÔNG ĐỌC ĐƯỢC THÌ KHÔNG VẼ, đừng điền 0 — xem `subtotal`. */}
      {invoice.subtotal != null && (
        <DetailRow label="Tiền hàng" value={formatCurrency(invoice.subtotal + (Number(invoice.discount) || 0))} />
      )}
      {invoice.subtotal != null && Number(invoice.discount) > 0 && (
        <DetailRow label="Giảm giá đơn" value={`−${formatCurrency(Number(invoice.discount))}`} />
      )}
      {invoice.vat != null && <DetailRow label="Thuế GTGT" value={formatCurrency(invoice.vat)} />}
      <DetailRow
        label={credit > 0 ? "Tổng hóa đơn" : "Tổng cộng"}
        value={formatCurrency(invoice.total)}
        strong={credit === 0}
      />
      {credit > 0 && (
        <>
          <DetailRow label="Trừ hàng trả" value={`−${formatCurrency(credit)}`} />
          <DetailRow label="Còn phải thu" value={formatCurrency(netDue)} strong />
        </>
      )}
      {/*
        ⚠ CHỈ ĐẾM PHIẾU CHƯA TRỪ. Nói ra để người đi đòi tiền không đòi
          nhầm một số sắp thay đổi — nhưng phiếu ĐÃ trừ rồi thì đừng
          nhắc, nhắc là họ tưởng còn giảm nữa và đòi thiếu.
      */}
      {chuaTru > 0 && (
        <p className="mt-2 rounded-lg bg-[#fff7e6] px-2.5 py-2 text-xs font-semibold text-[#7a4b00]">
          Còn {chuaTru} phiếu trả chưa trừ vào công nợ — hoàn thành (nhập hàng về kho) xong
          thì số phải thu sẽ giảm tiếp.
        </p>
      )}
    </>
  )
}
