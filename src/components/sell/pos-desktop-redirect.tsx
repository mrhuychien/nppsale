"use client"

/**
 * CHẶN Ở CỬA: máy tính thì đưa sang màn `/pos`.
 *
 * Chủ nhà chốt 22/09/2026 cho nhánh `newdesign`: "trên desktop ấn tạo
 * đơn -> dùng tạo đơn pos, sửa -> dùng sửa pos, main vẫn chạy
 * production bình thường".
 *
 * ⚠ VÌ SAO CHẶN Ở MÀN CHỨ KHÔNG SỬA TỪNG CÁI NÚT — xem
 *   `@/lib/nav/pos-preview`. Ngắn gọn: nút "Tạo đơn" nằm ở sáu chỗ,
 *   sót một cái là người test rơi về màn cũ rồi kết luận POS không chạy.
 *
 * ⚠ `replace` CHỨ KHÔNG `push`. `push` là bấm Quay lại một cái rơi
 *   ngược về `/sell`, rồi lại bị đẩy sang `/pos` — người dùng kẹt trong
 *   một vòng không thoát ra được bằng nút Quay lại.
 *
 * ⚠ ĐO BỀ NGANG SAU KHI DỰNG, KHÔNG ĐOÁN TRƯỚC. `window` không tồn tại
 *   lúc render trên máy chủ; đoán "đủ rộng" ở đó là đẩy cả người dùng
 *   điện thoại sang một màn không dùng được trên điện thoại.
 *
 * ⚠ CHỈ ĐO MỘT LẦN, LÚC VÀO MÀN. Nghe `resize` rồi chuyển hướng giữa
 *   chừng là người đang gõ dở một đơn trên màn `/sell` bị ném sang màn
 *   khác chỉ vì họ kéo hẹp cửa sổ.
 */

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { manDuRong } from "@/lib/nav/pos-preview"

export function PosDesktopRedirect({ to }: { to: string }) {
  const router = useRouter()
  const daChay = useRef(false)

  useEffect(() => {
    if (daChay.current) return
    daChay.current = true
    if (manDuRong()) router.replace(to)
  }, [router, to])

  return null
}
