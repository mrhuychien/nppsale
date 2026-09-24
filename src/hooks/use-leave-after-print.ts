"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

/**
 * ĐÓNG HỘP THOẠI IN XONG THÌ RỜI MÀN IN — chủ nhà chốt 20/09/2026: "in
 * xong đóng cửa sổ in → về chỗ cũ khi bấm nút in chứ không ở trang in".
 *
 * Màn in là một chỗ ĐI QUA, không phải chỗ đứng: in xong thì việc tiếp
 * theo luôn nằm ở danh sách hoặc ở đơn vừa xuất. Bỏ người dùng lại trên
 * một tờ giấy đã in là bắt họ tự nghĩ ra đường về, và với tờ mở ở tab
 * riêng thì đường về còn là "tự tìm nút đóng tab".
 *
 * ⚠ HAI ĐƯỜNG VỀ, VÌ MÀN IN TỚI ĐƯỢC BẰNG HAI CÁCH.
 *   · Mở ở TAB RIÊNG (nút In ở ngăn xem nhanh): tab ấy chỉ có MỘT mốc
 *     lịch sử, nên theo chuẩn HTML nó "script-closable" — tự đóng được.
 *     `router.back()` ở đây không đi đâu cả vì không có gì phía sau.
 *   · Mở CÙNG TAB (từ màn chi tiết, hoặc sau khi xuất hàng): lùi một
 *     bước là đúng chỗ cũ.
 *
 * ⚠ `afterprint` FIRE CẢ KHI NGƯỜI DÙNG BẤM HUỶ trong hộp thoại in. Đó
 * là điều ĐÚNG ở đây: huỷ in rồi vẫn muốn về chỗ cũ, không ai huỷ in để
 * ngồi lại ngắm bản xem trước.
 *
 * ⚠ CHỐT LẠI SAU MỖI LẦN IN, MỞ LẠI Ở `beforeprint`. Vài trình duyệt
 * bắn `afterprint` hai lần cho một lần in; không chốt thì lần thứ hai
 * gọi `window.close()` trên một tab đang đóng dở. Nhưng chốt vĩnh viễn
 * thì lần in THỨ HAI (người dùng đổi khổ giấy in lại) không còn đường
 * về — nên mở lại ở `beforeprint`.
 *
 * ⚠ ĐÓNG TAB CÓ THỂ BỊ TRÌNH DUYỆT TỪ CHỐI. Khi đó màn in ở nguyên đó —
 * đúng bằng hành vi cũ, không tệ hơn. Không có đường lùi nào để thử
 * thêm: tab mới không có gì phía sau nó.
 */
/**
 * Chọn đường về — tách ra khỏi hook để kiểm chứng được bằng test.
 *
 * ⚠ `historyLength <= 1` LÀ DẤU HIỆU CỦA TAB RIÊNG. Một tab vừa mở bằng
 * `target="_blank"` và chưa đi đâu thì chỉ có đúng một mốc lịch sử —
 * theo chuẩn HTML, đó cũng chính là điều kiện để nó tự đóng được. Lùi
 * một bước ở tab ấy không đi đâu cả, nên phải phân biệt hai đường.
 */
export function leavePrintView(nav: {
  historyLength: number
  close: () => void
  back: () => void
  /**
   * Đang chạy trong KHUNG ẨN của POS (`inTaiCho`) — chủ nhà 24/09/2026: "in
   * đơn tại chỗ ko cần mở tab". Khi đó chỉ báo cho trang mẹ gỡ khung.
   *
   * ⚠ KHÔNG ĐƯỢC LÙI. Khung con dùng CHUNG lịch sử với tab mẹ: `back()` ở
   *   đây là kéo cả màn POS lùi một trang, mất tờ đang soạn.
   */
  embedded?: boolean
  notifyParent?: () => void
}) {
  if (nav.embedded) nav.notifyParent?.()
  else if (nav.historyLength <= 1) nav.close()
  else nav.back()
}

/** Tin khung in ẩn gửi trang mẹ khi hộp thoại in đóng — xem `inTaiCho`. */
export const IN_XONG = "npp:in-xong"

export function useLeaveAfterPrint(enabled: boolean) {
  const router = useRouter()
  const leaving = useRef(false)

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return

    const onBefore = () => {
      leaving.current = false
    }
    const onAfter = () => {
      if (leaving.current) return
      leaving.current = true
      leavePrintView({
        historyLength: window.history.length,
        close: () => window.close(),
        back: () => router.back(),
        embedded: window.parent !== window,
        notifyParent: () => window.parent.postMessage({ type: IN_XONG }, window.location.origin),
      })
    }

    window.addEventListener("beforeprint", onBefore)
    window.addEventListener("afterprint", onAfter)
    return () => {
      window.removeEventListener("beforeprint", onBefore)
      window.removeEventListener("afterprint", onAfter)
    }
  }, [enabled, router])
}
