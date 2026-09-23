"use client"

import { useEffect, useState } from "react"

/** Trạng thái kết nối mạng, cập nhật theo sự kiện online/offline. */
export function useOnlineStatus(): boolean {
  /**
   * ⚠ LUÔN BẮT ĐẦU BẰNG `true`, ĐỌC THẬT TRONG `useEffect`.
   *
   * Bản cũ đọc `navigator.onLine` ngay lúc khởi tạo, và chỉ dự phòng khi
   * KHÔNG có `navigator`. Node ≥ 21 CÓ `navigator` — nhưng `onLine` là
   * `undefined`. Máy chủ vì thế vẽ nút "Ngoại tuyến" ở đầu trang, trình
   * duyệt thì không → lỗi hydrate, React vẽ lại TOÀN BỘ trang ở trình
   * duyệt trên mọi trang dashboard. Bắt được bằng chốt bấm màn hình
   * (23/09/2026).
   */
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  return online
}
