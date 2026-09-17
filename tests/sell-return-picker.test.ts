import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { selectedUnitOf, type PricedProduct } from "../src/lib/sell/pricing"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const RET = code(read("src/app/(dashboard)/sell/returns/page.tsx"))
const POS = code(read("src/app/(dashboard)/sell/page.tsx"))
const CARD = code(read("src/components/sell/product-card.tsx"))

describe("Chọn hàng trả dùng đúng thẻ của màn tìm hàng", () => {
  /**
   * ⚠ Bản trước là dãy nút gạch nối chỉ có TÊN hàng: không giá, không đơn
   * vị, không đổi được thùng/chai. Nhân viên phải thêm rồi mới biết dòng
   * trả đang tính theo đơn vị nào và bao nhiêu tiền — mà tiền hàng trả là
   * tiền TRỪ vào đơn, sai là sai thẳng vào số khách phải trả.
   */
  it("vẽ bằng ProductCard, không phải nút gạch nối", () => {
    expect(RET).toContain("<ProductCard")
    expect(RET).not.toContain("border-dashed")
  })

  it("có ô tìm và tìm được cả theo mã vạch", () => {
    expect(RET).toContain("viMatchAllWords(term, p.name, p.sku, p.barcode ?? \"\")")
    expect(RET).toContain("SEARCH_FIELD_PROPS")
  })

  /**
   * ⚠ Đơn vị chọn trên thẻ phải là đơn vị được THÊM. Thẻ hiện giá theo
   * thùng mà dòng trả lại ghi theo chai thì số tiền trừ lệch mười mấy lần.
   */
  it("đơn vị đang chọn trên thẻ là đơn vị được thêm", () => {
    // ⚠ Soi TRONG hàm `add`, không soi cả file. Thử phá cho thấy đổi riêng
    // dòng trong `add` thành `p.base_unit` mà chốt vẫn XANH — vì vòng lặp
    // vẽ thẻ bên dưới còn một dòng y hệt. Khi đó thẻ hiện giá theo thùng
    // còn dòng trả ghi theo chai: số tiền trừ lệch mười mấy lần.
    const i = RET.indexOf("const add = (")
    const body = RET.slice(i, RET.indexOf("\n  }", i))
    expect(i, "không tìm thấy hàm add").toBeGreaterThanOrEqual(0)
    expect(body).toContain("const unit = selectedUnitOf(unitSel, p)")
    expect(body).toContain("price: unitPriceFor(p, unit, groupId)")
    expect(RET).toContain("onPickUnit={(u) => setUnitSel((m) => ({ ...m, [p.id]: u }))}")
  })

  /** Hai màn dùng CHUNG một phép chọn đơn vị, không mỗi màn một kiểu. */
  it("cả hai màn tra đơn vị từ lib dùng chung", () => {
    expect(POS).toContain("selectedUnitOf(unitSel, p)")
    expect(RET).toContain("selectedUnitOf(unitSel, p)")
  })

  /**
   * ⚠ KHÔNG hiện tồn kho ở màn hàng trả. Khách đưa hàng LẠI cho mình, nên
   * "Hết hàng" tô đỏ ở đó trông như đang chặn và nhân viên sẽ không dám
   * bấm — trong khi trả hàng hết tồn là chuyện hoàn toàn bình thường.
   */
  it("thẻ ở màn hàng trả tắt dòng tồn kho", () => {
    expect(RET).toContain("showStock={false}")
    expect(RET).toContain('badgeLabel="Đã trả"')
    // Màn tìm hàng thì vẫn phải hiện tồn.
    expect(POS).not.toContain("showStock={false}")
  })

  it("thẻ mặc định VẪN hiện tồn — tắt phải là lựa chọn có chủ đích", () => {
    expect(CARD).toContain("showStock = true")
    expect(CARD).toContain('badgeLabel = "Trong giỏ"')
    expect(CARD).toContain("{showStock && (")
  })

  /**
   * Đơn chưa có hàng thì không để trống: khách vẫn trả được hàng mua từ
   * chuyến trước.
   */
  it("đơn rỗng thì rơi về cả danh mục, không hiện màn trống", () => {
    expect(RET).toContain("if (inOrder.length) return inOrder.slice(0, PICK_CAP)")
    expect(RET).toContain("return [...products].sort(byStock).slice(0, PICK_CAP)")
  })

  /** Đang xem danh sách nào thì nói ra — ba nguồn khác hẳn nhau. */
  it("nói rõ đang xem danh sách nào", () => {
    expect(RET).toContain("Hàng trong đơn này")
    expect(RET).toContain("Tất cả sản phẩm")
    expect(RET).toContain("Kết quả cho")
  })
})

describe("Phép chọn đơn vị dùng chung", () => {
  const p = {
    id: "p1",
    base_unit: "chai",
    units: [
      { unit_name: "thùng", conversion: 15 },
      { unit_name: "lốc", conversion: 6 },
    ],
  } as unknown as PricedProduct

  /**
   * ⚠ Chưa bấm gì thì mặc định là đơn vị CƠ SỞ, không phải phần tử đầu
   * bảng quy đổi — bảng đó có thể xếp thùng lên trước, và khi ấy chạm một
   * cái là thêm cả thùng thay vì một chai.
   */
  it("chưa chọn thì lấy đơn vị cơ sở", () => {
    expect(selectedUnitOf({}, p)).toBe("chai")
  })

  it("đã chọn thì giữ đúng lựa chọn", () => {
    expect(selectedUnitOf({ p1: "thùng" }, p)).toBe("thùng")
  })

  it("lựa chọn của sản phẩm khác không ảnh hưởng", () => {
    expect(selectedUnitOf({ p9: "thùng" }, p)).toBe("chai")
  })
})

describe("Thẻ sản phẩm không tràn khi mặt hàng có nhiều đơn vị", () => {
  /**
   * ⚠ Mặt hàng khai ba đơn vị (chai · lốc · thùng) thì ba nút cộng lại
   * rộng hơn phần còn lại của thẻ. Nhóm nút không co được sẽ đẩy GIÁ ra
   * ngoài mép phải — đúng kiểu tràn vừa phải sửa ở màn hàng trả.
   */
  it("nhóm nút đơn vị co được và cuộn ngang", () => {
    expect(CARD).toContain("flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl")
    expect(CARD).not.toContain('"flex gap-1 rounded-xl bg-surface-container p-[3px]"')
  })

  it("giá không bị bóp, nút đơn vị không bị bóp", () => {
    expect(CARD).toContain("shrink-0 whitespace-nowrap text-[18px]")
    expect(CARD).toContain("h-10 min-w-[64px] shrink-0 rounded-[9px]")
  })
})
