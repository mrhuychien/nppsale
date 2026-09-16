import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { viMatchAllWords } from "../src/lib/search"
import { compareByStockDesc } from "../src/lib/orders/product-order"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const FORM = read("src/components/orders/order-form.tsx")
const PICKER = read("src/components/orders/product-picker-sheet.tsx")

/**
 * ⚠ Gọi ĐÚNG hàm mã nguồn dùng, không chép lại phép xếp vào đây.
 *
 * Bản đầu của file này tự viết lại phép so sánh — và khi thử phá bằng
 * cách bỏ vế phụ theo tên trong mã thật, phép kiểm vẫn XANH, vì nó đang
 * kiểm bản sao của chính nó. Một phép kiểm như vậy nói dối.
 */
type P = { id: string; name: string }
const byStock = compareByStockDesc

describe("Tìm sản phẩm lúc tạo đơn", () => {
  /**
   * Phép khớp đã đo trên 3.359 tên thật lấy từ file KiotViet của NPP:
   *   "bánh" → 1011 · "banh quy" → 274 · "bánh quy mỏng" → 4
   *   "ngũ cốc" → 48 · "SP003731" → 1 · "sp0037" → 33
   * Nên bản thân phép khớp KHÔNG hỏng — giữ vài ca để nó đừng hỏng về sau.
   */
  it("khớp không dấu, nhiều từ, và khớp cả mã SKU", () => {
    const p = { name: "Bánh quy mỏng 180g(16 gói/th)cty asianfood", sku: "SP003731" }
    expect(viMatchAllWords("banh quy", p.name, p.sku)).toBe(true)
    expect(viMatchAllWords("bánh quy mỏng", p.name, p.sku)).toBe(true)
    expect(viMatchAllWords("sp0037", p.name, p.sku)).toBe(true)
    // Thứ tự từ không quan trọng, nhưng THIẾU một từ thì không khớp.
    expect(viMatchAllWords("mỏng bánh", p.name, p.sku)).toBe(true)
    expect(viMatchAllWords("bánh xèo", p.name, p.sku)).toBe(false)
  })

  /**
   * ⚠ NGUYÊN NHÂN THẬT của "tìm kiếm không hoạt động". Tải 1.740 sản phẩm
   * kèm bảng giá và đơn vị quy đổi mất vài giây; trong lúc đó `products`
   * rỗng nên gõ gì cũng ra 0 kết quả — mà dropdown lại CHỈ hiện khi có kết
   * quả, nên màn hình im lặng hoàn toàn.
   */
  it("có trạng thái đang tải danh mục", () => {
    expect(FORM).toContain("const [refLoading, setRefLoading] = useState(true)")
    expect(FORM).toContain("setRefLoading(false)")
  })

  /** Ba trạng thái phải nói ba câu khác nhau, không cùng im lặng. */
  it("đang tải và không tìm thấy đều nói ra", () => {
    expect(FORM).toContain("Đang tải danh mục sản phẩm…")
    expect(FORM).toContain("Không tìm thấy sản phẩm nào khớp")
    // Không còn điều kiện cũ khiến dropdown biến mất khi rỗng.
    expect(FORM).not.toContain("{productDropdownOpen && filteredProducts.length > 0 && (")
  })

  /** 1.740 sản phẩm nhân mỗi phím gõ, lại thêm phép sắp xếp. */
  it("lọc và xếp có nhớ kết quả", () => {
    expect(FORM).toContain("const filteredProducts = useMemo(() => {")
  })
})

describe("Sản phẩm tồn nhiều hiện trước", () => {
  const stock = { a: 0, b: 500, c: 120, d: 500 }
  const items: P[] = [
    { id: "a", name: "An (hết hàng)" },
    { id: "b", name: "Bình" },
    { id: "c", name: "Cường" },
    { id: "d", name: "Dũng" },
  ]

  it("tồn nhiều lên đầu, hết hàng xuống cuối", () => {
    const sorted = [...items].sort(byStock(stock))
    expect(sorted.map((x) => x.id)).toEqual(["b", "d", "c", "a"])
  })

  /** ⚠ Hết hàng KHÔNG bị ẩn — khách vẫn hỏi, nhân viên vẫn cần tra giá. */
  it("hết hàng vẫn còn trong danh sách", () => {
    expect([...items].sort(byStock(stock)).map((x) => x.id)).toContain("a")
  })

  /**
   * ⚠ Cùng mức tồn thì phải có thứ tự CỐ ĐỊNH. Không có vế phụ theo tên
   * thì hai lần gõ cùng một từ có thể ra hai thứ tự khác nhau.
   */
  it("cùng mức tồn thì xếp theo tên, thứ tự ổn định", () => {
    const a = [...items].sort(byStock(stock)).map((x) => x.id)
    const b = [...items].reverse().sort(byStock(stock)).map((x) => x.id)
    expect(a).toEqual(b)
  })

  /** Sản phẩm chưa có trong bản đồ tồn kho coi như tồn 0, không nổ. */
  it("thiếu số liệu tồn thì coi như 0", () => {
    const sorted = [...items, { id: "x", name: "Xoài" }].sort(byStock(stock))
    expect(sorted[sorted.length - 1].id).toBe("x")
  })

  /**
   * ⚠ MỘT phép xếp dùng chung, không phải hai bản chép. Hai màn làm cùng
   * một việc; để hai phép xếp riêng thì NVBH thấy hai thứ tự khác nhau
   * trên hai thiết bị mà không hiểu vì sao — và sửa một bên quên bên kia.
   */
  it("cả hai màn dùng CHUNG một phép xếp", () => {
    expect(FORM).toContain('compareByStockDesc } from "@/lib/orders/product-order"')
    expect(PICKER).toContain('compareByStockDesc } from "@/lib/orders/product-order"')
    expect(FORM).toContain("compareByStockDesc(stockByProduct)")
    expect(PICKER).toContain("compareByStockDesc(stockByProduct)")
    // Không còn bản chép nội tuyến ở màn nào.
    expect(FORM).not.toContain("stockByProduct[b.id] ?? 0) - (stockByProduct[a.id]")
    expect(PICKER).not.toContain("stockByProduct[b.id] ?? 0) - (stockByProduct[a.id]")
  })

  /**
   * ⚠ Phải SẮP XẾP TRƯỚC khi cắt `RENDER_CAP`. Cắt trước thì 60 dòng lấy
   * ra là 60 dòng đầu theo tên, và phép xếp theo tồn chỉ áp lên đúng phần
   * đã bị cắt — mặt hàng còn nhiều nhất có thể không lọt vào.
   */
  it("bộ chọn xếp trước rồi mới cắt", () => {
    expect(PICKER).toContain(".sort(byStock).slice(0, RENDER_CAP)")
    expect(PICKER).not.toContain(".slice(0, RENDER_CAP).sort(")
  })

  /** "Hay lấy" vẫn lên đầu — đó là thứ NVBH gõ nhiều nhất. */
  it("giữ nhóm sản phẩm hay lấy ở đầu khi chưa gõ gì", () => {
    expect(PICKER).toContain("return ra !== rb ? ra - rb : byStock(a, b)")
  })
})
