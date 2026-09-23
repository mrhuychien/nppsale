import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { doiDonViDong } from "../src/lib/pos/units"
import { posLinesToReturnCart } from "../src/lib/pos/save"
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
    expect(khoi).toMatch(/sua\(doiDonViDong\(l, u\.unit_name, productById\(l\.productId\), groupId\)\)/)
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
