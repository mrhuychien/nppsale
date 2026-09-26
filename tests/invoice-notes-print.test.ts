import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { noteBlocksOf } from "@/components/printing/sales-invoice"
import { leavePrintView } from "@/hooks/use-leave-after-print"

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
    expect(flat).toContain("{l.note ? ( <div className=\"italic leading-tight\">Ghi chú: {l.note}</div> ) : null}")
  })

  /**
   * ⚠ GHI CHÚ BẰNG ĐÚNG CỠ CHỮ CỦA BẢNG (chủ nhà chốt 20/09/2026: "còn
   * lại size font chữ cho bằng size font chữ trong bảng"). Bản trước để
   * nó `text-[0.9em]` — nhỏ hơn một chút; nay phân biệt bằng chữ nghiêng
   * và tiền tố "Ghi chú:", không bằng cỡ chữ.
   */
  it("ghi chú dòng KHÔNG đặt cỡ chữ riêng", () => {
    const i = DOC.indexOf("Ghi chú: {l.note}")
    expect(i).toBeGreaterThan(0)
    const tag = DOC.slice(i - 120, i)
    expect(tag).toContain("italic")
    expect(tag, "ghi chú dòng lại có cỡ chữ riêng").not.toMatch(/text-\[[\d.]+(px|em|rem)\]/)
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
  ])("%s: chỉ còn ghi chú hóa đơn (bỏ ghi chú đơn hàng)", (_l, rel) => {
    /* ⚠ LẬT 26/09/2026 — chủ nhà: "Bỏ hết phần ghi chú đơn hàng, chỉ dùng ghi chú dòng". */
    const src = read(rel)
    expect(src).not.toContain('"Ghi chú đơn hàng"')
    expect(src).toContain('"Ghi chú hóa đơn"')
  })

  /**
   * ⚠ GHI CHÚ ĐƠN RA KHỐI RIÊNG, KHÔNG NHÉT VÀO `footerNote`. Bản trước
   * ghép nó vào cuối câu cảnh báo ở cỡ chữ NHỎ NHẤT tờ giấy — tức là in
   * ra cho đủ chứ không cho ai đọc.
   */
  it("bản in đơn hàng không in ghi chú đơn (cả khối lẫn chân trang)", () => {
    /* ⚠ LẬT 26/09/2026 — chủ nhà: "Bỏ hết phần ghi chú đơn hàng, chỉ dùng ghi chú dòng". */
    expect(ORD_PRINT).toContain("notes={[]}")
    expect(ORD_PRINT).not.toContain('"Ghi chú đơn hàng"')
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
  /**
   * ⚠ CỠ CHỮ CỤ THỂ ĐÃ CHUYỂN SANG `tests/print-font-sample.test.ts`,
   * nơi các con số được ĐO TỪ TỜ MẪU KiotViet chứ không ước lượng. Ở đây
   * chỉ giữ phần thuộc về "tờ in gọn lại": dãn dòng và đệm ô.
   *
   * Đường đi của con số, ghi lại để không ai lật mù: 7,5pt (quá bé) →
   * 8,5pt → 13pt (tôi đoán sai, chủ nhà báo "to quá") → 10,5pt (đo từ
   * tờ mẫu). Chỉ đổi tiếp khi có một tờ giấy thật để đo.
   */
  it("A4 có dãn dòng riêng, không thừa hưởng 1.5 của Tailwind", () => {
    const k = CSS.slice(CSS.indexOf("@media print and (min-width: 160mm) {"))
    const i = k.indexOf("html .a4-doc {")
    expect(i).toBeGreaterThan(0)
    expect(k.slice(i, k.indexOf("}", i))).toContain("line-height: 1.15")
  })

  /**
   * ⚠ THỨ BẬC CỠ CHỮ nay do `tests/print-font-sample.test.ts` giữ — ở đó
   * so tiêu đề với chính cỡ thân, chứ không so với một con số viết tay.
   * Bản cũ ở đây khoá `h1 > 13`, và con số 13 ấy đã hết đúng.
   */

  /**
   * ⚠ Cột tên hàng trên khổ A5 chỉ rộng bằng vài chục ký tự. Tên hàng ở
   * kho này có cụm dài không dấu cách ("300g(30gói/th)"); thiếu
   * `overflow-wrap` là cụm ấy tự nong cột ra, đẩy cột tiền qua lề và bị
   * cắt — hỏng theo kiểu chỉ lộ ra sau khi đã in.
   */
  it("ô tên hàng ngắt được cụm chữ dài", () => {
    expect(DOC.match(/\$\{CELL\} \[overflow-wrap:anywhere\]/g)?.length,
      "phải có ở cả bảng hàng bán lẫn bảng hàng đổi/trả").toBe(2)
  })

  /**
   * ⚠ ĐỆM DỌC LÀ CHỖ TỐN GIẤY NHẤT: 7 cột × N dòng, mỗi 1px đệm là 2px
   * mỗi hàng. Một hóa đơn 25 dòng mất thêm nửa trang vì bốn pixel.
   */
  it("ô bảng đệm mỏng và dãn dòng chặt", () => {
    expect(DOC).toContain(
      'const CELL = "border border-black px-1 py-[2px] align-top leading-tight"'
    )
  })

  /**
   * ⚠ BẢNG KHÔNG ĐẶT CỠ RIÊNG NỮA — nó thừa hưởng cỡ của gốc tờ giấy.
   * Cỡ đặt một chỗ thì đổi một chỗ; xem `tests/print-font-sample`.
   */
  it("bảng xem trước thừa hưởng cỡ của gốc tờ giấy", () => {
    expect(DOC).toContain('<table className="w-full border-collapse">')
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
    expect(CSS).toContain("html .a4-doc .h-16 { height: 2.2rem; }")
  })
})

