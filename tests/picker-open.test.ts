import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  pickerOpenReducer, PICKER_OPEN_INIT,
  type PickerEvent, type PickerOpenState,
} from "../src/lib/ui/picker-open"

/**
 * ĐÓNG / MỞ DẢI GỢI Ý CỦA `ProductPicker`.
 *
 * ⚠ BỘ CHỐT NÀY SINH RA TỪ MỘT LẦN CHỐT NÓI DỐI. Chủ nhà chốt "chọn
 * xong thì dải gợi ý phải thu lại"; bản vá viết đúng một dòng
 * `if (closeOnPick) setOpen(false)`, và chốt khi ấy chỉ ĐỌC MÃ NGUỒN
 * tìm đúng dòng ấy — chốt xanh, màn hình vẫn mở nguyên. Chủ nhà phải
 * báo lại: *"bấm thêm hàng xong danh sách nó chưa ẩn đi"*.
 *
 * Cái bị bỏ sót nằm ở CHUỖI SỰ KIỆN, không nằm ở dòng mã: đóng xong,
 * `pick()` trả tiêu điểm về ô nhập, mà ô nhập mở dải gợi ý khi nhận
 * tiêu điểm. Hai lệnh cùng một lượt xử lý sự kiện → kết quả cuối là MỞ.
 *
 * ⚠ NÊN MỌI CHỐT Ở ĐÂY CHẠY THẬT CHUỖI ẤY, không soi chữ.
 */

const ROOT = resolve(__dirname, "..")

/** Chạy một chuỗi sự kiện từ trạng thái đầu. */
function chay(
  events: PickerEvent[],
  closeOnPick: boolean,
  tu: PickerOpenState = PICKER_OPEN_INIT
): PickerOpenState {
  return events.reduce((s, e) => pickerOpenReducer(s, e, { closeOnPick }), tu)
}

describe("dải gợi ý mở ra khi nào", () => {
  it("ban đầu đóng", () => {
    expect(PICKER_OPEN_INIT.open).toBe(false)
  })

  /** ⚠ Chủ nhà chốt cho toàn app: "bấm vào là phải xổ list rồi". */
  it("nhận tiêu điểm, bấm, hoặc gõ đều mở", () => {
    for (const e of [{ t: "focus" }, { t: "click" }, { t: "type" }] as PickerEvent[]) {
      expect(chay([e], false).open, JSON.stringify(e)).toBe(true)
      expect(chay([e], true).open, JSON.stringify(e)).toBe(true)
    }
  })

  it("Esc và bấm ra ngoài đều đóng", () => {
    for (const e of [{ t: "escape" }, { t: "outside" }] as PickerEvent[]) {
      expect(chay([{ t: "click" }, e], true).open, JSON.stringify(e)).toBe(false)
    }
  })
})

