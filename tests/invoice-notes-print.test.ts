import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { noteBlocksOf } from "@/components/printing/sales-invoice"

/**
 * GHI CHÚ TRÊN HÓA ĐƠN, và tờ in gọn lại — chủ nhà chốt 20/09/2026:
 * "Phần chi tiết và khi in hoá đơn chưa có ghi chú từng sản phẩm và ghi
 * chú chung của đơn" · "font chữ hoá đơn cho to lên chút, đẩy sát khoảng
 * cách các dòng để tiết kiệm giấy".
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const DOC = read("src/components/printing/sales-invoice.tsx")
const INV_PRINT = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")
const ORD_PRINT = read("src/app/(dashboard)/orders/[id]/print/page.tsx")
const INV_DETAIL = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")
const CSS = read("src/app/globals.css")

describe("khử trùng khối ghi chú", () => {
  it("bỏ khối rỗng và khối chỉ có khoảng trắng", () => {
    expect(
      noteBlocksOf([
        { label: "A", text: null },
        { label: "B", text: "" },
        { label: "C", text: "   \n  " },
        { label: "D", text: " giao trước 8h " },
      ])
    ).toEqual([{ label: "D", text: "giao trước 8h" }])
  })

  /**
   * ⚠ TRÙNG CHỮ THÌ GIỮ KHỐI ĐẦU — nó là NGUỒN. Ghi chú hóa đơn được
   * chép từ ghi chú đơn, nên giữ khối sau là tờ giấy ghi công cho người
   * chép thay vì người viết.
   */
  it("hai khối cùng nội dung chỉ in khối đầu", () => {
    expect(
      noteBlocksOf([
        { label: "Ghi chú đơn hàng", text: "Giao trước 8h" },
        { label: "Ghi chú hóa đơn", text: " Giao trước 8h " },
      ])
    ).toEqual([{ label: "Ghi chú đơn hàng", text: "Giao trước 8h" }])
  })

  /** Khác chữ thì in cả hai, đúng thứ tự truyền vào. */
  it("hai khối khác nội dung thì in đủ, giữ thứ tự", () => {
    expect(
      noteBlocksOf([
        { label: "Ghi chú đơn hàng", text: "Giao trước 8h" },
        { label: "Ghi chú hóa đơn", text: "Thiếu 2 thùng" },
      ]).map((n) => n.label)
    ).toEqual(["Ghi chú đơn hàng", "Ghi chú hóa đơn"])
  })
})

