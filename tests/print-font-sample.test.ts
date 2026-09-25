import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * CỠ CHỮ TỜ IN — ĐO TỪ TỜ MẪU, KHÔNG ƯỚC LƯỢNG.
 *
 * Chủ nhà chốt 20/09/2026: "font to quá, xem mẫu này font bao nhiêu copy
 * sang". Tờ mẫu là bản in KiotViet, khổ A5 (420 × 594,96pt), Times New
 * Roman. Giải nén luồng nội dung PDF rồi đọc toán tử `Tf` — cỡ ở đó tính
 * bằng px CSS, nhân 0,75 ra pt:
 *
 *    tên nhà phân phối       18px → 13,5pt
 *    "HÓA ĐƠN BÁN HÀNG"      20px → 15pt
 *    toàn bộ phần còn lại    14px → 10,5pt
 *    ghi chú nhỏ chân trang  10px → 7,5pt
 *
 * ⚠ 13pt HÔM TRƯỚC LÀ ĐOÁN SAI, và chốt này tồn tại để không ai đoán
 * lại. Chủ nhà nói "cho lên 13" khi đang nhìn một tờ 8,5pt; đo tờ mẫu
 * mới ra con số thật.
 */

const CSS = readFileSync(resolve(__dirname, "..", "src/app/globals.css"), "utf-8")
const DOC = readFileSync(
  resolve(__dirname, "..", "src/components/printing/sales-invoice.tsx"), "utf-8"
)

/** Cỡ chữ của một bộ chọn, theo khổ giấy. */
function pt(paper: "A5" | "A4", selector: string): number | null {
  const scope =
    paper === "A4" ? 'html\\[data-paper-size="A4"\\]' : 'html:not\\(\\[data-paper-size="A4"\\]\\)'
  const re = new RegExp(`${scope} \\.a4-doc${selector}\\s*\\{[^}]*?font-size:\\s*([\\d.]+)pt`)
  const m = re.exec(CSS)
  return m ? Number(m[1]) : null
}

