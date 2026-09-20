"use client"

/**
 * CHỨNG TỪ BÁN HÀNG — dựng theo đúng mẫu chủ NPP gửi (bản in KiotViet).
 *
 * MỘT KHUÔN, HAI LOẠI GIẤY: hóa đơn bán (mặc định) và đơn đặt hàng
 * (`title` + `numberLabel`). Chủ nhà chốt "mẫu in Đơn đặt hàng giống Hoá
 * đơn bán"; chép ra file thứ hai là ít lâu sau sửa một bên rồi hai tờ
 * giấy của cùng một nhà phân phối không còn giống nhau.
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
 * ⚠ PHẦN ĐẦU LÀ TÊN · ĐỊA CHỈ · ĐIỆN THOẠI NPP (chủ nhà chốt). Ba thứ
 *   đó nằm trong `organizations.settings` jsonb, đọc qua `loadOrgHeader`
 *   — KHÔNG phải cột trên bảng. Trống thì dòng đó không in ra, và chỗ
 *   nhập chúng là Cài đặt → Cấu hình tổ chức.
 *
 * ⚠ NGÀY KÈM GIỜ (chủ nhà chốt). Giờ lấy từ `created_at`, không lấy từ
 *   cột ngày kiểu `date` — xem `docStampAt`.
 *
 * ⚠ KHỔ GIẤY DO NƠI GỌI CHỌN, mặc định của kho này là A5 — đúng khổ của
 *   tờ mẫu chủ nhà gửi.
 *
 *   CỠ CHỮ KHI IN nằm ở khối `.a4-doc` trong `globals.css`, KHÔNG phải ở
 *   lớp `text-[12px]` dưới đây (nó chỉ còn tác dụng ở bản xem trước trên
 *   màn hình). Con số hiện tại là 10,5pt, đo từ chính tờ mẫu KiotViet.
 *
 * ⚠ CẢ TỜ CHỈ MỘT CỠ CHỮ, TRỪ ĐÚNG TIÊU ĐỀ (chủ nhà chốt 20/09/2026:
 *   "trừ chữ HOÁ ĐƠN BÁN HÀNG, còn lại size font chữ cho bằng size font
 *   chữ trong bảng"). Cỡ đặt MỘT chỗ — ở gốc tờ giấy cho màn hình, ở
 *   `.a4-doc` cho giấy. Đừng thêm một `text-[Npx]` nào nữa: lần trước
 *   rải ra tám nơi, và khi đổi cỡ thì quên mất hai chỗ.
 *
 * ⚠ CỘT TÊN HÀNG LÀ CỘT DUY NHẤT KHÔNG ĐẶT BỀ RỘNG, nên nó nhận toàn bộ
 *   chỗ còn lại của bảng. Mọi pixel bớt được ở đệm ô và ở sáu cột kia
 *   đều chảy vào đây, và tên hàng ngắn đi một dòng là cả tờ giấy ngắn đi
 *   một dòng cho MỖI mặt hàng (chủ nhà chốt 20/09/2026: "cho cột tên
 *   hàng rộng ra … để tiết kiệm dòng khi in").
 */

import { formatCurrency } from "@/lib/utils"
import { stampVN, longDateVN } from "@/lib/printing/doc-stamp"
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
  /**
   * Ghi chú riêng của dòng hàng — in ngay dưới tên (chủ nhà chốt
   * 20/09/2026: "chưa có ghi chú từng sản phẩm").
   *
   * ⚠ RỖNG THÌ KHÔNG IN DÒNG NÀO. Đây là tờ giấy đang bị ép cho gọn lại;
   * một dòng "Ghi chú:" trống trên mỗi mặt hàng là tốn giấy cho hư không.
   */
  note?: string | null
}

/** Một dòng hàng đổi / trả trên bản in. */
export interface SalesInvoiceReturnLine {
  id: string
  name: string
  unitName: string
  quantity: number
  unitPrice: number
  /** Số tiền trừ vào hóa đơn. Dòng ĐỔI luôn 0 — đổi hàng không trừ tiền. */
  credit: number
  isExchange: boolean
}

