"use client"

import { formatCurrency, formatDate } from "@/lib/utils"

/**
 * Phiếu giao hàng cho MỘT đơn — một trang A5 dọc.
 *
 * Tách ra khỏi màn phiếu kho của luồng cũ để workflow v2 in được ngay sau
 * khi bấm Xuất hàng, mà không phải đi vòng qua một màn sắp bị ẩn.
 *
 * ⚠ BẢN IN PHẢI GIỐNG HỆT BẢN CŨ. Màn cũ vẫn gọi component này, và luật
 * của đợt này là không đụng luồng cũ — nên ba thứ nằm NGOÀI phạm vi một
 * đơn (`entryCode`, `pageIndex`, `pageTotal`) đi vào qua props thay vì bị
 * bỏ đi hay gán mặc định khác.
 *
 * ⚠ GỐC TRANG PHẢI GIỮ CẢ HAI LỚP `print-page a5-doc`. `globals.css` viết
 * luật 8pt / Times New Roman cho cả hai, NHƯNG luật thu nhỏ khối chữ ký
 * (`.a5-doc .signatures`) chỉ gắn vào `a5-doc`. Mất lớp đó là chữ ký in
 * to hơn và trang tràn sang tờ thứ hai.
 *
 * ⚠ KHÔNG TỰ BỌC `.print-only`. Ba component in có sẵn đều để lớp
 * `.print-*-only` cho NƠI GỌI đặt — tự bọc ở đây là trang gọi mất quyền
 * chọn chế độ in.
 *
 * ⚠ Kiểu ở đây là kiểu RIÊNG đã làm phẳng, không nhận entity thô của
 * database — đúng khuôn của `driver-list.tsx`, `payslip.tsx`,
 * `payment-receipt-tt200.tsx`.
 */

export interface DeliverySlipLine {
  product?: { name?: string | null; sku?: string | null } | null
  unit_name?: string | null
  quantity?: number | null
  unit_price?: number | null
  line_total?: number | null
  note?: string | null
  /** Dòng ĐỔI: thu về kho nhưng KHÔNG trừ công nợ. */
  is_exchange?: boolean | null
}

export interface DeliverySlipReturn {
  id: string
  status?: string | null
  reason?: string | null
  credit_note_amount?: number | null
  notes?: string | null
  lines?: DeliverySlipLine[] | null
}

export interface DeliverySlipOrder {
  order_code: string
  order_date?: string | null
  payment_terms?: string | null
  notes?: string | null
  total?: number | null
  customer?: {
    store_name?: string | null
    phone?: string | null
    address?: string | null
    ward?: string | null
    district?: string | null
    province?: string | null
  } | null
  lines?: DeliverySlipLine[] | null
  returns?: DeliverySlipReturn[] | null
}

export interface DeliverySlipProps {
  o: DeliverySlipOrder
  /** Mã phiếu kho in ở góc trên trái. */
  entryCode: string
  /** Số trang trong chuyến, 1-based. v2 mỗi đơn một phiếu nên luôn là 1/1. */
  pageIndex: number
  pageTotal: number
}