describe("in xong thì rời màn in", () => {
  /**
   * ⚠ MÀN IN LÀ CHỖ ĐI QUA, KHÔNG PHẢI CHỖ ĐỨNG (chủ nhà chốt
   * 20/09/2026: "in xong đóng cửa sổ in → về chỗ cũ khi bấm nút in chứ
   * không ở trang in"). Bỏ người dùng lại trên tờ giấy đã in là bắt họ
   * tự nghĩ ra đường về — với tờ mở ở tab riêng thì đường về còn là "tự
   * tìm nút đóng tab".
   */
  const HOOK = read("src/hooks/use-leave-after-print.ts")

  const spy = (historyLength: number) => {
    const hit: string[] = []
    return {
      nav: {
        historyLength,
        close: () => hit.push("close"),
        back: () => hit.push("back"),
      },
      hit,
    }
  }

  /**
   * ⚠ TAB RIÊNG THÌ ĐÓNG, KHÔNG LÙI. Tab vừa mở bằng `target="_blank"`
   * chỉ có một mốc lịch sử; `back()` ở đó không đi đâu cả và người dùng
   * ngồi lại trên tờ giấy.
   */
  it("tab riêng (một mốc lịch sử) thì đóng tab", () => {
    const { nav, hit } = spy(1)
    leavePrintView(nav)
    expect(hit).toEqual(["close"])
  })

  /** ⚠ CÙNG TAB THÌ LÙI, KHÔNG ĐÓNG — đóng là mất luôn cả phiên làm việc. */
  it("cùng tab (có lịch sử) thì lùi một bước", () => {
    const { nav, hit } = spy(4)
    leavePrintView(nav)
    expect(hit).toEqual(["back"])
  })

  /**
   * ⚠ ĐÚNG HAI MỐC LÀ RANH GIỚI, VÀ PHẢI CHẠM VÀO NÓ. Không có ca này
   * thì nới ngưỡng thành `<= 2` vẫn xanh — mà nới một bậc nghĩa là màn
   * in mở CÙNG TAB từ màn chi tiết sẽ ĐÓNG cả tab của người dùng thay
   * vì lùi về chỗ cũ.
   */
  it("đúng hai mốc lịch sử là cùng tab, phải lùi chứ không đóng", () => {
    const { nav, hit } = spy(2)
    leavePrintView(nav)
    expect(hit).toEqual(["back"])
  })

  /** Trình duyệt báo 0 mốc thì vẫn là tab riêng, không được rơi sang lùi. */
  it("không có mốc nào cũng coi là tab riêng", () => {
    const { nav, hit } = spy(0)
    leavePrintView(nav)
    expect(hit).toEqual(["close"])
  })

  /**
   * ⚠ `afterprint` FIRE CẢ KHI BẤM HUỶ trong hộp thoại in, và đó là điều
   * ĐÚNG: huỷ in rồi vẫn muốn về chỗ cũ. Nghe `beforeprint` để mở lại
   * chốt, nếu không lần in THỨ HAI (đổi khổ giấy in lại) mất đường về.
   */
  it("nghe afterprint, và mở lại chốt ở beforeprint", () => {
    expect(HOOK).toContain('window.addEventListener("afterprint", onAfter)')
    expect(HOOK).toContain('window.addEventListener("beforeprint", onBefore)')
    expect(HOOK).toContain("leaving.current = false")
    // Gỡ listener khi rời trang — để lại là mỗi lần vào màn in thêm một cái.
    expect(HOOK).toContain('window.removeEventListener("afterprint", onAfter)')
    expect(HOOK).toContain('window.removeEventListener("beforeprint", onBefore)')
  })

  /** ⚠ CHỈ BẬT KHI DỮ LIỆU ĐÃ VỀ — xem chú thích tại chỗ gọi. */
  it.each([
    ["bản in hóa đơn", "src/app/(dashboard)/sales-invoices/[id]/print/page.tsx"],
    ["bản in đơn hàng", "src/app/(dashboard)/orders/[id]/print/page.tsx"],
    ["bản in hóa đơn điện tử", "src/app/(dashboard)/invoices/[id]/print/page.tsx"],
  ])("%s: có gắn", (_l, rel) => {
    expect(read(rel)).toContain("useLeaveAfterPrint(!loading)")
  })
})
