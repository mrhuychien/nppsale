import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buocSoLuong, CHUA_CO_HANG, dongCoHang, locSoLuong, lyDoKhoaNut, moneyDisplay, SL_PHAI_DUONG, tomTatLo, tomTatThanhDay,
} from "../src/lib/inventory/stock-in-mobile"

/** Phiếu nhập kho trên điện thoại — thiết kế "phieu-nhap" (chủ nhà 30/09/2026). */
const dong = (p: Partial<{ product_id: string; quantity: string; batch_code: string; expires_at: string; unit_name: string }>) => ({
  product_id: "", quantity: "", batch_code: "", expires_at: "", unit_name: "hộp", ...p,
})

describe("thanh đáy: N mặt hàng · N đơn vị", () => {
  it("đơn vị quy về đơn vị cơ sở (2 thùng × 24 + 3 hộp = 51), bỏ dòng trống", () => {
    const lines = [
      dong({ product_id: "a", quantity: "2", unit_name: "thùng" }),
      dong({ product_id: "b", quantity: "3" }),
      dong({}),
    ]
    const r = tomTatThanhDay(lines, (l) => (l.unit_name === "thùng" ? 24 : 1))
    expect(r).toEqual({ matHang: 2, donViCoSo: 51 })
  })

  it("hệ số hỏng / 0 thì coi là 1, SL âm không trừ", () => {
    const r = tomTatThanhDay([dong({ product_id: "a", quantity: "4" }), dong({ product_id: "b", quantity: "-3" })], () => 0)
    expect(r).toEqual({ matHang: 2, donViCoSo: 4 })
  })

  it("chưa có hàng: 0 · 0", () => {
    expect(tomTatThanhDay([dong({})], () => 1)).toEqual({ matHang: 0, donViCoSo: 0 })
  })
})

describe("nút chính", () => {
  it("chưa có mặt hàng → khoá với lý do của thiết kế", () => {
    expect(lyDoKhoaNut([dong({})])).toBe(CHUA_CO_HANG)
    expect(CHUA_CO_HANG).toBe("Thêm ít nhất 1 mặt hàng")
  })
  it("một dòng SL 0 / trống → khoá, không lặng lẽ bỏ dòng", () => {
    expect(lyDoKhoaNut([dong({ product_id: "a", quantity: "2" }), dong({ product_id: "b", quantity: "" })])).toBe(SL_PHAI_DUONG)
    expect(lyDoKhoaNut([dong({ product_id: "a", quantity: "0" })])).toBe(SL_PHAI_DUONG)
  })
  it("đủ → mở (dòng trống tự thêm không tính)", () => {
    expect(lyDoKhoaNut([dong({ product_id: "a", quantity: "0.5" }), dong({})])).toBe("")
  })
})

describe("nhãn và ô nhập", () => {
  it("tóm tắt lô", () => {
    expect(tomTatLo({ batch_code: "", expires_at: "" })).toBe("Lô tự sinh · chưa có HSD")
    expect(tomTatLo({ batch_code: " L01 ", expires_at: "2027-12-31" })).toBe("L01 · HSD 31/12/2027")
  })
  it("− / + không xuống dưới 0", () => {
    expect(buocSoLuong("1", -1)).toBe("0")
    expect(buocSoLuong("0", -1)).toBe("0")
    expect(buocSoLuong("", 1)).toBe("1")
    expect(buocSoLuong("1.5", 1)).toBe("2.5")
  })
  it("ô SL chỉ giữ số và một dấu thập phân", () => {
    expect(locSoLuong("1,5")).toBe("1.5")
    expect(locSoLuong("1.2.3")).toBe("1.23")
    expect(locSoLuong("a12e")).toBe("12")
  })
  it("moneyDisplay làm tròn, không đọc 29629.6 thành 296296", () => {
    expect(moneyDisplay("29629.6")).toBe(29630)
    expect(moneyDisplay("")).toBe("")
  })
  it("dongCoHang bỏ dòng chưa chọn hàng", () => {
    expect(dongCoHang([dong({ product_id: "a" }), dong({})])).toHaveLength(1)
  })
})

describe("trang /inventory/stock-in: điện thoại dùng màn mới, máy tính giữ nguyên", () => {
  const PAGE = readFileSync(resolve(__dirname, "../src/app/(dashboard)/inventory/stock-in/page.tsx"), "utf-8")
  const MOBILE = readFileSync(resolve(__dirname, "../src/components/inventory/stock-in-mobile.tsx"), "utf-8")

  it("màn điện thoại bọc lg:hidden, máy tính hidden lg:block", () => {
    const i = PAGE.indexOf("<StockInMobile")
    expect(i).toBeGreaterThan(0)
    expect(PAGE.slice(i - 80, i)).toContain('className="lg:hidden"')
    expect(PAGE).toContain('className="hidden space-y-6 lg:block"')
  })

  it("cùng lệnh ghi: nút chính của điện thoại gọi handleSubmit", () => {
    const i = PAGE.indexOf("<StockInMobile")
    const khoi = PAGE.slice(i, PAGE.indexOf("/>", i))
    expect(khoi).toContain("onSubmit={handleSubmit}")
    expect(khoi).toContain("onDiscard={discardDraft}")
    expect(khoi).toContain('nccField={nccField("stockin-supplier-m")}')
  })

  it("đầu trắng + thanh đáy có kb-hide và khoá theo lyDoKhoaNut", () => {
    expect(MOBILE).toContain("<DauTrangTrang")
    expect(MOBILE).toContain('title="Nhập kho"')
    expect(MOBILE).toContain("Huỷ nháp")
    const i = MOBILE.indexOf('data-testid="nk-m-thanh-day"')
    expect(i).toBeGreaterThan(0)
    const bar = MOBILE.slice(i - 20, i + 1200)
    expect(bar).toContain("kb-hide")
    expect(bar).toContain("disabled={!!lyDo || p.saving}")
  })
})
