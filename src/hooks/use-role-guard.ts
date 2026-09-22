"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "./use-auth"
import { type Module } from "@/lib/permissions"
import { duocVaoTrang } from "@/lib/nav/nav-permission"

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

  /**
   * ⚠ LUẬT NẰM Ở `duocVaoTrang`, KHÔNG NẰM TRONG HOOK NÀY. Hook chạy
   *   trong React nên chốt không gọi được; luật để trong đây thì chốt
   *   chỉ soi được CHỮ, và một đột biến `false && …` giữ nguyên chữ mà
   *   giết luật vẫn đi lọt (đã thử, chốt xanh). Tách ra là để câu hỏi
   *   "ai vào được trang nào" trả lời được bằng một lời gọi.
   */
  const hasAccess = duocVaoTrang(user?.role, pathname, module)

  useEffect(() => {
    if (!loading && user && !hasAccess) {
      router.replace("/")
    }
  }, [user, loading, hasAccess, router])

  return { user, loading, hasAccess }
}
