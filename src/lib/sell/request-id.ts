/**
 * Mã chống lặp (`client_request_id`) cho một lần gửi đơn.
 *
 * ⚠ GIỮ NGUYÊN QUA CÁC CÚ BẤM LẠI khi nội dung đơn KHÔNG ĐỔI. Bản cũ ở
 *   `/sell/cart` sinh mã MỚI mỗi lần bấm, dù chú thích ngay trên nói
 *   "khoá nối sinh trước khi gửi và không đổi nữa": mạng rớt sau khi máy
 *   chủ đã ghi → màn báo "Không gửi được đơn" → NVBH bấm lại → ĐƠN THỨ
 *   HAI. Giữ mã thì lần bấm lại được máy chủ nhận ra là cùng một đơn.
 *
 * ⚠ NỘI DUNG ĐỔI THÌ MÃ ĐỔI. Sửa giỏ rồi gửi lại mà vẫn giữ mã cũ thì máy
 *   chủ trả về đơn LẦN TRƯỚC — và thay đổi vừa sửa mất trong im lặng.
 */
export interface MaChongLap {
  key: string
  id: string
}

export function layMaChongLap(truoc: MaChongLap | null, key: string, sinh: () => string): MaChongLap {
  if (truoc && truoc.key === key) return truoc
  return { key, id: sinh() }
}

export function sinhMaChongLap(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
