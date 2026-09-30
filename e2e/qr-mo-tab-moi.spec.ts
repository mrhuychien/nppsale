import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: link QR mở trình duyệt theo tài khoản nhân viên; iPhone có nút mở bằng
 *   Safari / Chrome riêng · "cửa sổ Qr ko có lối thoát, ko đóng ko chuyển được" → hộp cuộn trong màn
 *   hình + nút Đóng.
 */
const LINK = "http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef"
test.use({
  viewport: { width: 390, height: 664 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
})

test("hộp mã QR trên iPhone: link, mở bằng Safari / Chrome, đóng được", async ({ page }) => {
  await page.route("**/api/admin/users/*/qr", (r) =>
    r.fulfill({ json: { token: "abcdefabcdefabcdefabcdef", loginUrl: LINK, issuedAt: "2026-09-30T00:00:00Z" } })
  )
  await dangNhap(page)
  await page.goto("/settings/users")
  // Điện thoại: chạm thẻ nhân viên → ngăn xem nhanh → nút QR (hộp QR mở CHỒNG lên ngăn đó).
  await page.getByTestId("nv-the").filter({ hasText: "0900 000 000" }).click()
  await page.getByRole("button", { name: "Mã QR đăng nhập" }).last().click()
  const hop = page.getByRole("dialog").filter({ hasText: "Mã QR đăng nhập" })
  await expect(hop.getByTestId("qr-link-mo")).toHaveAttribute("target", "_blank")
  await expect(hop.getByRole("link", { name: "Mở bằng Safari" })).toHaveAttribute("href", "x-safari-http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef")
  await expect(hop.getByRole("link", { name: "Mở bằng Chrome" })).toHaveAttribute("href", "googlechrome://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef")
  await expect(hop.getByText("Mở tab mới")).toHaveCount(0)
  // Hộp không tràn khỏi màn hình; nút Đóng cuộn tới được và đóng hộp.
  const box = await hop.boundingBox()
  expect(box!.height).toBeLessThanOrEqual(664)
  await hop.getByTestId("qr-dong").click()
  await expect(hop).toBeHidden()
  // Đóng xong vẫn thao tác được màn (không kẹt lớp phủ).
  await page.getByRole("button", { name: "Mã QR đăng nhập" }).last().click()
  await expect(hop).toBeVisible()
  await hop.getByRole("button", { name: /close|đóng/i }).first().click()
  await expect(hop).toBeHidden()
})

/* Chủ nhà 30/09/2026: "thêm nút đăng nhập chức năng tương tự mở tab trên safari cạnh tên nhân viên". */
test("danh sách nhân viên trên iPhone: nút Đăng nhập cạnh tên mở Safari, không mở ngăn xem nhanh", async ({ page }) => {
  const NV = [
    { id: "00000000-0000-4000-8000-0000000000c1", full_name: "NV Có Mã", phone: "0933000001", is_active: true },
    { id: "00000000-0000-4000-8000-0000000000c2", full_name: "NV Chưa Mã", phone: "0933000002", is_active: true },
    { id: "00000000-0000-4000-8000-0000000000c3", full_name: "NV Khoá", phone: "0933000003", is_active: false },
  ].map((u) => ({ ...u, org_id: "00000000-0000-4000-8000-0000000000a1", role: "sales" }))
  await fetch(`${FAKE}/rest/v1/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(NV) })
  try {
    await page.route("**/api/admin/users/qr-links", (r) => r.fulfill({ json: { links: { [NV[0].id]: LINK } } }))
    let taoMa = 0
    await page.route(`**/api/admin/users/${NV[1].id}/qr`, (r) => {
      taoMa++
      return r.fulfill({ json: { token: "moi", loginUrl: "https://nppsale.vercel.app/qr-login?t=moi", issuedAt: "2026-09-30T00:00:00Z" } })
    })
    await dangNhap(page)
    await page.goto("/settings/users")
    // Bảng máy tính vẫn có trong DOM (ẩn) — chỉ đếm thẻ đang hiện.
    const nut = page.locator('[data-testid="nv-dang-nhap"]:visible')
    const the = (ten: string) => page.locator("div", { has: page.getByText(ten, { exact: true }) }).filter({ has: nut }).last().locator(nut)
    const coMa = the("NV Có Mã")
    await expect(coMa).toHaveAttribute("href", "x-safari-http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef")
    // Thẻ điện thoại (thiết kế "ds-nhan-vien"): nút vuông chỉ icon, chữ "Đăng nhập" cho trình đọc màn hình.
    await expect(coMa).toHaveText("Đăng nhập")
    // Không có nút cho chính mình và người đang khoá.
    await expect(nut).toHaveCount(2)
    // Chưa có mã: bấm = tạo mã rồi mở Safari; không mở ngăn xem nhanh.
    await the("NV Chưa Mã").click()
    await expect.poll(() => taoMa).toBe(1)
    await expect(the("NV Chưa Mã")).toHaveAttribute("href", "x-safari-https://nppsale.vercel.app/qr-login?t=moi")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  } finally {
    for (const u of NV) await fetch(`${FAKE}/rest/v1/users?id=eq.${u.id}`, { method: "DELETE" })
  }
})

test.describe("máy tính", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" })
  test("không phải iPhone / iPad thì không có nút Đăng nhập (mở tab là đổi phiên cả trình duyệt)", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/settings/users")
    await expect(page.getByText("Chủ NPP").first()).toBeVisible()
    await expect(page.getByTestId("nv-dang-nhap")).toHaveCount(0)
  })
})
