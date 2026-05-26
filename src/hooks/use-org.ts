"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "./use-auth"

interface OrgRow {
  id: string
  name: string
}

// Module-level cache giữ data tổ chức trong suốt session — tránh
// re-fetch khi user navigate giữa các trang có in chứng từ (phiếu
// lương, phiếu thu, biên bản bàn giao, …).
const cache = new Map<string, OrgRow>()

export function clearOrgCache(): void {
  cache.clear()
}

export function useOrg() {
  const { user } = useAuth()
  const orgId = user?.org_id
  const cached = orgId ? cache.get(orgId) ?? null : null
  const [org, setOrg] = useState<OrgRow | null>(cached)
  const [loading, setLoading] = useState(orgId ? !cached : false)

  useEffect(() => {
    if (!orgId) {
      setOrg(null)
      setLoading(false)
      return
    }
    const c = cache.get(orgId)
    if (c) {
      setOrg(c)
      setLoading(false)
      return
    }
    let cancelled = false
    const supabase = createClient()
    supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const row = data as OrgRow | null
        if (row) cache.set(orgId, row)
        setOrg(row)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return { org, loading }
}
