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
/* ⚠ GỘP LƯỢT ĐANG ĐỌC (chủ nhà 27/09/2026 — log Supabase vượt gói): một trang gắn 2–3 thành
   phần cùng dùng `useOrg` lúc bộ nhớ còn trống thì trước đây mỗi cái tự đọc — 3 lượt cho một dòng. */
const dangDoc = new Map<string, PromiseLike<{ data: unknown; error: { message: string } | null }>>()

/**
 * ⚠ NHỚ TRONG MÁY 12 GIỜ (chủ nhà 27/09/2026: "org làm gì đâu vì chỉ có 1 nhà phân phối dùng thôi").
 *   Menu người dùng có ở MỌI màn nên trước đây mỗi lần tải trang là một lượt đọc `organizations`
 *   cho một dòng gần như không bao giờ đổi (tên NPP, cờ bán âm). Lưu ở Cài đặt → Tổ chức thì
 *   `clearOrgCache()` xoá bản nhớ.
 */
export const NHO_ORG_MS = 12 * 60 * 60 * 1000
const khoaNho = (orgId: string) => `npp:org:${orgId}`

function docNho(orgId: string): OrgRow | null {
  try {
    const raw = localStorage.getItem(khoaNho(orgId))
    if (!raw) return null
    const v = JSON.parse(raw) as { at: number; row: OrgRow }
    return v && Date.now() - v.at < NHO_ORG_MS ? v.row : null
  } catch {
    return null
  }
}

function ghiNho(row: OrgRow) {
  try {
    localStorage.setItem(khoaNho(row.id), JSON.stringify({ at: Date.now(), row }))
  } catch {
    /* bỏ qua — chỉ mất phần nhớ */
  }
}

export function clearOrgCache(): void {
  cache.clear()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith("npp:org:")) localStorage.removeItem(k)
    }
  } catch {
    /* bỏ qua */
  }
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
    const nho = cache.get(orgId) ?? docNho(orgId)
    if (nho) cache.set(orgId, nho)
    const c = nho
    if (c) {
      setOrg(c)
      setLoading(false)
      return
    }
    let cancelled = false
    let p = dangDoc.get(orgId)
    if (!p) {
      /* ⚠ BỌC `Promise.resolve` NGAY: builder của Supabase là "thenable" LƯỜI — mỗi lần `.then` là
         gửi lại truy vấn. Giữ builder rồi cho 3 nơi `.then` là 3 lượt gọi (log e2e 27/09/2026). */
      // audit-ok: lỗi đọc ở `p.then(({ data, error })` ngay dưới (ghi log; `allow_oversell` về tắt — mặc định an toàn).
      p = Promise.resolve(createClient().from("organizations").select("id, name, allow_oversell").eq("id", orgId).maybeSingle())
      dangDoc.set(orgId, p)
      void Promise.resolve(p).finally(() => dangDoc.delete(orgId))
    }
    p.then(({ data, error }) => {
        if (error) console.error("[hooks/use-org] truy vấn lỗi:", error.message)
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
        if (row) {
          cache.set(orgId, row)
          ghiNho(row)
        }
        setOrg(row)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return { org, loading }
}
