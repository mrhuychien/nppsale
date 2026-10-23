"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

/** Khổ máy tính — cùng mốc `lg` (1024px) của Tailwind mà các màn danh sách dùng để tách bố cục. */
export const DESKTOP_QUERY = "(min-width: 1024px)"

export function useIsDesktop(): boolean {
  const [la, setLa] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const doi = () => setLa(mq.matches)
    doi()
    mq.addEventListener("change", doi)
    return () => mq.removeEventListener("change", doi)
  }, [])
  return la
}

let mqMay: MediaQueryList | null = null
const coMq = () => typeof window !== "undefined" && !!window.matchMedia
const layMq = () => (mqMay ??= window.matchMedia(DESKTOP_QUERY))
function ngheKho(bao: () => void): () => void {
  if (!coMq()) return () => {}
  const mq = layMq()
  mq.addEventListener("change", bao)
  return () => mq.removeEventListener("change", bao)
}
const khoHienTai = () => (coMq() ? layMq().matches : true)
const khoMayChu = () => null

/**
 * Như `useIsDesktop` nhưng `null` khi CHƯA BIẾT. Màn nào đọc số riêng cho một khổ (điện thoại / máy tính) chờ biết khổ
 * rồi mới đọc — không gửi thừa truy vấn của khổ kia; phần chỉ khổ kia hiện thì khỏi dựng.
 *
 * ⚠ CHỈ `null` Ở LƯỢT VẼ KHỚP HTML MÁY CHỦ (tải cứng). Mở màn bằng điều hướng trong app thì biết khổ NGAY lượt vẽ đầu
 *   (chủ nhà 23/10/2026 "load trang chậm lắm": bản `useState` + `useEffect` cũ bắt mọi lần mở màn vẽ hai lượt, lượt đầu
 *   dựng cả phần của khổ kia rồi mới gỡ).
 */
export function useKhoMay(): boolean | null {
  return useSyncExternalStore(ngheKho, khoHienTai, khoMayChu)
}