export interface SalesInvoiceProps {
  org: { name?: string | null; address?: string | null; phone?: string | null }
  /**
   * Tiêu đề giữa trang. Mặc định là hóa đơn bán; màn in ĐƠN ĐẶT HÀNG
   * truyền "ĐƠN ĐẶT HÀNG".
   *
   * ⚠ MỘT KHUÔN CHO CẢ HAI LOẠI GIẤY. Chủ nhà chốt "mẫu in Đơn đặt hàng
   * giống Hoá đơn bán"; chép ra file thứ hai là ít lâu sau sửa mẫu ở một
   * bên rồi hai tờ giấy của cùng một nhà phân phối không còn giống nhau.
   */
  title?: string
  /** Nhãn trước số chứng từ: "Số HĐ" (hóa đơn) hay "Số ĐH" (đơn hàng). */
  numberLabel?: string
  invoiceNumber: string
  /** Mốc in ở dòng "Ngày … " dưới tiêu đề. */
  issuedAt: Date | null
  customerName: string
  customerAddress?: string | null
  customerPhone?: string | null
  salesPersonName?: string | null
  salesPersonPhone?: string | null
  lines: SalesInvoiceLine[]
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
  /**
   * Dòng hàng ĐỔI / TRẢ in ngay dưới bảng hàng bán.
   *
   * ⚠ NẰM NGOÀI "TỔNG TIỀN HÀNG". Những dòng này KHÔNG phải hàng bán;
   * gộp vào tổng là tờ hóa đơn chứng nhận đã bán cả thứ khách vừa trả
   * lại. Chúng đứng riêng và giải thích đúng con số ở dòng "Trừ hàng
   * trả" bên dưới — nhờ vậy mọi số trên giấy đều cộng ra được.
   *
   * ⚠ NƠI GỌI TỰ QUYẾT CÓ TRUYỀN HAY KHÔNG. Hóa đơn đã phát hành điện tử
   * thì tờ in phải khớp từng dòng với tờ đã gửi cơ quan thuế.
   */
  returnLines?: SalesInvoiceReturnLine[]
  /**
   * Các khối ghi chú in trong bảng, ngay dưới phần cộng tiền.
   *
   * ⚠ ĐÂY LÀ CHỖ CỦA GHI CHÚ ĐƠN / HÓA ĐƠN, không phải `footerNote`.
   * `footerNote` in ở cỡ 9px cạnh chân trang — đủ cho một câu nhắc số tài
   * khoản, nhưng ghi chú của người bán là thứ người nhận hàng phải đọc
   * được ("giao trước 8h", "nợ 15 ngày"), nhét vào đó là giấu nó đi.
   *
   * ⚠ KHỐI RỖNG BỊ BỎ, VÀ HAI KHỐI TRÙNG CHỮ CHỈ IN MỘT. Ghi chú hóa đơn
   * thường được chép từ ghi chú đơn; in hai lần cùng một câu là tờ giấy
   * trông như có hai yêu cầu khác nhau.
   */
  notes?: { label: string; text: string | null | undefined }[]
  /** Dòng ghi chú nhỏ dưới bảng — ví dụ nhắc số tài khoản. */
  footerNote?: string | null
}

/** Một dòng đã quy về giá gồm thuế, kèm đơn giá tính ngược lại. */
export interface GrossedLine extends SalesInvoiceLine {
  /** Thành tiền in ra cột cuối. */
  amount: number
  /** Đơn giá in ra. Xem `grossUpLines`: luôn thoả `price × SL − ck = amount`. */
  price: number
  /** Chiết khấu dòng in ra cột CK, đã quy cùng thang với `amount`. */
  ck: number
}

/**
 * Quy mọi dòng về GIÁ ĐÃ GỒM THUẾ để ba dòng tổng cộng khớp nhau.
 *
 * ⚠ DÒNG CUỐI NHẬN PHẦN LẺ. Nhân từng dòng rồi làm tròn thì tổng các
 * dòng lệch "Tổng cộng" vài đồng — trên giấy đó là LỖI CỘNG SAI, không
 * ai đọc là lỗi làm tròn. Dồn chênh vào dòng cuối để cột tiền khớp
 * tuyệt đối.
 *
 * ⚠ Không bịa con số nào: chỉ dùng `total` và `lineTotal` đã lưu. Hoá
 * đơn không thuế thì tỉ lệ bằng 1 — không dòng nào đổi một đồng.
 *
 * ⚠ KHÔNG CÓ THAM SỐ `invoiceDiscount`, DÙ MẪU CÓ DÒNG "Chiết khấu hóa
 * đơn". Hệ thống này KHÔNG có chiết khấu ở mức hóa đơn — chiết khấu chỉ
 * có ở từng dòng (`line_discount`). Dòng ấy trên giấy vì thế luôn là 0,
 * và đó là con số ĐÚNG, không phải chỗ trống chờ điền. Nhận một tham số
 * vào đây thì các dòng sẽ quy lên `total + chiết khấu` trong khi ô tổng
 * hiện `total`, và cột tiền hết cộng ra được.
 *
 * ⚠ CỘT CK PHẢI THAM GIA PHÉP TÍNH, KHÔNG ĐƯỢC IN SỐ THÔ. In thẳng
 * `discount` bên cạnh một đơn giá đã quy đổi là dòng đó không còn cộng
 * ra được: `Đ.giá × SL − CK ≠ Thành tiền`, và khách cộng tay sẽ thấy
 * lệch. Nên `ck` quy cùng thang với `amount`, rồi `price` suy NGƯỢC từ
 * `(amount + ck) / SL` — đẳng thức đúng theo dựng, không theo may mắn.
 * Dòng không có chiết khấu thì `ck = 0` và `price = amount / SL`, y hệt
 * bản trước.
 */
