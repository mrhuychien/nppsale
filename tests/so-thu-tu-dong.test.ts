/** Chủ nhà 02/10/2026: "các màn làm đơn trên di động thêm số thứ tự đầu dòng". Bấm thật: e2e/so-thu-tu-dong.spec.ts. */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MAN: Array<[string, string, RegExp]> = [
  ["Giỏ /sell (đơn hàng)", "src/app/(dashboard)/sell/cart/page.tsx", /data-testid="dong-gio"[\s\S]{0,200}?<SoThuTu n=\{k \+ 1\} \/>/],
  ["Hàng trả / đổi /sell", "src/app/(dashboard)/sell/returns/page.tsx", /data-testid="dong-tra-sell"[\s\S]{0,200}?<SoThuTu n=\{i \+ 1\} \/>/],
  ["Phiếu nhập / trả hàng NCC", "src/components/purchasing/phieu-ncc-mobile.tsx", /data-testid="dong-phieu-ncc"[\s\S]{0,200}?<SoThuTu n=\{i \+ 1\} \/>/],
  ["Phiếu nhập kho", "src/components/inventory/stock-in-mobile.tsx", /data-testid="nk-m-dong"[\s\S]{0,300}?<SoThuTu n=\{i \+ 1\} \/>/],
]

describe("số thứ tự đầu dòng ở các màn làm đơn trên điện thoại", () => {
  for (const [ten, f, re] of MAN) {
    it(ten, () => expect(readFileSync(f, "utf8")).toMatch(re))
  }
  it("một ô dùng chung", () => {
    expect(readFileSync("src/components/mobile/so-thu-tu.tsx", "utf8")).toContain('data-testid="stt-dong"')
  })
})
