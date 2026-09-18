"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@/types"

// Log chẩn đoán chỉ bật ở môi trường dev — production giữ console sạch,
// không lộ trạng thái phiên / role người dùng.
const debug =
  process.env.NODE_ENV !== "production"
    ? (...args: unknown[]) => console.log("[AuthProvider]", ...args)
    : () => {}

interface AuthContextValue {
  user: User | null
  authUser: { id: string; email: string } | null
  loading: boolean
  authError: string | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    debug("mounted")
    const supabase = createClient()
    let mounted = true
    let resolved = false

    function markResolved(reason: string) {
      if (resolved) return
      resolved = true
      debug("resolved:", reason)
      if (mounted) setLoading(false)
    }

    // Hard fallback - 2.5s max wait
    const hardTimeoutId = setTimeout(() => {
      if (!resolved) {
        console.error("[AuthProvider] HARD TIMEOUT 2.5s - assuming no session")
        markResolved("timeout")
      }
    }, 2500)

    async function fetchProfile(userId: string) {
      try {
        const { data, error } = await supabase
          .from("users")
          .select(
            "id, org_id, full_name, role, phone, is_active, created_at, allow_price_edit, price_edit_max_increase_pct"
          )
          .eq("id", userId)
          .maybeSingle()
        if (error) {
          console.error("[AuthProvider] profile error:", error.code, error.message)
          return null
        }
        return data as User | null
      } catch (err) {
        console.error("[AuthProvider] profile unexpected error:", err)
        return null
      }
    }

    // Subscribe to auth state. The INITIAL_SESSION event fires
    // immediately on mount with the current session (or null).
    // This is faster and more reliable than calling getSession().
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      debug("event:", event, session?.user ? "WITH_SESSION" : "NO_SESSION")
      if (!mounted) return

      if (session?.user) {
        const au = session.user
        setAuthUser({ id: au.id, email: au.email || "" })
        // Fetch profile in background
        fetchProfile(au.id).then((profile) => {
          if (!profile || !mounted) return
          /**
           * ⚠ TÀI KHOẢN BỊ KHOÁ PHẢI BỊ ĐẨY RA, VÀ PHẢI ĐƯỢC NÓI VÌ SAO.
           *
           * Trước migration 122, `is_active` chỉ được kiểm ở đường đăng
           * nhập bằng mã QR. Đường email + mật khẩu đọc cờ này vào hồ sơ
           * rồi không hỏi tới nó lần nào, và phía cơ sở dữ liệu cũng
           * không — `user_org_id()` chỉ tra theo `auth.uid()`. Nghĩa là
           * nút "Khoá tài khoản" ở Cài đặt → Người dùng từ trước tới nay
           * chỉ là một cái nhãn: người đã nghỉ việc vẫn đăng nhập được
           * bằng mật khẩu cũ với nguyên quyền của vai mình.
           *
           * Mig 122 chặn ở `user_org_id()` nên RLS không trả dòng nào
           * nữa — nhưng RLS TỪ CHỐI LÀ IM LẶNG (0 dòng, HTTP 200, error
           * null). Không có đoạn này thì người bị khoá thấy một ứng dụng
           * trống trơn và nghĩ hệ thống hỏng. Lớp dưới để không lách
           * được, lớp này để hiểu chuyện gì xảy ra.
           *
           * ⚠ `=== false` CHỨ KHÔNG PHẢI `!profile.is_active`. Cột này
           * NULL được (mig 001 không NOT NULL) và NULL nghĩa là CHƯA AI
           * KHOÁ — đá người đang đi làm ra ngoài là hỏng nặng hơn hẳn.
           */
          if (profile.is_active === false) {
            debug("profile inactive — signing out")
            setAuthError(
              "Tài khoản của bạn đã bị khoá. Liên hệ chủ nhà phân phối để mở lại."
            )
            setUser(null)
            void supabase.auth.signOut()
            return
          }
          debug("profile loaded")
          setUser(profile)
        })
      } else {
        setUser(null)
        setAuthUser(null)
      }

      // The initial event (INITIAL_SESSION) fires once on subscribe.
      // Use it to mark loading=false.
      markResolved(event)
    })

    // Refresh session khi tab quay lại visible (mobile user mở app sau
    // khi bị suspend, hoặc desktop user quay lại sau vài giờ).
    // Supabase auto-refresh thường chỉ chạy khi tab active; cần kick
    // thủ công để token mới được set trước khi user thao tác.
    // Throttle 5 phút: chuyển tab qua lại liên tục không dội request
    // refresh lên auth endpoint (token sống 1h, refresh sớm là thừa).
    let lastRefreshAt = 0
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (now - lastRefreshAt < 5 * 60_000) return
      lastRefreshAt = now
      supabase.auth.refreshSession().catch((err) => {
        console.warn("[AuthProvider] refresh on visibility failed:", err)
      })
    }
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      mounted = false
      clearTimeout(hardTimeoutId)
      subscription.unsubscribe()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [])

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
    setAuthUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, authUser, loading, authError, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    // Provider not mounted yet - return safe defaults so we never crash
    return {
      user: null,
      authUser: null,
      loading: true,
      authError: null,
      signOut: async () => {},
    }
  }
  return ctx
}
