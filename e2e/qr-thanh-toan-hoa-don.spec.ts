import { test, expect, type Locator, type Page } from "@playwright/test"
import { createRequire } from "node:module"
import { join } from "node:path"
import { dangNhap, FAKE } from "./helpers"
import { ORG } from "./fixture.mjs"

/**
 * Chủ nhà 10/11/2026: "em thêm cho a mã QR thanh toán số tiền trên hóa đơn, nội dung Thanh toán đến tài khoản. mã để cạnh
 * khu vực ký (song song)". Đi đúng đường người dùng: chọn ngân hàng + số tài khoản ở Cấu hình tổ chức (tài khoản giả), Lưu,
 * mở tờ in hoá đơn — CHỤP mã trên trang rồi giải bằng ZXing (như app ngân hàng quét) phải ra đúng chuỗi VietQR.
 * Đáp án tính độc lập bằng Python (`binascii.crc_hqx`): Vietcombank 970436 · TK 0123456789 · 900.000đ (HD-E2E-1 không có
 * hàng trả trừ vào) · nội dung "Thanh toan den tai khoan".
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const DON = "o-e2e-1"
const QR_HD =
  "00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454069000005802VN62280824Thanh toan den tai khoan63047442"
const QR_XEM_THU = "00020101021138540010A00000072701240006970436011001234567890208QRIBFTTA53037045802VN63046A15"

/* Nạp CJS như `e2e/camera-trang.ts` (đặt tên khác `require` — bộ dịch TS của Playwright dùng tên ấy cho chính các `import`). */
const napCjs = createRequire(join(process.cwd(), "package.json"))
const zx = napCjs("html5-qrcode/third_party/zxing-js.umd.js")

/** Ảnh chụp mã trên trang → ảnh xám (thêm lề trắng) → ZXing. */
async function quetMa(page: Page, svg: Locator): Promise<string | null> {
  const png = (await svg.screenshot()).toString("base64")
  const { Y, w, h } = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const le = 40
    const c = document.createElement("canvas")
    c.width = img.width + 2 * le
    c.height = img.height + 2 * le
    const g = c.getContext("2d")!
    g.fillStyle = "#fff"
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, le, le)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const Y: number[] = new Array(c.width * c.height)
    for (let i = 0; i < Y.length; i++) Y[i] = ((d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000) | 0
    return { Y, w: c.width, h: c.height }
  }, png)
  const hints = new Map([[zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.QR_CODE]]])
  try {
    const anh = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.RGBLuminanceSource(new Uint8ClampedArray(Y), w, h)))
    return new zx.MultiFormatReader(false, hints).decodeWithState(anh).getText()
  } catch {
    return null
  }
}

/* Ảnh chụp nét (mã 7em ở chữ 12px = 84px CSS → ×3). */
test.use({ deviceScaleFactor: 3 })

/* Chủ nhà 11/11/2026: "Thu nhỏ mã qr. vẫn thêm dòng Lưu ý khi có mã qr" — chỉ đặt tài khoản (ô câu Lưu ý để trống) thì tờ in
   vẫn có dòng Lưu ý theo đúng câu của chủ nhà; mã 5,5em. */
const LUU_Y_TU_DONG =
  "Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng Vietcombank - 0123456789 - NPP THU NGHIEM."