describe("một cỡ chữ cho cả tờ, trừ đúng tiêu đề", () => {
  /**
   * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "trừ chữ HOÁ ĐƠN BÁN HÀNG, còn lại size
   * font chữ cho bằng size font chữ trong bảng". Hai cỡ riêng của tờ
   * mẫu — tên nhà phân phối 13,5pt và ghi chú chân trang 7,5pt — ĐÃ BỎ.
   * Đây là chỗ CỐ Ý lệch với tờ mẫu, không phải quên chép.
   */
  /*
   * ⚠ CHỦ NHÀ 25/09/2026: "khi chọn khổ A4, tự giãn ra đầy trang". A4 rộng gấp
   * ~1,41 lần A5 → cỡ chữ A4 = cỡ A5 × ~1,4 (10,5 → 14,5; 15 → 21). A5 giữ nguyên.
   */
  const CO = { A5: { than: 10.5, h1: 15 }, A4: { than: 14.5, h1: 21 } } as const

  it.each([["A5"], ["A4"]] as const)("%s: thân và bảng cùng một cỡ", (paper) => {
    expect(pt(paper, ""), "thân tờ").toBe(CO[paper].than)
    expect(pt(paper, " table"), "bảng — chính là tờ hóa đơn").toBe(CO[paper].than)
  })

  it.each([["A5"], ["A4"]] as const)("%s: chỉ tiêu đề khác cỡ, và nó phải TO hơn", (paper) => {
    const h1 = pt(paper, " h1")
    expect(h1, "mất cỡ riêng của tiêu đề").toBe(CO[paper].h1)
    expect(h1!).toBeGreaterThan(pt(paper, "")!)
  })

  /**
   * ⚠ CHỐT CHÍNH: KHÔNG CÒN CỠ THỨ BA NÀO. Mỗi `font-size` thêm vào khối
   * `.a4-doc` là một chỗ phải nhớ khi chủ nhà đổi cỡ chữ lần sau — và
   * lần trước đúng là đã quên mất hai chỗ, nên tên nhà phân phối vẫn to
   * còn ghi chú chân trang vẫn bé sau khi cả tờ đã đổi cỡ.
   */
  it.each([["A5"], ["A4"]] as const)("%s: chỉ có đúng ba khai báo cỡ chữ", (paper) => {
    const scope =
      paper === "A4" ? 'html\\[data-paper-size="A4"\\]' : 'html:not\\(\\[data-paper-size="A4"\\]\\)'
    const re = new RegExp(`${scope} \\.a4-doc([^{]*)\\{[^}]*?font-size:\\s*([\\d.]+)pt`, "g")
    const found: Array<[string, string]> = []
    for (let m = re.exec(CSS); m; m = re.exec(CSS)) found.push([m[1].trim(), m[2]])
    // thân · bảng · tiêu đề — không hơn.
    expect(found.map((f) => f[0]).sort()).toEqual(["", "h1", "table"])
    expect(found.find((f) => f[0] === "")?.[1]).toBe(found.find((f) => f[0] === "table")?.[1])
  })

  /**
   * Và component cũng chỉ đặt cỡ MỘT chỗ — ở gốc tờ giấy. Rải ra từng
   * phần là mỗi lần đổi phải nhớ tám nơi.
   */
  it("bản xem trước đặt cỡ một chỗ, ở gốc tờ giấy", () => {
    expect(DOC).toContain('className="a4-doc mx-auto max-w-3xl bg-white text-[12px] text-black print:max-w-none"')
    const body = DOC.slice(DOC.indexOf("export function SalesInvoice("))
    /**
     * ⚠ BẮT CẢ HAI KIỂU CỠ CHỮ CỦA TAILWIND. Bản trước chỉ dò
     * `text-[Npx]`, nên trả `text-lg` về cho tên nhà phân phối vẫn XANH —
     * đúng thứ chốt này sinh ra để chặn. Thang chữ (`text-lg`, `text-sm`…)
     * cũng là cỡ chữ; còn `text-right` / `text-black` thì không.
     */
    const SIZE = /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b|\btext-\[[\d.]+(?:px|pt|em|rem)\]/g
    const sizes = body.match(SIZE) ?? []
    // Đúng hai: một ở gốc tờ giấy, một ở tiêu đề.
    expect(sizes.sort(), `cỡ chữ rải rác: ${sizes.join(" ")}`).toEqual(["text-[12px]", "text-xl"])
    // Tiêu đề vẫn là ngoại lệ duy nhất, và nó dùng thang của Tailwind.
    expect(body).toContain('<h1 className="text-xl font-bold leading-tight">')
  })

  /** Hai lớp móc cũ đã hết việc — để lại là mời người sau tưởng chúng còn tác dụng. */
  it("không còn lớp móc cỡ chữ nào lủng lẳng", () => {
    for (const hook of ["doc-org-name", "doc-footer-note"]) {
      expect(DOC, `component còn lớp ${hook}`).not.toContain(hook)
      expect(CSS, `globals.css còn luật cho ${hook}`).not.toContain(hook)
    }
  })

  /**
   * ⚠ DÃN DÒNG GIỮ MỨC CHẶT — chủ nhà chốt "đẩy sát khoảng cách các dòng
   * để tiết kiệm giấy". Tờ mẫu đo được ~1.14; ở đây cố ý chặt hơn.
   */
  it("dãn dòng không bị nới ra theo", () => {
    const i = CSS.indexOf('html:not([data-paper-size="A4"]) .a4-doc {')
    expect(CSS.slice(i, CSS.indexOf("}", i))).toContain("line-height: 1.08")
  })
})

