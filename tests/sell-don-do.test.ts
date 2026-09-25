import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { coDonDangLamDo, hoiKhiVaoTrang } from "@/lib/sell/don-do"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Nếu có đơn đang làm dở khi vào làm đơn sẽ hiện modal hỏi: Bạn có
 *   đơn hàng đang làm dở. Bạn có muốn tiếp tục? Có / Không."
 */
describe("đơn đang làm dở ở /sell", () => {
  it("có hàng bán hoặc hàng trả mới là đơn dở", () => {
    expect(coDonDangLamDo({ cart: [], returnLines: [] })).toBe(false)
    expect(coDonDangLamDo({ cart: [{}], returnLines: [] })).toBe(true)
    expect(coDonDangLamDo({ cart: [], returnLines: [{}] })).toBe(true)
  })
  it("không hỏi ở màn tự nạp đơn vào giỏ / xong đơn / nháp", () => {
    for (const p of ["/sell", "/sell/cart", "/sell/customer", "/sell/terms"]) expect(hoiKhiVaoTrang(p), p).toBe(true)
    for (const p of ["/sell/edit/abc", "/sell/reorder/abc", "/sell/done", "/sell/drafts", "/orders"]) expect(hoiKhiVaoTrang(p), p).toBe(false)
  })
  it("modal gắn ở layout /sell — một lần mỗi lần vào luồng; Không = xoá giỏ", () => {
    expect(readFileSync(resolve(__dirname, "../src/app/(dashboard)/sell/layout.tsx"), "utf-8")).toContain("<DonDoModal />")
    const m = readFileSync(resolve(__dirname, "../src/components/sell/don-do-modal.tsx"), "utf-8")
    expect(m).toContain("Bạn có đơn hàng đang làm dở")
    expect(m).toContain("Bạn có muốn tiếp tục?")
    expect(m).toMatch(/cart\.clear\(\)\s+setMo\(false\)/)
    expect(m).toContain("daXet.current = true")
  })
})
