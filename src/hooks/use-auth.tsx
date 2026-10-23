"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { COT_GIAM_GIA, COT_HO_SO, gopHoSo, hoSoGuiKemDung } from "@/lib/auth/ho-so"
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
/** Chỗ layout (máy chủ) gửi hồ sơ xuống — xem `NapHoSo`. */
const NapHoSoContext = createContext<((hoSo: User | null) => void) | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  /* Hồ sơ trang mang theo từ máy chủ (`NapHoSo`) — dùng MỘT lần, ở sự kiện phiên đầu. */
  const guiKem = useRef<User | null>(null)
  const napHoSo = useCallback((hoSo: User | null) => {
    guiKem.current = hoSo
  }, [])

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
        /* Quyền giảm giá (mig 185) đọc riêng — xem `COT_GIAM_GIA`.
           Hai câu chạy SONG SONG (chủ nhà 27/09/2026 "muốn nhanh hơn nữa"): mọi
           trang đều đợi hồ sơ này, nối đuôi là thêm một vòng mạng mỗi lần mở trang. */
        const [chinh, gg] = await Promise.all([
          supabase.from("users").select(COT_HO_SO).eq("id", userId).maybeSingle(),
          supabase.from("users").select(COT_GIAM_GIA).eq("id", userId).maybeSingle(),
        ])
        if (chinh.error) {
          console.error("[AuthProvider] profile error:", chinh.error.code, chinh.error.message)
          return null
        }
        return gopHoSo(chinh, gg)
      } catch (err) {
        console.error("[AuthProvider] profile unexpected error:", err)
        return null
      }
    }

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
     *
     * Một chỗ cho cả hồ sơ đọc mạng lẫn hồ sơ trang mang theo từ máy chủ.
     */
    function apDungHoSo(profile: User) {
      if (profile.is_active === false) {
        debug("profile inactive — signing out")
        setAuthError("Tài khoản của bạn đã bị khoá. Liên hệ chủ nhà phân phối để mở lại.")
        setUser(null)
        void supabase.auth.signOut()
        return
      }
      debug("profile loaded")
      setUser(profile)
    }

    // Subscribe to auth state. The INITIAL_SESSION event fires
    // immediately on mount with the current session (or null).
    // This is faster and more reliable than calling getSession().
    /** Người đã (đang) đọc hồ sơ trong phiên này. */
    let hoSoCua: string | null = null
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      debug("event:", event, session?.user ? "WITH_SESSION" : "NO_SESSION")
      if (!mounted) return

      if (session?.user) {
        const au = session.user
        setAuthUser({ id: au.id, email: au.email || "" })
        /* ⚠ MỘT HỒ SƠ MỘT LẦN (chủ nhà 27/09/2026 — log Supabase vượt gói). Supabase phát
           INITIAL_SESSION rồi SIGNED_IN / TOKEN_REFRESHED cho cùng một người: trước đây mỗi sự
           kiện đọc lại hồ sơ (2 câu). Cùng người thì bỏ qua — trừ USER_UPDATED (đổi thông tin). */
        if (hoSoCua === au.id && event !== "USER_UPDATED") {
          markResolved(event)
          return
        }
        hoSoCua = au.id
        /* ⚠ HỒ SƠ TRANG MANG THEO (chủ nhà 23/10/2026 "load trang chậm lắm"): máy chủ đã đọc sẵn khi dựng
           trang (`NapHoSo`) — đúng người thì dùng luôn, không đi thêm một vòng mạng trước khi trang được hỏi
           dữ liệu. Dùng một lần: sự kiện sau (đổi thông tin, đổi người) đọc mạng như cũ. */
        const sanCo = hoSoGuiKemDung(guiKem.current, au.id, event)
        guiKem.current = null
        if (sanCo) apDungHoSo(sanCo)
        else
          fetchProfile(au.id).then((profile) => {
            // Đọc hỏng thì cho sự kiện sau đọc lại — đừng kẹt ở "đã có hồ sơ".
            if (!profile) hoSoCua = null
            if (!profile || !mounted) return
            apDungHoSo(profile)
          })
      } else {
        hoSoCua = null
        guiKem.current = null
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
    <NapHoSoContext.Provider value={napHoSo}>
      <AuthContext.Provider value={{ user, authUser, loading, authError, signOut }}>
        {children}
      </AuthContext.Provider>
    </NapHoSoContext.Provider>
  )
}

/**
 * Layout (máy chủ) gửi hồ sơ đã đọc xuống `AuthProvider` — xem `@/lib/auth/ho-so`.
 *
 * ⚠ ĐẶT Ở KHUNG, NGOÀI PHẦN TRANG. Hiệu ứng của con chạy TRƯỚC hiệu ứng của cha, nên hồ sơ nằm sẵn trước
 *   khi `AuthProvider` nghe sự kiện phiên đầu. Lỡ đến muộn thì chỉ là đọc mạng như cũ — không sai, chỉ chậm.
 */
export function NapHoSo({ hoSo }: { hoSo: User | null }) {
  const nap = useContext(NapHoSoContext)
  useEffect(() => {
    nap?.(hoSo)
  }, [nap, hoSo])
  return null
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
