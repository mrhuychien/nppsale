import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { thuLaiKhiGiaoDichHong } from "@/lib/supabase/thu-lai-giao-dich-hong"

/**
 * Admin Supabase client with service_role key.
 * SERVER-SIDE ONLY - NEVER import this in client components.
 * Used for admin operations like creating/deleting auth users.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    throw new Error("Thiếu env var SUPABASE_SERVICE_ROLE_KEY hoặc NEXT_PUBLIC_SUPABASE_URL")
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Câu PostgREST trả 25P02 (giao dịch hỏng từ trước) thì gửi lại — một luật với client trình duyệt / máy chủ.
    global: { fetch: thuLaiKhiGiaoDichHong((input, init) => fetch(input, init)) },
  })
}
