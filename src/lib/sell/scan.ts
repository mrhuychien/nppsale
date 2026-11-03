/**
 * Quét mã vạch liên tục.
 *
 * ⚠ CAMERA ĐỌC ~8–10 KHUNG MỖI GIÂY, mỗi khung đọc được là một lần báo mã,
 * nên giơ mã vạch trước ống kính một giây rưỡi là cả chục lần "thêm 1".
 * Không có cửa chặn này thì mỗi lần quét ra một số lượng ngẫu nhiên, và
 * người dùng không đoán nổi vì sao. Bộ quét chung (`BarcodeScanner`) dùng
 * chính hàm này ở đường camera (chủ nhà 02/11/2026 — Nhập kho không tự lọc);
 * màn bán hàng lọc thêm cả đường nhập tay.
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
 *
 * Một luật cho mọi màn quét (bán hàng, phiếu xuất kho — chủ nhà 03/11/2026):
 * màn nào tự viết `p.sku === code` là quét mã vạch thật không bao giờ ra.
 */
export function findByCode<T extends { barcode?: string | null; sku?: string | null }>(
  products: readonly T[],
  code: string
): T | undefined {
  const c = code.trim().toLowerCase()
  if (!c) return undefined
  return (
    products.find((p) => (p.barcode ?? "").trim().toLowerCase() === c) ??
    products.find((p) => (p.sku ?? "").trim().toLowerCase() === c)
  )
}
