"use client"

import { useEffect, useState } from "react"

/**
 * ĐỌC LẠI DANH SÁCH KHI NGƯỜI DÙNG QUAY VỀ TAB NÀY.
 *
 * ⚠ VÌ SAO CẦN: từ 20/09/2026 các nút chức năng ở ngăn xem nhanh MỞ TAB
 * MỚI (chủ nhà chốt). Tab danh sách vì thế không còn bị rời đi và quay
 * lại — nó nằm im với bản chụp cũ. Người dùng bấm "Xuất hàng", lập hóa
 * đơn ở tab kia, quay về đây và thấy đơn VẪN nằm ở tab Phiếu tạm như
 * chưa có gì xảy ra; tới khi vô tình tải lại thì đơn biến mất.
 *
 * Chủ nhà báo đúng cảm giác đó: "tạo hóa đơn xong thì mất luôn đơn hàng
 * chứ không chuyển trạng thái?". Đơn KHÔNG mất — `post_invoice` đổi
 * trạng thái sang `completed` (xem `_wf2b_sync_order_status`, mig 125),
 * nên nó rời tab "Phiếu tạm" sang tab "Hoàn thành". Cái sai là màn hình
 * không nói ra, và nói muộn.
 *
 * ⚠ DÙNG `visibilitychange`, KHÔNG DÙNG `focus`. `focus` bắn cả khi
 * người dùng chỉ bấm vào thanh địa chỉ rồi bấm lại vào trang — mỗi lần
 * như vậy là một lượt tải danh sách cho một thứ không đổi.
 *
 * ⚠ CHỈ ĐỌC LẠI KHI ĐÃ RỜI ĐI ĐỦ LÂU. Chuyển tab đi rồi về ngay trong
 * một giây là thao tác nhầm, không phải một vòng làm việc — tải lại ở đó
 * chỉ làm danh sách nhấp nháy dưới tay người đang đọc.
 *
 * Trả về một con số tăng dần; đưa nó vào mảng phụ thuộc của effect tải
 * danh sách là xong.
 */
export function useRefreshOnFocus(minAwayMs = 3000): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (typeof document === "undefined") return
    let hiddenAt: number | null = null

    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= minAwayMs) {
        setTick((t) => t + 1)
      }
      hiddenAt = null
    }

    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [minAwayMs])

  return tick
}