test("tài khoản nhận tiền ở Cấu hình tổ chức → tờ in hoá đơn có mã QR đúng số tiền song song ô ký + dòng Lưu ý; đơn hàng chỉ có Lưu ý", async ({ page }) => {
  try {
    await dangNhap(page)
    const docXong = page.waitForResponse((r) => r.url().includes("/rest/v1/organizations") && r.url().includes("settings"))
    await page.goto("/settings/org")
    await docXong

    // Thiếu ngân hàng → không lưu, nói rõ vì sao.
    const soTk = page.getByLabel("Số tài khoản")
    await soTk.fill("0123 456 789")
    await page.getByRole("button", { name: "Lưu thay đổi" }).click()
    await expect(page.getByText(/Chọn ngân hàng của số tài khoản nhận tiền/).first()).toBeVisible()
    await expect(page.getByTestId("qr-xem-thu")).toHaveCount(0)

    // Chọn ngân hàng → mã xem thử (không số tiền) quét ra đúng tài khoản.
    await page.getByRole("combobox", { name: "Ngân hàng nhận tiền" }).click()
    await page.getByRole("option", { name: /^Vietcombank — / }).click()
    const xemThu = page.getByTestId("qr-xem-thu").locator("svg")
    await expect(xemThu).toBeVisible()
    expect(await quetMa(page, xemThu)).toBe(QR_XEM_THU)
    // Ô câu Lưu ý để trống → màn báo trước câu tờ in sẽ tự ghi.
    await page.getByLabel("Tên chủ tài khoản (in trong câu Lưu ý tự động)").fill("NPP THU NGHIEM")
    await expect(page.getByLabel("Lưu ý in dưới bảng hàng")).toHaveValue("")
    await expect(page.getByTestId("luu-y-tu-dong")).toContainText(LUU_Y_TU_DONG)
    await page.getByRole("button", { name: "Lưu thay đổi" }).click()
    await expect(page.getByText("Đã cập nhật thông tin tổ chức").first()).toBeVisible()

    for (const url of [`/sales-invoices/${HOA_DON}/print`, `/in/hoa-don/${HOA_DON}`]) {
      await page.goto(url)
      const khoi = page.getByTestId("qr-thanh-toan")
      await expect(khoi, url).toHaveAttribute("data-vietqr", QR_HD)
      await expect(khoi).toContainText("Quét mã thanh toán")
      expect(await quetMa(page, khoi.locator("svg")), url).toBe(QR_HD)
      // Song song khu vực ký: cùng hàng, mã đứng trước (bên trái) ô "Người nhận hàng".
      const bQr = (await khoi.boundingBox())!
      const bKy = (await page.getByText("Người nhận hàng", { exact: true }).boundingBox())!
      expect(Math.abs(bQr.y - bKy.y), url).toBeLessThan(4)
      expect(bQr.x + bQr.width, url).toBeLessThanOrEqual(bKy.x)
      // Thu nhỏ: cạnh mã 5,5em (chữ xem trước 12px → 66px; bản 7em cũ là 84px).
      const bMa = (await khoi.locator("svg").boundingBox())!
      expect(Math.round(bMa.width), url).toBe(66)
      // Có mã thì vẫn có dòng Lưu ý, ngay dưới bảng hàng.
      await expect(page.getByTestId("luu-y-in"), url).toHaveText(LUU_Y_TU_DONG)
    }

    // Đơn đặt hàng "chưa phải chứng từ thanh toán" — không có mã.
    await page.goto(`/orders/${DON}/print`)
    await expect(page.getByText("Người nhận hàng", { exact: true })).toBeVisible()
    await expect(page.getByTestId("qr-thanh-toan")).toHaveCount(0)
    await expect(page.getByTestId("luu-y-in")).toHaveText(LUU_Y_TU_DONG)

    // Mở lại cài đặt: đã lưu (số tài khoản lưu gọn, không khoảng trắng).
    const docLai = page.waitForResponse((r) => r.url().includes("/rest/v1/organizations") && r.url().includes("settings"))
    await page.goto("/settings/org")
    await docLai
    await expect(page.getByLabel("Số tài khoản")).toHaveValue("0123456789")
    await expect(page.getByRole("combobox", { name: "Ngân hàng nhận tiền" })).toContainText("Vietcombank")
    await expect(page.getByLabel("Tên chủ tài khoản (in trong câu Lưu ý tự động)")).toHaveValue("NPP THU NGHIEM")
  } finally {
    /* Sổ giả dùng chung cả lượt chạy — trả cài đặt về như cũ để bài in khác không thấy mã. */
    await fetch(`${FAKE}/rest/v1/organizations?id=eq.${ORG}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: {} }),
    })
  }
})
