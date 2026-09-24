import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { posPrintHref } from "../src/lib/pos/tabs"
import { trangInHoaDon } from "../src/lib/pos/print-window"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Ấn vào IN trên Đơn hàng hoặc Hoá đơn -> bật ra cửa sổ
 *   máy in luôn ko cần ra trang in, thiết lập luôn phiếu in riêng cho màn pos".
 */
const read = (p: string) => readFileSync(p, "utf8")

describe("POS in tại chỗ bằng trang in riêng", () => {
  /**
   * ⚠ NGUYÊN NHÂN GỐC: `X-Frame-Options: DENY` chặn CẢ khung cùng miền — khung
   *   in ẩn của `inTaiCho` nạp ra trang lỗi, bấm In không bật gì.
   */
  it("header cho phép khung CÙNG MIỀN, không DENY", () => {
    const cfg = read("next.config.mjs")
    expect(cfg).toMatch(/key: 'X-Frame-Options',\s*value: 'SAMEORIGIN'/)
    expect(cfg).not.toContain("'DENY'")
  })

  it.each([
    ["don-hang", "orders"],
    ["hoa-don", "sales-invoices"],
    ["tra-hang", "returns"],
  ])("/in/%s dùng CHUNG mẫu phiếu với /%s/[id]/print", (r, d) => {
    const f = `src/app/in/${r}/[id]/page.tsx`
    expect(existsSync(f)).toBe(true)
    expect(read(f)).toContain(`export { default } from "@/app/(dashboard)/${d}/[id]/print/page"`)
  })

  it("trang in POS nằm NGOÀI khung dashboard (không menu, không thanh trên)", () => {
    expect(existsSync("src/app/in/layout.tsx")).toBe(true)
    expect(read("src/app/in/layout.tsx")).not.toContain("DashboardShell")
  })

  it("mọi nút In của POS đi trang in riêng qua khung ẩn, không mở tab", () => {
    expect(posPrintHref("SO", "x")).toBe("/in/don-hang/x")
    expect(trangInHoaDon("x")).toBe("/in/hoa-don/x?auto=1")
    expect(read("src/components/pos/order-screen.tsx")).toContain("inTaiCho(`/in/don-hang/${orderId}`)")
    expect(read("src/components/pos/return-screen.tsx")).toContain("inTaiCho(`/in/tra-hang/${returnId}`)")
    const xem = read("src/app/pos/hoa-don/[id]/page.tsx")
    expect(xem).toContain('const h = posPrintHref("INV", id); if (h) inTaiCho(h)')
    for (const f of ["src/components/pos/order-screen.tsx", "src/components/pos/invoice-screen.tsx",
      "src/components/pos/return-screen.tsx", "src/components/pos/pos-top-bar.tsx", "src/app/pos/hoa-don/[id]/page.tsx"]) {
      expect(read(f), `${f} còn mở trang in ở tab`).not.toMatch(/window\.open\([^)]*print/)
      expect(read(f), `${f} còn mở trang in của phần quản lý`).not.toMatch(/\/(orders|sales-invoices|returns)\/\$\{[^}]+\}\/print/)
    }
  })
})
