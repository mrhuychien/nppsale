import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { thuLaiKhiGiaoDichHong } from "@/lib/supabase/thu-lai-giao-dich-hong"

export function createServerSupabaseClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Câu PostgREST trả 25P02 (giao dịch hỏng từ trước — chủ nhà 29/10/2026) thì gửi lại; gọi `fetch` lúc chạy để giữ
      // bản fetch Next.js vá. Xem `thu-lai-giao-dich-hong.ts`.
      global: { fetch: thuLaiKhiGiaoDichHong((input, init) => fetch(input, init)) },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch {
            // Server Component — ignore
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value: "", ...options })
          } catch {
            // Server Component — ignore
          }
        },
      },
    }
  )
}
