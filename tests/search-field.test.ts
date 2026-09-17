import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SEARCH_FIELD_PROPS } from "../src/lib/ui/search-field"
import { bottomInsetOf, bottomSheetBox } from "../src/hooks/use-viewport-insets"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Mọi ô tìm gõ tay — để một màn tự khai riêng là màn đó sẽ quên. */
const FIELDS = [
  "src/app/(dashboard)/sell/page.tsx",
  "src/app/(dashboard)/sell/customer/page.tsx",
  "src/components/ui/mobile-filter-bar.tsx",
  "src/components/layout/mobile-search-overlay.tsx",
].map((f) => ({ file: f, src: read(f) }))

describe("Ô tìm kiếm không được gọi thanh điền tự động của iOS", () => {
  /**
   * ⚠ NGUYÊN NHÂN. Trên iOS Safari, `<input>` không khai báo mình là gì
   * sẽ bị coi là ô có thể điền tự động: Safari dựng một THANH ĐEN ngay
   * trên bàn phím với bốn nút (chìa khoá · thẻ · vị trí · ✓). Thanh đó
   * che đúng phần kết quả tìm mà NVBH cần nhìn.
   *
   * `type="search"` mới là thứ tắt nó. `inputMode` chỉ đổi bàn phím hiện
   * ra, không nói gì về mục đích của ô.
   */
  it("khai type=search, không chỉ inputMode", () => {
    expect(SEARCH_FIELD_PROPS.type).toBe("search")
    expect(SEARCH_FIELD_PROPS.autoComplete).toBe("off")
  })

  /**
   * ⚠ Hàng gợi ý gõ chữ ("Kaka · Uh · Vib") ăn thêm một hàng chiều cao và
   * vô dụng khi tra mã SKU — tên hàng là "Huxiaoqi 328g", không từ điển
   * nào đoán đúng. Viết hoa tự động còn làm hỏng mã.
   */
  it("tắt gợi ý gõ chữ và viết hoa tự động", () => {
    expect(SEARCH_FIELD_PROPS.autoCorrect).toBe("off")
    expect(SEARCH_FIELD_PROPS.autoCapitalize).toBe("off")
    expect(SEARCH_FIELD_PROPS.spellCheck).toBe(false)
  })

  /** Bàn phím vẫn phải là bàn phím tìm kiếm, phím Enter là "tìm". */
  it("giữ nguyên kiểu bàn phím tìm kiếm", () => {
    expect(SEARCH_FIELD_PROPS.inputMode).toBe("search")
    expect(SEARCH_FIELD_PROPS.enterKeyHint).toBe("search")
  })

  it.each(FIELDS)("$file dùng bộ thuộc tính chung", ({ src }) => {
    expect(src).toContain("{...SEARCH_FIELD_PROPS}")
    // Không còn khai lẻ — khai lẻ là chỗ để quên `type`.
    expect(src).not.toContain('inputMode="search"\n')
  })
})

