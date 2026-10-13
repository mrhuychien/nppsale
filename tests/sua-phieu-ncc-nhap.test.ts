/**
 * MÀN POS PHIẾU TRẢ NCC / PHIẾU NHẬP THEO TRẠNG THÁI THẬT — chủ nhà 13/10/2026: "Xem lại phiếu trả NCC. Sao sửa phiếu
 * nháp -> ra màn post lại hiện trạng thái đã xuất kho và ko có nút lưu nháp tiếp (chỉ có nút ghi nhận và xuất kho)".
 * Bấm thật: e2e/sua-phieu-ncc-nhap.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { manPhieuNcc } from "@/lib/pos/purchase"
import { POS_BADGE_STYLE } from "@/lib/pos/types"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("manPhieuNcc — nhãn + nút theo trạng thái phiếu", () => {
  it("phiếu NHÁP (kể cả mở bằng nút Sửa): nhãn NHÁP, có lưu nháp", () => {
    for (const loai of ["tra", "nhap"] as const) {
      expect(manPhieuNcc(loai, "draft")).toEqual({
        nhan: { label: "NHÁP", tone: "tam" }, luuNhap: true, daGhiNhan: false, daHuy: false, dangNap: false,
      })
    }
  })
  it("đã ghi nhận: ĐÃ XUẤT KHO (trả NCC) / ĐÃ NHẬP KHO (phiếu nhập) — KHÔNG có lưu nháp", () => {
    expect(manPhieuNcc("tra", "completed")).toMatchObject({ nhan: { label: "ĐÃ XUẤT KHO" }, luuNhap: false, daGhiNhan: true })
    expect(manPhieuNcc("nhap", "completed")).toMatchObject({ nhan: { label: "ĐÃ NHẬP KHO" }, luuNhap: false, daGhiNhan: true })
  })
  it("đã huỷ: nhãn ĐÃ HUỶ, không lưu nháp, không phải đã ghi nhận", () => {
    expect(manPhieuNcc("tra", "cancelled")).toEqual({
      nhan: { label: "ĐÃ HUỶ", tone: "huy" }, luuNhap: false, daGhiNhan: false, daHuy: true, dangNap: false,
    })
    expect(POS_BADGE_STYLE.huy.fg).toBe("var(--pos-danger)")
  })
  it("chưa nạp xong: chưa nói gì, nút lưu chờ", () => {
    expect(manPhieuNcc("tra", null)).toEqual({ nhan: null, luuNhap: false, daGhiNhan: false, daHuy: false, dangNap: true })
  })
})

describe("hai màn POS dùng trạng thái thật, không đoán theo đường dẫn /sua", () => {
  const TRA = read("src/components/pos/supplier-return-screen.tsx")
  const NHAP = read("src/components/pos/purchase-screen.tsx")

  it("phiếu trả NCC: nhãn, nút trái, lời nhắc đã xuất, dải delta theo trạng thái", () => {
    expect(TRA).toContain('const man = manPhieuNcc("tra", trangThai)')
    expect(TRA).toContain("setTrangThai(r.status ?? null)")
    expect(TRA).toContain("badge={badge ?? man.nhan}")
    expect(TRA).toContain('const nutLuuNhap = man.dangNap ? mode === "lap" : man.luuNhap')
    expect(TRA).toContain('{nutLuuNhap ? (dangLuu ? "Đang lưu…" : "Lưu nháp") : "Huỷ"}')
    expect(TRA).toContain("{man.daGhiNhan && (\n            <DocBanner")
    expect(TRA).toContain("{man.daGhiNhan && (\n            <DeltaPreviewStrip")
    // Lưu xong thì trạng thái đi theo — ghi nhận ngay trên màn là thành phiếu đã xuất, hết nút Lưu nháp.
    expect(TRA).toContain('setTrangThai(complete ? "completed" : "draft")')
    expect(TRA).not.toMatch(/mode === "sua" \? "Huỷ"/)
    expect(TRA).not.toMatch(/mode === "lap" \? \{ label: "NHÁP"/)
  })
  it("phiếu trả NCC: lời nhắc nói đúng cơ chế — giữ nguyên số phiếu, không hứa phiếu mới số mới", () => {
    expect(TRA).toContain("giữ nguyên số phiếu")
    expect(TRA).not.toContain("phiếu mới mang số mới")
  })
  it("phiếu nhập: nhãn và nút trái theo trạng thái; hoàn thành rồi lưu vẫn là hoàn thành (sửa tại chỗ)", () => {
    expect(NHAP).toContain('const man = manPhieuNcc("nhap", trangThai)')
    expect(NHAP).toContain("badge={badge ?? man.nhan}")
    expect(NHAP).toContain('const nutLuuTam = man.dangNap ? mode === "lap" : man.luuNhap')
    expect(NHAP).toContain('{nutLuuTam ? (dangLuu ? "Đang lưu…" : "Lưu tạm") : "Huỷ"}')
    expect(NHAP).toContain('setTrangThai((cu) => (complete || cu === "completed" ? "completed" : "draft"))')
    expect(NHAP).not.toMatch(/mode === "sua" \? "Huỷ"/)
  })
  it("phiếu đã huỷ: nút chính khoá ở cả hai màn", () => {
    for (const s of [TRA, NHAP]) expect(s).toMatch(/disabled=\{!!khoa \|\| lines\.length === 0 \|\| dangLuu \|\| man\.dangNap \|\| man\.daHuy\}/)
  })
})
