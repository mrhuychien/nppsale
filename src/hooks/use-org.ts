"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Organization } from "@/types"
import { useAuth } from "./use-auth"

export function useOrg() {
  const { user } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchOrg() {
      if (!user?.org_id) {
        setLoading(false)
        return
      }
      try {
        const { data } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", user.org_id)
          .single()
        if (data) setOrg(data as Organization)
      } finally {
        setLoading(false)
      }
    }
    fetchOrg()
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  return { org, loading }
}
