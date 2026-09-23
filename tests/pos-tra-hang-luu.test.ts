import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dongTraGhiSo } from "../src/lib/pos/save"
import { moCuaInCho, trangInHoaDon } from "../src/lib/pos/print-window"
import type { PosLine } from "../src/lib/pos/types"

const dong = (p: Partial<PosLine>): PosLine => ({
  key: "k", productId: "p1", sku: "", name: "Sữa", unit: "hộp", units: [],
  qty: 1, price: 0, discount: { value: 0, unit: "vnd" }, ...p,
})

/**
 * ⚠ CHỦ NHÀ BÁO 23/09/2026: "Lưu đơn hàng trả lỗi … null value in column
 *   line_total of relation return_lines violates not-null constraint (23502)".
 *   Màn Trả hàng POS chèn dòng mà không có `line_total`.
 */
describe("POS trả hàng: dòng ghi sổ có line_total", () => {
  it("line_total = làm tròn SL × giá × (1 + VAT) — cùng công thức toReturnLine / mig 152", () => {
    expect(dongTraGhiSo("r1", dong({ qty: 3, price: 19_000 }))).toMatchObject({
      return_id: "r1", product_id: "p1", unit_name: "hộp", quantity: 3, unit_price: 19_000,
      vat_rate: 0, line_total: 57_000, is_exchange: false,
    })
    expect(dongTraGhiSo("r1", dong({ qty: 1.5, price: 333, vatRate: 0.1 })).line_total).toBe(Math.round(1.5 * 333 * 1.1))
  })

  it("dòng đổi vẫn mang line_total (cột NOT NULL) và cờ is_exchange", () => {
    const r = dongTraGhiSo("r1", dong({ qty: 2, price: 10_000, isExchange: true }))
    expect(r.line_total).toBe(20_000)
    expect(r.is_exchange).toBe(true)
  })

  it("savePosReturn chèn dòng qua dongTraGhiSo", () => {
    const S = readFileSync("src/lib/pos/save.ts", "utf8")
    const i = S.indexOf("export async function savePosReturn")
    expect(S.slice(i)).toMatch(/\.map\(\(l\) => dongTraGhiSo\(id!?, l\)\)/)
  })
})

/**
 * ⚠ CHỦ NHÀ 23/09/2026: "Khi bấm nút Xuất hàng và lập HĐ / Huỷ HĐ và lập lại
 *   -> bật luôn cửa sổ in hoá đơn".
 */
describe("cửa sổ in mở sẵn lúc bấm", () => {
  const tab = () => ({
    closed: false,
    close: vi.fn(function (this: { closed: boolean }) { this.closed = true }),
    location: { href: "" },
    document: { title: "", body: { textContent: "" } },
  })

  it("mở tab NGAY (trước ghi sổ), xong thì trỏ tới trang in ?auto=1", () => {
    const t = tab()
    const open = vi.fn(() => t as unknown as Window)
    const c = moCuaInCho({ open })
    expect(open).toHaveBeenCalledTimes(1)
    c.toi(trangInHoaDon("inv1"))
    expect(t.location.href).toBe("/sales-invoices/inv1/print?auto=1")
    expect(open).toHaveBeenCalledTimes(1)
  })

  it("ghi sổ hỏng thì đóng tab trống", () => {
    const t = tab()
    const c = moCuaInCho({ open: () => t as unknown as Window })
    c.dong()
    expect(t.close).toHaveBeenCalled()
  })

  it("tab bị chặn (open trả null) thì lúc xong mở thẳng trang in", () => {
    const open = vi.fn(() => null)
    const c = moCuaInCho({ open })
    c.toi("/x")
    expect(open).toHaveBeenLastCalledWith("/x", "_blank")
  })
})
