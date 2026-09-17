"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  rowsToCache,
  setPermissionsCache,
  setUserOverrides,
  type Action,
  type Module,
  type Role,
  type UserOverrides,
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
  const userId = user?.id

  useEffect(() => {
    if (!orgId) {
      // No session — clear any stale cache from a previous user.
      setPermissionsCache(null)
      setUserOverrides(null)
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

        /**
         * ⚠ QUYỀN TUỲ CHỈNH THEO TỪNG NGƯỜI — phần trước nay bị bỏ quên.
         * Màn /settings/users/[id]/permissions ghi xuống bảng này từ lâu,
         * nhưng lúc chạy chỉ có bảng theo VAI TRÒ được nạp. Quản lý thu hồi
         * quyền của một nhân viên, thấy báo "Đã lưu", rồi nhân viên đó vẫn
         * thấy và vẫn vào được đúng màn vừa bị thu hồi.
         */
        if (!userId) return
        const ovRes = await supabase
          .from("user_permission_overrides")
          .select("permission_key, granted")
          .eq("user_id", userId)
        if (cancelled) return
        if (ovRes.error) {
          // ⚠ ĐỌC HỎNG THÌ BỎ TUỲ CHỈNH, KHÔNG ĐOÁN. Đoán "bị thu hồi" là
          // khoá nhầm người đang cần làm việc; đoán "được cấp" là mở nhầm.
          // Rơi về quyền vai trò là hành vi đã biết và giải thích được.
          console.warn("[PermissionsLoader] không đọc được quyền riêng:", ovRes.error.message)
          setUserOverrides(null)
          return
        }
        const ov: UserOverrides = {}
        for (const r of (ovRes.data as Array<{ permission_key: string; granted: boolean }>) || []) {
          ov[r.permission_key] = !!r.granted
        }
        setUserOverrides(ov)
      } catch (err) {
        console.warn("[PermissionsLoader] unexpected error:", err)
        setPermissionsCache(null)
        setUserOverrides(null)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [orgId, userId])

  return null
}
