import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { chuCaiDau, boTienToCuaHang } from "../src/lib/pos/avatar"

/**
 * CHỌN KHÁCH / CHỌN NHÂN VIÊN Ở `/pos` — đợt 22/09/2026.
 *
 * Chủ nhà chốt ba việc, kèm bản vẽ:
 *   · "Chọn khách hàng -> hiện modal chọn"
 *   · "Chọn nhân viên -> sửa giao diện như hình (chỉ cần tên nhân viên
 *     ko cần thông tin kèm)"
 *   · "Sao phần tìm khách hiện tại có 50 kết quả?"
 *
 * ⚠ CÂU THỨ BA KHÔNG PHẢI CÂU HỎI GIAO DIỆN, NÓ LÀ MỘT LỖI NÓI DỐI. Ô
 * tìm dừng vòng lặp ở mã thứ 50 rồi hiện số dòng ĐÃ CẮT. Tám trăm khách
 * khớp chữ "a" thì màn hình vẫn ghi "50 kết quả" — người dùng đọc ra
 * "chỉ có 50 khách tên a", không thấy khách của mình, rồi đi tạo trùng.
 * Một khách trùng là công nợ tách làm hai sổ.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const TIM = code(read("src/components/pos/search-dropdown.tsx"))
const NVBH = code(read("src/components/pos/seller-picker.tsx"))
const DON = code(read("src/components/pos/order-screen.tsx"))

describe("số kết quả phải là số THẬT, không phải số đã cắt", () => {
  /**
   * ⚠ ĐẾM ĐỦ RỒI MỚI CẮT. Vòng lặp dừng ở trần là vĩnh viễn không biết
   * có bao nhiêu mã khớp — và con số hiện lên trở thành một lời nói dối
   * không có cách nào phát hiện từ màn hình.
   */
  it("vòng lặp đếm không dừng ở trần vẽ", () => {
    const i = TIM.indexOf("for (let k = 0")
    expect(i, "không còn vòng lọc").toBeGreaterThan(-1)
    const dieuKien = TIM.slice(i, TIM.indexOf(")", i))
    expect(dieuKien, "vòng lặp vẫn dừng ở trần — số khớp lại là số đã cắt")
      .not.toMatch(/out\.length\s*<|TRAN_VE|<\s*50/)
    expect(dieuKien, "vòng lặp không quét hết danh mục").toContain("items.length")
  })

  it("trần chỉ cắt phần VẼ, không cắt phần ĐẾM", () => {
    const i = TIM.indexOf("for (let k = 0")
    const than = TIM.slice(i, TIM.indexOf("return { ketQua: out", i))
    /* Đếm trước, cắt sau — và cắt bằng một điều kiện riêng. */
    expect(than, "không còn biến đếm riêng").toMatch(/n\+\+|n\s*\+=\s*1/)
    expect(than, "phần vẽ không bị chặn bởi trần — danh sách vẽ hết").toMatch(
      /if \(out\.length < TRAN_VE\)/
    )
  })

  it("ô rỗng cũng báo TỔNG danh mục, không báo số dòng vừa cắt", () => {
    const i = TIM.indexOf("if (!words.length)")
    expect(i).toBeGreaterThan(-1)
    const nhanh = TIM.slice(i, TIM.indexOf("\n", i))
    expect(nhanh, "chưa gõ gì mà vẫn báo số đã cắt").toContain("soKhop: items.length")
  })

  /**
   * ⚠ VÀ MÀN HÌNH PHẢI NÓI RA LÀ ĐÃ CẮT. Đếm đúng mà vẫn hiện một con
   * số trần trụi thì người dùng biết có 812 khách khớp nhưng vẫn không
   * hiểu vì sao chỉ thấy 50 — và không biết rằng gõ thêm sẽ ra khác.
   */
  it("bị cắt thì nói là đang hiện bao nhiêu trong bao nhiêu", () => {
    expect(TIM, "không so số khớp với số vẽ").toMatch(/soKhop > ketQua\.length/)
    expect(TIM, "không nói rõ đang hiện một phần").toContain("hiện ${ketQua.length} trong ${soKhop}")
    expect(TIM, "không chỉ cho người dùng đường thu hẹp").toContain("gõ thêm để thu hẹp")
  })
})

