import { describe, it, expect } from "vitest"
import { docChonNhieu, ghiChonNhieu } from "../src/lib/sell/chon-nhieu-pref"

/** ⚠ Chủ nhà 24/09/2026: chế độ chọn nhiều giữ tới khi người dùng tự tắt. */
function kho() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe("nhớ công tắc chọn nhiều", () => {
  it("bật rồi đọc lại; tắt thì quên", () => {
    const k = kho()
    expect(docChonNhieu("dat", k)).toBe(false)
    ghiChonNhieu("dat", true, k)
    expect(docChonNhieu("dat", k)).toBe(true)
    ghiChonNhieu("dat", false, k)
    expect(docChonNhieu("dat", k)).toBe(false)
  })
  it("đặt hàng và hàng trả là hai công tắc riêng", () => {
    const k = kho()
    ghiChonNhieu("tra", true, k)
    expect(docChonNhieu("tra", k)).toBe(true)
    expect(docChonNhieu("dat", k)).toBe(false)
  })
  it("bộ nhớ trình duyệt ném lỗi (chế độ riêng tư) thì coi như tắt, không vỡ màn", () => {
    const hong = { getItem: () => { throw new Error("SecurityError") }, setItem: () => { throw new Error("QuotaExceeded") }, removeItem: () => { throw new Error("x") } }
    expect(docChonNhieu("dat", hong)).toBe(false)
    expect(() => ghiChonNhieu("dat", true, hong)).not.toThrow()
  })
})
