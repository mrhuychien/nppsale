import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  // Bypass auth for debug page so users can diagnose even when auth is broken
  if (request.nextUrl.pathname.startsWith("/debug")) {
    return NextResponse.next({ request })
  }

  // Đăng nhập bằng QR: route /qr-login tự đối chiếu token và đặt phiên.
  // Phải cho qua trước khi middleware đẩy khách chưa đăng nhập về /login.
  if (request.nextUrl.pathname.startsWith("/qr-login")) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  // If env vars missing, let page load (debug page will show the issue)
  if (!url || !key) {
    return supabaseResponse
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        request.cookies.set({ name, value, ...options })
        supabaseResponse = NextResponse.next({ request })
        supabaseResponse.cookies.set({ name, value, ...options })
      },
      remove(name: string, options: Record<string, unknown>) {
        request.cookies.set({ name, value: "", ...options })
        supabaseResponse = NextResponse.next({ request })
        supabaseResponse.cookies.set({ name, value: "", ...options })
      },
    },
    global: {
      // Race server-side auth calls against an 8s timeout. Cao hơn 3s
      // cũ vì refresh token sau khi expire có thể chậm trên mạng yếu;
      // nếu timeout, ta KHÔNG đuổi user về /login mà coi như "có thể
      // còn session" để client tự reconcile (xem dưới).
      fetch: (input, init) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)
        return fetch(input, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timeoutId)
        )
      },
    },
  })

  // Nếu có cookie Supabase (sb-*-auth-token) → user đã từng đăng nhập
  // trên device này. Khi getUser() timeout/lỗi, ta TIN cookie thay vì
  // đuổi về /login, để network chập chờn không log user ra.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"))

  // getSession() đọc phiên từ cookie — KHÔNG gọi mạng khi access token
  // còn hạn (chỉ refresh qua mạng khi token hết hạn). Trước đây dùng
  // getUser() → 1 round-trip đến Supabase Auth cho MỖI lần chuyển trang,
  // là nguồn chậm chính khi điều hướng. Đánh đổi: middleware chỉ là
  // cổng định tuyến; dữ liệu luôn được RLS bảo vệ ở tầng PostgREST và
  // các API nhạy cảm (/api/admin/*, /qr-login) vẫn tự getUser().
  let user = null
  let authCheckFailed = false
  try {
    const result = await supabase.auth.getSession()
    user = result.data.session?.user ?? null
  } catch (err) {
    console.error("[middleware] auth check failed:", err)
    authCheckFailed = true
  }

  // Redirect unauthenticated users to login — TRỪ khi auth check fail
  // nhưng cookie sb-* vẫn còn (giữ session trên device đã đăng nhập).
  if (
    !user &&
    !(authCheckFailed && hasAuthCookie) &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/debug") &&
    request.nextUrl.pathname !== "/"
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Server-side role check for admin routes
  if (user && request.nextUrl.pathname.startsWith("/settings")) {
    try {
      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
      if (profileErr) console.error("[supabase/middleware] truy vấn lỗi:", profileErr.message)
      if (profile && !["owner", "manager"].includes(profile.role)) {
        const url = request.nextUrl.clone()
        url.pathname = "/dashboard"
        return NextResponse.redirect(url)
      }
    } catch {
      // Let client-side handle if query fails
    }
  }

  // Server-side role check for HR routes
  if (user && request.nextUrl.pathname.startsWith("/hr")) {
    try {
      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
      if (profileErr) console.error("[supabase/middleware] truy vấn lỗi:", profileErr.message)
      if (profile && !["owner", "manager", "accountant"].includes(profile.role)) {
        const url = request.nextUrl.clone()
        url.pathname = "/dashboard"
        return NextResponse.redirect(url)
      }
    } catch {
      // Let client-side handle
    }
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
