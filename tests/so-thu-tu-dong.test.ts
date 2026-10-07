/** Chủ nhà 02/10/2026: "các màn làm đơn trên di động thêm số thứ tự đầu dòng". Bấm thật: e2e/so-thu-tu-dong.spec.ts. */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MAN: Array<[string, string, RegExp]> = [
  ["Giỏ /sell (đơn hàng)", "src/app/(dashboard)/sell/cart/page.tsx", /data-testid="dong-gio"[\s\S]{0,200}?<SoThuTu n=\{k \+ 1\} \/>/],
  ["Hàng trả / đổi /sell", "src/app/(dashboard)/sell/returns/page.tsx", /data-testid="dong-tra-sell"[\s\S]{0,200}?<SoThuTu n=\{i \+ 1\} \/>/],
  ["Phiếu nhập / trả hàng NCC", "src/components/purchasing/phieu-ncc-mobile.tsx", /data-testid="dong-phieu-ncc"[\s\S]{0,200}?<SoThuTu n=\{i \+ 1\} \/>/],
  ["Phiếu nhập kho", "src/components/inventory/stock-in-mobile.tsx", /data-testid="nk-m-dong"[\s\S]{0,300}?<SoThuTu n=\{i \+ 1\} \/>/],
]

// Chủ nhà 02/10/2026: "thêm số thứ tự cho màn kiểm kê và duyệt điều chỉnh. rà soát thêm Cái gì có dòng thì thêm stt vào".
const CO_DONG = [
  "src/components/inventory/kiem-ke-mobile.tsx",
  "src/components/inventory/duyet-dieu-chinh-mobile.tsx",
  "src/components/inventory/chi-tiet-phieu-dien-thoai.tsx",
  "src/app/(dashboard)/inventory/stocktake-check/page.tsx",
  "src/app/(dashboard)/inventory/adjustments/page.tsx",
  "src/app/(dashboard)/orders/[id]/page.tsx",
  "src/app/(dashboard)/sales-invoices/[id]/page.tsx",
  "src/app/(dashboard)/returns/[id]/page.tsx",
  /* Lập phiếu trả trên điện thoại (07/10/2026): dòng hàng vẽ ở phần vẽ kiểu /sell. */
  "src/components/returns/phieu-tra-khach-mobile.tsx",
  "src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx",
  "src/components/orders/mobile-order-detail.tsx",
  "src/components/orders/order-drawer.tsx",
  "src/components/orders/return-summary.tsx",
  "src/components/sales-invoices/invoice-drawer.tsx",
  "src/components/returns/return-drawer.tsx",
  "src/components/finance/cash-receipt-drawer.tsx",
  "src/components/pos/invoice-screen.tsx",
  "src/components/pos/order-screen.tsx",
]

describe("mọi màn có dòng chứng từ đều có STT", () => {
  for (const f of CO_DONG) {
    it(f, () => expect(readFileSync(f, "utf8")).toMatch(/<SoThuTu n=\{|data-testid="stt-dong"/))
  }
  it("duyệt điều chỉnh: STT trong chi tiết dòng kiểm", () => {
    expect(readFileSync("src/components/inventory/duyet-dieu-chinh-mobile.tsx", "utf8")).toMatch(/data-testid="dong-kiem-chi-tiet"[\s\S]{0,700}?<SoThuTu n=\{i \+ 1\} \/>/)
  })
  it("kiểm kê: STT nằm trong dòng kiểm", () => {
    expect(readFileSync("src/components/inventory/kiem-ke-mobile.tsx", "utf8")).toMatch(/data-testid="dong-kiem-ke"[\s\S]{0,500}?<SoThuTu n=\{i \+ 1\} \/>/)
  })
})

describe("số thứ tự đầu dòng ở các màn làm đơn trên điện thoại", () => {
  for (const [ten, f, re] of MAN) {
    it(ten, () => expect(readFileSync(f, "utf8")).toMatch(re))
  }
  it("một ô dùng chung", () => {
    expect(readFileSync("src/components/mobile/so-thu-tu.tsx", "utf8")).toContain('data-testid="stt-dong"')
  })
})
