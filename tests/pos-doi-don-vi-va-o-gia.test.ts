import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { doiDonViDong, doiDonViTheoHeSo, doiDonViDongTra, donViHienThi, donViCuaSanPham } from "../src/lib/pos/units"
import { posLinesToInvoice, posLinesToReturnCart } from "../src/lib/pos/save"
import { returnCreditOf } from "../src/lib/sell/returns"
import { MoneyInput } from "../src/components/ui/money-input"
import type { PosLine } from "../src/lib/pos/types"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

const SP = {
  id: "p1", base_unit: "hộp", sell_price: 20_000,
  units: [{ unit_name: "thùng", conversion: 24 }],
  price_lists: [{ unit_name: "thùng", group_id: null, price: 450_000 }],
}

/**
 * ⚠ LỖI THẬT — chủ nhà báo 23/09/2026: "tạo đơn hàng trên pos, chuyển đổi
 *   đơn vị tính k thay đổi đơn giá trong phần hàng đổi trả". Bấm hộp →
 *   thùng ở khối "Hàng đổi trả kèm đơn" chỉ đổi nhãn; đơn giá vẫn là giá
 *   hộp, và khoản trừ đơn hụt đúng 24 lần.
 */
describe("hàng đổi trả kèm đơn: đổi đơn vị là đổi đơn giá", () => {
  const dongTra: PosLine = {
    key: "r1", productId: "p1", sku: "", name: "Sữa", unit: "hộp",
    units: [{ unit_name: "hộp", conversion: 1 }, { unit_name: "thùng", conversion: 24 }],
    qty: 2, price: 20_000, discount: { value: 0, unit: "vnd" }, isExchange: false,
  }

  it("hộp → thùng: đơn giá theo bảng giá thùng, khoản trừ đơn theo đó", () => {
    const sau = { ...dongTra, ...doiDonViDong(dongTra, "thùng", SP as never, null) }
    const gio = posLinesToReturnCart([sau])
    expect(gio[0]).toMatchObject({ unit: "thùng", price: 450_000 })
    expect(returnCreditOf(gio)).toBe(900_000)
  })

  it("thùng → hộp: về lại giá hộp", () => {
    const thung = { ...dongTra, unit: "thùng", price: 450_000 }
    expect(doiDonViDong(thung, "hộp", SP as never, null).price).toBe(20_000)
  })

  it("dải chip của khối hàng trả gọi phép đổi, không chỉ đổi nhãn", () => {
    const S = read("src/components/pos/order-screen.tsx")
    const i = S.indexOf("Hàng đổi trả kèm đơn")
    const khoi = S.slice(i, S.indexOf("Đơn giá trả dòng", i))
    expect(khoi, "chip đơn vị hàng trả chỉ đổi nhãn").not.toMatch(/sua\(\{ unit: u\.unit_name \}\)/)
    expect(khoi).toMatch(/sua\(doiDonViDongTra\(l, u\.unit_name, productById\(l\.productId\), groupId\)\)/)
  })
})

/**
 * ⚠ YÊU CẦU 23/09/2026: "Đơn giá chia khối 3 số 1 (giống thành tiền) kiểu
 *   220.000". Ô giá ở POS hiện số trần `220000` trong khi cột thành tiền
 *   ngay cạnh là `220.000` — đọc nhầm một số 0 là sai mười lần.
 */
