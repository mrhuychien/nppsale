"use client"

/**
 * MỞ POS Ở TAB MỚI — chủ nhà chốt 23/09/2026: "Mỗi khi mở pos bật tab mới đi".
 *
 * ⚠ BẮT Ở MỘT CHỖ, KHÔNG SỬA TỪNG NÚT. Lối vào POS nằm rải khắp nơi (menu
 *   trái, trang chủ, danh sách / chi tiết đơn, xem nhanh, chi tiết hóa đơn,
 *   danh sách phiếu trả…). Bộ bắt này nghe MỌI cú bấm vào `<a>` ở pha bắt
 *   (capture) trên `document` — chạy TRƯỚC `onClick` của `next/link` — và
 *   nếu đích là một cửa POS (`posTargetFor`) thì mở thẳng màn POS ở tab
 *   mới, tab cũ đứng yên.
 *
 * ⚠ MỞ THẲNG ĐÍCH POS, không mở `/sell/edit/…` rồi để nó tự chuyển: đi vòng
 *   là thêm một lần nạp trang, và chính cú chuyển vòng ấy từng chạy đua với
 *   `/sell/cart` (xem `sell/edit/[id]`).
 *
 * ⚠ CHỈ MÁY TÍNH (`manDuRong`). Điện thoại giữ `/sell` như cũ. Bấm kèm
 *   Ctrl / Cmd / Shift / chuột giữa thì để trình duyệt tự xử — người dùng
 *   đã chọn cách mở của họ.
 */

import { useEffect } from "react"
import { manDuRong, posTargetFor } from "@/lib/nav/pos-preview"
import { openInNewTab } from "@/components/ui/new-tab-link"

export function PosNewTab() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute("href") || ""
      if (/^[a-z]+:/i.test(href) && !href.startsWith(window.location.origin)) return
      if (!manDuRong()) return
      const dich = posTargetFor(href)
      if (!dich) return
      e.preventDefault()
      e.stopPropagation()
      openInNewTab(dich)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])
  return null
}

/**
 * Cho các nút đi bằng `router.push` (không phải `<a>`): máy tính mở POS ở
 * tab mới, còn lại đi như cũ.
 */
export function diHoacMoPos(push: (href: string) => void, href: string) {
  const dich = manDuRong() ? posTargetFor(href) : null
  if (dich) openInNewTab(dich)
  else push(href)
}