describe("bề rộng cột: dồn chỗ cho tên hàng", () => {
  /**
   * CHỦ NHÀ CHỐT 20/09/2026: "cho cột tên hàng rộng ra, cột đvt, sl, ck,
   * thành tiền nhỏ lại để tiết kiệm dòng khi in".
   *
   * ⚠ CỘT TÊN HÀNG LÀ CỘT DUY NHẤT KHÔNG ĐẶT BỀ RỘNG — nó nhận toàn bộ
   * chỗ còn lại. Đặt một con số cho nó là biến nó thành cột thứ bảy có
   * trần, và chỗ thừa rơi vào đâu không ai biết.
   */
  const th = (label: string): string | null => {
    const re = new RegExp(`<th className=\\{(?:\`\\$\\{CELL\\} ([\\w-]+)\`|CELL)\\}>${label}<`)
    const m = re.exec(DOC)
    return m ? (m[1] ?? "") : null
  }
  /** Tailwind `w-N` → px. */
  const px = (cls: string) => (cls ? Number(cls.replace("w-", "")) * 4 : NaN)

  it("cột tên hàng không đặt bề rộng", () => {
    expect(th("Tên hàng và quy cách"), "không tìm thấy cột tên hàng").toBe("")
  })

  it.each([
    ["ĐVT", 48],
    ["SL", 32],
    ["CK", 32],
    ["Thành tiền", 80],
  ])("cột %s rộng %ipx", (label, want) => {
    const cls = th(label)
    expect(cls, `không tìm thấy cột ${label}`).toBeTruthy()
    expect(px(cls!)).toBe(want)
  })

  /**
   * ⚠ SÁU CỘT CÓ TRẦN KHÔNG ĐƯỢC PHÌNH TRỞ LẠI. Đây là tripwire: cột nào
   * được nới ra sau này thì chỗ ấy lấy thẳng từ cột tên hàng, và cả thay
   * đổi hôm nay thành vô nghĩa.
   *
   * Phép đo, ghi lại để đừng ai phải đo lại:
   *   A5 rộng 148mm, lề 8mm mỗi bên → ~132mm ≈ 499px cho cả bảng.
   *   `box-sizing: border-box` nên đệm nằm TRONG bề rộng đã đặt; chỉ cột
   *   tên hàng mới phải trừ đệm của chính nó.
   *
   *   TRƯỚC: 36+64+48+80+64+96 = 388px → tên hàng còn 111px, trừ đệm
   *          px-1.5 còn ~99px ≈ 19 ký tự một dòng ở 10,5pt Times.
   *   SAU:   36+48+32+80+32+80 = 308px → tên hàng được 191px, trừ đệm
   *          px-1 còn ~183px ≈ 35 ký tự.
   *   Tên hàng ~50 ký tự vì thế xuống từ 3 dòng còn 2 — mỗi mặt hàng
   *   tiết kiệm một dòng.
   *
   * ⚠ KHÔNG HẠ TIẾP `Đ.giá` VÀ `Thành tiền`: 80px đã sát min-content của
   *   một số tiền tám chữ số ("12.345.678" ≈ 83px ở 10,5pt). Hạ nữa thì
   *   trình duyệt bỏ qua con số, hoặc tệ hơn là cột tiền xuống dòng.
   */
  it("sáu cột có trần không phình trở lại", () => {
    const fixed = ["STT", "ĐVT", "SL", "Đ.giá", "CK", "Thành tiền"]
      .map((l) => px(th(l)!))
      .reduce((a, b) => a + b, 0)
    expect(Number.isNaN(fixed)).toBe(false)
    expect(fixed, `sáu cột chiếm ${fixed}px, trước khi sửa là 388px`).toBeLessThanOrEqual(308)
  })

  /**
   * ⚠ ĐỆM NGANG LÀ BẢY CỘT × HAI BÊN. Mỗi 1px bớt đi trả lại 14px cho
   * bảng, và toàn bộ chảy vào cột tên hàng. Đây là chỗ lấy lại được
   * nhiều nhất mà không ai phải đọc chữ nhỏ hơn.
   */
  it("đệm ngang của ô bảng là px-1", () => {
    expect(DOC).toContain('const CELL = "border border-black px-1 py-[2px] align-top leading-tight"')
  })
})
