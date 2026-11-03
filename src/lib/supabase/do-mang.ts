/**
 * SỔ GHI THỜI GIAN CÂU HỎI MÁY CHỦ (trình duyệt) — chủ nhà 03/11/2026: "em rà soát kỹ phần load đơn vào pos vẫn có hiện
 * tượng chậm hoặc báo lỗi quá 10s".
 *
 * Trên máy đo (bản build production, CPU ×4, mạng trễ 80 ms) mở POS Xuất hàng mất 2,1–2,4 giây, không câu nào tự nó chậm —
 * lỗi "quá 10 giây" chỉ xảy ra khi một câu phải chờ máy chủ / mạng ngoài thực tế. Không nhìn được trình duyệt của người
 * dùng thì không biết câu nào: `fetchCoHetGio` ghi mỗi câu Supabase vào vòng nhớ này (CHỈ đường dẫn + cách gọi + thời gian +
 * kết quả, không tham số, không dữ liệu), màn POS nạp xong thì gửi bản tóm tắt về nhật ký máy chủ (`baoNapPos`).
 */

export interface LuotMang {
  /** Đường dẫn, bỏ tham số (vd `/rest/v1/rpc/get_invoiceable_lines`). */
  p: string
  /** GET / POST / … */
  m: string
  /** Mốc bắt đầu, ms từ lúc mở trang (`performance.now()`). */
  bd: number
  /** Thời gian chờ, ms (gồm cả lượt thử lại khi hết giờ). */
  ms: number
  /** Mã HTTP, hoặc "het" (hết 10 giây) / "loi" (lỗi mạng). */
  tt: number | "het" | "loi"
}

const TRAN = 80
const vong: LuotMang[] = []

export function ghiLuotMang(l: LuotMang) {
  vong.push(l)
  if (vong.length > TRAN) vong.splice(0, vong.length - TRAN)
}

/** Các câu BẮT ĐẦU từ mốc `moc` (ms từ lúc mở trang) trở đi. */
export function luotMangTu(moc: number): LuotMang[] {
  return vong.filter((l) => l.bd >= moc)
}

/** Chỉ cho kiểm thử. */
export function xoaLuotMang() {
  vong.length = 0
}

/** Đường dẫn của câu, bỏ phần tham số (không mang mã đơn / số điện thoại vào nhật ký). */
export function duongGon(input: RequestInfo | URL): string {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url ?? ""
  try {
    return new URL(u, "http://x").pathname
  } catch {
    return String(u).split("?")[0]
  }
}
