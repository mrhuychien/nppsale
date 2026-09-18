"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "./use-auth"
import { canAccessModule, type Module } from "@/lib/permissions"
import { NAV_PERMISSION, canEnterHref } from "@/lib/nav/nav-permission"

/**
 * Chặn ở CỬA VÀO trang, khớp đúng với phép lọc menu.
 *
 * ⚠ GIẤU MÀ KHÔNG CHẶN THÌ CHƯA PHẢI PHÂN QUYỀN. Trước đây menu tra theo
 * đường dẫn (tới tận TÍNH NĂNG và quyền riêng của từng người) còn cửa vào
 * chỉ tra theo MÔ-ĐUN. Hai phép kiểm khác nhau cho cùng một câu hỏi: mục
 * "Công nợ NCC" biến mất khỏi menu của NVBH, nhưng gõ thẳng `/payables`
 * vào thanh địa chỉ thì vào được — vì mô-đun cha `receivables` vẫn mở.
 *
 * Nay nếu đường dẫn hiện tại có trong bảng phân quyền menu thì cửa vào
 * dùng CHÍNH phép kiểm đó. Đường dẫn động (`/orders/[id]`) không có trong
 * bảng nên vẫn tra theo mô-đun như cũ — không siết thêm chỗ chưa khai.
 */
export function useRoleGuard(module: Module) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const declared = pathname ? NAV_PERMISSION[pathname] : undefined
  const hasAccess = user
    ? declared
      ? canEnterHref(user.role, pathname as string)
      : canAccessModule(user.role, module)
    : false

  useEffect(() => {
    if (!loading && user && !hasAccess) {
      router.replace("/")
    }
  }, [user, loading, hasAccess, router])

  return { user, loading, hasAccess }
}
