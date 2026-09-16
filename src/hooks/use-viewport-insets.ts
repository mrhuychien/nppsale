"use client"

import { useEffect, useState } from "react"

/**
 * Phần màn hình còn nhìn thấy khi bàn phím ảo đang mở.
 *
 * VÌ SAO CẦN CẢ HAI SỐ, KHÔNG CHỈ CHIỀU CAO
 *   Bản trước chỉ đo `height` rồi gán cho tấm trượt. Nhưng tấm trượt là
 *   `position: fixed; bottom: 0`, và trên iOS `bottom: 0` là đáy KHUNG
 *   TRANG — chỗ đó nằm DƯỚI bàn phím. Gán chiều cao đã trừ bàn phím cho
 *   một khối vẫn neo ở đáy khung trang thì khối đó tụt hẳn xuống dưới bàn
 *   phím, chỉ ló ra một sợi trắng. Đúng thứ người dùng chụp lại được.
 *
 *   `bottomInset` là phần đáy khung trang mà khung nhìn không với tới —
 *   tức chiều cao bàn phím (đã tính cả thanh phụ trợ của nó). Nơi gọi phải
 *   đẩy khối lên bằng đúng khoảng đó.
 *
 * Trả `null` khi chưa đo được (render ở máy chủ, hoặc trình duyệt không có
 * `visualViewport`) — nơi gọi phải có đường lùi bằng CSS, đừng để chiều
 * cao thành 0.
 */
export interface ViewportInsets {
  /** Chiều cao phần CÒN NHÌN THẤY — đã trừ bàn phím. */
  height: number
  /** Phần bị bàn phím chiếm ở ĐÁY khung trang. */
  bottomInset: number
}

/**
 * ⚠ Kẹp ≥ 0. Lúc người dùng thu phóng bằng hai ngón, khung nhìn có thể
 * cao hơn khung trang và hiệu số ra ÂM — `bottom` âm đẩy tấm trượt ra
 * ngoài màn hình, hỏng nặng hơn cả lỗi đang sửa.
 */
export function bottomInsetOf(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number
): number {
  return Math.max(0, layoutHeight - visualHeight - visualOffsetTop)
}

/**
 * Khung của một tấm trượt đáy: cao bao nhiêu, và phải nhấc khỏi đáy khung
 * trang bao xa để không chui xuống dưới bàn phím.
 */
export function bottomSheetBox(
  insets: ViewportInsets,
  ratio: number
): { height: number; bottom: number } {
  return { height: Math.round(insets.height * ratio), bottom: insets.bottomInset }
}

export function useViewportInsets(active = true): ViewportInsets | null {
  const [insets, setInsets] = useState<ViewportInsets | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof window === "undefined" || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => {
      const bottomInset = bottomInsetOf(window.innerHeight, vv.height, vv.offsetTop)
      // So rồi mới đặt: sự kiện 'scroll' của khung nhìn bắn rất dày, đặt
      // lại state y hệt là vẽ lại cả danh sách sản phẩm theo từng khung
      // hình cuộn.
      setInsets((prev) =>
        prev && prev.height === vv.height && prev.bottomInset === bottomInset
          ? prev
          : { height: vv.height, bottomInset }
      )
    }
    update()
    vv.addEventListener("resize", update)
    // Bàn phím iOS cuộn khung nhìn chứ không phải lúc nào cũng đổi kích
    // thước — thiếu 'scroll' thì số đo đứng im dù trang đã bị đẩy lên.
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [active])

  return insets
}
