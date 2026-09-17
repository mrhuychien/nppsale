import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { selectedUnitOf, type PricedProduct } from "../src/lib/sell/pricing"
import { returnPriceViolation } from "../src/lib/sell/returns"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const RET = code(read("src/app/(dashboard)/sell/returns/page.tsx"))
const POS = code(read("src/app/(dashboard)/sell/page.tsx"))
const CARD = code(read("src/components/sell/product-card.tsx"))

describe("Chọn hàng trả dùng CHÍNH màn tìm hàng của luồng bán hàng", () => {
  /**
   * ⚠ MỘT MÀN TÌM HÀNG DUY NHẤT CHO CẢ APP.
   *
   * Bản trước: màn hàng trả có ô tìm + lưới thẻ RIÊNG, kèm một danh sách
   * "Hàng trong đơn này" bày sẵn. Hai vấn đề:
   *   · Danh sách bày sẵn chiếm gần hết màn hình trước khi người dùng kịp
   *     gõ gì, mà hàng phải trả thường KHÔNG nằm trong đơn đang soạn —
   *     khách trả hàng của chuyến trước.
   *   · Bản tìm hàng ở đó thiếu sạch những thứ màn bán hàng có: tab "khách
   *     hay lấy", nút quét mã, trần số thẻ vẽ một lúc. Cùng một việc mà hai
   *     bản, và bản kém hơn nằm đúng chỗ ít ai soi.
   */
  it("màn hàng trả KHÔNG còn dựng bản tìm hàng thứ hai", () => {
    expect(RET).not.toContain("<ProductCard")
    expect(RET).not.toContain("viMatchAllWords")
    // Và không còn bày sẵn hàng trong đơn.
    expect(RET).not.toContain("Hàng trong đơn này")
  })

  it("chạm vào ô tìm là mở màn tìm hàng ở chế độ chọn hàng trả", () => {
    expect(RET).toContain('router.push("/sell?mode=return")')
    expect(RET).toContain("Tìm hàng để trả")
  })

  it("màn tìm hàng nhận ra chế độ đó", () => {
    expect(POS).toContain('const returning = searchParams.get("mode") === "return"')
    expect(POS).toContain('"Chọn hàng trả"')
  })

  /**
   * ⚠ Đơn vị chọn trên thẻ phải là đơn vị được THÊM. Thẻ hiện giá theo
   * thùng mà dòng trả lại ghi theo chai thì số tiền trừ lệch mười mấy lần.
   */
  it("thêm dòng trả dùng đúng đơn vị và giá đang hiện trên thẻ", () => {
    const i = POS.indexOf("const addToCart = (p: SellProduct) => {")
    expect(i, "không tìm thấy addToCart").toBeGreaterThanOrEqual(0)
    const body = POS.slice(i, POS.indexOf("\n  }", i))
    expect(body).toContain("const unit = unitOf(p)")
    expect(body).toContain("const price = unitPriceFor(p, unit, groupId)")
    // Nhánh trả dùng chính hai biến đó, không tự tra lại.
    const branch = body.slice(body.indexOf("if (returning) {"))
    expect(branch).toContain("unit,")
    expect(branch).toContain("price,")
    expect(branch).toContain('router.push("/sell/returns")')
  })

  /**
   * ⚠ KHÔNG chặn và KHÔNG hiện tồn kho khi chọn hàng TRẢ. Khách đưa hàng
   * LẠI cho mình; trả một mặt hàng đang hết tồn là chuyện bình thường, còn
   * "Hết hàng" tô đỏ trông như đang chặn nên nhân viên sẽ không dám bấm.
   */
  it("chọn hàng trả thì không chặn theo tồn và không hiện tồn", () => {
    const i = POS.indexOf("const addToCart = (p: SellProduct) => {")
    const body = POS.slice(i, POS.indexOf("\n  }", i))
    /**
     * ⚠ Cắt nhánh theo DẤU ĐÓNG NGOẶC của chính nó, không cắt tới chỗ
     * `const onHand` đầu tiên. Thử phá: nhét `const onHand` NGAY TRONG
     * nhánh trả — khúc cắt kết thúc đúng tại dòng vừa nhét nên phép soi
     * không thấy gì và chốt vẫn XANH, trong khi hàng hết tồn lại không trả
     * lại được.
     */
    const at = body.indexOf("if (returning) {")
    expect(at, "không tìm thấy nhánh chọn hàng trả").toBeGreaterThanOrEqual(0)
    const branch = body.slice(at, body.indexOf("\n    }", at))
    expect(branch, "nhánh trả bị chặn theo tồn kho").not.toContain("onHand")
    expect(branch, "nhánh trả bị chặn theo tồn kho").not.toContain("Hết hàng")
    expect(POS).toContain("showStock={!returning}")
    expect(POS).toContain('badgeLabel={returning ? "Đã trả" : "Trong giỏ"}')
  })

  /** Huy hiệu đếm phải đếm ĐÚNG rổ — dòng trả, không phải dòng bán. */
  it("huy hiệu đếm theo rổ đang chọn", () => {
    expect(POS).toContain("findReturnLine(cart.returnLines, p.id, unit)")
    expect(POS).toContain("returning ? cart.returnLines[i].qty : cart.cart[i].qty")
  })

  /** Đang chọn hàng trả thì đường quay lại phải về PHIẾU TRẢ, không về giỏ. */
  it("có đường quay lại phiếu trả", () => {
    expect(POS).toContain("{returning && cart.returnLines.length > 0 && (")
    expect(POS).toContain("dòng hàng trả")
    expect(POS).toContain("{!returning && cartCount > 0 && (")
  })

  it("thẻ mặc định VẪN hiện tồn — tắt phải là lựa chọn có chủ đích", () => {
    expect(CARD).toContain("showStock = true")
    expect(CARD).toContain('badgeLabel = "Trong giỏ"')
    expect(CARD).toContain("{showStock && (")
  })
})

