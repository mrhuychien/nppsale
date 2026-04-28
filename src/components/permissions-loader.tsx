"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  rowsToCache,
  setPermissionsCache,
  type Action,
  type Module,
  type Role,
} from "@/lib/permissions"
import { useAuth } from "@/hooks/use-auth"

interface DbRow {
  role: string
  module: string
  action: string
  allowed: boolean
}

/**
 * Loads `role_permissions` for the current org once after the user is
 * authenticated and pushes the result into the module-level permission
 * cache. Renders nothing.
 */
export function PermissionsLoader() {
  const { user } = useAuth()
  const orgId = user?.org_id

  useEffect(() => {
    if (!orgId) {
      // No session — clear any stale cache from a previous user.
      setPermissionsCache(null)
      return
    }

    let cancelled = false
    const supabase = createClient()

    async function load() {
      try {
        const { data, error } = await supabase
          .from("role_permissions")
          .select("role, module, action, allowed")
          .eq("org_id", orgId)
        if (cancelled) return
        if (error) {
          // Most common cause: migration not yet applied. Fall back to
          // defaults silently — the app keeps working with the static map.
          console.warn("[PermissionsLoader] load failed, using defaults:", error.message)
          setPermissionsCache(null)
          return
        }
        const rows = ((data as DbRow[]) || []).map((r) => ({
          role: r.role as Role,
          module: r.module as Module,
          action: r.action as Action,
          allowed: !!r.allowed,
        }))
        setPermissionsCache(rowsToCache(rows))
      } catch (err) {
        console.warn("[PermissionsLoader] unexpected error:", err)
        setPermissionsCache(null)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orgId])

  return null
}
