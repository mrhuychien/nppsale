import type { SupabaseClient } from "@supabase/supabase-js"
import type { NotificationType, Role } from "@/types"

interface NotificationInput {
  orgId: string
  userId: string
  type: NotificationType
  title: string
  body?: string
  linkUrl?: string
  metadata?: Record<string, unknown>
}

/**
 * Create a notification for a single user. Safe to call from client code —
 * RLS scopes the row to the current org. Errors are swallowed (logged to
 * console) so background notification creation never breaks the primary
 * action the user just performed.
 */
export async function createNotification(
  supabase: SupabaseClient,
  input: NotificationInput
): Promise<void> {
  try {
    const { error } = await supabase.from("notifications").insert({
      org_id: input.orgId,
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link_url: input.linkUrl ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[notifications] create failed:", error.message)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[notifications] create exception:", err)
  }
}

/**
 * Create the same notification for a list of users.
 */
export async function createNotificationForUsers(
  supabase: SupabaseClient,
  input: Omit<NotificationInput, "userId"> & { userIds: string[] }
): Promise<void> {
  if (input.userIds.length === 0) return
  try {
    const rows = input.userIds.map((uid) => ({
      org_id: input.orgId,
      user_id: uid,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link_url: input.linkUrl ?? null,
      metadata: input.metadata ?? {},
    }))
    const { error } = await supabase.from("notifications").insert(rows)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[notifications] bulk create failed:", error.message)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[notifications] bulk create exception:", err)
  }
}

/**
 * Look up the user ids of all owners/managers in an org. Used to broadcast
 * "order_pending_approval" notifications.
 */
export async function fetchApproversForOrg(
  supabase: SupabaseClient,
  orgId: string
): Promise<string[]> {
  const { data, error: dataErr } = await supabase
    .from("users")
    .select("id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "manager"])
    .eq("is_active", true)
  if (dataErr) console.error("[lib/notifications] truy vấn lỗi:", dataErr.message)
  if (!data) return []
  return (data as Array<{ id: string; role: Role }>).map((u) => u.id)
}
