/**
 * TẢI DANH SÁCH HAI NHỊP — chủ nhà 26/09/2026: "Các danh sách load nhanh 20 đơn trước, hiển thị
 * luôn, trong khi vẫn load tiếp các đơn. Nó không bị chậm."
 *
 * Trang danh sách (50 dòng) trước đây hỏi một lượt cả 50 dòng + đếm tổng, rồi mới vẽ. Nay:
 *   · Nhịp 1: 20 dòng đầu + đếm tổng → gọi `onDau` để trang VẼ NGAY.
 *   · Nhịp 2: phần còn lại của trang, KHÔNG đếm, chạy SONG SONG với nhịp 1 (không chờ nhau).
 *   Kết quả cuối (trả về) là cả trang ghép lại — trang xử lý tiếp như cũ.
 *
 * ⚠ Nhịp 1 hỏng / bị huỷ → trả luôn nhịp 1 (trang hiện lỗi như cũ). Nhịp 2 hỏng → vẫn giữ 20
 *   dòng đầu đã vẽ, kèm lỗi để trang nói ra — không bỏ mất phần đã có.
 * ⚠ `boQuaDau` (tải thêm cùng truy vấn, ví dụ "Tải thêm 20" trên điện thoại): KHÔNG vẽ lại 20
 *   dòng đầu — không thì danh sách 40 dòng đang xem co về 20 rồi mới dài lại.
 */
export const NHIP_DAU = 20

export interface KetQuaNhip<T> {
  data: T[] | null
  count?: number | null
  error: unknown
  aborted?: boolean
}

export async function taiHaiNhip<T, R extends KetQuaNhip<T>>(
  chay: (from: number, to: number, dem: boolean) => PromiseLike<R>,
  from: number,
  to: number,
  onDau?: (dau: R) => void,
  opts: { boQuaDau?: boolean } = {}
): Promise<R> {
  const cuoiDau = from + NHIP_DAU - 1
  if (cuoiDau >= to) return chay(from, to, true)
  const dauP = Promise.resolve(chay(from, cuoiDau, true))
  const sauP = Promise.resolve(chay(cuoiDau + 1, to, false))
  // Nhịp 2 có thể hỏng khi nhịp 1 đã hỏng và ta không còn chờ nó nữa — đừng để lỗi trôi nổi.
  sauP.catch(() => {})
  const dau = await dauP
  if (dau.error || dau.aborted) return dau
  if (!opts.boQuaDau) onDau?.(dau)
  // Đếm cho biết không còn dòng nào sau nhịp 1 → khỏi chờ nhịp 2.
  if (typeof dau.count === "number" && dau.count <= from + NHIP_DAU) return dau
  let sau: R
  try {
    sau = await sauP
  } catch (err) {
    return { ...dau, error: err instanceof Error ? err.message : "Lỗi kết nối" }
  }
  if (sau.aborted) return { ...dau, aborted: true }
  if (sau.error) return { ...dau, error: sau.error }
  return { ...dau, data: [...(dau.data ?? []), ...(sau.data ?? [])] }
}

/** Khoá của lần tải trước: truy vấn nào (`khoa`) và tải tới dòng nào (`to`). */
export type KhoaTai = { khoa: unknown; to: number } | null

const giongKhoa = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b

/**
 * Lần tải này có phải "Tải thêm" của đúng truy vấn trước không: cùng khoá (bộ lọc + vị trí đầu),
 * trang dài hơn. Khi đó danh sách đang hiện được GIỮ NGUYÊN trong lúc chờ (không trắng màn, không
 * co về 20 dòng). Đổi bộ lọc / tải lại cùng độ dài → không phải tải thêm.
 * `ghi = false`: chỉ xem, không ghi lần này vào `ref` (dùng ở đầu hàm, trước khi bật "đang nạp").
 */
export function laTaiThem(ref: { current: KhoaTai }, khoa: unknown, to: number, ghi = true): boolean {
  const truoc = ref.current
  if (ghi) ref.current = { khoa, to }
  return !!truoc && giongKhoa(truoc.khoa, khoa) && to > truoc.to
}
