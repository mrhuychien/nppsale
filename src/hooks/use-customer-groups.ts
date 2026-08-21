"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "./use-auth"

interface CustomerGroupRow {
  id: string
  name: string
}

// customer_groups là reference table (rất ít thay đổi — seed lúc
// setup wizard). Cache theo orgId trong suốt session để tránh
// re-fetch khi user mở liên tục: customer form, product detail,
// price list manager, analytics customer categories, …
const cache = new Map<string, CustomerGroupRow[]>()

export function clearCustomerGroupsCache(): void {
  cache.clear()
}

export function useCustomerGroups() {
  const { user } = useAuth()
  const orgId = user?.org_id
  const cached = orgId ? cache.get(orgId) ?? null : null
  const [groups, setGroups] = useState<CustomerGroupRow[]>(cached ?? [])
  const [loading, setLoading] = useState(orgId ? !cached : false)

  useEffect(() => {
    if (!orgId) {
      setGroups([])
      setLoading(false)
      return
    }
    const c = cache.get(orgId)
    if (c) {
      setGroups(c)
      setLoading(false)
      return
    }
    let cancelled = false
    const supabase = createClient()
    supabase
      .from("customer_groups")
      .select("id, name")
      .eq("org_id", orgId)
      .order("name")
      .then(({ data, error }) => {
        if (error) console.error("[hooks/use-customer-groups] truy vấn lỗi:", error.message)
        if (cancelled) return
        const rows = (data as CustomerGroupRow[] | null) ?? []
        cache.set(orgId, rows)
        setGroups(rows)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return { groups, loading }
}