describe("chọn khách là một hộp giữa màn", () => {
  it("hộp neo vào màn hình, không neo vào thẻ khách", () => {
    /**
     * ⚠ `fixed` CHỨ KHÔNG `absolute`. Neo vào thẻ khách là hộp chỉ rộng
     *   bằng cột phải (420px) và bị cắt cụt khi cột ấy cuộn — đúng thứ
     *   chủ nhà vừa bảo đổi.
     */
    /**
     * ⚠ SOI `className` CỦA CHÍNH THẺ HỘP, đừng soi một cửa sổ quanh
     *   nó. Bản đầu của chốt này cắt 300 ký tự TRƯỚC `role="dialog"` —
     *   và nền mờ `fixed inset-0` nằm gọn trong cửa sổ ấy, nên đổi hộp
     *   về `absolute` chốt vẫn xanh. Đã thử phá đúng kiểu đó một lần.
     */
    const i = TIM.indexOf('role="dialog"')
    expect(i, "ô chọn khách không còn là một hộp").toBeGreaterThan(-1)
    const j = TIM.indexOf('className="', i)
    const the = TIM.slice(j, TIM.indexOf('"', j + 11))
    expect(the, "hộp vẫn neo vào thẻ cha").toMatch(/^className="fixed /)
    expect(the, "hộp không nằm giữa màn").toMatch(/left-1\/2[\s\S]*top-1\/2/)
    /* Nền mờ phủ cả màn, nếu không bấm ra ngoài không đóng được. */
    expect(TIM, "mất nền mờ phủ màn").toMatch(/fixed inset-0/)
  })

  it("đóng được bằng cả nút ×, bấm nền, và phím Esc", () => {
    expect(TIM, "mất nút đóng").toMatch(/aria-label="Đóng"/)
    const i = TIM.indexOf("const onKeyDown")
    const than = TIM.slice(i, TIM.indexOf("\n  }", i))
    expect(than, "Esc không đóng hộp — hộp che cả màn mà chỉ thoát được bằng chuột")
      .toMatch(/"Escape"[\s\S]{0,80}onClose\(\)/)
  })

  it("mỗi dòng có vòng tròn chữ đầu như bản vẽ", () => {
    expect(TIM, "mất vòng tròn chữ đầu").toContain("chuCaiDau(it.title)")
  })

  /** ⚠ Bàn phím phải còn chạy — spec §10, và nó là lý do màn desktop tồn tại. */
  it("còn đi được bằng ↑↓ và Enter", () => {
    for (const k of ["ArrowDown", "ArrowUp", "Enter"]) {
      expect(TIM, `hộp chọn khách không xử lý phím ${k}`).toContain(`"${k}"`)
    }
  })
})

describe("ô gán nhân viên: chỉ tên, không thông tin kèm", () => {
  it("màn đơn dùng ô chọn riêng, không còn select trần", () => {
    /* Ô gán nằm trong `DocPeople` (23/09/2026) — khối ấy dùng `SellerPicker`. */
    expect(DON).toMatch(/<DocPeople/)
    const KHOI = readFileSync(resolve(__dirname, "../src/components/pos/doc-people.tsx"), "utf-8")
    expect(KHOI, "khối người được gán chưa dùng ô chọn nhân viên mới").toMatch(/<SellerPicker/)
    expect(KHOI, "vẫn là <select> trần — không theo bản vẽ").not.toContain("<select")
  })

  /**
   * ⚠ CHỦ NHÀ BỎ DÒNG PHỤ ĐI, nguyên văn: "chỉ cần tên nhân viên ko cần
   * thông tin kèm". Bản vẽ có "Tuyến Q.8 · Thứ 3 · 4 đơn hôm nay"; đừng
   * tiện tay thêm lại. Mỗi dòng phụ ở đây là một truy vấn nữa cho một
   * việc mỗi đơn làm đúng một lần.
   */
  it("mỗi dòng chỉ vẽ tên, không vẽ tuyến / số đơn", () => {
    const i = NVBH.indexOf("function Dong")
    expect(i, "không còn thành phần vẽ một dòng").toBeGreaterThan(-1)
    const than = NVBH.slice(i)
    for (const cam of ["Tuyến", "đơn hôm nay", "meta", "subtitle", "hint"]) {
      expect(than, `dòng nhân viên mọc lại thông tin kèm: ${cam}`).not.toContain(cam)
    }
  })

  it('"chưa gán" là một dòng chọn được, không phải chỗ trống', () => {
    /* Rỗng nghĩa là đơn đứng tên người đang đăng nhập (mig 153) — gán
       nhầm rồi phải gỡ ra được. */
    expect(NVBH).toContain('emptyLabel = "— chưa gán —"')
    expect(NVBH, "không gỡ được người đã gán").toMatch(/onChange\(""\)/)
  })

  it("dòng đang chọn có dấu tích", () => {
    expect(NVBH, "không biết đang gán cho ai").toContain("✓")
  })
})

describe("chữ cái đầu cho vòng tròn đại diện", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT CHẠY THẬT, KHÔNG PHẢI SOI CHỮ. Phép lấy chữ là một
   * hàm thuần, nên hỏi thẳng nó.
   */
  it("bỏ tiền tố loại hình rồi mới lấy chữ", () => {
    expect(chuCaiDau("Tạp hoá Bà Năm")).toBe("B")
    expect(chuCaiDau("Bách Hoá Xanh Q.8")).toBe("X")
    expect(chuCaiDau("Siêu thị Mini Hạnh")).toBe("M")
    expect(chuCaiDau("Đại lý Tuấn Phát")).toBe("T")
    expect(chuCaiDau("Cửa hàng Tuấn")).toBe("T")
  })

  /**
   * ⚠ ĐÂY LÀ LÝ DO CẢ HÀM NÀY TỒN TẠI. Lấy bừa chữ đầu là ở một nhà
   * phân phối thật, quá nửa danh sách hiện chữ "T" — vòng tròn không
   * phân biệt được gì và chỉ còn chiếm chỗ.
   */
  it("bốn cửa hàng khác nhau ra bốn chữ khác nhau", () => {
    const ds = ["Tạp hoá Bà Năm", "Tạp hoá Chín Lành", "Tạp hoá Đức Anh", "Tạp hoá Hương"]
    const chu = new Set(ds.map((x) => chuCaiDau(x)))
    expect(chu.size, "mọi cửa hàng ra cùng một chữ — vòng tròn vô dụng").toBe(4)
  })

  it("không có tiền tố thì giữ nguyên", () => {
    expect(chuCaiDau("Khách lẻ")).toBe("K")
    expect(boTienToCuaHang("Minh thúy mart")).toBe("Minh thúy mart")
  })

  it("tên đúng bằng tiền tố thì không cắt sạch thành rỗng", () => {
    expect(boTienToCuaHang("Tạp hoá")).toBe("Tạp hoá")
    expect(chuCaiDau("Tạp hoá")).toBe("T")
  })

  /**
   * ⚠ TIỀN TỐ PHẢI KHỚP TRỌN TỪ, không khớp nửa từ. "ch" là viết tắt
   * của "cửa hàng" và nó nằm trong danh sách — bỏ đòi hỏi khoảng trắng
   * đi thì "Chanh Tươi" bị cắt mất chữ "Chanh" và còn chữ "T", còn
   * "Shopee Mart" cắt ở "shop" và còn chữ "M". Cắt quá tay ra một chữ
   * chẳng liên quan gì tới cái tên người ta đọc.
   */
  it("tiền tố chỉ khớp khi nó là TRỌN một từ", () => {
    expect(chuCaiDau("Chanh Tươi")).toBe("C")
    expect(chuCaiDau("Shopee Mart")).toBe("S")
    expect(boTienToCuaHang("Chanh Tươi")).toBe("Chanh Tươi")
  })

  it("tên người lấy đầu họ + đầu tên, đúng lối viết tắt tiếng Việt", () => {
    expect(chuCaiDau("Nguyễn Thị Thương", "nguoi")).toBe("NT")
    expect(chuCaiDau("Trần Tiến", "nguoi")).toBe("TT")
    expect(chuCaiDau("Hạnh", "nguoi")).toBe("H")
  })

  /**
   * ⚠ Lấy hai từ ĐẦU sẽ ra "NT" cho cả "Nguyễn Thị Thương" lẫn "Nguyễn
   *   Thị Thu" — hai người một vòng tròn, đúng thứ vòng tròn sinh ra để
   *   tránh.
   */
  it("hai người cùng họ khác tên ra hai chữ khác nhau", () => {
    expect(chuCaiDau("Nguyễn Thị Thu", "nguoi")).not.toBe(
      chuCaiDau("Nguyễn Thị Bình", "nguoi")
    )
  })

  it("tên rỗng ra dấu hỏi, không ra vòng tròn trống", () => {
    /* Vòng tròn trống đọc ra là "đang tải", không phải "không có tên". */
    expect(chuCaiDau("")).toBe("?")
    expect(chuCaiDau("   ", "nguoi")).toBe("?")
  })
})
