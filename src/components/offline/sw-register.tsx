"use client"

import { useEffect } from "react"

/**
 * Đăng ký service worker (chỉ ở production) để app mở được khi mất mạng.
 * An toàn: nếu trình duyệt không hỗ trợ hoặc lỗi thì bỏ qua.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("[sw] register failed:", err))
    }
    // Đăng ký sau khi load xong để không tranh tài nguyên lúc khởi động.
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
  }, [])
  return null
}
