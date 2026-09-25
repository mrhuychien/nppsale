import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  returnTotals, debtAfterReturn, warehouseSentence,
} from "../src/lib/pos/return-totals"

/**
 * PHIẾU TRẢ HÀNG CỦA `/pos` — spec §6 mục "Phiếu trả hàng (3, 8)".
 *
 * ⚠ MỌI CON SỐ LẤY THẲNG TỪ BẢN THIẾT KẾ chủ nhà đã duyệt bằng mắt, để
 * chốt đo đúng cái đã chốt chứ không phải số tôi tự nghĩ ra.
 */

const vnd = (value: number) => ({ value, unit: "vnd" as const })
const pct = (value: number) => ({ value, unit: "pct" as const })

/** Đúng bộ dòng của artboard 3. */
const dongMau = [
  { qty: 2, price: 264_000, isExchange: false }, // 528.000 tiền hàng trả
  { qty: 6, price: 58_000, isExchange: true }, // 348.000 hàng đổi
]

describe("cộng tiền phiếu trả", () => {
  /**
   * ⚠ ĐO ĐÚNG BẢN THIẾT KẾ:
   *   528.000 − 20.000 = 508.000, và 348.000 hàng đổi KHÔNG tham gia.
   */
  it("ra đúng con số trên bản thiết kế", () => {
    const t = returnTotals({ lines: dongMau, fee: vnd(20_000) })
    expect(t.goodsReturned).toBe(528_000)
    expect(t.exchangeValue).toBe(348_000)
    expect(t.fee).toBe(20_000)
    expect(t.dueToCustomer).toBe(508_000)
  })

  /**
   * ⚠ ĐÂY LÀ CHỖ DỄ SAI NHẤT CỦA CẢ MÀN. Dòng ĐỔI lấy hàng mới ra khỏi
   * kho và KHÔNG trừ tiền — cộng 348.000 ấy vào là trả cho khách số
   * tiền của đúng món họ vừa nhận.
   */
  it("hàng đổi KHÔNG cộng vào số phải trả khách", () => {
    const t = returnTotals({ lines: dongMau, fee: vnd(20_000) })
    expect(t.dueToCustomer).not.toBe(528_000 + 348_000 - 20_000)
    /* Bỏ hẳn dòng đổi đi thì số phải trả KHÔNG đổi. */
    const t2 = returnTotals({ lines: dongMau.filter((l) => !l.isExchange), fee: vnd(20_000) })
    expect(t2.dueToCustomer).toBe(t.dueToCustomer)
  })

  /** ⚠ Nhưng giá trị hàng đổi vẫn phải HIỆN RA để đối chiếu. */
  it("giá trị hàng đổi vẫn tính ra để hiển thị", () => {
    expect(returnTotals({ lines: dongMau }).exchangeValue).toBe(348_000)
  })

  /**
   * ⚠ PHÍ THEO `%` TÍNH TRÊN TIỀN HÀNG TRẢ, không trên tổng hai thứ.
   * Hàng đổi không sinh ra khoản hoàn nào để mà trừ phí.
   */
  it("phí theo % tính trên tiền hàng trả, không tính cả hàng đổi", () => {
    const t = returnTotals({ lines: dongMau, fee: pct(10) })
    expect(t.fee).toBe(52_800)
    expect(t.fee).not.toBe(Math.round((528_000 + 348_000) * 0.1))
  })

  /**
   * ⚠ PHÍ LỚN HƠN TIỀN HÀNG THÌ KHÔNG TRẢ ĐỒNG NÀO, chứ không phải
   * khách nợ thêm. Đòi thêm tiền qua ô "phí trả hàng" là một con đường
   * không ai định mở.
   */
  it("phí lớn hơn tiền hàng thì về 0, không âm", () => {
    const t = returnTotals({ lines: dongMau, fee: vnd(900_000) })
    expect(t.dueToCustomer).toBe(0)
  })

  it("phiếu rỗng thì mọi số là 0", () => {
    const t = returnTotals({ lines: [] })
    expect(t.goodsReturned).toBe(0)
    expect(t.dueToCustomer).toBe(0)
    expect(t.returnLineCount).toBe(0)
  })

  /** ⚠ Đếm dòng và đếm số lượng là hai thứ khác nhau — câu cảnh báo kho dùng cả hai. */
  it("đếm riêng dòng và số lượng của từng loại", () => {
    const t = returnTotals({ lines: dongMau })
    expect(t.returnLineCount).toBe(1)
    expect(t.returnQty).toBe(2)
    expect(t.exchangeLineCount).toBe(1)
    expect(t.exchangeQty).toBe(6)
  })
})