describe("Tấm trượt đáy phải nằm TRÊN bàn phím", () => {
  // Tấm trượt chọn sản phẩm của màn tạo đơn cũ là chỗ lỗi này lộ ra; màn đó
  // đã bị xoá. Tấm trượt còn lại có ô gõ tay là `LineEditSheet` (sửa dòng
  // hàng: số lượng, giá, ghi chú) — nó dùng đúng phép đo đó.
  const SHEET_USER = read("src/components/sell/line-edit-sheet.tsx")
  const HOOK = read("src/hooks/use-viewport-insets.ts")

  /**
   * Số đo thật, iPhone Safari dọc, tính bằng px CSS.
   *
   * `LAYOUT` là khung trang — thứ `100vh` và `bottom: 0` bám vào; nó KHÔNG
   * co lại khi bàn phím mở. `VISUAL` là phần còn nhìn thấy.
   */
  const LAYOUT = 745
  const KEYBOARD = 336 // bàn phím + thanh phụ trợ đen phía trên nó
  const VISUAL = LAYOUT - KEYBOARD // 409
  const RATIO = 0.92

  /** Khoảng tấm trượt chiếm trên trục dọc của KHUNG TRANG. */
  const span = (height: number, bottom: number) => ({
    top: LAYOUT - bottom - height,
    bottom: LAYOUT - bottom,
  })

  /**
   * ⚠ LỖI NGƯỜI DÙNG CHỤP LẠI ĐƯỢC. Bản trước chỉ hạ CHIỀU CAO theo khung
   * nhìn mà vẫn để tấm trượt neo `bottom: 0`. Đáy khung trang nằm dưới bàn
   * phím, nên cả tấm trượt tụt xuống dưới đó: chỉ còn một sợi trắng ló ra,
   * không thấy ô tìm, không thấy danh sách, không thấy nút Xong.
   *
   * Phép kiểm này DỰNG LẠI cách làm cũ và đo ra đúng sợi trắng ấy — để ai
   * đọc sau biết vì sao phải có `bottom`, chứ không tưởng nó thừa.
   */
  it("cách cũ (bottom: 0) đẩy gần hết tấm trượt xuống dưới bàn phím", () => {
    const s = span(Math.round(VISUAL * RATIO), 0)
    const visiblePart = VISUAL - s.top
    expect(s.top).toBeGreaterThan(VISUAL - 60) // gần sát mép bàn phím
    expect(visiblePart).toBeLessThan(60) // đúng "sợi trắng"
  })

  it("cách mới nhấc tấm trượt lên đúng chiều cao bàn phím", () => {
    const box = bottomSheetBox({ height: VISUAL, bottomInset: KEYBOARD }, RATIO)
    const s = span(box.height, box.bottom)
    // Không mẩu nào nằm dưới mép bàn phím.
    expect(s.bottom).toBe(VISUAL)
    // Và không tràn lên quá đỉnh màn hình.
    expect(s.top).toBeGreaterThanOrEqual(0)
    // Nhìn thấy TRỌN chiều cao đã tính, không phải một phần.
    expect(s.bottom - s.top).toBe(box.height)
  })

  it("bàn phím đóng thì tấm trượt trở lại sát đáy màn hình", () => {
    const box = bottomSheetBox({ height: LAYOUT, bottomInset: 0 }, RATIO)
    expect(box.bottom).toBe(0)
    expect(span(box.height, box.bottom).bottom).toBe(LAYOUT)
  })

  /** Khung nhìn bị CUỘN trong khung trang — phần đáy khuất vẫn phải trừ đủ. */
  it("trừ cả phần khung nhìn bị đẩy xuống", () => {
    expect(bottomInsetOf(LAYOUT, VISUAL, 0)).toBe(KEYBOARD)
    expect(bottomInsetOf(LAYOUT, VISUAL, 100)).toBe(KEYBOARD - 100)
  })

  /**
   * ⚠ Thu phóng hai ngón làm khung nhìn CAO HƠN khung trang, hiệu số ra
   * âm. `bottom` âm đẩy tấm trượt ra ngoài màn hình — hỏng nặng hơn lỗi
   * đang sửa.
   */
  it("không bao giờ trả số âm", () => {
    expect(bottomInsetOf(LAYOUT, 900, 0)).toBe(0)
    expect(bottomInsetOf(LAYOUT, VISUAL, 999)).toBe(0)
  })

  it("tấm trượt đặt cả hai giá trị, không chỉ chiều cao", () => {
    expect(SHEET_USER).toContain("bottomSheetBox(vp, 0.92)")
    expect(SHEET_USER).toContain(
      "style={box ? { height: box.height, bottom: box.bottom } : undefined}"
    )
  })

  /**
   * ⚠ Bàn phím iOS có lúc CUỘN khung nhìn chứ không đổi kích thước —
   * thiếu 'scroll' thì số đo đứng im dù trang đã bị đẩy lên.
   */
  it("lắng nghe cả resize lẫn scroll của khung nhìn", () => {
    expect(HOOK).toContain('vv.addEventListener("resize", update)')
    expect(HOOK).toContain('vv.addEventListener("scroll", update)')
    expect(HOOK).toContain('vv.removeEventListener("resize", update)')
    expect(HOOK).toContain('vv.removeEventListener("scroll", update)')
  })

  /**
   * ⚠ Trình duyệt không có `visualViewport`, hoặc render ở máy chủ, thì
   * phải còn đường lùi bằng CSS. Để chiều cao thành 0 là tấm trượt biến
   * mất hẳn.
   */
  /**
   * ⚠ Trình duyệt không có `visualViewport`, hoặc render ở máy chủ, thì
   * `box` là `null` và không có `style` nào được đặt. Đường lùi khi đó là
   * class của chính `SheetContent`; để nó không khai chiều cao nào thì tấm
   * trượt cao 0 và biến mất hẳn.
   */
  it("có đường lùi CSS khi chưa đo được", () => {
    expect(HOOK).toContain("): ViewportInsets | null {")
    expect(SHEET_USER).toContain("style={box ? ")
    const SHEET = read("src/components/ui/sheet.tsx")
    expect(SHEET).toContain("max-h-[85vh]")
  })

  /** Chỉ đo khi tấm trượt đang mở — đừng gắn bộ lắng nghe suốt đời trang. */
  it("chỉ lắng nghe khi đang mở", () => {
    expect(HOOK).toContain("if (!active) return")
    expect(SHEET_USER).toContain("useViewportInsets(open)")
  })
})
