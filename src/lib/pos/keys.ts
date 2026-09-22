/**
 * PHÍM TẮT CỦA `/pos` — spec §10, phần quy tắc thuần.
 *
 * ⚠ KHÔNG BẮT PHÍM KHI ĐANG GÕ TRONG Ô NHẬP, TRỪ `Esc` VÀ DÃY `F*`.
 * Người dùng gõ tên hàng vào ô tìm mà mỗi chữ cái lại kích một lệnh
 * thì ô tìm không dùng được. `F3`/`F4`/`F8`/`F9` thì ngược lại: chúng
 * KHÔNG phải ký tự gõ được, và cả điểm của chúng là dùng được từ bất
 * kỳ đâu — kể cả khi con trỏ đang nằm trong ô số lượng.
 *
 * ⚠ `Esc` LUÔN ĐƯỢC BẮT. Nó là đường thoát; đang gõ dở trong một ô
 * nằm trong modal mà `Esc` không đóng được modal là một cái bẫy.
 */

export type PosKey = "F2" | "F3" | "F4" | "F6" | "F7" | "F8" | "F9" | "Escape"

const NHAN: readonly string[] = ["F2", "F3", "F4", "F6", "F7", "F8", "F9", "Escape"]

/** Phím này có phải phím POS quan tâm không. */
export function posKeyOf(key: string): PosKey | null {
  return NHAN.includes(key) ? (key as PosKey) : null
}

/**
 * Có được xử lý phím này khi tiêu điểm đang nằm ở `tagName` không.
 *
 * @param tagName `INPUT` | `TEXTAREA` | `SELECT` | … (viết hoa, như DOM trả về)
 * @param isContentEditable ô soạn thảo tự do
 */
export function posShouldHandle(
  key: PosKey,
  tagName: string,
  isContentEditable = false
): boolean {
  // ⚠ `Esc` LUÔN được bắt, và F* cũng vậy — cả hai đều KHÔNG phải ký
  //   tự gõ được nên không tranh chỗ với người đang gõ.
  if (key === "Escape" || /^F\d$/.test(key)) return true
  const dangGo =
    isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName.toUpperCase())
  return !dangGo
}

/** Nhãn hiển thị cạnh ô tìm / nút — để mọi chỗ gọi cùng một tên. */
export const POS_KEY_HINT: Record<PosKey, string> = {
  /**
   * ⚠ BẢN THIẾT KẾ CHỦ NHÀ ĐƯA CHỐT BỘ PHÍM NÀY, và nó KHÁC bộ cũ.
   *   Bản vẽ ghi rõ trên ba chỗ: nút "Thêm sản phẩm (F2)", nút "Lưu
   *   nháp (F6)", và dòng gợi ý chân bảng "Enter thêm dòng · F6 lưu
   *   nháp · F9 gửi đơn".
   *
   * ⚠ `F9` ĐỔI NGHĨA. Trước đây nó là "thêm dòng hàng đổi" ở màn đơn;
   *   bản vẽ giao nó cho "gửi đơn". Giữ nghĩa cũ là màn hình nói một
   *   đằng phím làm một nẻo.
   *
   * ⚠ `F3` CÒN LẠI CHO MÀN CHƯA ĐƯỢC VẼ. Bốn màn kia (phiếu trả, nhập
   *   hàng, trả NCC, sửa hóa đơn) không có trong bản thiết kế; chúng
   *   dùng `F2` như màn đơn để người dùng chỉ phải nhớ MỘT phím, và
   *   `F3` giữ lại như bí danh cũ cho quen tay.
   */
  F2: "Thêm sản phẩm",
  F3: "Thêm sản phẩm",
  F4: "Tìm khách hàng / NCC",
  F6: "Lưu nháp",
  F7: "Thêm hàng đổi",
  F8: "Thêm hàng trả",
  F9: "Gửi đơn",
  Escape: "Đóng",
}