describe("Sửa giá dòng trả: ô giá phải NHÌN THẤY được", () => {
  const PRICE_INPUT = code(read("src/components/sell/return-price-input.tsx"))

  /**
   * ⚠ NGƯỜI DÙNG BÁO HAI LẦN LIỀN "vẫn không sửa được giá". Tính năng có
   * từ lượt trước, nhưng đường vào là một cú chạm vào TÊN HÀNG — mà tên
   * hàng trông y hệt chữ thường: không viền, không mũi tên, không nhãn.
   * Ô số lượng ngay cạnh thì hiện rõ, nên giá cũng phải hiện rõ như thế.
   */
  it("mỗi dòng trả có ô nhập giá ngay trên dòng", () => {
    expect(RET).toContain("<ReturnPriceInput")
    expect(RET).toContain("onChange={(price) => cart.patchReturnLine(i, { price })}")
    // Ngang hàng với ô số lượng, không nằm ở đâu khác.
    const i = RET.indexOf("<ReturnPriceInput")
    const j = RET.indexOf("<Stepper qty={r.qty}")
    expect(i, "không tìm thấy ô giá").toBeGreaterThan(0)
    expect(j, "không tìm thấy ô số lượng").toBeGreaterThan(0)
    expect(Math.abs(i - j), "ô giá và ô số lượng không cùng một hàng").toBeLessThan(900)
  })

  it("ô giá có nhãn, không phải một ô trống không tên", () => {
    expect(RET).toContain("Đơn giá")
    expect(RET).toContain("Số lượng")
  })

  /** Dòng bấm được thì phải TRÔNG như bấm được. */
  it("dòng mở được phần sửa thì có mũi tên", () => {
    expect(RET).toContain("<ChevronRight")
    expect(RET).toContain("onClick={() => setEditIdx(i)}")
  })

  /**
   * ⚠ Giữ chuỗi riêng, không ép về số sau mỗi phím. Ép thì xoá hết chữ số
   * là ô tự nhảy về 0 và không gõ lại được — lỗi đã gặp ở ô giá dòng bán.
   */
  it("ô giá gõ được, xoá trắng không nhảy về 0", () => {
    expect(PRICE_INPUT).toContain("const [text, setText] = useState(String(price))")
    // ⚠ Trong chuỗi nháy đơn của JS, `\D` bị đọc thành `D` — phải nhân đôi
    // dấu chéo ngược, nếu không chốt này so với một chuỗi KHÔNG tồn tại.
    expect(PRICE_INPUT).toContain('const digits = e.target.value.replace(/\\D/g, "")')
    // Giá đổi từ nơi khác (đổi đơn vị) thì ô phải theo.
    expect(PRICE_INPUT).toContain("useEffect(() => setText(String(price)), [price])")
  })

  it("giá vượt trần thì ô tô đỏ ngay tại chỗ", () => {
    expect(RET).toContain("bad={priceBadOf(r)}")
    expect(PRICE_INPUT).toContain('bad ? "border-error text-error"')
  })
})

