/**
 * ĐÓNG / MỞ DẢI GỢI Ý CỦA `ProductPicker` — phần quy tắc thuần.
 *
 * ⚠ VÌ SAO TÁCH RA KHỎI COMPONENT. Luật này có một cái bẫy chỉ lộ ra
 * khi CHẠY, và một chốt soi mã nguồn không bao giờ thấy:
 *
 *   `pick()` đóng dải gợi ý rồi trả tiêu điểm về ô nhập cho người dùng
 *   gõ tiếp. Nhưng ô nhập mở dải gợi ý khi NHẬN TIÊU ĐIỂM (`onFocus`) —
 *   và bấm chuột vào một dòng gợi ý đã đẩy tiêu điểm sang cái nút của
 *   dòng ấy. Nên lệnh trả tiêu điểm sinh ra một lượt `focus` MỚI, và
 *   lượt ấy mở lại đúng cái dải vừa đóng. Hai lệnh nằm trong cùng một
 *   lượt xử lý sự kiện nên React gộp lại: kết quả cuối là MỞ.
 *
 *   Chủ nhà báo đúng triệu chứng ấy: *"bấm thêm hàng xong danh sách nó
 *   chưa ẩn đi"*. Bản vá trước đã viết `if (closeOnPick) setOpen(false)`
 *   và chốt đọc thấy đúng dòng đó — chốt xanh, màn hình vẫn sai.
 *
 * Để ở đây thì chốt CHẠY được đúng chuỗi sự kiện thật: chọn → tiêu điểm
 * quay lại → phải còn ĐÓNG.
 *
 * ⚠ VÀ PHẢI CHỈ BỎ QUA ĐÚNG MỘT LƯỢT. Bỏ qua mọi lượt `focus` sau đó là
 * người dùng Tab vào ô mà dải gợi ý không xổ ra nữa — hỏng một đường
 * dùng bàn phím để chữa một đường dùng chuột.
 */

export interface PickerOpenState {
  open: boolean
  /**
   * Bỏ qua ĐÚNG MỘT lượt `focus` sắp tới.
   *
   * ⚠ Chỉ bật khi tiêu điểm THẬT SỰ sẽ quay lại ô — xem `refocus`. Bật
   * lúc tiêu điểm đang nằm sẵn trong ô là cờ ấy không có lượt `focus`
   * nào để tiêu, và nó ở lại nuốt mất lượt Tab kế tiếp.
   */
  skipNextFocus: boolean
}

export const PICKER_OPEN_INIT: PickerOpenState = { open: false, skipNextFocus: false }

export type PickerEvent =
  /** Ô nhập nhận tiêu điểm — kể cả do `.focus()` gọi từ mã. */
  | { t: "focus" }
  /** Bấm chuột vào ô nhập. */
  | { t: "click" }
  /** Gõ một ký tự. */
  | { t: "type" }
  | { t: "escape" }
  /** Bấm ra ngoài khung. */
  | { t: "outside" }
  | {
      t: "pick"
      /** Ô nhập ĐANG KHÔNG có tiêu điểm, nên trả nó về sẽ sinh một lượt `focus`. */
      refocus: boolean
    }

export function pickerOpenReducer(
  s: PickerOpenState,
  e: PickerEvent,
  opts: { closeOnPick: boolean }
): PickerOpenState {
  switch (e.t) {
    case "focus":
      /* ⚠ Lượt `focus` do chính phép chọn trả tiêu điểm về thì KHÔNG mở
         lại — nhưng tiêu cờ đi để lượt sau còn mở được. */
      if (s.skipNextFocus) return { open: s.open, skipNextFocus: false }
      return { open: true, skipNextFocus: false }

    case "click":
    case "type":
      /* ⚠ Bấm hay gõ là ý định RÕ RÀNG — mở, và xoá cờ nếu còn sót. */
      return { open: true, skipNextFocus: false }

    case "escape":
    case "outside":
      return { open: false, skipNextFocus: false }

    case "pick":
      if (!opts.closeOnPick) {
        /* Giữ mở để nhập hàng loạt — hành vi của mọi màn đang chạy. */
        return { open: true, skipNextFocus: false }
      }
      return { open: false, skipNextFocus: e.refocus }
  }
}
