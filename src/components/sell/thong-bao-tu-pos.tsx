"use client"

/**
 * LỜI BÁO TỪ POS VỪA TỰ ĐÓNG — tác vụ đơn (chủ nhà 04–05/11/2026: "sau khi hoàn thành 1 đơn thì tự đóng pos" · "In xong
 * đóng luôn").
 *
 * ⚠ VÌ SAO: POS đóng thì câu báo "Đã xuất hóa đơn HD-0123" mất theo tab — người dùng về tới danh sách mà không có một chữ
 *   nào nói việc vừa rồi đã ghi xong. POS ghi câu ấy vào `localStorage` (`KHOA_XONG_POS`) ngay trước khi đóng; mọi tab
 *   khác cùng gốc nhận sự kiện `storage` ở đây (sự kiện KHÔNG bắn ở chính tab ghi).
 *
 * ⚠ TAB ĐANG ẨN THÌ GIỮ LẠI, HIỆN KHI QUAY VỀ. Lúc POS đóng, tab danh sách thường đang nằm sau; hiện ngay là thông báo
 *   tự tắt trước khi ai kịp thấy. Quá `HAN_LOI_BAO_MS` thì bỏ — chuyện đã cũ.
 */

import { useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { HAN_LOI_BAO_MS, KHOA_XONG_POS, docLoiBao } from "@/lib/pos/tac-vu-don"

export function ThongBaoTuPos() {
  const { toast } = useToast()

  useEffect(() => {
    let cho: { text: string; daIn: boolean; luc: number } | null = null
    const hien = (v: { text: string; daIn: boolean }) =>
      toast({ title: v.text, description: v.daIn ? "POS đã in xong và tự đóng." : "POS đã tự đóng." })

    const onStorage = (e: StorageEvent) => {
      if (e.key !== KHOA_XONG_POS) return
      const v = docLoiBao(e.newValue, Date.now())
      if (!v) return
      if (document.visibilityState === "visible") hien(v)
      else cho = { ...v, luc: Date.now() }
    }
    const onVis = () => {
      if (document.visibilityState !== "visible" || !cho) return
      const v = cho
      cho = null
      if (Date.now() - v.luc <= HAN_LOI_BAO_MS) hien(v)
    }

    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [toast])

  return null
}
