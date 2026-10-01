"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { LIST_PERIODS, type ListPeriod } from "@/lib/orders/list-summary"

/**
 * BỘ LỌC THỜI GIAN CỦA DANH SÁCH ĐƯỢC NHỚ THEO TỪNG TÀI KHOẢN.
 *
 * ⚠ CHỦ NHÀ 01/10/2026: "Làm thêm phần trong các danh sách lưu bộ lọc Thời gian cho user".
 *   Nhớ KỲ đã chọn (Hôm nay / Tuần này / Tháng này / Tất cả) theo danh sách + tài khoản — máy dùng
 *   chung (máy kho, máy quầy) thì mỗi người một lựa chọn. Khoảng ngày tự gõ KHÔNG nhớ (mai đã khác).
 *   Đọc trong effect, không đọc lúc render đầu (HTML máy chủ ≠ máy khách → lỗi hydrate #418).
 */
const TIEN_TO = "npp.loc-ky."

export function khoaLuuKy(danhSach: string, userId: string): string {
  return `${TIEN_TO}${danhSach}.${userId}`
}

/** Giá trị đã lưu → kỳ hợp lệ, rác / bản cũ → null (dùng mặc định). */
export function docKyDaLuu(raw: string | null | undefined): ListPeriod | null {
  return raw && (LIST_PERIODS as string[]).includes(raw) ? (raw as ListPeriod) : null
}

/**
 * `apDung` — cho danh sách lọc bằng hai ô ngày: nạp được kỳ đã lưu thì đổi luôn hai ô ngày
 * (`khoangKy`). Gọi một lần lúc nạp, không gọi khi người dùng tự chọn (nơi gọi tự đổi ô ngày).
 */
export function useLuuKy(
  danhSach: string,
  macDinh: ListPeriod,
  apDung?: (k: ListPeriod) => void
): [ListPeriod, (k: ListPeriod) => void] {
  const { user } = useAuth()
  const uid = user?.id ?? null
  const [ky, setKy] = useState<ListPeriod>(macDinh)
  const apDungRef = useRef(apDung)
  apDungRef.current = apDung

  useEffect(() => {
    if (!uid) return
    try {
      const k = docKyDaLuu(window.localStorage.getItem(khoaLuuKy(danhSach, uid)))
      if (k) {
        setKy(k)
        apDungRef.current?.(k)
      }
    } catch {
      /* trình duyệt chặn bộ nhớ → dùng mặc định */
    }
  }, [danhSach, uid])

  const dat = useCallback(
    (k: ListPeriod) => {
      setKy(k)
      if (!uid) return
      try {
        window.localStorage.setItem(khoaLuuKy(danhSach, uid), k)
      } catch {
        /* không lưu được thì thôi, lọc vẫn chạy */
      }
    },
    [danhSach, uid]
  )
  return [ky, dat]
}
