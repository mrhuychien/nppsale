import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docChonNhieu, ghiChonNhieu, roiManSauKhiThem, khoaChonNhieu, KHOA_CHON_NHIEU } from "../src/lib/sell/pick-mode"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Đảo ngược: chế độ chọn từng sản phẩm một là mặc định,
 *   chế độ chọn nhiều sản phẩm là option" — công tắc giữ tới khi người dùng tự
 *   tắt, bán và trả riêng. Và "bỏ dấu + ở từng dòng … bấm vào dòng".
 */
describe("chế độ chọn nhiều (tuỳ chọn) / chọn từng mã (mặc định)", () => {
  const kho = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      m,
    }
  }
  it("mặc định chọn TỪNG mã; bật / tắt chọn nhiều được lưu", () => {
    const s = kho()
    expect(docChonNhieu("ban", s)).toBe(false)
    ghiChonNhieu(true, "ban", s)
    expect(s.m.get(KHOA_CHON_NHIEU)).toBe("1")
    expect(docChonNhieu("ban", s)).toBe(true)
    ghiChonNhieu(false, "ban", s)
    expect(docChonNhieu("ban", s)).toBe(false)
  })
  it("khoá cũ 'chọn từng mã' KHÔNG bị đọc lại (nghĩa ngược)", () => {
    const s = kho()
    s.m.set("npp.sell.chon-tung-ma", "1")
    expect(docChonNhieu("ban", s)).toBe(false)
    expect(KHOA_CHON_NHIEU).not.toBe("npp.sell.chon-tung-ma")
  })
  it("bán và trả là hai công tắc riêng", () => {
    const s = kho()
    ghiChonNhieu(true, "tra", s)
    expect(docChonNhieu("tra", s)).toBe(true)
    expect(docChonNhieu("ban", s)).toBe(false)
    expect(khoaChonNhieu("tra")).not.toBe(khoaChonNhieu("ban"))
  })
  it("bộ nhớ bị chặn thì về mặc định, không làm hỏng màn", () => {
    const hong = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") }, removeItem: () => { throw new Error("blocked") } }
    expect(docChonNhieu("ban", hong)).toBe(false)
    expect(() => ghiChonNhieu(true, "tra", hong)).not.toThrow()
  })
  it("rời màn khi: chọn TỪNG mã, thêm, dòng MỚI", () => {
    const co = { chonNhieu: false, delta: 1, dongMoi: true }
    expect(roiManSauKhiThem(co)).toBe(true)
    expect(roiManSauKhiThem({ ...co, chonNhieu: true })).toBe(false)
    expect(roiManSauKhiThem({ ...co, delta: -1 })).toBe(false)
    expect(roiManSauKhiThem({ ...co, dongMoi: false })).toBe(false)
  })
  it("màn /sell: nút chọn nhiều ở cả bán lẫn trả; đọc bộ nhớ sau khi gắn màn", () => {
    const S = readFileSync("src/app/(dashboard)/sell/page.tsx", "utf8")
    expect(S).toContain("useEffect(() => { setChonNhieu(docChonNhieu(loaiChon)) }, [loaiChon])")
    expect(S).toContain("{!returning && nutChonNhieu}")
    expect(S.match(/\{nutChonNhieu\}/g)?.length).toBe(1)
    expect(S).toMatch(/if \(roiManSauKhiThem\(\{ chonNhieu, delta, dongMoi: j < 0 \}\)\) \{\s*clearSearchMemory\(\)\s*backToReturnSlip\(router\)/)
  })
  it("thẻ: bấm dòng là +1, bỏ nút + LÚC ĐẦU; bộ − số + giữ, nút con chặn lan chạm", () => {
    const C = readFileSync("src/components/sell/product-card.tsx", "utf8")
    expect(C).toContain('role="button"')
    expect(C).toContain("onClick={them}")
    expect(C).toContain("onClick={rieng(() => onPickUnit(product.id, u))}")
    expect(C).toContain("onClick={rieng(() => onStep(product, unit, -1))}")
    expect(C).toContain("onClick={rieng(them)}") // + trong bộ đếm: không +2
    expect(C).not.toContain("<Plus") // nút + lúc đầu đã bỏ
    expect(C).not.toMatch(/onStep\(product, unit, 1\)\}\s*className/)
  })
})
