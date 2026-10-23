"use client"

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import type { NguoiTaiDanhMuc } from "@/lib/sell/ref-data"

/** Hồ sơ mãi chưa về thì sau chừng này vẫn tải danh mục (chỉ không dùng lại bản lưu). */
export const CHO_HO_SO_MS = 4000

/**
 * Lúc nào đủ để bắt đầu tải danh mục bán — luật thuần, xem `useNguoiTaiDanhMuc`.
 * Mất mạng: ngay (dùng bản lưu, không chờ hồ sơ). Không có phiên: ngay. Có phiên: chờ hồ sơ, quá hạn thì thôi chờ.
 */
export function sanTaiDanhMuc(s: { matMang: boolean; dangXacThuc: boolean; coPhien: boolean; coHoSo: boolean; hetCho: boolean }): boolean {
  if (s.matMang) return true
  if (s.dangXacThuc) return false
  return !s.coPhien || s.coHoSo || s.hetCho
}

/**
 * NGƯỜI ĐANG TẢI DANH MỤC BÁN (chủ nhà 23/10/2026 "Làm nốt"): khoá để sản phẩm dùng lại bản lưu trên máy
 * (`dungLaiSanPham`), và để bản lưu của người khác trên cùng máy không bị hiện ra. `san` = bắt đầu tải được chưa.
 * Chờ hồ sơ không tốn thêm vòng mạng: câu Supabase vốn chờ phiên, và hồ sơ có ngay ở sự kiện phiên đầu (gửi kèm).
 */
export function useNguoiTaiDanhMuc(): { san: boolean; nguoi: NguoiTaiDanhMuc | null } {
  const { user, authUser, loading } = useAuth()
  const choHoSo = !!authUser && !user
  const [hetCho, setHetCho] = useState(false)
  useEffect(() => {
    if (!choHoSo) return
    const t = setTimeout(() => setHetCho(true), CHO_HO_SO_MS)
    return () => clearTimeout(t)
  }, [choHoSo])
  const uid = user?.id
  const vai = user?.role
  const nguoi = useMemo(() => (uid && vai ? { uid, vai } : null), [uid, vai])
  const san = sanTaiDanhMuc({
    matMang: typeof navigator !== "undefined" && !navigator.onLine,
    dangXacThuc: loading,
    coPhien: !!authUser,
    coHoSo: !!user,
    hetCho,
  })
  return { san, nguoi }
}
