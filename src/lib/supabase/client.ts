import { createBrowserClient } from "@supabase/ssr"
import { fetchCoHetGio } from "@/lib/supabase/fetch-het-gio"

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!url || !key) {
    console.error("[supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  return createBrowserClient(url!, key!, {
    global: {
      // Hẹn giờ 10 giây để câu không treo mãi; app nằm nền thì không đếm, câu đọc hết giờ thử lại một lần
      // (chủ nhà 22/10/2026 — "AbortError: Fetch is aborted" ở màn Sản phẩm). Xem `fetch-het-gio.ts`.
      fetch: fetchCoHetGio,
    },
    auth: {
      // Mặc định của @supabase/ssr đã là true; khai báo tường minh để
      // chắc chắn session lưu trong cookie + tự refresh khi tab active.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
