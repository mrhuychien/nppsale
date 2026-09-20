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

describe("cỡ chữ chép từ tờ mẫu KiotViet", () => {
  it.each([["A5"], ["A4"]] as const)("%s: thân và bảng đều 10,5pt", (paper) => {
    expect(pt(paper, ""), "thân tờ").toBe(10.5)
    expect(pt(paper, " table"), "bảng — chính là tờ hóa đơn").toBe(10.5)
  })

  it.each([["A5"], ["A4"]] as const)("%s: tiêu đề 15pt, tên NPP 13,5pt, ghi chú nhỏ 7,5pt", (paper) => {
    expect(pt(paper, " h1"), "HÓA ĐƠN BÁN HÀNG").toBe(15)
    expect(pt(paper, " \\.doc-org-name"), "tên nhà phân phối").toBe(13.5)
    expect(pt(paper, " \\.doc-footer-note"), "ghi chú nhỏ chân trang").toBe(7.5)
  })

  /**
   * ⚠ THỨ BẬC PHẢI ĐÚNG: tiêu đề > tên NPP > thân > ghi chú nhỏ. Đây là
   * chốt bắt được cả những sai lệch mà bốn con số rời không bắt được —
   * ví dụ đổi thân lên 16pt thì tiêu đề thành chữ nhỏ hơn thân.
   */
  it.each([["A5"], ["A4"]] as const)("%s: giữ đúng thứ bậc cỡ chữ", (paper) => {
    const h1 = pt(paper, " h1")!
    const org = pt(paper, " \\.doc-org-name")!
    const body = pt(paper, "")!
    const foot = pt(paper, " \\.doc-footer-note")!
    expect(h1).toBeGreaterThan(org)
    expect(org).toBeGreaterThan(body)
    expect(body).toBeGreaterThan(foot)
  })

  /** Không còn dấu vết của con số đoán hôm trước. */
  it("không còn 13pt ở khối tờ in", () => {
    const i = CSS.indexOf('html:not([data-paper-size="A4"]) .a4-doc {')
    expect(CSS.slice(i, i + 2000)).not.toContain("font-size: 13pt")
  })

  /**
   * Hai lớp này là CẦU NỐI giữa CSS in và component; thiếu một bên thì
   * quy tắc ở trên không bám vào đâu và chữ rơi về cỡ thân.
   */
  it("component gắn đúng hai lớp mà CSS đang bám vào", () => {
    expect(DOC).toContain('className="doc-org-name text-lg font-bold uppercase leading-tight"')
    expect(DOC).toContain('className="doc-footer-note text-[10px] leading-tight"')
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
