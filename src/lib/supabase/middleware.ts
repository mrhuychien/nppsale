import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  // Bypass auth for debug page so users can diagnose even when auth is broken
  if (request.nextUrl.pathname.startsWith("/debug")) {
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
      // Race server-side auth calls against a 3s timeout so middleware
      // never blocks page load if Supabase is slow/unreachable.
      fetch: (input, init) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)
        return fetch(input, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timeoutId)
        )
      },
    },
  })

  let user = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (err) {
    console.error("[middleware] auth check failed:", err)
    // Treat as unauthenticated, but let client-side handle it
  }

  // Redirect unauthenticated users to login
  if (
    !user &&
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
      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
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
      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
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
