"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "./use-auth"

interface OrgRow {
  id: string
  name: string
  allow_oversell: boolean
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
      .select("id, name, allow_oversell")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const raw = data as Partial<OrgRow> | null
        const row: OrgRow | null = raw
          ? {
              id: String(raw.id ?? orgId),
              name: String(raw.name ?? ""),
              // Trước khi migration 086 chạy, cột chưa có → null/undefined.
              // Coi như tắt để an toàn (giữ behavior cũ).
              allow_oversell: raw.allow_oversell === true,
            }
          : null
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