export function DeliverySlip({ o, entryCode, pageIndex, pageTotal }: DeliverySlipProps) {
  const orderLines = o.lines || []
  const orderQty = orderLines.reduce((s, l) => s + Number(l.quantity || 0), 0)
  const orderTotal = orderLines.reduce(
    (s, l) => s + Number(l.line_total || Number(l.unit_price || 0) * Number(l.quantity || 0)),
    0
  )
  const fullAddress = [o.customer?.address, o.customer?.ward, o.customer?.district, o.customer?.province]
    .filter(Boolean)
    .join(", ")
  return (
    <div className="print-page a5-doc p-4">
      <div className="flex justify-between items-start mb-1" style={{ fontSize: "7pt", color: "#666" }}>
        <span>Phiếu giao hàng — {entryCode}</span>
        <span>{pageIndex}/{pageTotal}</span>
      </div>
      <h1 className="text-center font-bold uppercase" style={{ fontSize: "11pt" }}>
        Phiếu giao hàng
      </h1>
      <p className="text-center font-mono font-bold mb-2" style={{ fontSize: "9pt" }}>
        {o.order_code}
      </p>

      <div className="grid grid-cols-2 gap-x-3 mb-2" style={{ fontSize: "8pt" }}>
        <div>
          <p>
            <span className="text-gray-500">Khách:</span>{" "}
            <span className="font-bold">{o.customer?.store_name || "-"}</span>
          </p>
          {o.customer?.phone && (
            <p>
              <span className="text-gray-500">SĐT:</span>{" "}
              <span className="font-semibold">{o.customer.phone}</span>
            </p>
          )}
          {fullAddress && (
            <p>
              <span className="text-gray-500">Địa chỉ:</span>{" "}
              <span className="font-semibold">{fullAddress}</span>
            </p>
          )}
        </div>
        <div>
          <p>
            <span className="text-gray-500">Ngày đặt:</span>{" "}
            <span className="font-semibold">{o.order_date ? formatDate(o.order_date) : "-"}</span>
          </p>
          <p>
            <span className="text-gray-500">Hình thức:</span>{" "}
            <span className="font-semibold">{o.payment_terms || "COD"}</span>
          </p>
          {o.notes && (
            <p>
              <span className="text-gray-500">Ghi chú:</span> {o.notes}
            </p>
          )}
        </div>
      </div>

      <table className="w-full border-collapse mb-2" style={{ fontSize: "8pt" }}>
        <colgroup>
          <col style={{ width: "8mm" }} />
          <col />
          <col style={{ width: "20mm" }} />
          <col style={{ width: "11mm" }} />
          <col style={{ width: "13mm" }} />
          <col style={{ width: "20mm" }} />
          <col style={{ width: "22mm" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-400">
            <th className="py-0.5 text-left font-bold">STT</th>
            <th className="py-0.5 text-left font-bold">Sản phẩm</th>
            <th className="py-0.5 text-left font-bold">SKU</th>
            <th className="py-0.5 text-center font-bold">ĐVT</th>
            <th className="py-0.5 text-right font-bold">SL</th>
            <th className="py-0.5 text-right font-bold">Đơn giá</th>
            <th className="py-0.5 text-right font-bold">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {orderLines.map((l, i) => {
            const lineTotal = Number(l.line_total || Number(l.unit_price || 0) * Number(l.quantity || 0))
            return (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-0.5">{i + 1}</td>
                <td className="py-0.5 font-medium">
                  {l.product?.name || "-"}
                  {l.note && (
                    <span className="italic text-gray-600 ml-1" style={{ fontSize: "7pt" }}>
                      ✏ {l.note}
                    </span>
                  )}
                </td>
                <td className="py-0.5 font-mono">{l.product?.sku || "-"}</td>
                <td className="py-0.5 text-center">{l.unit_name}</td>
                <td className="py-0.5 text-right font-semibold">{l.quantity}</td>
                <td className="py-0.5 text-right">
                  {l.unit_price ? formatCurrency(Number(l.unit_price)) : "-"}
                </td>
                <td className="py-0.5 text-right font-semibold">
                  {lineTotal ? formatCurrency(lineTotal) : "-"}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-400 font-bold">
            <td colSpan={4} className="py-0.5 text-right">Tổng cộng:</td>
            <td className="py-0.5 text-right">{orderQty}</td>
            <td className="py-0.5"></td>
            <td className="py-0.5 text-right">
              {formatCurrency(Number(o.total || orderTotal))}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Hàng trả về — chỉ in khi đơn CÓ phiếu trả thật. Đơn không có
          phiếu trả thì KHÔNG in bảng trống/ghi tay (người dùng yêu cầu
          bỏ); chỉ còn dòng "Số phải thu". */}
      {(() => {
        const allReturnLines = (o.returns || []).flatMap((r) => r.lines || [])
        // Refund-side total only — exchange items don't deduct
        // công nợ on the slip.
        const refundOnly = allReturnLines.filter((l) => !l.is_exchange)
        const totalReturnQty = refundOnly.reduce(
          (s, l) => s + Number(l.quantity || 0),
          0
        )
        const totalReturnValue = refundOnly.reduce(
          (s, l) =>
            s +
            Number(
              l.line_total != null
                ? l.line_total
                : Number(l.unit_price || 0) * Number(l.quantity || 0)
            ),
          0
        )
        const hasReturns = allReturnLines.length > 0
        const netDue = Number(o.total || orderTotal) - totalReturnValue
        return (
          <div className="mb-2">
            {hasReturns && (
              <>
                <h2 className="font-bold mt-2 mb-1" style={{ fontSize: "9pt" }}>
                  Hàng trả về (thu về kho)
                </h2>
                <p className="text-gray-500 mb-1" style={{ fontSize: "7pt" }}>
                  Thu lại các SP dưới đây và đối chiếu với khách trước khi rời điểm giao.
                </p>
                <table className="w-full border-collapse" style={{ fontSize: "8pt" }}>
                  <colgroup>
                    <col style={{ width: "8mm" }} />
                    <col />
                    <col style={{ width: "20mm" }} />
                    <col style={{ width: "11mm" }} />
                    <col style={{ width: "13mm" }} />
                    <col style={{ width: "20mm" }} />
                    <col style={{ width: "22mm" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-400">
                      <th className="py-0.5 text-left font-bold">STT</th>
                      <th className="py-0.5 text-left font-bold">Sản phẩm</th>
                      <th className="py-0.5 text-left font-bold">SKU</th>
                      <th className="py-0.5 text-center font-bold">ĐVT</th>
                      <th className="py-0.5 text-right font-bold">SL</th>
                      <th className="py-0.5 text-right font-bold">Đơn giá</th>
                      <th className="py-0.5 text-right font-bold">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allReturnLines.map((l, i) => {
                      const lineTotal = Number(
                        l.line_total != null
                          ? l.line_total
                          : Number(l.unit_price || 0) * Number(l.quantity || 0)
                      )
                      return (
                        <tr key={i} className="border-b border-gray-200">
                          <td className="py-0.5">{i + 1}</td>
                          <td className="py-0.5 font-medium">
                            {l.product?.name || "-"}
                            {l.is_exchange && (
                              <span
                                className="font-bold uppercase px-1 ml-1 rounded bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40"
                                style={{ fontSize: "7pt" }}
                              >
                                ĐỔI
                              </span>
                            )}
                            {l.note && (
                              <span
                                className="italic text-gray-600 ml-1"
                                style={{ fontSize: "7pt" }}
                              >
                                ✏ {l.note}
                              </span>
                            )}
                          </td>
                          <td className="py-0.5 font-mono">{l.product?.sku || "-"}</td>
                          <td className="py-0.5 text-center">{l.unit_name}</td>
                          <td className="py-0.5 text-right font-semibold">
                            {l.quantity}
                          </td>
                          <td className="py-0.5 text-right">
                            {l.is_exchange
                              ? <span className="text-[#175cd3] font-semibold">đổi</span>
                              : l.unit_price
                                ? formatCurrency(Number(l.unit_price))
                                : "-"}
                          </td>
                          <td className="py-0.5 text-right font-semibold">
                            {l.is_exchange
                              ? <span className="text-[#175cd3]">—</span>
                              : lineTotal
                                ? formatCurrency(lineTotal)
                                : "-"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-400 font-bold">
                      <td colSpan={4} className="py-0.5 text-right">
                        Tổng trả (trừ công nợ):
                      </td>
                      <td className="py-0.5 text-right">{totalReturnQty}</td>
                      <td className="py-0.5"></td>
                      <td className="py-0.5 text-right">
                        {formatCurrency(totalReturnValue)}
                      </td>
                    </tr>
                    {allReturnLines.some((l) => l.is_exchange) && (
                      <tr>
                        <td
                          colSpan={7}
                          className="italic text-[#175cd3]"
                          style={{ fontSize: "7pt" }}
                        >
                          * ĐỔI = thu về kho, KHÔNG trừ công nợ.
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
                {(o.returns || []).map((r, ri) => {
                  const reasonText = r.reason
                    ? ({
                        damaged: "Hỏng/vỡ",
                        wrong_item: "Sai hàng",
                        near_expiry: "Cận date",
                        expired: "Hết hạn",
                        refused: "Khách từ chối",
                      } as Record<string, string>)[r.reason] || r.reason
                    : "—"
                  /* ⚠ BỐN TRẠNG THÁI CỦA WORKFLOW V2. `chk_returns_status_v2`
                     (migration 119) chỉ còn cho draft/submitted/completed/
                     cancelled; hai giá trị cũ pending/approved đã bị backfill
                     đi và ràng buộc cấm. Giữ bảng cũ thì phiếu trả nào cũng
                     rơi xuống `|| r.status` và in chữ "submitted" trần ra
                     giữa một tờ phiếu tiếng Việt đưa cho khách. */
                  const statusText = r.status
                    ? ({
                        draft: "Nháp",
                        submitted: "Chờ xử lý",
                        completed: "Hoàn tất",
                        cancelled: "Đã huỷ",
                      } as Record<string, string>)[r.status] || r.status
                    : ""
                  return (
                    <p
                      key={r.id}
                      className="text-gray-600 mt-0.5"
                      style={{ fontSize: "7pt" }}
                    >
                      <span className="font-semibold">Phiếu trả {ri + 1}:</span>{" "}
                      {statusText ? `[${statusText}] ` : ""}Lý do: {reasonText}
                      {r.credit_note_amount != null
                        ? ` • Credit note: ${formatCurrency(Number(r.credit_note_amount))}`
                        : ""}
                      {r.notes ? ` • ${r.notes}` : ""}
                    </p>
                  )
                })}
              </>
            )}
            <div
              className="mt-1 flex items-center justify-end gap-2 border-t border-gray-400 pt-1"
              style={{ fontSize: "9pt" }}
            >
              <span className="text-gray-500">
                {hasReturns ? "Còn phải thu:" : "Số phải thu:"}
              </span>
              <span className="font-bold" style={{ fontSize: "10pt" }}>
                {formatCurrency(Math.max(0, netDue))}
              </span>
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-3 gap-3 text-center signatures mt-4">
        <div>
          <p className="font-bold" style={{ fontSize: "8pt" }}>Thủ kho</p>
          <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
          <div style={{ height: "16mm" }} />
        </div>
        <div>
          <p className="font-bold" style={{ fontSize: "8pt" }}>Lái xe / Giao hàng</p>
          <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
          <div style={{ height: "16mm" }} />
        </div>
        <div>
          <p className="font-bold" style={{ fontSize: "8pt" }}>Khách hàng</p>
          <p className="italic text-gray-500" style={{ fontSize: "7pt" }}>(Ký, ghi rõ họ tên)</p>
          <div style={{ height: "16mm" }} />
        </div>
      </div>
    </div>
  )
}
