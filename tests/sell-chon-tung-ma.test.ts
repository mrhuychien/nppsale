import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docChonTungMa, ghiChonTungMa, roiManSauKhiThem, khoaChonTungMa, KHOA_CHON_TUNG_MA } from "../src/lib/sell/pick-mode"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: nút chọn từng mã, giữ tới khi người dùng tự tắt;
 *   "Thêm cả cho phần chọn hàng trả".
 */
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
    expect(docChonTungMa("ban", s)).toBe(false)
    ghiChonTungMa(true, "ban", s)
    expect(s.m.get(KHOA_CHON_TUNG_MA)).toBe("1")
    expect(docChonTungMa("ban", s)).toBe(true)
    ghiChonTungMa(false, "ban", s)
    expect(docChonTungMa("ban", s)).toBe(false)
  })
  it("bán và trả là hai công tắc riêng", () => {
    const s = kho()
    ghiChonTungMa(true, "tra", s)
    expect(docChonTungMa("tra", s)).toBe(true)
    expect(docChonTungMa("ban", s)).toBe(false)
    expect(khoaChonTungMa("tra")).not.toBe(khoaChonTungMa("ban"))
  })
  it("bộ nhớ bị chặn thì không làm hỏng màn", () => {
    const hong = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") }, removeItem: () => { throw new Error("blocked") } }
    expect(docChonTungMa("ban", hong)).toBe(false)
    expect(() => ghiChonTungMa(true, "tra", hong)).not.toThrow()
  })
  it("chỉ rời màn khi: đang bật, thêm, dòng MỚI", () => {
    const co = { chonTungMa: true, delta: 1, dongMoi: true }
    expect(roiManSauKhiThem(co)).toBe(true)
    expect(roiManSauKhiThem({ ...co, chonTungMa: false })).toBe(false)
    expect(roiManSauKhiThem({ ...co, delta: -1 })).toBe(false)
    expect(roiManSauKhiThem({ ...co, dongMoi: false })).toBe(false)
  })
  it("nút ở cả màn bán lẫn màn trả; đọc bộ nhớ sau khi gắn màn, theo đúng loại", () => {
    const S = readFileSync("src/app/(dashboard)/sell/page.tsx", "utf8")
    expect(S).toContain("useEffect(() => { setChonTungMa(docChonTungMa(loaiChon)) }, [loaiChon])")
    expect(S).toContain("{!returning && nutChonTungMa}")
    expect(S.match(/\{nutChonTungMa\}/g)?.length).toBe(1) // hàng khách + bảng giá của màn trả
    expect(S).toMatch(/if \(roiManSauKhiThem\(\{ chonTungMa, delta, dongMoi: j < 0 \}\)\) \{\s*clearSearchMemory\(\)\s*backToReturnSlip\(router\)/)
  })
})
