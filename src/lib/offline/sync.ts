"use client"

import { createClient } from "@/lib/supabase/client"
import { createOrderRecords } from "@/lib/orders/create"
import { listOutbox, removeEntry, markEntry } from "./outbox"

let syncing = false

function isTransient(err: unknown): boolean {
  // Lỗi mạng (mất sóng, timeout) → giữ đơn trong hàng chờ, thử lại sau.
  // Ngược lại (lỗi dữ liệu 4xx) → đánh dấu để người dùng xử lý.
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase()
  const code = (err as { code?: string })?.code
  // Chưa chạy migration 089 (thiếu cột client_request_id): insert đơn
  // FAIL trước khi tạo dòng nào → an toàn thử lại, tự khỏi sau migration.
  if (code === "42703" || code === "PGRST204" || msg.includes("client_request_id")) {
    return true
  }
  if (code && /^[0-9A-Z]/.test(code)) return false // mã lỗi Postgres/PostgREST khác
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("abort") ||
    msg.includes("timeout") ||
    msg.includes("failed to")
  )
}

export interface SyncResult {
  synced: number
  remaining: number
  failed: number
}

/**
 * Đẩy toàn bộ đơn trong hàng chờ lên server. An toàn khi gọi trùng
 * (có khoá chống chạy song song). Idempotent nhờ client_request_id nên
 * thử lại không tạo đơn trùng.
 */
export async function syncOutbox(): Promise<SyncResult> {
  if (syncing) return { synced: 0, remaining: (await listOutbox()).length, failed: 0 }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, remaining: (await listOutbox()).length, failed: 0 }
  }

  syncing = true
  let synced = 0
  let failed = 0
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      // Chưa xác thực (token hết hạn khi offline lâu) → để nguyên hàng chờ.
      return { synced: 0, remaining: (await listOutbox()).length, failed: 0 }
    }
    const { data: profile, error: profileErr } = await supabase
      .from("users")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle()
    if (profileErr) console.error("[offline] truy vấn lỗi:", profileErr.message)
    const orgId = (profile as { org_id?: string } | null)?.org_id
    if (!orgId) return { synced: 0, remaining: (await listOutbox()).length, failed: 0 }

    const entries = await listOutbox()
    for (const entry of entries) {
      if (entry.status === "error") continue // chờ người dùng xử lý thủ công
      try {
        await createOrderRecords(supabase, entry.payload, { userId: user.id, orgId })
        await removeEntry(entry.id)
        synced++
      } catch (err) {
        if (isTransient(err)) {
          // Mất mạng giữa chừng → dừng, giữ nguyên phần còn lại.
          break
        }
        failed++
        await markEntry(entry.id, {
          status: "error",
          attempts: entry.attempts + 1,
          lastError: err instanceof Error ? err.message : "Lỗi không xác định",
        })
      }
    }
  } finally {
    syncing = false
  }

  const remaining = (await listOutbox()).length
  return { synced, remaining, failed }
}
