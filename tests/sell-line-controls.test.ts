import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SHEET = code(read("src/components/sell/line-edit-sheet.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const RET = code(read("src/app/(dashboard)/sell/returns/page.tsx"))

/** Thân hàm `Stepper`. */
const STEPPER = SHEET.slice(SHEET.indexOf("export function Stepper("))

/**
 * Khối `<div>` gần nhất bao quanh `pos` mà có `justify-between` — tức là
 * một HÀNG xếp ngang. Trả `null` nếu không có.
 *
 * Quét tuyến tính giữ ngăn xếp thẻ mở, nên không cần bộ phân tích JSX:
 * đủ để trả lời đúng một câu "hai khối này có nằm chung một hàng không".
 */
function enclosingRowOf(src: string, pos: number): string | null {
  const open: number[] = []
  const re = /<div\b|<\/div>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null && m.index < pos) {
    if (m[0] === "</div>") open.pop()
    else open.push(m.index)
  }
  // Từ thẻ trong cùng đi ngược ra, lấy thẻ đầu tiên là một hàng ngang.
  for (let k = open.length - 1; k >= 0; k--) {
    const start = open[k]
    const tagEnd = src.indexOf(">", start)
    const tag = src.slice(start, tagEnd + 1)
    // ⚠ "Hàng ngang" = thẻ flex KHÔNG phải cột. Bản đầu đòi có
    // `justify-between`; đổi bố cục sang `flex items-end gap-2` là phép tìm
    // trả về `null` và chốt đỏ vì lý do sai — nó tưởng không có hàng nào,
    // chứ không phải hàng đó có vấn đề.
    if (!/\bflex\b/.test(tag) || /flex-col/.test(tag)) continue
    // Tìm thẻ đóng khớp.
    let depth = 0
    const scan = /<div\b|<\/div>/g
    scan.lastIndex = start
    let t: RegExpExecArray | null
    while ((t = scan.exec(src)) !== null) {
      depth += t[0] === "</div>" ? -1 : 1
      if (depth === 0) return src.slice(start, t.index + 6)
    }
    return src.slice(start)
  }
  return null
}


describe("Nút − không bao giờ xoá dòng", () => {
  /**
   * ⚠ LỖI NGƯỜI DÙNG BÁO. Bản trước biến nút − thành thùng rác khi số
   * lượng bằng 1: cùng một chỗ trên màn hình làm hai việc khác hẳn nhau
   * tuỳ con số đang hiện. Bấm − từ 2 xuống 1 rồi bấm tiếp theo quán tính
   * là mất dòng — và muốn bỏ một dòng đang để 8 thùng thì phải bấm − bảy
   * lần mới thấy nút xoá xuất hiện.
   */
  it("bộ đếm không còn nhận việc xoá", () => {
    expect(STEPPER).not.toContain("onRemove")
    expect(STEPPER).not.toContain("🗑")
    expect(STEPPER).not.toContain("Xoá dòng")
  })

  it("− khoá lại ở số 1, không giảm tiếp và không xoá", () => {
    /* ⚠ SÀN NAY LÀ THAM SỐ, MẶC ĐỊNH 1 — màn hóa đơn cần sàn 0 ("đợt
       này không xuất dòng này"), giỏ hàng vẫn sàn 1. Chốt đòi ĐÚNG hai
       điều: mặc định là 1, và nút − so với sàn ấy. */
    expect(STEPPER).toContain("min = 1,")
    expect(STEPPER).toContain("const atMin = qty <= min")
    expect(STEPPER).toContain("disabled={atMin}")
    expect(STEPPER).toMatch(/onClick=\{\(\) => onChange\(qty - 1\)\}/)
  })

  /** Gõ tay số 0 cũng không được biến thành xoá dòng. */
  it("gõ tay không tụt xuống dưới 1", () => {
    expect(STEPPER).toContain("onChange(Math.max(min, parseInt(digits, 10)))")
  })

  /**
   * Không màn nào còn truyền việc xoá vào bộ đếm.
   *
   * ⚠ Soi TỪNG lời gọi `<Stepper …/>`, không soi cả file: sheet sửa dòng
   * vẫn có một prop `onRemove` hợp lệ cho nút "Xoá dòng" của riêng nó, và
   * chốt soi cả file sẽ bắt nhầm đúng thứ nên giữ.
   */
  it.each([
    ["giỏ hàng", CART],
    ["hàng trả", RET],
    ["sheet sửa dòng", SHEET],
  ])("%s không truyền onRemove cho bộ đếm", (_l, src) => {
    const calls = src.match(/<Stepper[\s\S]*?\/>/g) ?? []
    expect(calls.length, "không tìm thấy lời gọi Stepper nào").toBeGreaterThan(0)
    for (const c of calls) expect(c, c).not.toContain("onRemove")
  })
})

describe("Nút xoá LUÔN có mặt trên mỗi dòng", () => {
  it("dòng giỏ hàng có nút xoá riêng", () => {
    expect(CART).toContain("<Trash2")
    expect(CART).toMatch(/onClick=\{\(\) => cart\.setQty\(r\.i, 0\)\}/)
    // Có nhãn cho trình đọc màn hình, và nhãn nói rõ xoá cái gì.
    expect(CART).toContain('aria-label={`Xoá ${r.product?.name ?? "dòng"}`}')
  })

  /**
   * ⚠ Nút xoá KHÔNG được nằm trong nút mở sheet sửa dòng. Lồng nút trong
   * nút thì chạm vào đâu cũng mở sheet, và nút xoá thành vô dụng.
   */
  it("nút xoá nằm ngoài nút mở sheet sửa dòng", () => {
    const i = CART.indexOf("onClick={() => setEditIdx(r.i)}")
    const j = CART.indexOf("<Trash2", i)
    expect(j).toBeGreaterThan(i)
    // Giữa hai chỗ phải có thẻ đóng của nút mở sheet.
    expect(CART.slice(i, j)).toContain("</button>")
  })

  it("dòng hàng trả cũng có nút xoá riêng", () => {
    expect(RET).toContain('aria-label="Xoá dòng trả"')
    expect(RET).toMatch(/onClick=\{\(\) => cart\.setReturnQty\(i, 0\)\}/)
  })
})

describe("Màn hàng trả không tràn ngang", () => {
  /**
   * ⚠ LỖI NGƯỜI DÙNG BÁO. Bộ chọn "Trả tiền / Đổi hàng" xếp CẠNH bộ đếm
   * số lượng: trên màn 375px, thẻ chỉ còn ~323px bề ngang mà hai khối cộng
   * lại đã ~162px + 164px + lề — bộ đếm bị đẩy tràn ra ngoài mép phải và
   * bấm không tới nút +.
   */
  /**
   * ⚠ Soi theo CẤU TRÚC LỒNG NHAU, không theo "giữa hai khối có chuỗi X".
   *
   * Chốt bản đầu chỉ đòi giữa bộ chọn và bộ đếm xuất hiện chuỗi mở của một
   * hàng mới. Thử phá cho thấy bọc thêm một hàng quanh bộ chọn mà chốt vẫn
   * XANH — vì chuỗi đó vốn đã có sẵn ở dưới. Nay đi ngược lên cây thẻ tìm
   * đúng HÀNG chứa bộ đếm rồi soi xem hàng đó có chứa bộ chọn không.
   */
  it("hàng chứa bộ đếm KHÔNG chứa bộ chọn trả/đổi", () => {
    const row = enclosingRowOf(RET, RET.indexOf("<Stepper"))
    expect(row, "không tìm được hàng chứa bộ đếm").toBeTruthy()
    expect(row).toContain("<Stepper")
    expect(row, "bộ chọn trả/đổi đang nằm chung hàng với bộ đếm").not.toContain("Trả tiền")
  })

  /** Hai nút chia đều bề ngang thay vì rộng theo chữ bên trong. */
  it("nút trả/đổi dùng flex-1, không phải padding cố định", () => {
    expect(RET).toContain('"h-10 flex-1 rounded-lg text-[13px] font-extrabold"')
    expect(RET).not.toContain('"h-9 rounded-lg px-3 text-[13px] font-extrabold"')
  })

  /**
   * Bộ đếm không được co lại méo mó khi khối bên cạnh dài ra.
   *
   * Khối cạnh nó nay là Ô GIÁ — nó phải là phần CO, còn bộ đếm giữ nguyên
   * 164px. Ngược lại thì gõ một con số dài là bộ đếm bị bóp và bấm không
   * tới nút +.
   */
  it("bộ đếm giữ nguyên bề ngang, ô giá mới là phần co", () => {
    expect(RET).toContain('<div className="w-[164px] shrink-0">')
    expect(RET).not.toContain('w-[152px]')
    const row = enclosingRowOf(RET, RET.indexOf("<Stepper"))
    expect(row, "không tìm được hàng chứa bộ đếm").toBeTruthy()
    expect(row).toContain('className="min-w-0 flex-1"')
    expect(row).toContain("<ReturnPriceInput")
  })
})
