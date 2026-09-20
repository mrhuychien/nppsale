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
