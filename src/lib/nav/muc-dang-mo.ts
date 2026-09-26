/**
 * Mục menu đang mở trong một nhóm: mục có đường dẫn DÀI NHẤT khớp trang hiện tại.
 * ⚠ So tiền tố thuần thì `/bao-cao` (Tổng quan) cũng khớp `/bao-cao/ban-hang` — hai mục cùng
 *   sáng. Chọn mục khớp dài nhất thì chỉ đúng một mục sáng.
 */
export function mucDangMo(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const h of hrefs) {
    if ((pathname === h || pathname.startsWith(h + "/")) && (!best || h.length > best.length)) best = h
  }
  return best
}
