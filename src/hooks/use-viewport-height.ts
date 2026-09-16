"use client"

import { useEffect, useState } from "react"

/**
 * Chiều cao phần màn hình CÒN NHÌN THẤY được, tính cả lúc bàn phím ảo mở.
 *
 * VÌ SAO KHÔNG DÙNG `vh` HAY `dvh`
 *   Cả hai đều đo theo khung trang, KHÔNG trừ bàn phím. Trên iOS, mở bàn
 *   phím lên thì `100vh` vẫn là cả màn hình — nên một tấm trượt cao
 *   `88vh` có gần một nửa nằm dưới bàn phím, và danh sách kết quả biến
 *   mất đúng lúc người dùng đang gõ để tìm.
 *
 *   `window.visualViewport.height` mới là phần thật sự còn nhìn thấy:
 *   bàn phím mở thì nó co lại, đóng thì nó giãn ra.
 *
 * Trả `null` khi chưa đo được (render ở máy chủ, hoặc trình duyệt không
 * có `visualViewport`) — nơi gọi phải có đường lùi bằng CSS, đừng để
 * chiều cao thành 0.
 */
export function useViewportHeight(active = true): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof window === "undefined" || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => setHeight(vv.height)
    update()
    vv.addEventListener("resize", update)
    // Bàn phím iOS cuộn khung nhìn chứ không phải lúc nào cũng đổi kích
    // thước — thiếu 'scroll' thì có ca chiều cao đứng im dù bàn phím đã
    // đẩy trang lên.
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [active])

  return height
}
