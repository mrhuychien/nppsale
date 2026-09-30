/**
 * Chủ nhà 30/09/2026: "bấm vào Mã qr từng nhân viên thêm phần ấn vào link -> mở trình duyệt theo link
 * nhân viên đó" · "cửa sổ Qr ko có lối thoát, ko đóng ko chuyển được. Bỏ bớt 2 nút Chép link và mở tab
 * mới (đổi phiên cả trình duyệt) và các giải thích liên quan".
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const S = readFileSync("src/components/users/qr-login-dialog.tsx", "utf8")

describe("hộp mã QR đăng nhập", () => {
  it("đường dẫn là link bấm được, mở tab mới, không lộ trang gốc", () => {
    const i = S.indexOf('data-testid="qr-link-mo"')
    expect(i).toBeGreaterThan(0)
    const the = S.slice(S.lastIndexOf("<a", i), S.indexOf(">", i))
    expect(the).toContain("href={state.loginUrl}")
    expect(the).toContain('target="_blank"')
    expect(the).toContain('rel="noopener noreferrer"')
  })
  it("luôn có lối thoát: hộp cuộn trong màn hình + nút Đóng", () => {
    expect(S).toContain('className="max-h-[90dvh] overflow-y-auto sm:max-w-md"')
    expect(S).toContain("onClick={() => onOpenChange(false)} data-testid=\"qr-dong\"")
  })
  it("đã bỏ nút chép link ẩn danh, nút mở tab mới đổi phiên và các giải thích", () => {
    for (const bo of ["chepAnDanh", "qr-chep-an-danh", "Mở tab mới", "cửa sổ ẩn danh", "đổi phiên cả trình duyệt"]) {
      expect(S, bo).not.toContain(bo)
    }
  })
})