describe("ô đơn giá ở POS chia khối nghìn", () => {
  it("ô giá hiện 220.000, không phải 220000", () => {
    const html = renderToStaticMarkup(
      createElement(MoneyInput, { showSuffix: false, value: 220_000, onChange: () => {} })
    )
    expect(html).toContain('value="220.000"')
  })

  it.each([
    "src/components/pos/order-screen.tsx",
    "src/components/pos/return-screen.tsx",
    "src/components/pos/invoice-edit-screen.tsx",
    "src/components/pos/purchase-screen.tsx",
    "src/components/pos/supplier-return-screen.tsx",
  ])("%s: mọi ô giá dùng MoneyInput, không còn ô số trần", (f) => {
    const S = read(f)
    expect(S, "còn ô giá gõ số trần").not.toMatch(/price: Number\(e\.target\.value\.replace/)
    expect(S).toMatch(/<MoneyInput/)
  })
})

/* ---- Đợt sửa 23/09/2026: chủ nhà chốt "fix theo hướng trên" ---- */

const dong = (p: Partial<PosLine>): PosLine => ({
  key: "k", productId: "p1", sku: "", name: "Sữa", unit: "hộp", units: [],
  qty: 1, price: 0, discount: { value: 0, unit: "vnd" }, ...p,
})
const HOP_THUNG = [{ unit_name: "hộp", conversion: 1 }, { unit_name: "thùng", conversion: 24 }]

/**
 * ⚠ GIÁ VỐN ĐI THEO HỆ SỐ. Nhập hàng: một thùng 480.000 thì một hộp
 *   20.000 — không có bảng giá nhập để tra. Bản cũ giữ nguyên 480.000 khi
 *   đổi sang hộp: giá vốn đội lên 24 lần.
 */
describe("nhập hàng: đổi đơn vị thì giá nhập đi theo hệ số", () => {
  it("thùng 480.000 → hộp 20.000, và ngược lại", () => {
    const thung = dong({ unit: "thùng", units: HOP_THUNG, price: 480_000 })
    expect(doiDonViTheoHeSo(thung, "hộp")).toEqual({ unit: "hộp", price: 20_000 })
    const hop = dong({ unit: "hộp", units: HOP_THUNG, price: 20_000 })
    expect(doiDonViTheoHeSo(hop, "thùng").price).toBe(480_000)
  })

  it("thiếu hệ số của một bên thì giữ giá, không đoán", () => {
    const l = dong({ unit: "thùng", units: [{ unit_name: "thùng", conversion: 24 }], price: 480_000 })
    expect(doiDonViTheoHeSo(l, "lốc").price).toBe(480_000)
  })

  it("màn nhập hàng nối ô đơn vị vào phép ấy", () => {
    const S = read("src/components/pos/purchase-screen.tsx")
    expect(S).toMatch(/patchLine\(l\.key, doiDonViTheoHeSo\(l, e\.target\.value\)\)/)
    expect(S, "ô đơn vị chỉ đổi nhãn").not.toMatch(/patchLine\(l\.key, \{ unit: e\.target\.value \}\)/)
  })

  /** `product_units` không khai lại đơn vị cơ sở thì ô chọn thiếu "hộp". */
  it("bộ đơn vị lấy từ danh mục có đơn vị cơ sở đứng đầu", () => {
    expect(donViCuaSanPham(SP as never)).toEqual(HOP_THUNG)
    for (const f of ["purchase-screen", "supplier-return-screen"]) {
      const S = read(`src/components/pos/${f}.tsx`)
      expect(S, `${f} còn dựng đơn vị thẳng từ p.units`).not.toMatch(/units: \(p\.units \?\? \[\]\)\.map/)
    }
  })
})

/**
 * ⚠ SỬA HÓA ĐƠN: HỆ SỐ CỦA DÒNG CŨ. `post_invoice` trừ kho
 *   `quantity × conversion_factor` đúng như màn gửi lên; màn nạp lại mọi
 *   dòng với hệ số 1 — lập lại một dòng "2 thùng" là kho chỉ trừ 2 hộp.
 */
describe("sửa hóa đơn", () => {
  it("dòng nạp lại giữ hệ số đã chụp, và hệ số ấy đi xuống hóa đơn mới", () => {
    const l = dong({ unit: "thùng", units: [{ unit_name: "thùng", conversion: 24 }], qty: 2, price: 450_000 })
    const ds = donViHienThi(l, SP as never)
    expect(ds.map((u) => u.unit_name)).toEqual(["hộp", "thùng"])
    expect(ds.find((u) => u.unit_name === "thùng")?.conversion).toBe(24)
    expect(posLinesToInvoice([l])[0].conversionFactor).toBe(24)
  })

  it("màn đọc conversion_factor của dòng cũ, không đặt 1", () => {
    const S = read("src/components/pos/invoice-edit-screen.tsx")
    expect(S).toMatch(/conversion_factor, unit_price/)
    expect(S).not.toMatch(/units: \[\{ unit_name: x\.unit_name, conversion: 1 \}\]/)
  })

  it("đổi đơn vị tra bảng giá theo nhóm khách; dòng mới cũng thế", () => {
    const S = read("src/components/pos/invoice-edit-screen.tsx")
    expect(S).toMatch(/doiDonViDong\(\{ \.\.\.l, units: donViHienThi\(l, p\) \}, e\.target\.value, p, groupId\)/)
    expect(S, "dòng mới lấy sell_price phẳng").not.toMatch(/price: Number\(p\.sell_price\)/)
    expect(S).toMatch(/price: unitPriceFor\(p, p\.base_unit, groupId\)/)
  })
})

/**
 * ⚠ TRẢ HÀNG (màn riêng): trước chỉ có đơn vị cơ sở và giá `sell_price`
 *   phẳng. Nay chọn được thùng; dòng thêm tay tra bảng giá, dòng nạp từ
 *   hóa đơn gốc hoàn theo giá đã bán × hệ số.
 */
describe("trả hàng: dòng thêm tay vs dòng theo hóa đơn gốc", () => {
  it("dòng thêm tay: đổi sang thùng tra bảng giá thùng", () => {
    const l = dong({ unit: "hộp", units: HOP_THUNG, price: 20_000 })
    expect(doiDonViDongTra(l, "thùng", SP as never, null).price).toBe(450_000)
  })

  it("dòng theo hóa đơn gốc: bán 22.000/hộp thì thùng hoàn 528.000, không theo bảng giá", () => {
    const l = dong({ unit: "hộp", units: [{ unit_name: "hộp", conversion: 1 }], price: 22_000, giaTheoHoaDon: true })
    const moi = doiDonViDongTra(l, "thùng", SP as never, null)
    expect(moi).toMatchObject({ unit: "thùng", price: 528_000 })
  })

  /** Phiếu trả đã lưu nạp lại khi chưa có hệ số (return_lines không lưu). */
  it("dòng chưa biết hệ số lấy hệ số danh mục, không lấy 1", () => {
    const l = dong({ unit: "thùng", units: [], price: 450_000, giaTheoHoaDon: true })
    expect(donViHienThi(l, SP as never).find((u) => u.unit_name === "thùng")?.conversion).toBe(24)
    expect(doiDonViDongTra(l, "hộp", SP as never, null).price).toBe(18_750)
  })

  it("màn trả hàng có ô đơn vị nối vào phép đổi, và thêm hàng tra bảng giá", () => {
    const S = read("src/components/pos/return-screen.tsx")
    expect(S).toMatch(/<PosUnitSelect/)
    expect(S).toMatch(/patch\(l\.key, doiDonViDongTra\(l, u, productById\(l\.productId\), groupId\)\)/)
    expect(S).not.toMatch(/price: Number\(p\.sell_price\)/)
    expect(S).not.toMatch(/units: \[\{ unit_name: (p\.base_unit|x\.unit_name|x\.unitName), conversion: 1 \}\]/)
  })
})

/** ⚠ Phiếu trả kèm đơn nạp lại: đổi được đơn vị, giá theo hệ số. */
describe("màn đơn hàng: dòng nạp lại đổi được đơn vị", () => {
  it("dòng một đơn vị ghép thêm đơn vị của danh mục lúc vẽ", () => {
    const l = dong({ unit: "hộp", units: [{ unit_name: "hộp", conversion: 1 }] })
    expect(donViHienThi(l, SP as never).map((u) => u.unit_name)).toEqual(["hộp", "thùng"])
    expect(donViHienThi(l, null)).toEqual([{ unit_name: "hộp", conversion: 1 }])
  })

  it("hai dải chip vẽ từ donViHienThi, phiếu trả nạp lại mang giaTheoHoaDon", () => {
    const S = read("src/components/pos/order-screen.tsx")
    expect(S.match(/donViHienThi\(l, productById\(l\.productId\)\)\.map/g)).toHaveLength(2)
    expect(S).not.toMatch(/units: \[\{ unit_name: l\.unit_name, conversion: 1 \}\]/)
    expect(S).toMatch(/giaTheoHoaDon: true/)
  })
})