describe("ghi chú từng mặt hàng", () => {
  /**
   * ⚠ DỮ LIỆU ĐÃ CÓ TỪ ĐẦU — chỉ là chưa chỗ nào in ra. `note` đi từ
   * dòng đơn qua `post_invoice` vào `sales_invoice_lines.note`. Một ghi
   * chú đã nhập mà màn hình không hiện thì người bán tưởng mình quên
   * nhập và nhập lại.
   */
  it.each([
    ["bản in hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx"],
    ["bản in đơn hàng", "src/app/(dashboard)/orders/[id]/print/page.tsx"],
    ["trang chi tiết hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/page.tsx"],
  ])("%s: câu truy vấn kéo cột note về", (_l, rel) => {
    const src = read(rel)
    expect(src, "thiếu `note` trong câu select dòng hàng").toMatch(
      /line_total,[^"]*\bnote\b/
    )
  })

  it("khuôn in có ô ghi chú dưới tên hàng", () => {
    expect(DOC).toContain("note?: string | null")
    const flat = DOC.replace(/\s+/g, " ")
    expect(flat).toContain("{l.note ? ( <div className=\"text-[0.9em] italic leading-tight\">Ghi chú: {l.note}</div> ) : null}")
  })

  /**
   * ⚠ CỠ CHỮ THEO `em`, KHÔNG THEO px. Bảng này đổi cỡ theo khổ giấy
   * trong globals.css; đặt px là ghi chú to bằng tên hàng ở A5 và bé
   * như hạt bụi ở A4.
   */
  it("cỡ ghi chú dòng co theo bảng, không phải số px cố định", () => {
    const i = DOC.indexOf("Ghi chú: {l.note}")
    expect(i).toBeGreaterThan(0)
    expect(DOC.slice(i - 120, i)).toContain("text-[0.9em]")
  })

  it("hai bản in đều truyền note của dòng vào khuôn", () => {
    for (const src of [INV_PRINT, ORD_PRINT]) {
      expect(src).toContain("note: l.note ?? null,")
    }
  })

  /**
   * ⚠ KIỂM CẢ ĐIỀU KIỆN LẪN THÂN, KHÔNG CHỈ KIỂM CHỮ. Chỉ tìm "Ghi chú:
   * {l.note}" thì đổi điều kiện thành `{false && (` vẫn xanh — dòng chữ
   * còn nguyên trong file mà màn hình không in ra gì.
   */
  it("trang chi tiết in ghi chú dòng ra màn hình", () => {
    const flat = INV_DETAIL.replace(/\s+/g, " ")
    expect(flat).toContain(
      '{l.note && ( <div className="mt-0.5 whitespace-pre-wrap text-xs italic text-on-surface-variant [overflow-wrap:anywhere]"> Ghi chú: {l.note} </div> )}'
    )
  })
})

describe("ghi chú chung của đơn", () => {
  /**
   * ⚠ ĐỌC THẲNG TỪ ĐƠN, KHÔNG CHÉP SANG HÓA ĐƠN LÚC XUẤT. `post_invoice`
   * chỉ lưu ghi chú người dùng gõ lúc xuất; ghi chú của đơn ở lại
   * `sales_orders.notes`. Đọc thẳng thì mọi hóa đơn CŨ cũng hiện ra —
   * chép sang chỉ cứu được hóa đơn lập từ nay về sau.
   */
  it.each([
    ["bản in hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx"],
    ["trang chi tiết hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/page.tsx"],
  ])("%s: nhúng ghi chú của đơn", (_l, rel) => {
    expect(read(rel)).toContain("order:sales_orders(order_code, notes)")
  })

  /** Và ghi chú của chính hóa đơn phải nằm trong câu truy vấn của bản in. */
  it("bản in hóa đơn kéo cả notes của hóa đơn", () => {
    expect(INV_PRINT).toContain("total, created_at, notes, order_id")
  })

  /** ⚠ HAI NHÃN RIÊNG — gộp làm một là mất mất ai dặn câu nào. */
  it.each([
    ["bản in hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx"],
    ["trang chi tiết hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/page.tsx"],
  ])("%s: hai khối, ghi rõ của đơn và của hóa đơn", (_l, rel) => {
    const src = read(rel)
    expect(src).toContain('"Ghi chú đơn hàng"')
    expect(src).toContain('"Ghi chú hóa đơn"')
    expect(src.indexOf('"Ghi chú đơn hàng"')).toBeLessThan(src.indexOf('"Ghi chú hóa đơn"'))
  })

  /**
   * ⚠ GHI CHÚ ĐƠN RA KHỐI RIÊNG, KHÔNG NHÉT VÀO `footerNote`. Bản trước
   * ghép nó vào cuối câu cảnh báo ở cỡ chữ NHỎ NHẤT tờ giấy — tức là in
   * ra cho đủ chứ không cho ai đọc.
   */
  it("bản in đơn hàng không còn giấu ghi chú vào chân trang", () => {
    expect(ORD_PRINT).toContain('notes={[{ label: "Ghi chú đơn hàng", text: order.notes }]}')
    const i = ORD_PRINT.indexOf("footerNote={")
    expect(i).toBeGreaterThan(0)
    expect(ORD_PRINT.slice(i, i + 400)).not.toContain("order.notes")
  })

  /** Khối ghi chú nằm TRONG bảng, trước dòng "Bằng chữ". */
  it("khuôn in vẽ khối ghi chú trước dòng Bằng chữ", () => {
    const n = DOC.indexOf("noteBlocks.map")
    const w = DOC.indexOf("Bằng chữ")
    expect(n).toBeGreaterThan(0)
    expect(w).toBeGreaterThan(n)
    expect(DOC).toContain('<td className={`${CELL} whitespace-pre-wrap`} colSpan={7}>')
  })
})

describe("tờ in gọn lại", () => {
  /**
   * ⚠ CỠ CHỮ TRÊN GIẤY DO globals.css QUYẾT, KHÔNG PHẢI `text-[12px]` Ở
   * COMPONENT. Các lớp Tailwind kia chỉ còn tác dụng ở bản xem trước
   * trên màn hình. Sửa nhầm chỗ là tờ in ra y như cũ.
   */
  it("A4 có cỡ chữ riêng cho bảng và có dãn dòng", () => {
    expect(CSS, "bảng A4 vẫn rơi về text-[11px] của Tailwind").toContain(
      'html[data-paper-size="A4"] .a4-doc table { font-size: 10pt; }'
    )
    const i = CSS.indexOf('html[data-paper-size="A4"] .a4-doc {')
    expect(i).toBeGreaterThan(0)
    const block = CSS.slice(i, CSS.indexOf("}", i))
    expect(block, "thiếu line-height nên bảng thừa hưởng 1.5").toContain("line-height: 1.15")
  })

  it("A5 to lên một nấc, dòng chặt lại", () => {
    const i = CSS.indexOf('html:not([data-paper-size="A4"]) .a4-doc {')
    const block = CSS.slice(i, CSS.indexOf("}", i))
    expect(block).toContain("font-size: 8.5pt")
    expect(block).toContain("line-height: 1.08")
    expect(CSS).toContain('html:not([data-paper-size="A4"]) .a4-doc table { font-size: 8pt; }')
  })

  /**
   * ⚠ ĐỆM DỌC LÀ CHỖ TỐN GIẤY NHẤT: 7 cột × N dòng, mỗi 1px đệm là 2px
   * mỗi hàng. Một hóa đơn 25 dòng mất thêm nửa trang vì bốn pixel.
   */
  it("ô bảng đệm mỏng và dãn dòng chặt", () => {
    expect(DOC).toContain(
      'const CELL = "border border-black px-1.5 py-[2px] align-top leading-tight"'
    )
  })

  /** Bản xem trước trên màn hình cũng phải to theo, không lệch với giấy. */
  it("bảng xem trước không còn 11px", () => {
    expect(DOC).toContain('<table className="w-full border-collapse text-[12px]">')
    expect(DOC).not.toContain("text-[11px]")
  })

  /**
   * ⚠ KHÔNG ĐỤNG `h-16` CỦA Ô KÝ. globals.css thu nó lại cho A5 bằng
   * chính tên lớp đó (`.a4-doc .h-16`); đổi lớp ở component mà quên sửa
   * CSS là chữ ký ở A5 phình ra và đẩy tràn trang — một lỗi chỉ lộ ra
   * sau khi đã in.
   */
  it("ô ký giữ nguyên tên lớp mà CSS đang bám vào", () => {
    expect(DOC).toContain('<div className="h-16" />')
    expect(CSS).toContain('html:not([data-paper-size="A4"]) .a4-doc .h-16 { height: 2.2rem; }')
  })
})
