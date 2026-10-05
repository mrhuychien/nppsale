import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hidesMobileAppBar, laSuaPhieuNcc, showsBottomNav } from "@/lib/nav/mobile-chrome"

/**
 * Chủ nhà 05/10/2026: "Xem lại phần sửa phiếu nhập hàng ncc chưa quay về giống phần tạo phiếu mà dùng form riêng
 * (trên di động)". Màn SỬA phiếu nhập / phiếu trả NCC dùng chung khung `PhieuNccMobile` + ô riêng
 * `truong-phieu-ncc.tsx` với màn TẠO, và (như màn tạo) không có thanh đáy / đầu trang chung che nút Lưu.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const SUA_NHAP = "src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx"
const SUA_TRA = "src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx"

describe("màn sửa phiếu NCC dùng khung của màn tạo", () => {
  it("sửa phiếu nhập: PhieuNccMobile + TruongPhieuNhap, không còn PurchaseReceiptForm", () => {
    const s = doc(SUA_NHAP)
    expect(s).toMatch(/<PhieuNccMobile[\s\S]*kind="nhap"/)
    expect(s).toMatch(/fields=\{<TruongPhieuNhap form=\{form\} patch=\{patch\} \/>\}/)
    expect(s).not.toMatch(/<PurchaseReceiptForm[\s/>]/)
  })
  it("sửa phiếu trả NCC: PhieuNccMobile + TruongPhieuTraNcc, không còn PurchaseReturnForm", () => {
    const s = doc(SUA_TRA)
    expect(s).toMatch(/<PhieuNccMobile[\s\S]*kind="tra"/)
    expect(s).toMatch(/fields=\{<TruongPhieuTraNcc form=\{form\} patch=\{patch\} \/>\}/)
    expect(s).not.toMatch(/<PurchaseReturnForm[\s/>]/)
  })
  it("màn tạo dùng CHUNG ô riêng với màn sửa (không vẽ lại ô số HĐ / ngày / kho / lý do)", () => {
    expect(doc("src/app/(dashboard)/purchasing/receipts/new/page.tsx")).toMatch(/fields=\{<TruongPhieuNhap /)
    expect(doc("src/app/(dashboard)/purchase-returns/new/page.tsx")).toMatch(/fields=\{<TruongPhieuTraNcc /)
  })
})

describe("màn sửa phiếu NCC trên điện thoại không bị thanh chung che nút", () => {
  it.each([
    "/purchasing/receipts/2f0e8c1a-1111-4222-8333-944455556666/edit",
    "/purchase-returns/2f0e8c1a-1111-4222-8333-944455556666/edit",
  ])("%s: ẩn thanh đáy + đầu trang chung", (duong) => {
    expect(laSuaPhieuNcc(duong)).toBe(true)
    expect(showsBottomNav(duong)).toBe(false)
    expect(hidesMobileAppBar(duong)).toBe(true)
  })
  it("chi tiết phiếu (không /edit) vẫn có thanh chung", () => {
    const d = "/purchasing/receipts/2f0e8c1a-1111-4222-8333-944455556666"
    expect(laSuaPhieuNcc(d)).toBe(false)
    expect(showsBottomNav(d)).toBe(true)
  })
})
