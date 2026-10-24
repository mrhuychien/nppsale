/**
 * Mã vạch ở form sản phẩm — chủ nhà 24/10/2026: "phần thêm sản phẩm đoạn mã vạch thêm cho tao phần quét mã vạch nhé".
 *
 * Ô Mã vạch nhận mã từ ba đường: gõ tay, máy quét USB / Bluetooth (gõ mã rồi Enter vào ô đang chọn), camera điện thoại
 * (`BarcodeScanner` dùng chung với nhập kho / xuất kho / POS — không dựng bộ quét thứ hai). Luật dưới đây dùng chung
 * cho cả ba đường.
 */

/** Sản phẩm khác đang mang cùng mã vạch. */
export type SanPhamTrungMa = { id: string; name: string; sku: string | null }

/**
 * Chuẩn hoá mã đọc được: bỏ ký tự xuống dòng / tab máy quét gửi kèm, cắt khoảng trắng hai đầu. Không đổi hoa thường,
 * không bỏ khoảng trắng ở giữa — mã Code128 có thể chứa khoảng trắng; so trùng mới bỏ phân biệt (`findByCode`).
 */
export function chuanMaVach(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\r\n\t]+/g, "").trim()
}

/**
 * Trong các dòng sổ trả về theo mã, chọn sản phẩm KHÁC sản phẩm đang sửa (sửa hàng thì chính nó mang mã ấy là đúng).
 * Không có → null.
 */
export function sanPhamTrungMaVach(rows: SanPhamTrungMa[] | null | undefined, idHienTai?: string | null): SanPhamTrungMa | null {
  for (const r of rows ?? []) if (!idHienTai || r.id !== idHienTai) return r
  return null
}

/** Lời cảnh báo trùng mã — CẢNH BÁO rồi vẫn cho lưu (sổ không khoá trùng mã vạch; hàng cùng mã khác NCC là có thật). */
export function cauTrungMaVach(ma: string, sp: SanPhamTrungMa): { title: string; description: string } {
  const maHang = sp.sku ? ` (${sp.sku})` : ""
  return {
    title: "Mã vạch đã gắn cho sản phẩm khác",
    description: `${ma} đang là mã vạch của “${sp.name}”${maHang}. Kiểm tra lại trước khi lưu kẻo tạo trùng hàng.`,
  }
}
