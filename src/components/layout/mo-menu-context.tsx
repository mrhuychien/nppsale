"use client"

import { createContext, useContext } from "react"
import { Menu } from "lucide-react"

/**
 * Mở ngăn menu chính (☰) của khung app từ màn tự dựng đầu trang — những màn ẩn app bar trên điện
 * thoại (danh sách Đơn hàng / Hoá đơn bán / Khách hàng / Trả hàng) mất nút ☰ của app bar.
 * `null` = khung không có ngăn menu.
 */
export const MoMenuContext = createContext<(() => void) | null>(null)

export function useMoMenu() {
  return useContext(MoMenuContext)
}

/** ☰ cạnh tiêu đề đầu trang xanh — chủ nhà 30/09/2026: "Các trang danh sách khi NPP truy cập mobile phải có menu 3 gạch". */
export function NutMenuDauTrang() {
  const moMenu = useMoMenu()
  if (!moMenu) return null
  return (
    <button
      type="button"
      onClick={moMenu}
      aria-label="Mở menu"
      data-testid="mo-menu"
      className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl active:bg-primary-foreground/15"
    >
      <Menu className="h-6 w-6" />
    </button>
  )
}
