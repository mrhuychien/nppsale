"use client"

/**
 * Bảng giá nhập (mig 234) cho màn lập phiếu nhập / trả NCC — giá gợi ý khi thêm hàng.
 * ⚠ Lỗi đọc không chặn màn: phiếu vẫn lập được, chỉ thiếu gợi ý (ghi ra console để còn dò).
 */
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { napBangGiaNhap, type BangGiaNhap } from "@/lib/purchasing/bang-gia-nhap"

const RONG: BangGiaNhap = new Map()

export function useBangGiaNhap(batTat = true): BangGiaNhap {
  const [bang, setBang] = useState<BangGiaNhap>(RONG)
  useEffect(() => {
    if (!batTat) return
    let huy = false
    napBangGiaNhap(createClient()).then((kq) => {
      if (huy) return
      if (kq.loi) console.warn(kq.chuaCo ? "[gia-nhap] sổ chưa chạy mig 234 — gợi ý theo giá vốn mặc định" : `[gia-nhap] không đọc được bảng giá nhập: ${kq.loi}`)
      setBang(kq.bang)
    })
    return () => {
      huy = true
    }
  }, [batTat])
  return bang
}
