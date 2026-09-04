"use client"

import { useEffect, useState } from "react"

/**
 * true khi bàn phím ảo đang mở.
 *
 * VÌ SAO CẦN: thanh hành động dính đáy và thanh nav cùng nằm ở đáy màn.
 * Bàn phím ảo đẩy chúng lên đè vào giữa màn hình, che đúng ô đang gõ.
 *
 * ĐO BẰNG visualViewport, không đo bằng window.innerHeight: trên iOS
 * `innerHeight` KHÔNG đổi khi bàn phím mở (bàn phím phủ lên chứ không thu
 * viewport), nên so `innerHeight` với chính nó là luôn ra false.
 * `visualViewport.height` mới là phần THẬT SỰ nhìn thấy.
 *
 * Ngưỡng 120px: thanh gợi ý của bàn phím và thanh công cụ trình duyệt cũng
 * làm chênh vài chục px — lấy ngưỡng thấp quá thì cuộn trang cũng bị coi
 * là mở bàn phím.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    // Trình duyệt không có visualViewport (rất cũ): coi như không bao giờ
    // mở — thà giữ thanh hành động luôn hiện còn hơn ẩn nhầm.
    if (!vv) return

    const onResize = () => setOpen(window.innerHeight - vv.height > 120)
    vv.addEventListener("resize", onResize)
    // Cuộn trang khi bàn phím mở cũng đổi visualViewport trên iOS.
    vv.addEventListener("scroll", onResize)
    onResize()
    return () => {
      vv.removeEventListener("resize", onResize)
      vv.removeEventListener("scroll", onResize)
    }
  }, [])

  return open
}