describe("công nợ sau phiếu trả", () => {
  /** Bản thiết kế: 13.816.000 − 508.000 = 13.308.000. */
  it("ra đúng con số trên bản thiết kế", () => {
    expect(debtAfterReturn(13_816_000, 508_000)).toBe(13_308_000)
  })

  /**
   * ⚠ `null` LÀ "CHƯA ĐỌC ĐƯỢC", KHÔNG PHẢI 0. Cộng từ 0 ra một con số
   * trông như thật là nói với người đi đòi tiền rằng khách này sạch nợ.
   */
  it("chưa đọc được nợ thì trả null, không trả một con số", () => {
    expect(debtAfterReturn(null, 508_000)).toBeNull()
    expect(debtAfterReturn(undefined, 508_000)).toBeNull()
  })

  /**
   * ⚠ Trả nhiều hơn nợ thì ra SỐ ÂM — dư có của khách (luật công nợ âm mig 186,
   * chủ nhà 25/09/2026 rà lại). Bản cũ kẹp về 0, nói với người lập phiếu rằng phần
   * vượt biến mất.
   */
  it("trả nhiều hơn nợ thì ra dư có (số âm), không kẹp về 0", () => {
    expect(debtAfterReturn(100_000, 500_000)).toBe(-400_000)
  })
})

describe("câu mô tả giao dịch kho", () => {
  /**
   * ⚠ NÓI ĐÚNG HAI CHIỀU. Hàng trả ĐI VÀO kho nhận, hàng đổi ĐI RA
   * khỏi kho bán — hai chiều ngược nhau trong cùng một lần bấm.
   */
  it("nói cả nhập lẫn xuất khi có cả hai loại", () => {
    const s = warehouseSentence(returnTotals({ lines: dongMau }), "Kho cận date") ?? ""
    expect(s).toContain("nhập 2")
    expect(s).toContain("Kho cận date")
    expect(s).toContain("xuất 6")
    expect(s).toContain("Kho bán")
    expect(s).toContain("cùng một giao dịch")
  })

  it("chỉ có hàng trả thì không nhắc kho bán", () => {
    const s = warehouseSentence(returnTotals({ lines: [dongMau[0]] }), "Kho cận date") ?? ""
    expect(s).toContain("Kho cận date")
    expect(s).not.toContain("Kho bán")
  })

  /**
   * ⚠ KHÔNG VIẾT CỨNG MỘT TÊN KHO KHÔNG TỒN TẠI. `complete_return` chỉ
   * nhận HAI vùng — `sale` và `date` (`ReturnZone`). Bản đầu của màn
   * này ghi "Kho hàng lỗi", một vùng không có trong hệ: người dùng đi
   * tìm nó trong báo cáo kho và không thấy, rồi tưởng hàng trả đã bốc
   * hơi.
   */
  it("tên kho nhận do nơi gọi truyền vào, không viết cứng", () => {
    const s = warehouseSentence(returnTotals({ lines: [dongMau[0]] }), "Kho bán") ?? ""
    expect(s).toContain("Kho bán")
    expect(
      /kho hàng lỗi/i.test(s),
      "câu nhắc gọi tên một vùng kho không tồn tại trong hệ"
    ).toBe(false)
  })

  /** ⚠ Và cả màn phiếu trả cũng không được nhắc tới vùng ấy. */
  it("màn phiếu trả không nhắc kho hàng lỗi", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "src/components/pos/return-screen.tsx"),
      "utf-8"
    ).replace(/\/\*[\s\S]*?\*\//g, "")
    expect(/Kho hàng lỗi/i.test(src)).toBe(false)
  })

  /** ⚠ Phiếu rỗng thì KHÔNG có câu nào — đừng hứa một giao dịch không xảy ra. */
  it("phiếu rỗng thì không có câu nào", () => {
    expect(warehouseSentence(returnTotals({ lines: [] }))).toBeNull()
  })
})
