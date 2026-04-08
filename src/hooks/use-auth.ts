"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@/types"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function getUser() {
      try {
        const { data: { user: au } } = await supabase.auth.getUser()
        if (au) {
          setAuthUser({ id: au.id, email: au.email || "" })
          const { data: profile } = await supabase
            .from("users")
            .select("*")
            .eq("id", au.id)
            .single()
          if (profile) setUser(profile as User)
        }
      } finally {
        setLoading(false)
      }
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setAuthUser({ id: session.user.id, email: session.user.email || "" })
        const { data: profile } = await supabase
          .from("users")
          .select("*")
          .eq("id", session.user.id)
          .single()
        if (profile) setUser(profile as User)
      } else {
        setUser(null)
        setAuthUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setAuthUser(null)
  }

  return { user, authUser, loading, signOut }
}