describe("chọn một mã xong thì thế nào", () => {
  /**
   * ⚠ ĐÂY LÀ CHUỖI THẬT CỦA MỘT CÚ BẤM CHUỘT, và là chỗ bản trước sai:
   *   mở ô → bấm vào dòng gợi ý (tiêu điểm sang cái nút của dòng) →
   *   `pick()` đóng dải rồi trả tiêu điểm về ô → một lượt `focus` NỮA.
   *   Lượt ấy không được mở lại.
   */
  it("bấm chuột chọn xong, tiêu điểm quay về ô, dải vẫn ĐÓNG", () => {
    const s = chay(
      [{ t: "click" }, { t: "pick", refocus: true }, { t: "focus" }],
      true
    )
    expect(
      s.open,
      "dải gợi ý mở lại vì lệnh trả tiêu điểm — đúng lỗi chủ nhà đã báo"
    ).toBe(false)
  })

  /**
   * ⚠ BẤM `Enter` THÌ TIÊU ĐIỂM VẪN NẰM TRONG Ô, nên KHÔNG có lượt
   *   `focus` nào. Cờ bỏ qua không được bật ở đường này.
   */
  it("chọn bằng Enter cũng đóng, và không để lại cờ", () => {
    const s = chay([{ t: "click" }, { t: "pick", refocus: false }], true)
    expect(s.open).toBe(false)
    expect(
      s.skipNextFocus,
      "cờ bỏ qua còn sót ở đường Enter — nó sẽ nuốt lượt Tab kế tiếp"
    ).toBe(false)
  })

  /**
   * ⚠ VÀ CHỈ BỎ QUA ĐÚNG MỘT LƯỢT. Bỏ qua mãi là người dùng Tab vào ô
   *   mà dải không xổ ra nữa — chữa một đường dùng chuột bằng cách làm
   *   hỏng một đường dùng bàn phím.
   */
  it("lượt nhận tiêu điểm THỨ HAI thì mở lại bình thường", () => {
    const s = chay(
      [
        { t: "click" },
        { t: "pick", refocus: true },
        { t: "focus" }, // lượt do pick trả tiêu điểm — bỏ qua
        { t: "focus" }, // người dùng Tab vào ô — phải mở
      ],
      true
    )
    expect(s.open, "Tab vào ô không còn xổ được danh sách").toBe(true)
  })

  /** ⚠ Bấm hoặc gõ sau khi chọn cũng phải mở lại được ngay. */
  it("bấm lại vào ô sau khi chọn thì mở lại", () => {
    for (const e of [{ t: "click" }, { t: "type" }] as PickerEvent[]) {
      const s = chay([{ t: "click" }, { t: "pick", refocus: true }, e], true)
      expect(s.open, JSON.stringify(e)).toBe(true)
      expect(s.skipNextFocus).toBe(false)
    }
  })

  /**
   * ⚠ MẶC ĐỊNH (`closeOnPick: false`) GIỮ NGUYÊN HÀNH VI CỦA NĂM MÀN
   *   ĐANG CHẠY: chọn xong dải vẫn mở để nhập hàng loạt. Đổi mặc định
   *   là đổi luôn cả năm màn mà không ai yêu cầu.
   */
  it("không bật closeOnPick thì chọn xong dải vẫn MỞ", () => {
    /**
     * ⚠ ĐO NGAY SAU `pick`, ĐỪNG ĐO SAU `focus`. Bản đầu của chốt này
     * chạy cả lượt `focus` phía sau rồi mới đo — và lượt ấy mở lại dải,
     * nên đột biến "pick LUÔN đóng" vẫn xanh. Đúng kiểu sai đã đẻ ra cả
     * tệp này: một sự kiện phía sau che mất hành vi cần đo.
     */
    const ngay = chay([{ t: "click" }, { t: "pick", refocus: true }], false)
    expect(
      ngay.open,
      "chọn xong dải đóng lại — hỏng đường nhập hàng loạt của năm màn đang chạy"
    ).toBe(true)
    expect(ngay.skipNextFocus).toBe(false)

    /* Và lượt trả tiêu điểm sau đó cũng không đổi gì. */
    const sau = chay([{ t: "focus" }], false, ngay)
    expect(sau.open).toBe(true)
  })
})

describe("component nối đúng vào bộ luật", () => {
  const SRC = readFileSync(resolve(ROOT, "src/components/ui/product-picker.tsx"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")

  /**
   * ⚠ BỘ LUẬT ĐÚNG MÀ COMPONENT KHÔNG GỌI THÌ VÔ NGHĨA — đúng cái đã
   *   xảy ra một lần: hàm `missingLotLines` đúng nhưng không ai nối nó
   *   vào nút. Chốt này canh chỗ NỐI.
   */
  it("không còn state đóng/mở riêng trong component", () => {
    /**
     * ⚠ CANH CÁI BIẾN, KHÔNG CANH LỜI GỌI. Bản đầu tìm chuỗi `setOpen(`
     * — và một đột biến viết `const [open, setOpen] = useState(false)`
     * rồi không gọi hàm ấy lần nào đã lọt qua: component tự giữ trạng
     * thái, bộ luật thành mã chết, chốt vẫn xanh.
     */
    expect(
      /\[\s*open\s*,/.test(SRC),
      "component lại tự giữ trạng thái đóng/mở — bộ luật thành mã chết"
    ).toBe(false)
    expect(SRC, "`open` không lấy từ bộ luật").toMatch(/const open = mo\.open/)
    expect(SRC).toMatch(/pickerOpenReducer/)
  })

  /**
   * ⚠ `refocus` PHẢI ĐO THẬT, không đặt cứng. Đặt cứng `true` là đường
   *   Enter để lại cờ; đặt cứng `false` là đường chuột mở lại dải.
   */
  it("pick đo xem tiêu điểm có quay lại ô không", () => {
    expect(SRC).toMatch(/refocus: document\.activeElement !== inputRef\.current/)
  })

  /** ⚠ Và mọi lối vào của ô nhập đều đi qua bộ luật. */
  it("focus / click / gõ / Esc đều gửi vào bộ luật", () => {
    for (const t of ["focus", "click", "type", "escape"]) {
      expect(SRC, `lối vào "${t}" không đi qua bộ luật`).toMatch(
        new RegExp(`gui\\(\\{ t: "${t}"`)
      )
    }
    expect(SRC).toMatch(/gui\(\{ t: "outside" \}\)/)
  })
})
