/**
 * Chủ nhà 02/10/2026: màn soạn hàng theo mẫu — nhặt tổng theo kệ → chia rổ theo đơn → hoàn tất; thiếu hàng "Ghi
 * thiếu, báo để sửa HĐ". Máy chủ: scripts/sql/thu-225-luot-soan.sql. Bấm thật: e2e/soan-hang.spec.ts.
 */
import { describe, it, expect } from "vitest"
import {
  chiaVaoRo, chuaChiaKeTiep, chuaNhatKeTiep, docTienDo, dungDongNhat, hienSoLuong, khoaChia, khuKe, nhomDong,
  thieuTheoHd, tongKet, loiLuotSoan, type DongHdSoan, type HdSoan,
} from "@/lib/orders/luot-soan"

const HD: HdSoan[] = [
  { id: "h1", ma: "HD-0701", khach: "Super market 178" },
  { id: "h2", ma: "HD-0676", khach: "Cô Phương" },
  { id: "h3", ma: "HD-0702", khach: "Khách lẻ" },
]
const SP = { banh: { base_unit: "gói", units: [{ unit_name: "thùng", conversion: 15 }] }, keo: { base_unit: "gói", units: [] }, kem: { base_unit: "hộp", units: [] } }
const d = (invoiceId: string, productId: string, sl: number, donVi = "gói", heSo = 1, x: Partial<DongHdSoan> = {}): DongHdSoan => ({
  invoiceId, productId, sl, donVi, heSo, ten: productId, sku: productId.toUpperCase(),
  viTri: { banh: "A1-03", keo: "B1-02", kem: "TĐ-01" }[productId] ?? null, ncc: { banh: "Royalfarm", keo: "Tân Việt" }[productId] ?? null, ...x,
})
const DONG = [
  d("h1", "banh", 1, "thùng", 15), d("h1", "keo", 10), d("h3", "banh", 5),
  d("h2", "kem", 3, "hộp"), d("h2", "banh", 2), d("h1", "keo", 2),
]

describe("dòng nhặt tổng", () => {
  const rows = dungDongNhat(HD, DONG, SP)
  it("quy về đơn vị cơ sở, gộp theo mặt hàng, rổ theo thứ tự HĐ, xếp theo vị trí kệ", () => {
    expect(rows.map((r) => r.productId)).toEqual(["banh", "keo", "kem"])
    const banh = rows[0]
    expect(banh.tong).toBe(22)
    expect(banh.phan.map((p) => `${p.ro}${p.sl}`)).toEqual(["A15", "B2", "C5"])
    expect(rows[1].phan).toEqual([expect.objectContaining({ ro: "A", sl: 12 })])
  })
  it("SL hiện '1 thùng + 7 gói = 22 gói'; không có đơn vị lớn thì không có dòng phụ", () => {
    expect(hienSoLuong(22, rows[0])).toEqual({ chinh: "1 thùng + 7 gói", phu: "= 22 gói" })
    expect(hienSoLuong(12, rows[1])).toEqual({ chinh: "12 gói", phu: "" })
  })
  it("nhóm theo kệ (đường đi) / nhà cung cấp", () => {
    expect(khuKe("A1-03")).toBe("Kệ A")
    expect(khuKe("TĐ-01")).toBe("Kệ TĐ")
    expect(khuKe(null)).toBe("Chưa có vị trí kệ")
    expect(nhomDong(rows, "ke").map((g) => g.ten)).toEqual(["Kệ A", "Kệ B", "Kệ TĐ"])
    expect(nhomDong(rows, "ncc").map((g) => g.ten)).toEqual(["Chưa có nhà cung cấp", "Royalfarm", "Tân Việt"])
  })
})

describe("thiếu hàng: chia đủ theo thứ tự rổ, báo để sửa HĐ", () => {
  const rows = dungDongNhat(HD, DONG, SP)
  it("nhặt được 16/22 bánh → A 15, B 1, C 0", () => {
    expect(chiaVaoRo(rows[0], 16).map((p) => p.duoc)).toEqual([15, 1, 0])
    expect(chiaVaoRo(rows[0]).map((p) => p.duoc)).toEqual([15, 2, 5])
  })
  it("danh sách thiếu theo hoá đơn", () => {
    const t = { nhat: { banh: 16 }, chia: {} }
    const m = thieuTheoHd(rows, t)
    expect(m.get("h2")).toEqual(["Thiếu 1 gói · banh"])
    expect(m.get("h3")).toEqual(["Thiếu 5 gói · banh"])
    expect(m.has("h1")).toBe(false)
  })
})

describe("tiến độ", () => {
  const rows = dungDongNhat(HD, DONG, SP)
  it("đếm đã nhặt / ô chia / rổ đủ; rổ hết hàng (thiếu) không tính là ô phải chia", () => {
    const t = { nhat: { banh: 16, keo: 12, kem: 3 }, chia: { [khoaChia("banh", "h1")]: true, [khoaChia("keo", "h1")]: true } as Record<string, boolean> }
    const k = tongKet(rows, t)
    expect(k).toMatchObject({ soMat: 3, daNhat: 3, xongNhat: true, soO: 4, daChia: 2, matThieu: 1, xongChia: false })
    expect(Array.from(k.roDu)).toEqual(["h1"])
    t.chia[khoaChia("banh", "h2")] = true
    t.chia[khoaChia("kem", "h2")] = true
    expect(tongKet(rows, t).xongChia).toBe(true)
  })
  it("chưa nhặt hết thì chưa xong chia; mặt hàng kế tiếp vòng lại đầu", () => {
    const t = { nhat: { keo: 12 }, chia: {} }
    expect(tongKet(rows, t).xongChia).toBe(false)
    expect(chuaNhatKeTiep(rows, t, 1)).toBe(2)
    expect(chuaNhatKeTiep(rows, t, 2)).toBe(0)
    expect(chuaNhatKeTiep(rows, { nhat: { banh: 22, keo: 12, kem: 3 }, chia: {} }, 0)).toBe(-1)
    expect(chuaChiaKeTiep(rows, { nhat: {}, chia: { [khoaChia("keo", "h1")]: true } }, 0)).toBe(2)
  })
  it("đọc tiến độ máy chủ an toàn", () => {
    expect(docTienDo({ nhat: { a: 3, b: "x" }, chia: { "a|h": true, "b|h": false } })).toEqual({ nhat: { a: 3 }, chia: { "a|h": true } })
    expect(docTienDo(null)).toEqual({ nhat: {}, chia: {} })
    expect(loiLuotSoan("LUOT_DA_DONG: x")).toMatch(/hoàn tất/)
  })
})
