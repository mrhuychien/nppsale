import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cauTrungMaNcc, laTrungMaNcc, maNccTiepTheo, maNccTuSo, soDuoiMaNcc, soLonNhatMaNcc } from "@/lib/suppliers/ma-ncc"

/**
 * Chủ nhà 22/11/2026: "Kiểm tra lại phần tạo nhà cung cấp mới bị lỗi" — duplicate key "suppliers_org_id_code_key" (23505).
 * Mã tự đánh cũ = "NCC-" + (số NCC + 1): sổ đã xoá bớt NCC thì số ấy trùng một mã đang dùng, LẦN NÀO cũng trùng.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("mã NCC tự đánh", () => {
  it("đọc số đuôi đúng dạng NCC-<số>, không phân biệt hoa thường; mã khác dạng bỏ qua", () => {
    expect(soDuoiMaNcc("NCC-0012")).toBe(12)
    expect(soDuoiMaNcc(" ncc-7 ")).toBe(7)
    expect(soDuoiMaNcc("NCC1")).toBeNull()
    expect(soDuoiMaNcc("NCC-BH")).toBeNull()
    expect(soDuoiMaNcc("PCNCC-0003")).toBeNull()
    expect(soDuoiMaNcc(null)).toBeNull()
    expect(soDuoiMaNcc("")).toBeNull()
  })
  it("sổ đã xoá bớt NCC: mã kế tiếp = LỚN NHẤT + 1, không phải số NCC + 1 (lỗi chủ nhà gặp)", () => {
    // Ba NCC còn lại sau khi xoá NCC-0002: số NCC + 1 = 4 → nhưng NCC-0004 đang có.
    const daCo = ["NCC-0001", "NCC-0003", "NCC-0004"]
    expect(maNccTuSo(daCo.length + 1)).toBe("NCC-0004")
    expect(maNccTiepTheo(daCo)).toBe("NCC-0005")
  })
  it("chưa có mã nào dạng NCC-<số> → NCC-0001; mã gõ tay khác dạng không làm lệch", () => {
    expect(maNccTiepTheo([])).toBe("NCC-0001")
    expect(maNccTiepTheo(["NCC1", "NCC-BH", null, undefined, ""])).toBe("NCC-0001")
    expect(soLonNhatMaNcc(["NCC-0009", "ABC", "ncc-0011"])).toBe(11)
  })
  it("số dài hơn 4 chữ số giữ nguyên; mã kế tiếp đã có (khác hoa thường) thì tăng tiếp", () => {
    expect(maNccTuSo(12345)).toBe("NCC-12345")
    expect(maNccTiepTheo(["NCC-9999"])).toBe("NCC-10000")
    // "ncc-0003" là mã lớn nhất → 4; không có mã nào trùng 4 → NCC-0004.
    expect(maNccTiepTheo(["NCC-0001", "ncc-0003"])).toBe("NCC-0004")
  })
  it("nhận ra lỗi trùng mã NCC (23505 trên suppliers_org_id_code_key), không nhầm lỗi khác", () => {
    expect(laTrungMaNcc({ code: "23505", message: 'duplicate key value violates unique constraint "suppliers_org_id_code_key"' })).toBe(true)
    expect(laTrungMaNcc({ code: "23505", message: "x", details: "Key (org_id, code)=(a, NCC-0001) already exists." })).toBe(true)
    expect(laTrungMaNcc({ code: "23505", message: 'duplicate key value violates unique constraint "customers_org_id_phone_key"' })).toBe(false)
    expect(laTrungMaNcc({ code: "42501", message: "suppliers_org_id_code_key" })).toBe(false)
    expect(laTrungMaNcc(null)).toBe(false)
    expect(laTrungMaNcc("23505")).toBe(false)
  })
  it("mã gõ tay trùng: câu tiếng Việt nói rõ mã nào và cách làm", () => {
    expect(cauTrungMaNcc("NCC-X")).toBe("Mã NCC “NCC-X” đã có — đổi mã khác, hoặc để trống ô Mã NCC để hệ thống tự đánh mã.")
  })
})

describe("hai nơi tạo NCC dùng chung luật", () => {
  it("biểu mẫu tạo NCC (trang + khung tạo nhanh): không còn đánh mã bằng đếm; trùng thì đánh tiếp; gõ tay trùng báo rõ", () => {
    const f = read("src/components/suppliers/supplier-form.tsx")
    expect(f).not.toMatch(/count \|\| 0\) \+ 1/)
    expect(f).toContain("code = maNccTiepTheo(daCo)")
    expect(f).toContain("laTrungMaNcc(error) && lan < SO_LAN_DANH_LAI_MA_NCC")
    expect(f).toContain("throw new Error(cauTrungMaNcc(code))")
  })
  it("nhập NCC từ Excel: mã tự đánh bắt đầu từ mã lớn nhất + 1, không phải số NCC + 1", () => {
    const f = read("src/components/suppliers/supplier-import-dialog.tsx")
    expect(f).not.toContain("existingCodes.size + 1")
    expect(f).toContain("let nextSeq = soLonNhatMaNcc(existingCodes) + 1")
  })
})
