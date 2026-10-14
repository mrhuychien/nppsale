"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import type { KhachTrung } from "@/lib/customers/tao-khach"

/**
 * DÒ KHÁCH ĐÃ CÓ trước khi tạo mới — theo SĐT, địa chỉ hoặc tên (chủ nhà 06/06/2026), qua `search_customer_dupes`
 * (SECURITY DEFINER: thấy cả khách nhân viên khác phụ trách — đọc thẳng bảng thì RLS giấu, NVBH tưởng chưa có).
 * Một đường tìm cho máy tính (`CustomerDupeFinder`) và điện thoại (`TimKhachTruocKhiTao`). Gõ từ 2 ký tự, chờ 300ms.
 */
export function useDoTrungKhach(chu: string) {
  const supabase = useMemo(() => createClient(), [])
  const [tim, setTim] = useState("")
  const [ketQua, setKetQua] = useState<KhachTrung[]>([])
  const [dangTim, setDangTim] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setTim(chu.trim()), 300)
    return () => clearTimeout(t)
  }, [chu])

  useEffect(() => {
    if (tim.length < 2) {
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
      setKetQua(error ? [] : ((data as KhachTrung[] | null) ?? []))
      setDangTim(false)
    })
    return () => { huy = true }
  }, [tim, supabase])

  /** Nhận khách xong: dòng ấy thành "Trong DS của bạn" tại chỗ, không tìm lại. */
  const daNhan = (id: string) => setKetQua((ds) => ds.map((k) => (k.id === id ? { ...k, has_my_assignment: true } : k)))

  return { tim, ketQua, dangTim, loi, daNhan }
}
