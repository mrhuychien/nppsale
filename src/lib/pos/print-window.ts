/**
 * CỬA SỔ IN MỞ SẴN LÚC BẤM — cho nút "Xuất hàng & lập HĐ" / "Huỷ HĐ & lập lại".
 *
 * ⚠ CHỦ NHÀ YÊU CẦU 23/09/2026: "Khi bấm nút Xuất hàng và lập HĐ / Huỷ HĐ và
 *   lập lại -> bật luôn cửa sổ in hoá đơn".
 *
 * ⚠ MỞ NGAY TRONG CÚ BẤM, TRƯỚC LỆNH GHI SỔ. Mở sau `await` là trình duyệt
 *   chặn cửa sổ bật lên (hết "cử chỉ người dùng"); nên mở một tab trống
 *   ngay, ghi sổ xong mới trỏ nó tới trang in `?auto=1`, hỏng thì đóng.
 *
 * ⚠ KHÔNG `noopener` — cần giữ tay cầm để trỏ tab tới trang in.
 */
export interface CuaInCho {
  /** Ghi sổ xong: trỏ tab tới trang in. Tab bị chặn thì mở lại (có thể vẫn bị chặn). */
  toi(url: string): void
  /** Ghi sổ hỏng: đóng tab trống. */
  dong(): void
}

export function moCuaInCho(win: Pick<Window, "open"> = window): CuaInCho {
  let w: Window | null = null
  try {
    w = win.open("", "_blank")
    if (w) {
      w.document.title = "Đang lập hóa đơn…"
      w.document.body.textContent = "Đang lập hóa đơn… cửa sổ in sẽ bật ngay khi xong."
    }
  } catch {
    w = null
  }
  return {
    toi(url) {
      if (w && !w.closed) w.location.href = url
      else win.open(url, "_blank")
    },
    dong() {
      if (w && !w.closed) w.close()
    },
  }
}

/** Trang in hóa đơn bật thẳng hộp thoại in. */
export const trangInHoaDon = (invoiceId: string) => `/sales-invoices/${invoiceId}/print?auto=1`
