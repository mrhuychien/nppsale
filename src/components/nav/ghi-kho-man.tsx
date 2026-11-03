"use client"

/**
 * Ghi khổ màn (rộng ≥ 1024 px hay không) vào cookie `npp_kho` để MÁY CHỦ biết máy tính ngay từ lượt mở trang sau — xem
 * `@/lib/nav/kho-man`. Ghi lúc vào app và khi đổi cỡ cửa sổ (chờ 300 ms ngừng kéo); không đổi thì không ghi lại.
 */
import { useEffect } from "react"
import { chuoiCookieKho, docCookieKho, khoTheoBeNgang } from "@/lib/nav/kho-man"

export function GhiKhoMan() {
  useEffect(() => {
    const ghi = () => {
      try {
        const kho = khoTheoBeNgang(window.innerWidth)
        if (docCookieKho(document.cookie) !== kho) document.cookie = chuoiCookieKho(kho, location.protocol === "https:")
      } catch {
        /* chặn cookie (chế độ riêng tư) → màn cũ tự chuyển như trước */
      }
    }
    ghi()
    let hen: ReturnType<typeof setTimeout> | undefined
    const doiCo = () => {
      clearTimeout(hen)
      hen = setTimeout(ghi, 300)
    }
    window.addEventListener("resize", doiCo)
    return () => {
      clearTimeout(hen)
      window.removeEventListener("resize", doiCo)
    }
  }, [])
  return null
}
