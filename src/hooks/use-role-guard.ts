"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "./use-auth"
import { type Module, layQuyenDaNap, ngheQuyenDaNap } from "@/lib/permissions"
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
  /* ⚠ CHỜ BẢNG QUYỀN NẠP XONG rồi mới đá ra — xem `baoQuyenDaNap`. Loader hỏng không báo thì
     sau 4 giây quyết theo quyền đang có (không treo màn chờ mãi). */
  const daNap = useSyncExternalStore(ngheQuyenDaNap, layQuyenDaNap, () => false)
  const [hetCho, setHetCho] = useState(false)
  useEffect(() => {
    if (daNap || hasAccess) return
    const t = setTimeout(() => setHetCho(true), 4000)
    return () => clearTimeout(t)
  }, [daNap, hasAccess])
  const quyenChac = daNap || hetCho

  useEffect(() => {
    if (!loading && user && !hasAccess && quyenChac) {
      /* ⚠ VỀ /home, KHÔNG VỀ "/". "/" đẩy khối văn phòng sang /dashboard; ai không vào được
         /dashboard mà bị đẩy về "/" là quay vòng /dashboard ↔ "/" tới khi trình duyệt chặn
         ("history.replaceState() more than 100 times per 10 seconds" — chủ nhà 26/09/2026,
         màn trắng ở /dashboard). /home ai cũng vào được (`always`). */
      router.replace("/home")
    }
  }, [user, loading, hasAccess, quyenChac, router])

  /* Chưa chắc quyền mà đang thiếu quyền → coi như còn nạp (màn hiện khung chờ, không lộ nội dung). */
  return { user, loading: loading || (!hasAccess && !quyenChac), hasAccess }
}
