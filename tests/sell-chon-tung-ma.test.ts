import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docChonTungMa, ghiChonTungMa, sangDonSauKhiThem, KHOA_CHON_TUNG_MA } from "../src/lib/sell/pick-mode"

/** ⚠ CHỦ NHÀ 25/09/2026: nút chọn từng mã, giữ tới khi người dùng tự tắt. */
describe("chế độ chọn từng mã", () => {
  const kho = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      m,
    }
  }
  it("lưu bật / tắt, mặc định chọn nhiều", () => {
    const s = kho()
    expect(docChonTungMa(s)).toBe(false)
    ghiChonTungMa(true, s)
    expect(s.m.get(KHOA_CHON_TUNG_MA)).toBe("1")
    expect(docChonTungMa(s)).toBe(true)
    ghiChonTungMa(false, s)
    expect(docChonTungMa(s)).toBe(false)
  })
  it("bộ nhớ bị chặn thì không làm hỏng màn", () => {
    const hong = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") }, removeItem: () => { throw new Error("blocked") } }
    expect(docChonTungMa(hong)).toBe(false)
    expect(() => ghiChonTungMa(true, hong)).not.toThrow()
  })
  it("chỉ sang đơn khi: đang bật, thêm, dòng MỚI, không phải chọn hàng trả", () => {
    const co = { chonTungMa: true, delta: 1, dongMoi: true, traHang: false }
    expect(sangDonSauKhiThem(co)).toBe(true)
    expect(sangDonSauKhiThem({ ...co, chonTungMa: false })).toBe(false)
    expect(sangDonSauKhiThem({ ...co, delta: -1 })).toBe(false)
    expect(sangDonSauKhiThem({ ...co, dongMoi: false })).toBe(false)
    expect(sangDonSauKhiThem({ ...co, traHang: true })).toBe(false)
  })
  it("nút nằm cạnh bảng giá, đọc bộ nhớ sau khi gắn màn", () => {
    const S = readFileSync("src/app/(dashboard)/sell/page.tsx", "utf8")
    expect(S).toContain("useEffect(() => { setChonTungMa(docChonTungMa()) }, [])")
    expect(S).toContain('data-testid="chon-tung-ma"')
    expect(S.indexOf("{bangGia}")).toBeLessThan(S.indexOf('data-testid="chon-tung-ma"'))
  })
})
