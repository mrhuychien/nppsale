/**
 * Chủ nhà 30/09/2026: "trong phần danh sách nhân viên, bấm vào Mã qr từng nhân viên thêm phần ấn vào
 * link -> mở trình duyệt theo link nhân viên đó để vào xem ở tab khác".
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const S = readFileSync("src/components/users/qr-login-dialog.tsx", "utf8")

describe("hộp mã QR đăng nhập: link mở tab mới", () => {
  it("đường dẫn là link bấm được, mở tab mới, không lộ trang gốc", () => {
    const i = S.indexOf('data-testid="qr-link-mo"')
    expect(i).toBeGreaterThan(0)
    const the = S.slice(S.lastIndexOf("<a", i), S.indexOf(">", i))
    expect(the).toContain("href={state.loginUrl}")
    expect(the).toContain('target="_blank"')
    expect(the).toContain('rel="noopener noreferrer"')
  })
  it("có nút mở tab mới và cảnh báo link đổi phiên cả trình duyệt", () => {
    expect(S).toMatch(/<Button asChild[^>]*>\s*<a href=\{state\.loginUrl\} target="_blank" rel="noopener noreferrer">/)
    expect(S).toContain("đăng nhập thành {userName} ở mọi tab")
    expect(S).toContain("Mở trong cửa sổ ẩn danh")
  })
  it("chép link để mở ẩn danh (giữ phiên chủ NPP) — trang không tự mở ẩn danh được", () => {
    const i = S.indexOf("const chepAnDanh = async () => {")
    expect(i).toBeGreaterThan(0)
    expect(S.slice(i, i + 300)).toContain("navigator.clipboard.writeText(state.loginUrl)")
    expect(S).toContain("onClick={chepAnDanh}")
    expect(S).toContain("Ctrl + Shift + N")
  })
})
