import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
  generatedLotCode, supplierReturnMax,
  purchaseCancelLock, supplierReturnCancelLock,
  purchaseTotals, supplierReturnTotals, lotUnitCost,
} from "../src/lib/pos/purchase"

/**
 * MUA HÀNG — màn 9–12. Spec §6, §7.2, §8.
 *
 * ⚠ ĐÂY LÀ PHÍA ĐỤNG GIÁ VỐN. Sai một con số ở đây thì mọi báo cáo lãi
 * lỗ về sau sai theo, và không ai lần ngược ra được.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const vnd = (value: number) => ({ value, unit: "vnd" as const })
const pct = (value: number) => ({ value, unit: "pct" as const })

/**
 * §8.1 — LÔ & HSD KHI NHẬP.
 *
 * ⚠ BỘ CHỐT NÀY ĐÃ TỪNG CANH SAI HẲN MỘT LUẬT KHÔNG TỒN TẠI. Bản đầu
 * đọc spec §8 mục 1 ("lô & HSD bắt buộc") thành một Ô GÕ TAY, rồi chốt
 * rất chặt rằng nút nhập kho phải mờ khi ô ấy trống. Hệ thật không có
 * chỗ nào nhận giá trị ấy:
 *
 *   · `purchase_invoice_lines` không có cột lô — `linePayloadOf`
 *     (`src/lib/purchasing/save-receipt.ts:34`) ghi 10 cột, không cột
 *     nào là mã lô.
 *   · `complete_purchase_invoice` (migration 145, dòng 141) tự đặt
 *     `batch_code := <mã phiếu>-<seq>`, và lấy hạn từ
 *     `products.shelf_life_days` (dòng 107).
 *
 * Nên chốt cũ bảo vệ một lời hứa sai: người dùng gõ mã lô, phần mềm
 * vứt đi, rồi ba tháng sau họ tra mã ấy trong kho và không thấy. Chốt
 * mới canh đúng chuyện đang xảy ra thật.
 */
