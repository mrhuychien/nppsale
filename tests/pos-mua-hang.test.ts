import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
  missingLotLines, missingLotMessage, supplierReturnMax,
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

describe("§8.1 — lô & HSD bắt buộc khi nhập", () => {
  /** ⚠ Trả về SỐ THỨ TỰ DÒNG; spec chốt "tooltip nói rõ dòng nào thiếu". */
  it("chỉ đúng dòng nào thiếu lô", () => {
    expect(
      missingLotLines([
        { index: 1, lotCode: "L2609" },
        { index: 2, lotCode: "" },
        { index: 3, lotCode: null },
        { index: 4, lotCode: "L2610" },
      ])
    ).toEqual([2, 3])
  })

  /**
   * ⚠ CHUỖI TOÀN KHOẢNG TRẮNG CŨNG LÀ THIẾU. Một ô lô chứa dấu cách đi
   * thẳng vào `batch_code` và không ai tra ra lô ấy về sau.
   */
  it("khoảng trắng không tính là đã nhập lô", () => {
    expect(missingLotLines([{ index: 1, lotCode: "   " }])).toEqual([1])
  })

  it("đủ lô thì không có câu nhắc nào", () => {
    expect(missingLotLines([{ index: 1, lotCode: "L1" }])).toEqual([])
    expect(missingLotMessage([])).toBeNull()
  })

  /** ⚠ Nút mờ PHẢI nói dòng nào — "có dòng thiếu lô" là bắt người ta dò cả bảng. */
  it("câu nhắc gọi tên đúng dòng", () => {
    const m = missingLotMessage([2, 5]) ?? ""
    expect(m).toContain("dòng 2, 5")
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
describe("§8.1 — nút nhập kho mờ khi còn dòng thiếu lô", () => {
  const S = code(read("src/components/pos/purchase-screen.tsx"))

  /**
   * ⚠ ĐÂY LÀ LUẬT QUAN TRỌNG NHẤT CỦA §8, và bản đầu của bộ chốt này
   * KHÔNG canh nó: đột biến gỡ điều kiện `thieuLo` khỏi `disabled` mà
   * mọi chốt vẫn xanh. Hàm `missingLotLines` đúng nhưng không ai NỐI
   * nó vào nút — hàng vào kho không lô, và chỉ lộ ra khi cần truy
   * nguồn một lô đã bán đi.
   */
  it("điều kiện thiếu lô có trong disabled của nút chính", () => {
    const i = S.indexOf('variant="primary"')
    expect(i, "không thấy nút chính").toBeGreaterThan(-1)
    const nut = S.slice(i, i + 420)
    expect(
      /disabled=\{[^}]*thieuLo/.test(nut),
      "nút Hoàn thành & nhập kho không mờ khi còn dòng thiếu lô"
    ).toBe(true)
  })

  /** ⚠ Và `title` phải mang câu gọi tên đúng dòng. */
  it("nút mờ nói đúng dòng nào thiếu", () => {
    const i = S.indexOf('variant="primary"')
    const nut = S.slice(i, i + 420)
    expect(nut).toMatch(/title=/)
    expect(nut).toContain("cauThieuLo")
  })

  /** ⚠ Dòng thiếu lô phải VIỀN ĐỎ — spec §8 mục 1 chốt riêng. */
  it("dòng thiếu lô có viền đỏ", () => {
    expect(S).toMatch(/thieu \?\s*"border-\[#dc2626\]/)
  })
})

describe("§8.6 — phiếu nhập không có bảng trả/đổi kèm", () => {
  it("màn nhập hàng không dựng ReturnExchangeTable", () => {
    const s = code(read("src/components/pos/purchase-screen.tsx"))
    expect(s).not.toContain("ReturnExchangeTable")
  })
})

/**
 * ⚠ SPEC §8.4: "Trả NCC: select lô CHỈ liệt kê lô thuộc phiếu nhập
 * gốc, không liệt kê toàn kho."
 *
 * Trả một lô không thuộc phiếu gốc là trả cho NCC món họ không bán cho
 * mình — và `cancel_supplier_return` sẽ vướng `LO_DA_DONG` về sau.
 */
describe("§8.4 — lô của phiếu trả NCC chỉ lấy từ phiếu gốc", () => {
  const S = code(read("src/components/pos/supplier-return-screen.tsx"))

  it("select lô đọc từ dòng, không đọc từ danh mục kho", () => {
    const i = S.indexOf("Lô hàng")
    expect(i, "không thấy select lô").toBeGreaterThan(-1)
    const khoi = S.slice(i, i + 700)
    expect(khoi).toMatch(/l\.lots/)
    /* Không được rơi về danh mục sản phẩm hay bản đồ tồn kho. */
    expect(/stockByProduct|products\.map/.test(khoi), "select lô rơi về toàn kho").toBe(false)
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
