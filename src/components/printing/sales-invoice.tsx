"use client"

/**
 * HÓA ĐƠN BÁN HÀNG — dựng theo đúng mẫu chủ NPP gửi (bản in KiotViet).
 *
 * Khác mẫu cũ ở ba chỗ về BỐ CỤC, và một chỗ về NỘI DUNG:
 *   · tiêu đề công ty căn TRÁI, không căn giữa;
 *   · bảng có ĐƯỜNG KẺ ĐỦ và thêm cột **CK** (chiết khấu từng dòng);
 *   · ba dòng tổng nằm TRONG bảng, không phải một khối riêng bên phải;
 *   · ba ô ký: Người nhận hàng / Kế toán / Người bán (mẫu cũ chỉ hai).
 *
 * ⚠ KHÔNG CÓ DÒNG THUẾ — chủ NPP chốt: in giống mẫu.
 *
 *   Nhưng `invoices.total = subtotal + vat`. Bỏ dòng thuế mà giữ nguyên
 *   các con số là in ra một tờ giấy KHÔNG CỘNG RA TỔNG: hàng 600.000,
 *   chiết khấu 0, tổng cộng 660.000. Khách cộng tay sẽ thấy lệch 60.000
 *   và không có dòng nào giải thích.
 *
 *   Nên khi hoá đơn CÓ thuế, tờ giấy in theo GIÁ ĐÃ GỒM THUẾ — đúng
 *   cách hoá đơn bán hàng KiotViet vẫn làm: mỗi dòng nhân lên theo tỉ lệ
 *   `total / subtotal`, dòng CUỐI nhận phần lẻ để cột tiền cộng KHỚP
 *   TUYỆT ĐỐI với "Tổng cộng". Không có con số nào bịa ra: chỉ dùng
 *   `subtotal`, `vat`, `total` và `line_total` đã lưu.
 *
 *   Hoá đơn không thuế (`vat = 0`) thì tỉ lệ bằng 1 — không dòng nào đổi
 *   một đồng, và bảng in ra y hệt file mẫu.
 *
 * ⚠ IN Ở KHỔ A4. Mặc định của kho này là A5 (phiếu giao cho người đi
 *   giao), nhưng hoá đơn bảy cột ở A5 thì chữ còn 8pt và cột tiền dính
 *   nhau. Nút in đặt `data-paper-size="A4"` — xem `PrintButton`.
 */

import { formatCurrency } from "@/lib/utils"
import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"
import { netDueOnInvoice } from "@/lib/orders/invoice-credit"

export interface SalesInvoiceLine {
  id: string
  name: string
  /** Quy cách, ví dụ "8 que/hộp" — in ngay sau tên hàng như mẫu. */
  spec?: string | null
  unitName: string
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
}

export interface SalesInvoiceProps {
  org: { name?: string | null; address?: string | null; phone?: string | null }
  invoiceNumber: string
  /** Mốc in ở dòng "Ngày … " dưới tiêu đề. */
  issuedAt: Date | null
  customerName: string
  customerAddress?: string | null
  customerPhone?: string | null
  salesPersonName?: string | null
  salesPersonPhone?: string | null
  lines: SalesInvoiceLine[]
  /** Chiết khấu trên tổng hoá đơn (khác với CK từng dòng). */
  invoiceDiscount?: number
  total: number
  /**
   * Khoản trừ hàng trả ĐÃ HOÀN THÀNH của hóa đơn này.
   *
   * ⚠ KHÔNG SỬA `total`. Dòng "Tổng cộng" vẫn là giá trị lô hàng đã
   * giao — đó là thứ tờ hóa đơn chứng nhận. Khoản trừ và số còn phải thu
   * là HAI DÒNG THÊM ở dưới, đúng như sổ công nợ tính.
   *
   * ⚠ NƠI GỌI TỰ QUYẾT CÓ TRUYỀN HAY KHÔNG (`showCreditOnPrint`): hóa
   * đơn đã phát hành điện tử thì tờ in phải khớp từng con số với tờ đã
   * gửi cơ quan thuế.
   */
  returnCredit?: number
  /** Dòng ghi chú nhỏ dưới bảng — ví dụ nhắc số tài khoản. */
  footerNote?: string | null
}