export function grossUpLines(
  lines: SalesInvoiceLine[],
  total: number
): { rows: GrossedLine[]; goodsTotal: number } {
  const goodsTotal = Math.max(0, Number(total || 0))
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
    const ck = Math.round(Number(l.discount || 0) * ratio)
    return {
      ...l,
      amount,
      ck,
      price: qty > 0 ? (amount + ck) / qty : Number(l.unitPrice || 0),
    }
  })
  return { rows, goodsTotal }
}

/**
 * ⚠ ĐỆM DỌC LÀ CHỖ TỐN GIẤY NHẤT CỦA TỜ NÀY (chủ nhà chốt 20/09/2026:
 * "đẩy sát khoảng cách các dòng để tiết kiệm giấy"). Mỗi 1px đệm là
 * 2px mỗi hàng; một hóa đơn 25 dòng mất thêm nửa trang vì bốn pixel.
 * `leading-tight` cũng cần: mặc định của Tailwind là 1.5, quá thưa cho
 * một bảng chứng từ.
 *
 * ⚠ ĐỆM NGANG `px-1` CHỨ KHÔNG `px-1.5` (chủ nhà chốt: "cho cột tên
 * hàng rộng ra"). Bảy cột × hai bên: mỗi 1px bớt đi trả lại 14px cho
 * bảng, và toàn bộ phần ấy chảy vào cột tên hàng — cột DUY NHẤT không
 * đặt bề rộng. Bớt đệm rẻ hơn bớt cỡ chữ: không dòng nào khó đọc thêm.
 */
const CELL = "border border-black px-1 py-[2px] align-top leading-tight"

/**
 * Các khối ghi chú thật sự in ra: bỏ khối rỗng, khử trùng theo NỘI DUNG.
 *
 * ⚠ KHỬ TRÙNG THEO CHỮ, KHÔNG THEO NHÃN. Ghi chú hóa đơn thường được
 * chép nguyên văn từ ghi chú đơn; hai nhãn khác nhau kèm một câu giống
 * hệt là tờ giấy trông như có hai yêu cầu khác nhau, và người nhận hàng
 * đi tìm chỗ khác biệt không có thật. Khối ĐẦU giữ lại, vì nó là nguồn.
 *
 * ⚠ CẮT KHOẢNG TRẮNG TRƯỚC KHI SO. Một ghi chú chỉ gồm dấu cách hay
 * xuống dòng là ghi chú rỗng; in cái nhãn "Ghi chú:" cho nó là tốn một
 * dòng giấy cho hư không.
 */
export function noteBlocksOf(
  notes: { label: string; text: string | null | undefined }[]
): { label: string; text: string }[] {
  return notes
    .map((n) => ({ label: n.label, text: (n.text ?? "").trim() }))
    .filter((n, i, all) => n.text !== "" && all.findIndex((x) => x.text === n.text) === i)
}

