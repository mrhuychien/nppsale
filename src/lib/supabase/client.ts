import { createBrowserClient } from "@supabase/ssr"

// Custom fetch that times out after 10s so Supabase requests never hang forever
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)
  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!url || !key) {
    console.error("[supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  return createBrowserClient(url!, key!, {
    global: {
      fetch: fetchWithTimeout,
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
