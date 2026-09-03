"use client"

import { useEffect, useState } from "react"
import { VN_TZ } from "@/lib/utils"

/**
 * Thời điểm hiện tại đã định dạng, CHỈ có sau khi component đã mount.
 *
 * VÌ SAO KHÔNG GỌI THẲNG `new Date().toLocaleString()` TRONG RENDER
 * Next.js dựng HTML ở server trước rồi khớp lại ở trình duyệt. `new Date()`
 * ở hai phía là hai thời điểm khác nhau, trên hai múi giờ khác nhau (Vercel
 * chạy UTC, điện thoại ở UTC+7). Hai chuỗi khác nhau → React báo lỗi
 * #418/#423 và bỏ toàn bộ HTML server để render lại từ đầu.
 *
 * Nằm trong `hidden print:block` cũng không thoát: CSS ẩn đi nhưng nút vẫn
 * có trong DOM nên vẫn phải khớp.
 *
 * Trả chuỗi rỗng ở lần render đầu — giống nhau ở cả hai phía — rồi điền
 * thật sau khi mount.
 */
export function useClientNow(): string {
  const [now, setNow] = useState("")
  useEffect(() => {
    setNow(
      new Date().toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: VN_TZ,
      })
    )
  }, [])
  return now
}
