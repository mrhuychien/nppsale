import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Ô CHỌN CÓ TÌM KIẾM — chủ nhà chốt: chọn NCC ở phiếu nhập kho phải "làm
 * như thông lệ", tức ô gõ được kèm danh sách xổ xuống.
 *
 * Bản cũ là một `<Select>` liệt kê hết rồi bắt cuộn: nhà phân phối có vài
 * chục NCC thì đó là cuộn tay mỗi lần nhập một phiếu.
 */
const SS = readFileSync("src/components/ui/search-select.tsx", "utf8")
const STOCKIN = readFileSync("src/app/(dashboard)/inventory/stock-in/page.tsx", "utf8")

describe("ô chọn có tìm kiếm", () => {
  /** ⚠ Bắt gõ đủ dấu là bắt người dùng bỏ cuộc và cuộn tay như cũ. */
  it("bỏ dấu khi so, dùng chung hàm tìm của kho mã", () => {
    expect(SS).toContain("viMatchAllWords(t, o.label, o.hint, o.keywords)")
  })

  /**
   * ⚠ BÀN PHÍM PHẢI DÙNG ĐƯỢC. Đây là màn nhập liệu hàng loạt — người ta
   * gõ cả phiếu mà không rời tay khỏi bàn phím.
   */
  it("đi được bằng bàn phím", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      expect(SS, `thiếu phím ${key}`).toContain(`e.key === "${key}"`)
    }
  })

  /**
   * ⚠ `onMouseDown` CHỨ KHÔNG PHẢI `onClick`. `blur` của ô nhập chạy
   * TRƯỚC `click`, nên dùng `onClick` thì danh sách đóng trước khi cú bấm
   * tới nơi và người dùng bấm mãi không chọn được.
   */
  it("chọn bằng mousedown, không phải click", () => {
    const item = SS.slice(SS.indexOf("results.map((o, i) =>"))
    expect(item).toContain("onMouseDown={(e) => {")
    expect(item).not.toContain("onClick={() => choose(o)}")
  })

  /** ⚠ Không đóng khi bấm ra ngoài thì danh sách che mất ô tiếp theo. */
  it("bấm ra ngoài thì đóng", () => {
    expect(SS).toContain('document.addEventListener("mousedown", onDown)')
    expect(SS).toContain('document.removeEventListener("mousedown", onDown)')
  })

  /** ⚠ Danh sách đổi thì con trỏ về đầu, nếu không Enter chọn nhầm mục cũ. */
  it("đổi từ khoá thì con trỏ về đầu", () => {
    expect(SS).toContain("useEffect(() => setActive(0), [term])")
  })

  /**
   * ⚠ GÕ TAY PHẢI ĐƯỢC GIỮ KHI RỜI Ô. Không có nhánh này thì người dùng
   * gõ xong một tên lạ, bấm sang ô kế, và chữ vừa gõ biến mất.
   */
  it("giữ chữ gõ tay khi rời ô", () => {
    const blur = SS.slice(SS.indexOf("onBlur={() => {"), SS.indexOf("<div className=\"absolute right-2"))
    expect(blur).toContain("if (!allowFreeText) return")
    expect(blur).toContain("onPick(null, t)")
  })

  /** Chọn nhầm phải bỏ được, không thì phải tải lại trang. */
  it("có nút bỏ chọn", () => {
    expect(SS).toContain('aria-label="Bỏ chọn"')
  })
})

describe("phiếu nhập kho dùng ô mới", () => {
  it("thay <Select> bằng ô tìm", () => {
    expect(STOCKIN).toContain("<SearchSelect")
    expect(STOCKIN).not.toContain('placeholder="Chọn nhà cung cấp..."')
    expect(STOCKIN).not.toContain('<SelectItem value="_manual">')
  })

  /** ⚠ Kho gọi NCC theo mã in trên thùng hàng — mã phải tìm được. */
  it("tìm được cả theo mã NCC", () => {
    const opts = STOCKIN.slice(STOCKIN.indexOf("const supplierOptions"), STOCKIN.indexOf("const supplierOptions") + 500)
    expect(opts).toContain("hint: s.code || null")
    expect(opts).toContain("keywords: s.code || null")
  })

  /**
   * ⚠ HAI ĐƯỜNG KHÁC HẲN NHAU VỀ TIỀN. Chọn NCC CÓ trong danh mục thì lúc
   * lưu sinh CÔNG NỢ NCC; gõ tay thì chỉ ghi vào ghi chú. `onPick` trả
   * `null` cho trường hợp gõ tay nên không có đường nào lẫn hai thứ.
   */
  it("giữ nguyên ranh giới có mã / gõ tay", () => {
    expect(STOCKIN).toContain("setSupplierId(opt?.id ?? \"\")")
    expect(STOCKIN).toContain("setSupplier(text)")
  })

  /**
   * ⚠ NÓI RÕ ĐANG ĐI ĐƯỜNG NÀO. Đây là chỗ quyết định có sinh công nợ NCC
   * hay không; im lặng thì người nhập kho chỉ biết lúc đối chiếu cuối
   * tháng.
   */
  it("nói rõ trường hợp nào sinh công nợ, trường hợp nào không", () => {
    expect(STOCKIN).toContain("sẽ ghi <strong>công nợ NCC</strong>")
    expect(STOCKIN).toContain("<strong>không sinh công nợ NCC</strong>")
  })

  /** Vẫn còn đường tạo NCC mới ngay tại chỗ. */
  it("giữ đường tạo NCC mới", () => {
    expect(STOCKIN).toContain("Tạo nhà cung cấp mới")
  })
})
