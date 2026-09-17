import type { SellProduct } from "@/lib/sell/ref-data"

/**
 * Quét mã vạch liên tục.
 *
 * ⚠ CAMERA BẮN 10 LẦN MỖI GIÂY. `html5-qrcode` gọi lại callback ở mỗi
 * khung hình nó đọc được, nên giơ mã vạch trước ống kính một giây rưỡi là
 * MƯỜI LĂM lần "thêm 1". Không có cửa chặn này thì mỗi lần quét ra một số
 * lượng ngẫu nhiên, và người dùng không đoán nổi vì sao.
 */
export const SCAN_DEDUPE_MS = 1500

export function shouldAcceptScan(
  code: string,
  last: { code: string; at: number } | null,
  now: number,
  windowMs: number = SCAN_DEDUPE_MS
): boolean {
  const c = code.trim()
  if (!c) return false
  if (!last) return true
  // ⚠ Mã KHÁC thì nhận ngay. Quét liền hai mặt hàng khác nhau là chuyện
  // bình thường; bắt chờ hết cửa sổ là làm chậm đúng việc nó phục vụ.
  if (last.code !== c) return true
  return now - last.at >= windowMs
}

/**
 * Tra sản phẩm theo mã vạch, rồi tới SKU.
 *
 * ⚠ So SAU KHI cắt khoảng trắng và bỏ phân biệt hoa thường. Máy quét hay
 * kèm ký tự xuống dòng, và SKU nhập tay thì lúc hoa lúc thường — tra
 * trượt ở đây làm người dùng tưởng hàng chưa có trong danh mục.
 */
export function findByCode(products: SellProduct[], code: string): SellProduct | undefined {
  const c = code.trim().toLowerCase()
  if (!c) return undefined
  return (
    products.find((p) => (p.barcode ?? "").trim().toLowerCase() === c) ??
    products.find((p) => (p.sku ?? "").trim().toLowerCase() === c)
  )
}
