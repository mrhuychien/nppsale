"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { chuanHoaSdt, sdtTimChinhXac, type KhachTrung } from "@/lib/customers/tao-khach"

/**
 * DÒ KHÁCH ĐÃ CÓ trước khi tạo mới — CHỈ theo ĐÚNG số điện thoại (chủ nhà 15/10/2026: "ở máy tính tao chỉ cho tìm kiếm
 * chính xác, nghĩa là nhập đúng số điện thoại của khách thì khách mới hiện ra"). Qua `search_customer_dupes`
 * (SECURITY DEFINER: thấy cả khách nhân viên khác phụ trách) — vì thế gõ tên / địa chỉ / số dở KHÔNG tìm gì.
 * Một đường tìm cho máy tính (`CustomerDupeFinder`) và điện thoại (`TimKhachTruocKhiTao`). Chờ 300ms sau khi gõ.
 */
export function useDoTrungKhach(chu: string) {
  const supabase = useMemo(() => createClient(), [])
  /** Số đã chuẩn hoá đang tìm — "" khi chưa nhập đủ số. */
  const [tim, setTim] = useState("")
  const [ketQua, setKetQua] = useState<KhachTrung[]>([])
  const [dangTim, setDangTim] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setTim(sdtTimChinhXac(chu)), 300)
    return () => clearTimeout(t)
  }, [chu])

  useEffect(() => {
    if (!tim) {
      setKetQua([])
      setLoi(null)
      setDangTim(false)
      return
    }
    let huy = false
    setDangTim(true)
    supabase.rpc("search_customer_dupes", { p_q: tim }).then(({ data, error }) => {
      if (huy) return
      setLoi(error ? errorMessage(error) : null)
      // Sổ chưa chạy mig 245 thì hàm còn khớp từng phần — lọc lại ĐÚNG số ở đây (như `timKhachTrungSdt`).
      setKetQua(error ? [] : ((data as KhachTrung[] | null) ?? []).filter((k) => chuanHoaSdt(k.phone ?? "") === tim))
      setDangTim(false)
    })
    return () => { huy = true }
  }, [tim, supabase])

  /** Nhận khách xong: dòng ấy thành "Trong DS của bạn" tại chỗ, không tìm lại. */
  const daNhan = (id: string) => setKetQua((ds) => ds.map((k) => (k.id === id ? { ...k, has_my_assignment: true } : k)))

  /** Đã gõ gì đó nhưng chưa phải một số đủ — màn nhắc "nhập đủ số", không tìm. */
  const chuaDuSo = chu.trim() !== "" && !sdtTimChinhXac(chu)

  return { tim, ketQua, dangTim, loi, daNhan, chuaDuSo }
}