export function SalesInvoice(props: SalesInvoiceProps) {
  const {
    org, title = "HÓA ĐƠN BÁN HÀNG", numberLabel = "Số HĐ",
    invoiceNumber, issuedAt, customerName, customerAddress, customerPhone,
    salesPersonName, salesPersonPhone, lines,
    total, returnCredit = 0, returnLines = [], notes = [], footerNote,
  } = props

  const noteBlocks = noteBlocksOf(notes)

  const qtyTotal = lines.reduce((s, l) => s + Number(l.quantity || 0), 0)

  const { rows } = grossUpLines(lines, total)
  const netDue = netDueOnInvoice(total, returnCredit)

  /**
   * ⚠ CỠ CHỮ ĐẶT MỘT CHỖ DUY NHẤT — ở gốc tờ giấy, không rải trên từng
   * phần. Chủ nhà chốt 20/09/2026: "trừ chữ HOÁ ĐƠN BÁN HÀNG, còn lại
   * size font chữ cho bằng size font chữ trong bảng". Rải ra từng chỗ là
   * mỗi lần đổi phải nhớ tám nơi, và chỗ nào quên thì lệch — đúng cái
   * vừa phải đi sửa.
   *
   * Đây là cỡ của BẢN XEM TRƯỚC trên màn hình. Cỡ khi IN nằm ở khối
   * `.a4-doc` trong `globals.css`.
   */
  return (
    <div className="a4-doc mx-auto max-w-3xl bg-white text-[12px] text-black print:max-w-none">
      {/* Tiêu đề công ty — căn TRÁI như mẫu. */}
      <div className="mb-1.5">
        <p className="font-bold uppercase leading-tight">{org.name || "—"}</p>
        {org.address && <p className="leading-tight">Địa chỉ: {org.address}</p>}
        {org.phone && <p className="leading-tight">Điện thoại: {org.phone}</p>}
      </div>

      <div className="mb-1.5 text-center">
        <h1 className="text-xl font-bold leading-tight">{title}</h1>
        {/* ⚠ NGÀY KÈM GIỜ (chủ nhà chốt) — xem `docStampAt`: giờ thật nằm
            ở `created_at`, không nằm ở cột ngày kiểu `date`. */}
        <p className="font-bold leading-tight">Ngày {stampVN(issuedAt)}</p>
        <p className="leading-tight">{numberLabel}: {invoiceNumber || "—"}</p>
      </div>

      {/* Khối khách hàng — mỗi dòng một nhãn, căn trái. */}
      <div className="mb-1 leading-tight">
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

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-center font-bold">
            {/*
              ⚠ BỀ RỘNG CỘT LÀ GỢI Ý, KHÔNG PHẢI LỆNH. Bảng này để
                `table-layout: auto`, nên trình duyệt KHÔNG ép cột hẹp
                hơn nội dung ngắn nhất của nó (min-content). Đặt số nhỏ
                là "co xuống khi được phép", không phải "cắt chữ" — một
                cột CK toàn số 0 sẽ teo lại, còn cột có "1.500.000" tự
                nong ra. Vì vậy hạ mấy con số dưới đây KHÔNG làm vỡ bảng.

              ⚠ CỘT TÊN HÀNG CỐ Ý KHÔNG ĐẶT BỀ RỘNG: nó nhận TOÀN BỘ chỗ
                còn lại. Mọi pixel bớt được ở sáu cột kia đều chảy vào
                đây — đó là cách "cho cột tên hàng rộng ra" (chủ nhà chốt
                20/09/2026), và tên hàng ngắn đi một dòng là cả tờ giấy
                ngắn đi một dòng cho MỖI mặt hàng.
            */}
            <th className={`${CELL} w-9`}>STT</th>
            <th className={CELL}>Tên hàng và quy cách</th>
            <th className={`${CELL} w-12`}>ĐVT</th>
            <th className={`${CELL} w-8`}>SL</th>
            <th className={`${CELL} w-20`}>Đ.giá</th>
            {/* ⚠ CỘT CK ĐÃ KHÔI PHỤC (chủ nhà chốt: in giống mẫu). Nó
                tham gia phép tính chứ không chỉ để trang trí — xem
                `grossUpLines`: Đ.giá × SL − CK = Thành tiền. */}
            <th className={`${CELL} w-8`}>CK</th>
            <th className={`${CELL} w-20`}>Thành tiền</th>
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
                {/* ⚠ Cột tên hàng trên khổ A5 chỉ rộng bằng vài chục ký
                    tự. Tên hàng ở kho này có cụm dài không dấu cách như
                    "300g(30gói/th)"; thiếu `overflow-wrap` là cụm ấy tự
                    nong cột ra, đẩy cột tiền qua lề và bị cắt — hỏng
                    theo kiểu chỉ lộ ra sau khi đã in. */}
                <td className={`${CELL} [overflow-wrap:anywhere]`}>
                  {l.name}
                  {l.spec ? ` (${l.spec})` : ""}
                  {/* ⚠ GHI CHÚ BẰNG ĐÚNG CỠ CHỮ CỦA BẢNG (chủ nhà chốt
                      20/09/2026). Phân biệt bằng chữ nghiêng và tiền tố
                      "Ghi chú:", không bằng cỡ chữ — đặt một cỡ riêng ở
                      đây là thêm một chỗ phải nhớ khi cả tờ đổi cỡ. */}
                  {l.note ? (
                    <div className="italic leading-tight">Ghi chú: {l.note}</div>
                  ) : null}
                </td>
                <td className={`${CELL} text-center`}>{l.unitName}</td>
                <td className={`${CELL} text-center tabular-nums`}>{l.quantity}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.price)}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.ck)}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.amount)}</td>
              </tr>
            ))
          )}

          {/*
            HÀNG ĐỔI / TRẢ — chủ nhà chốt: ghi rõ "(Hàng đổi)" / "(Hàng
            trả)" ngay đầu tên hàng và cộng trừ luôn trên phiếu.

            ⚠ ĐÁNH SỐ TIẾP TỪ BẢNG TRÊN. Bắt đầu lại từ 1 là tờ giấy có hai
              dòng cùng số thứ tự, và người đối chiếu đọc thành hai tờ.
            ⚠ DÒNG ĐỔI GHI "không trừ", KHÔNG GHI 0. Số 0 trong cột tiền
              đọc như một lỗi nhập; chữ nói rõ đổi hàng không trừ tiền.
          */}
          {returnLines.map((l, i) => (
            <tr key={l.id}>
              <td className={`${CELL} text-center`}>{rows.length + i + 1}</td>
              <td className={`${CELL} [overflow-wrap:anywhere]`}>
                <span className="font-semibold">
                  {l.isExchange ? "(Hàng đổi) " : "(Hàng trả) "}
                </span>
                {l.name}
              </td>
              <td className={`${CELL} text-center`}>{l.unitName}</td>
              <td className={`${CELL} text-center tabular-nums`}>{l.quantity}</td>
              <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(l.unitPrice)}</td>
              {/* ⚠ Ô CK ĐỂ TRỐNG, không in 0. Hàng đổi/trả không có
                  chiết khấu dòng; một số 0 ở đây đọc như "đã tính rồi". */}
              <td className={CELL}></td>
              <td className={`${CELL} text-right tabular-nums`}>
                {l.isExchange ? "không trừ" : `−${formatCurrency(l.credit)}`}
              </td>
            </tr>
          ))}

          {/* Ba dòng tổng nằm TRONG bảng, đúng như mẫu. */}
          {/*
            ⚠ ĐÃ KHÔI PHỤC "Chiết khấu hóa đơn" VÀ "Tổng cộng" (chủ nhà
              chốt: in giống mẫu). Trước đó hai dòng này bị bỏ với lý do
              chúng không thêm thông tin — đúng về mặt số học, nhưng tờ
              giấy đi tới tay khách phải giống tờ họ vẫn quen nhận.

            ⚠ "Chiết khấu hóa đơn" LUÔN LÀ 0, VÀ ĐÓ LÀ SỐ ĐÚNG. Hệ thống
              này chỉ có chiết khấu ở từng dòng (cột CK); không có chiết
              khấu ở mức hóa đơn. Đây không phải ô bỏ trống chờ điền.

            ⚠ VẪN LẤY `total`, KHÔNG LẤY `goodsTotal`. Hai số bằng nhau do
              dựng, nhưng `Còn phải thu` trừ từ `total`; lấy số khác là
              một ngày nào đó lệch vài đồng mà không ai lần ra.
          */}
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={3}>Tổng tiền hàng</td>
            <td className={`${CELL} text-center tabular-nums`}>{qtyTotal}</td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(total)}</td>
          </tr>
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={3}>Chiết khấu hóa đơn ( )</td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(0)}</td>
          </tr>
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={3}>Tổng cộng</td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={CELL}></td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(total)}</td>
          </tr>
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
          {/* Ghi chú của đơn / hóa đơn — chủ nhà chốt 20/09/2026. */}
          {noteBlocks.map((n) => (
            <tr key={n.label}>
              <td className={`${CELL} whitespace-pre-wrap`} colSpan={7}>
                <span className="font-bold">{n.label}:</span> {n.text}
              </td>
            </tr>
          ))}
          <tr>
            <td className={`${CELL} h-4`} colSpan={7}></td>
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

      <div className="mt-1.5 grid grid-cols-2 items-start gap-4">
        <p className="leading-tight">{footerNote || ""}</p>
        <p className="text-right leading-tight">{longDateVN(issuedAt)}</p>
      </div>

      {/* Ba ô ký — mẫu cũ chỉ có hai. */}
      <div className="mt-1.5 grid grid-cols-3 gap-4 text-center">
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