/** dd/MM/yyyy HH:mm — không dùng `formatDate` vì mẫu có cả giờ. */
function stamp(d: Date | null): string {
  if (!d) return "—"
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "Ngày 17 tháng 09 năm 2026" — dòng trên ô ký. */
function longDate(d: Date | null): string {
  const x = d ?? new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `Ngày ${p(x.getDate())} tháng ${p(x.getMonth() + 1)} năm ${x.getFullYear()}`
}

/** Một dòng đã quy về giá gồm thuế, kèm đơn giá tính ngược lại. */
export interface GrossedLine extends SalesInvoiceLine {
  /** Thành tiền in ra cột cuối. */
  amount: number
  /** Đơn giá in ra — `amount / quantity`, để khách nhân tay ra đúng. */
  price: number
}

/**
 * Quy mọi dòng về GIÁ ĐÃ GỒM THUẾ để ba dòng tổng cộng khớp nhau.
 *
 * ⚠ DÒNG CUỐI NHẬN PHẦN LẺ. Nhân từng dòng rồi làm tròn thì tổng các
 * dòng lệch "Tổng cộng" vài đồng — trên giấy đó là LỖI CỘNG SAI, không
 * ai đọc là lỗi làm tròn. Dồn chênh vào dòng cuối để cột tiền khớp
 * tuyệt đối.
 *
 * ⚠ Không bịa con số nào: chỉ dùng `total`, `invoiceDiscount` và
 * `lineTotal` đã lưu. Hoá đơn không thuế thì tỉ lệ bằng 1 — không dòng
 * nào đổi một đồng.
 */
export function grossUpLines(
  lines: SalesInvoiceLine[],
  total: number,
  invoiceDiscount = 0
): { rows: GrossedLine[]; goodsTotal: number } {
  const goodsTotal = Math.max(0, Number(total || 0) + Number(invoiceDiscount || 0))
  const netSum = lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0)
  const ratio = netSum > 0 ? goodsTotal / netSum : 1

  const amounts = lines.map((l, i) =>
    i === lines.length - 1 ? 0 : Math.round(Number(l.lineTotal || 0) * ratio)
  )
  if (amounts.length > 0) {
    amounts[amounts.length - 1] = goodsTotal - amounts.reduce((s, a) => s + a, 0)
  }

  const rows = lines.map((l, i) => {
    const amount = amounts[i]
    const qty = Number(l.quantity) || 0
    return { ...l, amount, price: qty > 0 ? amount / qty : Number(l.unitPrice || 0) }
  })
  return { rows, goodsTotal }
}

const CELL = "border border-black px-1.5 py-1 align-top"

