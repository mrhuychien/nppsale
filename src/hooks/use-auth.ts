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
    // Safety timeout: if auth check hangs for more than 8s, give up
    const timeoutId = setTimeout(() => {
      if (mounted) {
        console.error("[useAuth] Auth check timed out after 8s")
        setAuthError("Không thể kết nối tới máy chủ")
        setLoading(false)
      }
    }, 8000)

    async function getUser() {
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser()
        if (authErr) {
          console.error("[useAuth] getUser error:", authErr)
          if (mounted) setAuthError(authErr.message)
          return
        }
        const au = authData?.user
        if (au && mounted) {
          setAuthUser({ id: au.id, email: au.email || "" })
          const { data: profile, error: profErr } = await supabase
            .from("users")
            .select("*")
            .eq("id", au.id)
            .maybeSingle()
          if (profErr) {
            console.error("[useAuth] profile error:", profErr)
            if (mounted) setAuthError(profErr.message)
          } else if (profile && mounted) {
            setUser(profile as User)
          }
        }
      } catch (err) {
        console.error("[useAuth] unexpected error:", err)
        if (mounted) {
          setAuthError(err instanceof Error ? err.message : "Lỗi không xác định")
        }
      } finally {
        if (mounted) {
          clearTimeout(timeoutId)
          setLoading(false)
        }
      }
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setAuthUser({ id: session.user.id, email: session.user.email || "" })
        try {
          const { data: profile } = await supabase
            .from("users")
            .select("*")
            .eq("id", session.user.id)
            .maybeSingle()
          if (profile && mounted) setUser(profile as User)
        } catch (err) {
          console.error("[useAuth] onAuthStateChange error:", err)
        }
      } else {
        setUser(null)
        setAuthUser(null)
      }
    })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
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
