import { createServerSupabaseClient } from "@/lib/supabase/server"
import { COT_GIAM_GIA, COT_HO_SO, gopHoSo } from "@/lib/auth/ho-so"
import type { User } from "@/types"

export interface HoSoMayChu {
  /** Người của phiên (đọc từ cookie). */
  uid: string
  /** Hồ sơ đọc được; `null` khi câu đọc hỏng — trình duyệt tự đọc lại như cũ. */
  hoSo: User | null
}

/**
 * Đọc phiên + hồ sơ ở máy chủ (layout). `null` = chưa đăng nhập.
 *
 * Hai câu chạy song song, cùng vùng với Supabase — vài mili giây, thay cho một vòng mạng từ máy người
 * dùng (xem `@/lib/auth/ho-so`). Dữ liệu vẫn qua RLS: PostgREST tự kiểm JWT trong cookie, cookie giả thì
 * câu đọc không ra dòng nào.
 */
export async function layHoSoMayChu(): Promise<HoSoMayChu | null> {
  const supabase = createServerSupabaseClient()
  // getSession() đọc phiên từ cookie — không gọi mạng (middleware đã làm mới token nếu hết hạn).
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return null
  const [chinh, giamGia] = await Promise.all([
    supabase.from("users").select(COT_HO_SO).eq("id", uid).maybeSingle(),
    supabase.from("users").select(COT_GIAM_GIA).eq("id", uid).maybeSingle(),
  ])
  if (chinh.error) console.error("[ho-so-may-chu] đọc hồ sơ lỗi:", chinh.error.message)
  return { uid, hoSo: gopHoSo(chinh, giamGia) }
}