export function SalesInvoice(props: SalesInvoiceProps) {
  const {
    org, invoiceNumber, issuedAt, customerName, customerAddress, customerPhone,
    salesPersonName, salesPersonPhone, lines, invoiceDiscount = 0,
    total, returnCredit = 0, footerNote,
  } = props

  const qtyTotal = lines.reduce((s, l) => s + Number(l.quantity || 0), 0)

  const { rows, goodsTotal } = grossUpLines(lines, total, invoiceDiscount)
  const netDue = netDueOnInvoice(total, returnCredit)

  return (
    <div className="a4-doc mx-auto max-w-3xl bg-white text-black print:max-w-none">
      {/* Tiêu đề công ty — căn TRÁI như mẫu. */}
      <div className="mb-3">
        <p className="text-lg font-bold uppercase leading-tight">{org.name || "—"}</p>
        {org.address && <p className="text-[11px] leading-snug">Địa chỉ: {org.address}</p>}
        {org.phone && <p className="text-[11px] leading-snug">Điện thoại: {org.phone}</p>}
      </div>

      <div className="mb-3 text-center">
        <h1 className="text-xl font-bold">HÓA ĐƠN BÁN HÀNG</h1>
        <p className="mt-1 text-xs font-bold">Ngày {stamp(issuedAt)}</p>
        <p className="text-xs">Số HĐ: {invoiceNumber || "—"}</p>
      </div>

      {/* Khối khách hàng — mỗi dòng một nhãn, căn trái. */}
      <div className="mb-2 space-y-0.5 text-[11px] leading-snug">
        <p>
          Khách hàng: <span className="font-bold">{customerName || "—"}</span>
        </p>
        {/* ⚠ Vẫn in NHÃN khi thiếu dữ liệu, như mẫu ("Liên hệ:" để trống).
            Ẩn cả dòng là người đọc không biết ô đó vốn có tồn tại. */}
        <p>Địa chỉ: {customerAddress || ""}</p>
        <p>Liên hệ: {customerPhone || ""}</p>
        <p>
          Nhân Viên Bán Hàng: {salesPersonName || ""}
          {salesPersonPhone ? ` - ${salesPersonPhone}` : ""}
        </p>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-center font-bold">
            <th className={`${CELL} w-9`}>STT</th>
            <th className={CELL}>Tên hàng và quy cách</th>
            <th className={`${CELL} w-16`}>ĐVT</th>
            <th className={`${CELL} w-12`}>SL</th>
            <th className={`${CELL} w-20`}>Đ.giá</th>
            <th className={`${CELL} w-16`}>CK</th>
            <th className={`${CELL} w-24`}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td className={`${CELL} text-center text-muted-foreground`} colSpan={7}>
                Hoá đơn chưa có dòng hàng nào.
              </td>
            </tr>
          ) : (
            rows.map((l, i) => (
              <tr key={l.id}>
                <td className={`${CELL} text-center`}>{i + 1}</td>
                <td className={CELL}>
                  {l.name}
                  {l.spec ? ` (${l.spec})` : ""}
                </td>
                <td className={`${CELL} text-center`}>{l.unitName}</td>
                <td className={`${CELL} text-center tabular-nums`}>{l.quantity}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.price)}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.discount)}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.amount)}</td>
              </tr>
            ))
          )}

          {/* Ba dòng tổng nằm TRONG bảng, đúng như mẫu. */}
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={3}>Tổng tiền hàng</td>
            <td className={`${CELL} text-center tabular-nums`}>{qtyTotal}</td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(goodsTotal)}</td>
          </tr>
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={6}>Chiết khấu hóa đơn ( )</td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(invoiceDiscount)}</td>
          </tr>
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={6}>Tổng cộng</td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(total)}</td>
          </tr>
          {/*
            ⚠ HAI DÒNG NÀY CHỈ HIỆN KHI CÓ HÀNG TRẢ. In "Trừ hàng trả: 0"
              là thêm một dòng không nói gì vào tờ giấy vốn đã chật.
            ⚠ "TỔNG CỘNG" Ở TRÊN KHÔNG ĐỔI. Nó là giá trị lô hàng đã giao
              — thứ tờ hóa đơn chứng nhận. Trừ thẳng vào đó là sửa một
              chứng từ đã phát hành.
          */}
          {returnCredit > 0 && (
            <>
              <tr>
                <td className={`${CELL} text-center`} colSpan={6}>Trừ hàng trả</td>
                <td className={`${CELL} text-right tabular-nums`}>
                  −{formatCurrency(returnCredit)}
                </td>
              </tr>
              <tr className="font-bold">
                <td className={`${CELL} text-center`} colSpan={6}>Còn phải thu</td>
                <td className={`${CELL} text-right tabular-nums`}>
                  {formatCurrency(netDue)}
                </td>
              </tr>
            </>
          )}
          <tr>
            <td className={`${CELL} h-6`} colSpan={7}></td>
          </tr>
          <tr>
            <td className={CELL} colSpan={7}>
              <span className="font-bold">Bằng chữ:</span>{" "}
              {/* ⚠ BẰNG CHỮ ĐỌC SỐ PHẢI TRẢ, không đọc tổng hóa đơn. Người
                  cầm tờ giấy đi thu tiền đọc đúng dòng này. */}
              <span className="italic">{numberToVietnameseWords(netDue)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-2 items-start gap-4">
        <p className="text-[9px] leading-snug">{footerNote || ""}</p>
        <p className="text-right text-[11px]">{longDate(issuedAt)}</p>
      </div>

      {/* Ba ô ký — mẫu cũ chỉ có hai. */}
      <div className="mt-2 grid grid-cols-3 gap-4 text-center text-[11px]">
        {[
          "Người nhận hàng",
          "Kế toán",
          "Người bán",
        ].map((role) => (
          <div key={role}>
            <p className="font-bold">{role}</p>
            <p className="italic">(Ký, họ tên)</p>
            {/* Chừa chỗ ký thật — thiếu khoảng này thì chữ ký đè lên chân trang. */}
            <div className="h-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
