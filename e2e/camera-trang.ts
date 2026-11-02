import type { Page } from "@playwright/test"
import { createRequire } from "node:module"
import { join } from "node:path"

/**
 * Dùng chung cho các bài quét mã bằng CAMERA GIẢ (chủ nhà 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa
 * quét được"). Cờ trình duyệt đổi theo tệp bài (`test.use({ launchOptions })` chỉ đặt được ở đầu tệp): mỗi tệp một video.
 */
export const CAMERA_GIA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]

/** Playwright dịch tệp bài sang CommonJS: không đặt tên `require`, không dùng `import.meta` — nạp theo gốc dự án. */
const napCjs = createRequire(join(process.cwd(), "package.json"))

/** Bảng mẫu Code128 của ZXing đóng kèm html5-qrcode (để vẽ tem Code128 bằng đúng bảng bộ đọc dùng). */
export function bangCode128(): ArrayLike<ArrayLike<number>> {
  return napCjs("html5-qrcode/third_party/zxing-js.umd.js").Code128Reader.CODE_PATTERNS
}

/** Ghi lại mọi luồng camera trang xin (kiểm ràng buộc + kiểm camera đã TẮT) và bỏ bộ đọc sẵn của máy (ép đường ZXing). */
export async function theoDoiCamera(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __rangBuoc: unknown[]; __luong: MediaStream[]; BarcodeDetector?: unknown }
    w.__rangBuoc = []
    w.__luong = []
    try {
      delete w.BarcodeDetector
    } catch {
      /* không xoá được thì thôi */
    }
    const md = navigator.mediaDevices
    if (!md) return
    const goc = md.getUserMedia.bind(md)
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.__rangBuoc.push(c)
      const s = await goc(c)
      w.__luong.push(s)
      return s
    }
  })
}

/** Mọi luồng camera trang từng mở đều đã tắt (đèn camera tắt). */
export const cameraDaTat = (page: Page) =>
  page.evaluate(() => {
    const ds = (window as unknown as { __luong: MediaStream[] }).__luong
    return ds.length > 0 && ds.every((s) => s.getTracks().every((t) => t.readyState === "ended"))
  })

/** Ràng buộc của lần xin camera thứ `i`. */
export const rangBuocCamera = (page: Page, i = 0) =>
  page.evaluate((i) => (window as unknown as { __rangBuoc: unknown[] }).__rangBuoc[i], i)

/** Video trong hộp quét đã có khung hình (camera chạy thật). */
export const cameraDangChay = (page: Page) =>
  page.evaluate(() => (document.querySelector("[data-testid=camera-quet]") as HTMLVideoElement | null)?.readyState ?? 0)