describe("§8.1 — mã lô do máy chủ sinh, màn nhập chỉ hiện ra", () => {
  /** ⚠ ĐÚNG KHUÔN `complete_purchase_invoice`: `lpad(seq, 3, '0')`. */
  it("ghép đúng mã lô máy chủ sẽ đặt", () => {
    expect(generatedLotCode("PN-260921-0007", 1)).toBe("PN-260921-0007-001")
    expect(generatedLotCode("PN-260921-0007", 12)).toBe("PN-260921-0007-012")
    expect(generatedLotCode("PN-260921-0007", 345)).toBe("PN-260921-0007-345")
  })

  /**
   * ⚠ CHƯA CÓ MÃ PHIẾU THÌ KHÔNG BỊA. Phiếu mới chưa lưu chưa có
   * `receipt_code`; đoán bừa là hiện ra một mã lô không bao giờ tồn
   * tại, và người dùng chép nó vào sổ tay.
   */
  it("chưa có mã phiếu thì trả null", () => {
    expect(generatedLotCode(null, 1)).toBeNull()
    expect(generatedLotCode("", 1)).toBeNull()
    expect(generatedLotCode("   ", 1)).toBeNull()
    expect(generatedLotCode(undefined, 1)).toBeNull()
  })

  it("số thứ tự không hợp lệ thì trả null", () => {
    expect(generatedLotCode("PN-1", 0)).toBeNull()
  })

  /**
   * ⚠ VÀ MÀN NHẬP KHÔNG ĐƯỢC CÓ Ô GÕ LÔ NỮA. Đây là chốt chống quay
   * lại: ô ấy trông vô hại nên rất dễ được thêm lại "cho đủ spec".
   */
  it("màn nhập hàng không có ô gõ mã lô", () => {
    const S = code(read("src/components/pos/purchase-screen.tsx"))
    expect(
      /aria-label=\{`Lô[^`]*`\}\s*[\s\S]{0,200}?onChange/.test(S),
      "ô lô gõ tay đã quay lại — giá trị ấy không cột nào nhận"
    ).toBe(false)
    expect(/patchLine\([^)]*lotId/.test(S), "màn nhập vẫn ghi lotId").toBe(false)
  })

  /** ⚠ Và phải NÓI RA ai đặt mã lô, chứ không im lặng bỏ cột đi. */
  it("màn nhập nói mã lô do hệ thống sinh", () => {
    /* ⚠ Bản đã bóc chú thích — chốt phải nhìn thứ người dùng đọc. */
    const P = code(read("src/components/pos/purchase-screen.tsx"))
    expect(/tự sinh/i.test(P)).toBe(true)
  })

  /**
   * ⚠ VÀ KHÔNG ĐƯỢC GỬI `batch_code` XUỐNG NỮA. Bản đầu nhét nó vào
   * `ReceiptLine` bằng một phép ép kiểu — `satisfies` chặn được, nhưng
   * chốt này nói VÌ SAO cho người sửa sau.
   */
  it("không gửi batch_code trong tải trọng phiếu nhập", () => {
    const S = code(read("src/lib/pos/save.ts"))
    expect(/batch_code:/.test(S), "cột này không tồn tại ở purchase_invoice_lines").toBe(false)
  })
})

describe("§8.5 — trả NCC không vượt số đã nhập còn lại", () => {
  it("trần đúng bằng số còn lại", () => {
    expect(supplierReturnMax(7)).toBe(7)
    expect(supplierReturnMax(0)).toBe(0)
  })

  /**
   * ⚠ `null` = CHƯA BIẾT, và khi đó KHÔNG chặn. Chặn theo một con số
   * chưa đọc được là khoá người dùng khỏi một việc hợp lệ mà không
   * giải thích nổi.
   */
  it("chưa biết số còn lại thì không chặn", () => {
    expect(supplierReturnMax(null)).toBeNull()
    expect(supplierReturnMax(undefined)).toBeNull()
  })

  it("số âm thì kẹp về 0", () => {
    expect(supplierReturnMax(-3)).toBe(0)
  })
})

describe("khoá của phiếu nhập", () => {
  /**
   * ⚠ BẢN SAO CỦA `cancel_purchase_invoice`. Hai phép kiểm ấy nằm
   * trong RPC; giao diện chỉ chặn sớm và phải nói CÙNG một câu.
   */
  it("hàng đã xuất bớt thì khoá", () => {
    const k = purchaseCancelLock({ paidToSupplier: 0, stockIssued: true })
    expect(k?.code).toBe("HANG_DA_XUAT")
    expect(k?.message).toContain("trả hàng NCC")
  })

  it("đã trả tiền NCC thì khoá", () => {
    const k = purchaseCancelLock({ paidToSupplier: 5_000_000, stockIssued: false })
    expect(k?.code).toBe("DA_TRA_TIEN")
    expect(k?.message).toContain("Gỡ phiếu chi")
  })

  /**
   * ⚠ NÓI KHOÁ HÀNG ĐÃ XUẤT TRƯỚC. Gỡ phiếu chi là một thao tác ghi
   * sổ; bắt người dùng làm xong mới biết hàng đã xuất nên vẫn không
   * huỷ được là bắt họ trả giá cho một việc không thành.
   */
  it("cùng lúc hai khoá thì nói hàng đã xuất trước", () => {
    const k = purchaseCancelLock({ paidToSupplier: 5_000_000, stockIssued: true })
    expect(k?.code).toBe("HANG_DA_XUAT")
  })

  it("sạch thì không khoá", () => {
    expect(purchaseCancelLock({ paidToSupplier: 0, stockIssued: false })).toBeNull()
  })
})

describe("khoá của phiếu trả NCC", () => {
  it("lô đã đóng thì khoá", () => {
    const k = supplierReturnCancelLock({ creditOffset: 0, lotClosed: true })
    expect(k?.code).toBe("LO_DA_DONG")
    expect(k?.message).toContain("nhập kho điều chỉnh")
  })

  it("đã cấn trừ công nợ thì khoá", () => {
    const k = supplierReturnCancelLock({ creditOffset: 1_000_000, lotClosed: false })
    expect(k?.code).toBe("DA_CAN_TRU")
  })

  it("sạch thì không khoá", () => {
    expect(supplierReturnCancelLock({ creditOffset: 0, lotClosed: false })).toBeNull()
  })
})

describe("cộng tiền phiếu nhập", () => {
  const lines = [{ qty: 1, price: 42_700_000, discount: vnd(138_000) }]

  /**
   * ⚠ ĐO ĐÚNG BẢN THIẾT KẾ:
   *   42.700.000 − 138.000 − 500.000 + 300.000 = 42.362.000
   */
  it("ra đúng con số trên bản thiết kế", () => {
    const t = purchaseTotals({
      lines,
      docDiscount: vnd(500_000),
      otherCost: vnd(300_000),
      vatRate: 0,
    })
    expect(t.goods).toBe(42_700_000)
    expect(t.lineDiscount).toBe(138_000)
    expect(t.docDiscount).toBe(500_000)
    expect(t.otherCost).toBe(300_000)
    expect(t.dueToSupplier).toBe(42_362_000)
  })

  /**
   * ⚠ CHI PHÍ NHẬP KHÁC **CỘNG** VÀO, KHÔNG TRỪ. Tiền bốc xếp, vận
   * chuyển — mình trả THÊM. Dùng chung ô `[₫/%]` với giảm giá nên rất
   * dễ viết nhầm dấu; bản thiết kế in hẳn dấu `+` vì lý do ấy.
   */
  it("chi phí nhập khác cộng vào, không trừ", () => {
    const khong = purchaseTotals({ lines: [{ qty: 1, price: 1_000_000, discount: vnd(0) }] })
    const co = purchaseTotals({
      lines: [{ qty: 1, price: 1_000_000, discount: vnd(0) }],
      otherCost: vnd(300_000),
    })
    expect(co.dueToSupplier).toBe(khong.dueToSupplier + 300_000)
    expect(co.dueToSupplier).not.toBe(khong.dueToSupplier - 300_000)
  })

  /** ⚠ `%` của chi phí tính trên tiền GỘP, cùng nền với giảm giá phiếu. */
  it("chi phí theo % cùng nền với giảm giá phiếu", () => {
    const t = purchaseTotals({
      lines: [{ qty: 1, price: 1_000_000, discount: vnd(0) }],
      docDiscount: pct(10),
      otherCost: pct(10),
    })
    expect(t.docDiscount).toBe(100_000)
    expect(t.otherCost).toBe(100_000)
  })

  it("thuế đầu vào tính trên số đã trừ giảm giá", () => {
    const t = purchaseTotals({
      lines: [{ qty: 1, price: 1_000_000, discount: vnd(0) }],
      docDiscount: vnd(200_000),
      vatRate: 10,
    })
    expect(t.vat).toBe(80_000)
    expect(t.dueToSupplier).toBe(880_000)
  })
})

describe("cộng tiền phiếu trả NCC", () => {
  const lines = [{ qty: 1, price: 3_860_000, discount: vnd(0) }]

  /** ⚠ ĐO ĐÚNG BẢN THIẾT KẾ: 3.860.000 − 150.000 = 3.710.000 */
  it("ra đúng con số trên bản thiết kế", () => {
    const t = supplierReturnTotals({ lines, fee: vnd(150_000) })
    expect(t.goods).toBe(3_860_000)
    expect(t.fee).toBe(150_000)
    expect(t.dueFromSupplier).toBe(3_710_000)
  })

  /**
   * ⚠ CHI PHÍ TRẢ HÀNG **TRỪ** ĐI, NGƯỢC HẲN CHI PHÍ NHẬP. Cùng một ô
   * `[₫/%]`, cùng chữ "chi phí", hai chiều ngược nhau: lúc nhập mình
   * trả thêm, lúc trả mình được hoàn ít đi.
   */
  it("chi phí trả hàng trừ đi, ngược chiều chi phí nhập", () => {
    const khong = supplierReturnTotals({ lines })
    const co = supplierReturnTotals({ lines, fee: vnd(150_000) })
    expect(co.dueFromSupplier).toBe(khong.dueFromSupplier - 150_000)
    /* Và đúng là ngược chiều với phiếu nhập. */
    const nhap = purchaseTotals({ lines, otherCost: vnd(150_000) })
    expect(nhap.dueToSupplier).toBe(khong.dueFromSupplier + 150_000)
  })

  /** ⚠ Chi phí lớn hơn tiền hàng thì NCC không hoàn đồng nào, không âm. */
  it("chi phí lớn hơn tiền hàng thì về 0", () => {
    expect(supplierReturnTotals({ lines, fee: vnd(9_000_000) }).dueFromSupplier).toBe(0)
  })
})

describe("giá vốn theo LÔ, không phải bình quân", () => {
  /**
   * ⚠ ĐÚNG CÔNG THỨC `complete_purchase_invoice`:
   *   v_unit_cost := (quantity * unit_price - line_discount) / base_qty
   */
  it("tính trên tiền đã trừ giảm dòng và theo đơn vị cơ sở", () => {
    expect(lotUnitCost({ qty: 2, price: 240_000, lineDiscount: 80_000, baseQty: 40 })).toBe(10_000)
  })

  /** ⚠ Chia cho 0 ra `Infinity` — thà nói "chưa tính được". */
  it("số lượng cơ sở bằng 0 thì trả null", () => {
    expect(lotUnitCost({ qty: 1, price: 100, lineDiscount: 0, baseQty: 0 })).toBeNull()
  })
})

/**
 * ⚠ SPEC §8.6: "Phiếu nhập KHÔNG có bảng hàng trả/đổi kèm. Trả NCC là
 * chứng từ riêng."
 *
 * Trộn hai thứ là một phiếu vừa nhập vừa trả trong cùng một bút toán —
 * và không ai đối chiếu nổi kho sau đó.
 */
/**
 * ⚠ NÚT CHÍNH CỦA MÀN NHẬP VẪN PHẢI MỜ VÌ NHỮNG LÝ DO CÓ THẬT.
 * Chốt cũ ở đây canh điều kiện `thieuLo` — một điều kiện nay đã bỏ vì
 * nó đòi một thứ không đi tới đâu. Nhưng bỏ chốt mà không thay chốt là
 * mở toang nút: bấm "Hoàn thành & nhập kho" trên một phiếu rỗng là ăn
 * nguyên câu `PHIEU_KHONG_CO_HANG` của máy chủ.
 */
describe("§8.1 — nút nhập kho vẫn mờ đúng lúc", () => {
  const S = code(read("src/components/pos/purchase-screen.tsx"))

  it("phiếu rỗng hoặc đang lưu thì nút chính mờ", () => {
    const i = S.indexOf('variant="primary"')
    expect(i, "không thấy nút chính").toBeGreaterThan(-1)
    const nut = S.slice(i, i + 420)
    expect(/disabled=\{[^}]*lines\.length === 0/.test(nut), "nút mở trên phiếu rỗng").toBe(true)
    expect(/disabled=\{[^}]*dangLuu/.test(nut), "bấm hai lần được khi đang lưu").toBe(true)
  })

  /** ⚠ Nút mờ PHẢI nói vì sao — mờ câm là người dùng bấm mãi không hiểu. */
  it("nút mờ nói lý do", () => {
    const i = S.indexOf('variant="primary"')
    const nut = S.slice(i, i + 420)
    expect(nut).toMatch(/title=/)
    expect(nut).toContain("Chưa có mặt hàng nào")
  })
})

describe("§8.6 — phiếu nhập không có bảng trả/đổi kèm", () => {
  it("màn nhập hàng không dựng ReturnExchangeTable", () => {
    const s = code(read("src/components/pos/purchase-screen.tsx"))
    expect(s).not.toContain("ReturnExchangeTable")
  })
})

/**
 * §8.4 — LÔ CỦA PHIẾU TRẢ NCC.
 *
 * ⚠ SPEC VIẾT "select lô CHỈ liệt kê lô thuộc phiếu nhập gốc", VÀ
 * KHÔNG CÓ SELECT NÀO Ở ĐÂY LÀ THẬT ĐƯỢC. Hai sự thật của hệ đang
 * chạy:
 *
 *   · `supplier_return_lines` (migration 068, dòng 51-65 + 146 dòng
 *     41) không có cột lô nào — `linePayloadOf` cũng không ghi cột nào
 *     như thế.
 *   · `complete_supplier_return` (migration 146, dòng 155-165) chọn lô
 *     FIFO: `ORDER BY expires_at NULLS LAST, created_at, id` trong
 *     `warehouse_zone` của phiếu.
 *
 * Nên một ô chọn lô ở màn này là một cái cần gạt không nối vào đâu:
 * người dùng chọn L2609, máy chủ lấy lô cũ nhất, và không một câu nào
 * báo cho họ biết. Chốt dưới đây canh rằng màn hình KHÔNG dựng cái cần
 * gạt ấy, mà vẫn hiện lô của phiếu gốc để đối chiếu.
 */
describe("§8.4 — lô của phiếu trả NCC: hiện để đối chiếu, không cho chọn", () => {
  const S = code(read("src/components/pos/supplier-return-screen.tsx"))

  /** ⚠ Lô vẫn phải lấy từ dòng (phiếu gốc), không rơi về toàn kho. */
  it("lô đọc từ dòng, không đọc từ danh mục kho", () => {
    expect(S).toMatch(/l\.lots/)
    expect(
      /stockByProduct|loadLotsByProduct/.test(S),
      "lô rơi về toàn kho thay vì lô của phiếu nhập gốc"
    ).toBe(false)
  })

  /**
   * ⚠ KHÔNG CÓ Ô CHỌN LÔ. Đây là chốt chống quay lại — một `<select>`
   * lô trông rất hợp lý với người đọc spec, và nó sẽ được thêm lại nếu
   * không có gì chặn.
   */
  it("không dựng ô chọn lô, và không ghi lotId", () => {
    expect(/patchLine\([^)]*lotId/.test(S), "màn trả NCC vẫn ghi lotId").toBe(false)
    const i = S.indexOf("l.lots")
    const khoi = S.slice(Math.max(0, i - 600), i + 600)
    expect(
      /<select[\s\S]{0,400}l\.lots/.test(khoi),
      "ô chọn lô đã quay lại — máy chủ lấy FIFO và bỏ qua lựa chọn này"
    ).toBe(false)
  })

  /**
   * ⚠ VÀ PHẢI NÓI RA AI CHỌN LÔ. Bỏ ô chọn đi mà im lặng là người dùng
   * tưởng phần mềm đang trả đúng lô họ cầm trên tay.
   */
  it("màn hình nói rõ máy chủ lấy lô theo hạn cũ trước", () => {
    /* ⚠ ĐỌC BẢN ĐÃ BÓC CHÚ THÍCH. Bản đầu của chốt này đọc tệp thô và
       khớp với chính câu giải thích ở đầu tệp — đột biến xoá sạch câu
       trên MÀN HÌNH mà chốt vẫn xanh. Chốt phải nhìn thứ người dùng
       đọc, không nhìn thứ lập trình viên viết cho nhau. */
    expect(/hạn cũ trước/i.test(S), "không có câu nào nói ai chọn lô").toBe(true)
  })

  /**
   * ⚠ VÙNG KHO PHẢI CHỌN ĐƯỢC. FIFO của máy chủ chỉ quét trong
   * `warehouse_zone` của phiếu; không cho chọn là mặc định cứng vào
   * `date`, và trả hàng từ kho bán sẽ ăn `INSUFFICIENT_STOCK` trong
   * khi kho bán đang đầy đúng món ấy.
   */
  it("có ô chọn vùng kho xuất", () => {
    expect(S).toMatch(/SubHeaderSelect/)
    expect(S).toMatch(/id="sr-kho"/)
    expect(S).toMatch(/zone: kho/)
  })
})

/**
 * §8.5 — CỘT "ĐÃ NHẬP" CHỈ CÓ KHI CÒN ĐƯỜNG VỀ PHIẾU GỐC.
 *
 * ⚠ `supplier_returns` KHÔNG CÓ CỘT TRỎ VỀ PHIẾU NHẬP. Nên trần "số đã
 * nhập" chỉ dựng được trong phiên đang lập phiếu; mở lại phiếu đã lưu
 * là mất nó. Cái sai đắt ở đây là để nó về `0` thay vì `null`:
 * `supplierReturnMax(0)` là 0, stepper khoá cứng, và người dùng không
 * sửa nổi một phiếu họ vừa lưu.
 */
describe("§8.5 — mở lại phiếu đã lưu thì 'đã nhập' là chưa biết, không phải 0", () => {
  const S = code(read("src/components/pos/supplier-return-screen.tsx"))

  it("dòng nạp từ phiếu đã lưu mang ordered null", () => {
    const i = S.indexOf("supplier_return_lines")
    expect(i, "không thấy chỗ nạp phiếu đã lưu").toBeGreaterThan(-1)
    /* ⚠ Quét tới hết khối nạp (`} catch`), không cắt theo số ký tự —
       một lát cứng 1.800 ký tự đã đỏ oan khi khối ấy dài thêm vài dòng. */
    const het = S.indexOf("} catch", i)
    const khoi = S.slice(i, het > 0 ? het : i + 4000)
    expect(khoi).toMatch(/ordered: null/)
    expect(/ordered: 0\b/.test(khoi), "0 khoá cứng stepper ở 0").toBe(false)
  })

  /** ⚠ Và nạp từ phiếu gốc thì `ordered` là số đã nhập THẬT. */
  it("dòng nạp từ phiếu gốc mang số đã nhập", () => {
    const i = S.indexOf("napTuPhieuGoc")
    expect(i).toBeGreaterThan(-1)
    const khoi = S.slice(i, i + 1400)
    expect(khoi).toMatch(/ordered: x\.receivedQty/)
    /* ⚠ Số lượng trả KHÔNG điền sẵn bằng cả chuyến hàng. */
    expect(khoi).toMatch(/qty: 0/)
  })

  /** ⚠ Và màn hình phải nói ra rằng đường nối ấy không lưu xuống. */
  it("nói rõ đường nối phiếu gốc không lưu vào phiếu", () => {
    /* ⚠ Bản đã bóc chú thích — cùng lý do với chốt "hạn cũ trước". */
    expect(/không lưu vào phiếu/i.test(S)).toBe(true)
  })
})

/**
 * ⚠ CÂU CHỮ MÀN 10 VÀ 12 PHẢI KHỚP CƠ CHẾ THẬT. Bên mua KHÔNG có hàm
 * "lập lại" — chỉ có `cancel_purchase_invoice` / `cancel_supplier_return`
 * rời với `complete_*`. Nên không được hứa "trong cùng một giao dịch"
 * hay "giữ nguyên số phiếu".
 */
describe("câu chữ màn sửa mua hàng không hứa điều phần mềm không làm", () => {
  const files = ["src/components/pos/purchase-screen.tsx", "src/components/pos/supplier-return-screen.tsx"]

  it("không hứa huỷ-và-lập-lại trong cùng một giao dịch", () => {
    for (const f of files) {
      const s = code(read(f))
      expect(
        /lập lại[\s\S]{0,80}cùng một giao dịch|cùng một giao dịch[\s\S]{0,80}lập lại/.test(s),
        `${f} hứa một giao dịch mà bên mua không có hàm lập lại`
      ).toBe(false)
    }
  })

  it("không hứa giữ nguyên số phiếu", () => {
    const s = code(read("src/components/pos/supplier-return-screen.tsx"))
    expect(
      /giữ nguyên số phiếu/i.test(s),
      "huỷ rồi lập lại là một phiếu MỚI, mang số mới"
    ).toBe(false)
  })

  /** ⚠ Và không được gọi thứ không có là "giá vốn bình quân". */
  it("không nói giá vốn bình quân", () => {
    const pos = resolve(ROOT, "src/components/pos")
    const pham: string[] = []
    for (const e of readdirSync(pos)) {
      const p = resolve(pos, e)
      if (statSync(p).isFile() && /\.tsx$/.test(e)) {
        if (/giá vốn bình quân|GIÁ VỐN BQ/i.test(code(readFileSync(p, "utf-8")))) pham.push(e)
      }
    }
    expect(
      pham,
      "hệ này ghi giá vốn THEO LÔ (batches.unit_cost), không có số bình quân trôi theo mỗi lần nhập"
    ).toEqual([])
  })
})
