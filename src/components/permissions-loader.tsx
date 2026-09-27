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

const KHOA_NHO = "npp.quyen.v1|"
export const NHO_QUYEN_MS = 5 * 60_000

/** Xoá nhớ quyền (sau khi lưu phân quyền) — lần tải sau đọc lại ngay. */
export function xoaNhoQuyen(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(KHOA_NHO)) sessionStorage.removeItem(k)
    }
  } catch {
    /* bỏ qua */
  }
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
    const khoa = `${KHOA_NHO}${orgId}|${userId ?? ""}`

    const apDung = (rows: DbRow[], ov: UserOverrides | null) => {
      setPermissionsCache(
        rowsToCache(
          rows.map((r) => ({ role: r.role as Role, module: r.module as Module, action: r.action as Action, allowed: !!r.allowed }))
        )
      )
      setUserOverrides(ov)
    }

    /* ⚠ NHỚ 5 PHÚT THEO PHIÊN TRÌNH DUYỆT (chủ nhà 27/09/2026 — log Supabase vượt gói: bảng quyền
       bị đọc lại ở MỖI lần tải trang, ~70 lượt / giờ cho một người). Quyền chỉ để ẩn / hiện màn —
       dữ liệu vẫn do RLS canh; đổi quyền có hiệu lực chậm nhất 5 phút (hoặc đăng nhập lại). */
    try {
      const raw = sessionStorage.getItem(khoa)
      const c = raw ? (JSON.parse(raw) as { at: number; rows: DbRow[]; ov: UserOverrides | null }) : null
      if (c && Date.now() - c.at < NHO_QUYEN_MS) {
        apDung(c.rows, c.ov)
        return
      }
    } catch {
      /* không có sessionStorage — đọc mạng như thường */
    }

    async function load() {
      try {
        // Hai câu SONG SONG — trước đây nối đuôi, thêm một vòng mạng mỗi lần mở app.
        const [res, ovRes] = await Promise.all([
          supabase.from("role_permissions").select("role, module, action, allowed").eq("org_id", orgId),
          userId
            ? supabase.from("user_permission_overrides").select("permission_key, granted").eq("user_id", userId)
            : Promise.resolve({ data: [], error: null }),
        ])
        const { data, error } = res
        if (cancelled) return
        if (error) {
          // Most common cause: migration not yet applied. Fall back to
          // defaults silently — the app keeps working with the static map.
          console.warn("[PermissionsLoader] load failed, using defaults:", error.message)
          setPermissionsCache(null)
          return
        }
        const rows = (data as DbRow[]) || []

        /**
         * ⚠ QUYỀN TUỲ CHỈNH THEO TỪNG NGƯỜI — phần trước nay bị bỏ quên.
         * Màn /settings/users/[id]/permissions ghi xuống bảng này từ lâu,
         * nhưng lúc chạy chỉ có bảng theo VAI TRÒ được nạp. Quản lý thu hồi
         * quyền của một nhân viên, thấy báo "Đã lưu", rồi nhân viên đó vẫn
         * thấy và vẫn vào được đúng màn vừa bị thu hồi.
         */
        let ov: UserOverrides | null = null
        if (ovRes.error) {
          // ⚠ ĐỌC HỎNG THÌ BỎ TUỲ CHỈNH, KHÔNG ĐOÁN. Đoán "bị thu hồi" là
          // khoá nhầm người đang cần làm việc; đoán "được cấp" là mở nhầm.
          // Rơi về quyền vai trò là hành vi đã biết và giải thích được.
          console.warn("[PermissionsLoader] không đọc được quyền riêng:", ovRes.error.message)
        } else if (userId) {
          ov = {}
          for (const r of (ovRes.data as Array<{ permission_key: string; granted: boolean }>) || []) {
            ov[r.permission_key] = !!r.granted
          }
        }
        apDung(rows, ov)
        // Chỉ nhớ khi đọc đủ cả hai — bản hỏng không được sống 5 phút.
        if (!ovRes.error) {
          try {
            sessionStorage.setItem(khoa, JSON.stringify({ at: Date.now(), rows, ov }))
          } catch {
            /* bỏ qua */
          }
        }
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
