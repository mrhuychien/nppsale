import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SEARCH_FIELD_PROPS } from "../src/lib/ui/search-field"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Ba màn có ô tìm gõ tay — để một màn tự khai riêng là màn đó sẽ quên. */
const FIELDS = [
  "src/components/orders/product-picker-sheet.tsx",
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

describe("Tấm trượt chọn sản phẩm co theo bàn phím", () => {
  const PICKER = read("src/components/orders/product-picker-sheet.tsx")
  const HOOK = read("src/hooks/use-viewport-height.ts")

  /**
   * ⚠ `vh` và `dvh` đo theo khung TRANG, không trừ bàn phím. Mở bàn phím
   * lên thì gần một nửa tấm trượt nằm dưới nó, và danh sách kết quả biến
   * mất đúng lúc người dùng đang gõ để tìm.
   */
  it("đo theo visualViewport, không theo vh", () => {
    expect(HOOK).toContain("window.visualViewport")
    expect(PICKER).toContain("useViewportHeight(open)")
    expect(PICKER).toContain("style={vh ? { height: Math.round(vh * 0.92) } : undefined}")
  })

  /**
   * ⚠ Bàn phím iOS có lúc CUỘN khung nhìn chứ không đổi kích thước —
   * thiếu 'scroll' thì chiều cao đứng im dù trang đã bị đẩy lên.
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
  it("có đường lùi CSS khi chưa đo được", () => {
    expect(HOOK).toContain("): number | null {")
    expect(PICKER).toContain('className="flex h-[88vh] flex-col p-0"')
  })

  /** Chỉ đo khi tấm trượt đang mở — đừng gắn bộ lắng nghe suốt đời trang. */
  it("chỉ lắng nghe khi đang mở", () => {
    expect(HOOK).toContain("if (!active) return")
  })
})