describe("Sửa giá dòng trả theo ĐÚNG quyền của người dùng", () => {
  const SHEET = code(read("src/components/sell/return-line-sheet.tsx"))

  /**
   * ⚠ DÙNG CHUNG QUYỀN VỚI DÒNG BÁN. Ai không được sửa giá bán thì cũng
   * không được sửa giá trả — hai đằng cùng là thẩm quyền về TIỀN, và chặn
   * một bên rồi mở bên kia thì "trả hàng" thành đường vòng để ra đúng con
   * số mình muốn.
   */
  it("màn hàng trả tra quyền bằng chính phép của màn giỏ", () => {
    expect(RET).toContain("const rules = userPriceRulesFrom(user)")
    expect(RET).toContain('const canEditPrice = user?.role !== "sales" || !!rules.allow_price_edit')
    expect(RET).toContain("canEditPrice={canEditPrice}")
  })

  it("không có quyền thì ô giá khoá lại và nói vì sao", () => {
    expect(SHEET).toContain("disabled={!canEditPrice}")
    expect(SHEET).toContain("Bạn không có quyền sửa giá")
    // ⚠ Cả ô TRÊN DÒNG nữa, không chỉ ô trong tấm trượt — khoá một chỗ mà
    // mở chỗ kia thì lời khoá chỉ là trang trí.
    expect(RET).toContain("disabled={!canEditPrice}")
    expect(RET).toContain("{!canEditPrice && (")
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

describe("Sửa được giá của dòng hàng trả", () => {
  const SHEET = code(read("src/components/sell/return-line-sheet.tsx"))
  const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))

  /**
   * ⚠ LỖI NGƯỜI DÙNG BÁO. Dòng trả chỉ có bộ đếm số lượng và bộ chọn
   * Trả tiền / Đổi hàng — không có đường nào chỉnh ĐƠN GIÁ. Giá lấy theo
   * bảng giá HÔM NAY, trong khi hàng khách đưa lại được mua hôm khác
   * (thường có chiết khấu) và thường là hàng hư hỏng / cận date chỉ bù
   * được một phần. Số tiền trừ vào đơn vì thế sai thẳng vào số khách phải
   * trả, mà không có cách nào chữa ngoài việc bỏ dòng đó ra.
   */
  it("bấm vào dòng trả là mở được phần sửa", () => {
    expect(RET).toContain("onClick={() => setEditIdx(i)}")
    expect(RET).toContain("<ReturnLineSheet")
  })

  it("sheet có ô nhập đơn giá và ô ghi chú", () => {
    expect(SHEET).toContain('aria-label="Đơn giá trả"')
    expect(SHEET).toContain("Lý do / ghi chú dòng")
  })

  /** ⚠ Đổi đơn vị là đổi GIÁ — giữ giá chai cho một thùng là trả sai mười lần. */
  it("đổi đơn vị thì tính lại giá", () => {
    expect(SHEET).toContain("onPatch({ unit: u, price: unitPriceFor(product, u, groupId) })")
  })

  /** Dòng đã sửa giá phải nhìn ra được ngay trên danh sách. */
  it("dòng sửa giá có nhãn riêng", () => {
    expect(RET).toContain("Giá sửa")
    expect(RET).toContain("const priceEdited =")
  })
})

describe("Luật giá của dòng trả NGƯỢC với dòng bán", () => {
  /**
   * ⚠ Dòng BÁN bị chặn khi giá THẤP hơn bảng giá — bán rẻ là mất tiền.
   * Dòng TRẢ thì ngược: tiền đi RA khỏi công ty, nên chỗ nguy hiểm là giá
   * CAO. Trả về cao hơn giá bán là một đường rút tiền: mua 100k, trả lại
   * 150k, và không quy tắc duyệt nào chạm tới vì đây không phải dòng bán.
   */
  it("trả cao hơn giá bảng là vi phạm", () => {
    expect(returnPriceViolation({ price: 150_000 }, 100_000)).toBe("above_list")
  })

  /**
   * ⚠ HẠ GIÁ THÌ LUÔN ĐƯỢC, kể cả xuống 0. Hàng hư hỏng, cận date, đã bóc
   * lẻ — mỗi ca một mức bù khác nhau. Đây cũng là chiều AN TOÀN: công ty
   * chi ít đi.
   */
  it.each([0, 1_000, 99_999, 100_000])("trả %s (≤ giá bảng) thì hợp lệ", (p) => {
    expect(returnPriceViolation({ price: p }, 100_000)).toBeNull()
  })

  it("giá âm bị chặn", () => {
    expect(returnPriceViolation({ price: -1 }, 100_000)).toBe("negative")
  })

  /**
   * ⚠ Chưa tra ra giá bảng (bằng 0) thì KHÔNG lấy 0 làm trần — làm vậy là
   * chặn mọi dòng trả của mặt hàng chưa có giá, trong khi khách vẫn đang
   * đứng đó với hàng trên tay.
   */
  it("mặt hàng chưa có giá bảng thì không chặn", () => {
    expect(returnPriceViolation({ price: 50_000 }, 0)).toBeNull()
  })
})

describe("Giá trả sai thì KHÔNG gửi được đơn", () => {
  const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))

  /** Tô đỏ ở màn hàng trả mà vẫn gửi được thì vệt đỏ đó chỉ là trang trí. */
  it("màn giỏ đếm dòng trả sai giá và nói ra", () => {
    expect(CART).toContain("const returnPriceBad = useMemo(")
    expect(CART).toContain("returnPriceViolation(r, p ? unitPriceFor(p, r.unit, groupId) : 0)")
    expect(CART).toContain("dòng trả cao hơn giá bảng")
    expect(CART).toContain('"Giá hàng trả quá cao"')
  })

  it("màn hàng trả tô đỏ đúng dòng", () => {
    expect(RET).toContain("const priceBadOf =")
    expect(RET).toContain("Giá trả cao hơn giá bảng")
  })
})
