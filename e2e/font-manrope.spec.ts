import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * Chủ nhà 12/11/2026: "Có lỗi gì mà font chữ thay đổi hết vậy" — bản build ceb2b87: lớp font trên <html> không có trong CSS
 * trang nạp → biến `--font-manrope` rỗng, cả app về font mặc định. Kiểm đúng điều người dùng thấy: biến có giá trị, chữ của
 * trang (body) đi theo biến ấy, và mặt chữ Manrope (tệp tự lưu trong repo) tải được cho chữ tiếng Việt.
 */
async function docFont(page: Page) {
  return page.evaluate(async () => {
    const bien = getComputedStyle(document.documentElement).getPropertyValue("--font-manrope").trim()
    const ho = (bien.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "")
    const mat = ho ? await document.fonts.load(`16px "${ho}"`, "Đơn hàng — Xuất hóa đơn: ữ ợ ệ ẵ Ỹ") : []
    return {
      bien,
      ho,
      chuTrang: getComputedStyle(document.body).fontFamily,
      mat: mat.map((f) => ({ trangThai: f.status, dam: f.weight })),
    }
  })
}

test("font Manrope: --font-manrope có giá trị, chữ trang theo nó, mặt chữ tải được (trang đăng nhập + trong app)", async ({ page }) => {
  for (const buoc of ["dang-nhap", "trong-app"] as const) {
    if (buoc === "dang-nhap") await page.goto("/login")
    else await dangNhap(page)
    const kq = await docFont(page)
    expect(kq.bien, `${buoc}: biến --font-manrope rỗng → cả app về font mặc định (lỗi 12/11/2026)`).not.toBe("")
    expect(kq.chuTrang, buoc).toContain(kq.ho)
    expect(kq.mat.length, buoc).toBeGreaterThan(0)
    expect(kq.mat.every((m) => m.trangThai === "loaded"), buoc).toBe(true)
    // Một mặt chữ biến thiên phủ 400–700 (như bốn mặt 400/500/600/700 của bản tải từ Google).
    expect(kq.mat.map((m) => m.dam), buoc).toEqual(["400 700"])
  }
})
