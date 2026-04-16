"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@/types"

// BUILD_TAG changes on every deploy - check in Console to verify
// that the latest code is running (not a stale browser cache)
const BUILD_TAG = "useAuth-v8-nonblocking-20260416"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    console.log(`[useAuth] mounted ${BUILD_TAG}`)
    let mounted = true
    let resolved = false

    // HARD SAFETY NET: no matter what, loading becomes false within 2s.
    // This guarantees the UI never sticks on "Đang tải".
    const hardTimeoutId = setTimeout(() => {
      if (!mounted || resolved) return
      console.error("[useAuth] HARD TIMEOUT 2s - forcing loading=false")
      resolved = true
      setLoading(false)
    }, 2000)

    function markResolved() {
      if (resolved) return
      resolved = true
      clearTimeout(hardTimeoutId)
      if (mounted) setLoading(false)
    }

    async function fetchProfile(userId: string) {
      try {
        console.log("[useAuth] fetching profile for", userId)
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle()
        if (error) {
          console.error("[useAuth] profile error:", error.code, error.message)
          return null
        }
        return data as User | null
      } catch (err) {
        console.error("[useAuth] profile unexpected error:", err)
        return null
      }
    }

    async function init() {
      try {
        console.log("[useAuth] calling getSession()")
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error("[useAuth] getSession error:", error.message)
          if (mounted) setAuthError(error.message)
          return
        }

        const au = data?.session?.user
        console.log("[useAuth] session result:", au ? "HAS_SESSION" : "NO_SESSION")

        if (!au) {
          // No session - done immediately
          return
        }

        // Set authUser immediately - the UI can proceed even without profile
        if (mounted) {
          setAuthUser({ id: au.id, email: au.email || "" })
        }

        // CRITICAL: resolve loading NOW, don't wait for profile.
        // Profile is fetched in background.
        markResolved()

        // Fetch profile non-blocking (fire and forget)
        fetchProfile(au.id).then((profile) => {
          if (profile && mounted) {
            console.log("[useAuth] profile loaded:", profile.full_name)
            setUser(profile)
          }
        })
      } catch (err) {
        console.error("[useAuth] init error:", err)
        if (mounted) {
          setAuthError(err instanceof Error ? err.message : "Lỗi không xác định")
        }
      } finally {
        markResolved()
      }
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[useAuth] authStateChange:", event)
      if (!mounted) return
      if (session?.user) {
        setAuthUser({ id: session.user.id, email: session.user.email || "" })
        const profile = await fetchProfile(session.user.id)
        if (profile && mounted) setUser(profile)
      } else {
        setUser(null)
        setAuthUser(null)
      }
    })

    return () => {
      mounted = false
      clearTimeout(hardTimeoutId)
      subscription.unsubscribe()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setAuthUser(null)
  }

  return { user, authUser, loading, authError, signOut }
}
