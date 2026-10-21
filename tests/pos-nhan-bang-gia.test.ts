/**
 * PHỤ ĐỀ BẢNG GIÁ màn đơn POS — chủ nhà 21/10/2026: "sửa luôn" (khách chưa có nhóm hiện "bảng giá bảng giá chung").
 * Bấm thật: e2e/pos-thong-tin-doi-tac.spec.ts (bài đơn POS).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { nhanBangGia } from "@/lib/pos/bang-gia"

describe("nhanBangGia", () => {
  it("khách chưa có nhóm: 'bảng giá chung' — chữ 'bảng giá' chỉ một lần", () => {
    expect(nhanBangGia(true, null)).toBe("bảng giá chung")
    expect(nhanBangGia(true, "  ")).toBe("bảng giá chung")
  })
  it("khách có nhóm: 'bảng giá <nhóm>'; tên nhóm tự có chữ 'Bảng giá …' thì không lặp", () => {
    expect(nhanBangGia(true, "Đại lý")).toBe("bảng giá Đại lý")
    expect(nhanBangGia(true, "Bảng giá sỉ")).toBe("Bảng giá sỉ")
    expect(nhanBangGia(true, "BẢNG GIÁ")).toBe("BẢNG GIÁ")
    // "Bảng giá…" phải là CHỮ đứng đầu, không phải phần đầu của một chữ khác.
    expect(nhanBangGia(true, "Bảng giáx")).toBe("bảng giá Bảng giáx")
  })
  it("chưa chọn khách: nói ra, không hứa bảng giá chung", () => {
    expect(nhanBangGia(false, "Đại lý")).toBe("bảng giá: chưa chọn khách")
    expect(nhanBangGia(false, null)).not.toContain("chung")
  })
  it("màn đơn POS dùng nhanBangGia, không ghép thêm chữ 'bảng giá' lần nữa", () => {
    const s = readFileSync(resolve(__dirname, "..", "src/components/pos/order-screen.tsx"), "utf-8")
    expect(s).toContain("const tenBangGia = nhanBangGia(!!khach, groups.find((g) => g.id === groupId)?.name)")
    expect(s).not.toContain("`bảng giá ${tenBangGia}`")
    expect(s).not.toContain('?? "bảng giá chung"')
  })
})
