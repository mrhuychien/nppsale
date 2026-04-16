"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@/types"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    let mounted = true

    async function fetchProfile(userId: string) {
      try {
        const { data: profile, error: profErr } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle()
        if (profErr) {
          console.error("[useAuth] profile error:", profErr)
          return null
        }
        return profile as User | null
      } catch (err) {
        console.error("[useAuth] profile unexpected error:", err)
        return null
      }
    }

    async function init() {
      try {
        // getSession() reads local storage, does NOT call the network.
        // This is instant and never hangs.
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
        if (sessionErr) {
          console.error("[useAuth] getSession error:", sessionErr)
          if (mounted) setAuthError(sessionErr.message)
          return
        }
        const session = sessionData?.session
        if (!session?.user) {
          // No session -> not logged in, done.
          return
        }
        const au = session.user
        if (mounted) {
          setAuthUser({ id: au.id, email: au.email || "" })
        }
        // Fetch profile with 5s timeout
        const profilePromise = fetchProfile(au.id)
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 5000)
        )
        const profile = await Promise.race([profilePromise, timeoutPromise])
        if (profile && mounted) setUser(profile)
      } catch (err) {
        console.error("[useAuth] init error:", err)
        if (mounted) {
          setAuthError(err instanceof Error ? err.message : "Lỗi không xác định")
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
