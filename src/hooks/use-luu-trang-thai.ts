"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * LỌC TRẠNG THÁI CỦA DANH SÁCH ĐƯỢC NHỚ QUA LẦN TẢI LẠI.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Các danh sách khi chọn lọc trạng thái ko lưu ? Load lại là ra như
 *   ban đầu." Nhớ theo từng máy (localStorage) — tiện riêng của người xem, không phải dữ
 *   liệu sổ. Đọc trong effect, không đọc lúc render đầu (HTML máy chủ ≠ máy khách → lỗi
 *   hydrate #418). Đường dẫn có `?status=` thì đường dẫn thắng.
 */
const TIEN_TO = "npp.loc-trang-thai."

export function useLuuTrangThai(khoa: string, macDinh: string): [string, (v: string) => void] {
  const [v, setV] = useState(macDinh)
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).has("status")) return
      const s = window.localStorage.getItem(TIEN_TO + khoa)
      if (s != null) setV(s)
    } catch {
      /* trình duyệt chặn bộ nhớ → dùng mặc định */
    }
  }, [khoa])
  const dat = useCallback(
    (x: string) => {
      setV(x)
      try {
        window.localStorage.setItem(TIEN_TO + khoa, x)
      } catch {
        /* không lưu được thì thôi, lọc vẫn chạy */
      }
    },
    [khoa]
  )
  return [v, dat]
}
