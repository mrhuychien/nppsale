/**
 * Thuộc tính chung cho MỌI ô tìm kiếm gõ tay.
 *
 * VÌ SAO GOM LẠI MỘT CHỖ
 *   Trên iOS Safari, một ô `<input>` không khai báo mình là gì sẽ bị coi
 *   là ô có thể điền tự động: Safari dựng một THANH ĐEN ngay trên bàn
 *   phím với bốn nút (chìa khoá · thẻ ngân hàng · vị trí · ✓). Thanh đó
 *   che mất kết quả tìm, và trong bộ chọn sản phẩm thì nó che đúng phần
 *   NVBH cần nhìn.
 *
 *   Cộng thêm một hàng gợi ý gõ chữ ("Kaka · Uh · Vib") — vô dụng khi
 *   đang tra mã SKU, mà vẫn ăn thêm một hàng chiều cao.
 *
 *   Hai thứ đó mất đi khi ô được khai đúng là ô TÌM KIẾM. Ba màn trong dự
 *   án có ô tìm gõ tay; để mỗi màn tự khai thì sẽ có màn quên.
 */

/**
 * ⚠ `type: "search"` là thứ quan trọng nhất ở đây, không phải
 * `inputMode`. `inputMode` chỉ đổi BÀN PHÍM hiện ra; `type` mới là thứ
 * nói cho Safari biết ô này không phải chỗ điền mật khẩu hay thẻ ngân
 * hàng, và nhờ đó thanh điền tự động không dựng lên.
 *
 * `autoCorrect` / `autoCapitalize` / `spellCheck` tắt hàng gợi ý gõ chữ —
 * tên hàng ở đây là "Huxiaoqi 328g", không có từ điển nào đoán đúng, mà
 * viết hoa tự động còn làm hỏng mã SKU.
 */
export const SEARCH_FIELD_PROPS = {
  type: "search",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  inputMode: "search",
  enterKeyHint: "search",
} as const

/**
 * Bỏ nút ✕ mặc định của WebKit trên ô `type="search"`.
 *
 * Dùng khi màn hình đã có nút xoá riêng — hai nút ✕ cạnh nhau thì người
 * dùng không biết bấm cái nào.
 */
export const HIDE_NATIVE_CLEAR =
  "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
