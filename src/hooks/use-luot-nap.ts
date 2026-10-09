import { useRef } from "react"

/** Bộ đếm lượt nạp (thuần — test được): `bat()` mở lượt mới, trả `conMoi()` — đúng khi chưa có lượt nào mới hơn. */
export function taoBoLuot(): () => () => boolean {
  let n = 0
  return () => {
    const lan = ++n
    return () => lan === n
  }
}

/**
 * Lượt nạp MỚI NHẤT của một màn — `const conMoi = batLuot()` đầu hàm nạp, mọi `set…` sau `await` hỏi `conMoi()`.
 * ⚠ Đổi kỳ / lọc nhanh tay thì lượt cũ (kỳ cũ) có thể về SAU lượt mới và đè số kỳ cũ lên nhãn kỳ mới (rà báo cáo
 *   09/10/2026).
 */
export function useLuotNap(): () => () => boolean {
  const ref = useRef<(() => () => boolean) | null>(null)
  if (!ref.current) ref.current = taoBoLuot()
  return ref.current
}
