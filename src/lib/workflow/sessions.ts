/**
 * T-05: workflow_sessions client helpers.
 *
 * Used by `useWorkflowSession` to upsert / close session rows. Direct
 * function calls for non-React surfaces (e.g. server actions, scripts).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type WorkflowEntityType =
  | "sales_order"
  | "stock_entry"
  | "delivery"
  | "driver_handover"

export interface WorkflowSession {
  id: string
  org_id: string
  user_id: string
  entity_type: WorkflowEntityType
  entity_id: string
  stage: string
  last_url: string
  form_draft: Record<string, unknown>
  entity_label: string | null
  last_action_at: string
  created_at: string
  closed_at: string | null
}

export interface UpsertSessionInput {
  orgId: string
  userId: string
  entityType: WorkflowEntityType
  entityId: string
  stage: string
  lastUrl: string
  entityLabel?: string
  formDraft?: Record<string, unknown>
}

/**
 * Idempotent: inserts a new open session, or updates the existing open
 * one for (user, entity_type, entity_id). Returns the session id.
 */
export async function upsertWorkflowSession(
  supabase: SupabaseClient,
  input: UpsertSessionInput
): Promise<{ id: string | null; error: string | null }> {
  const { data: existing, error: findErr } = await supabase
    .from("workflow_sessions")
    .select("id")
    .eq("user_id", input.userId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("closed_at", null)
    .maybeSingle()

  if (findErr) return { id: null, error: findErr.message }

  if (existing?.id) {
    const update: Record<string, unknown> = {
      stage: input.stage,
      last_url: input.lastUrl,
    }
    if (input.entityLabel !== undefined) update.entity_label = input.entityLabel
    if (input.formDraft !== undefined) update.form_draft = input.formDraft
    const { error } = await supabase
      .from("workflow_sessions")
      .update(update)
      .eq("id", existing.id)
    return { id: existing.id, error: error?.message ?? null }
  }

  const { data: created, error } = await supabase
    .from("workflow_sessions")
    .insert({
      org_id: input.orgId,
      user_id: input.userId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      stage: input.stage,
      last_url: input.lastUrl,
      entity_label: input.entityLabel ?? null,
      form_draft: input.formDraft ?? {},
    })
    .select("id")
    .single()

  return { id: created?.id ?? null, error: error?.message ?? null }
}

/**
 * Mark the open session for (user, entity_type, entity_id) as closed.
 * Safe to call when no open session exists.
 */
export async function closeWorkflowSession(
  supabase: SupabaseClient,
  input: {
    userId: string
    entityType: WorkflowEntityType
    entityId: string
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("workflow_sessions")
    .update({ closed_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("closed_at", null)
  return { error: error?.message ?? null }
}

/**
 * Save form draft (debounced — caller controls the cadence).
 * No-op when no open session exists for the (user, entity).
 */
export async function saveFormDraft(
  supabase: SupabaseClient,
  input: {
    userId: string
    entityType: WorkflowEntityType
    entityId: string
    formDraft: Record<string, unknown>
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("workflow_sessions")
    .update({ form_draft: input.formDraft })
    .eq("user_id", input.userId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("closed_at", null)
  return { error: error?.message ?? null }
}

/**
 * List the calling user's open sessions, newest action first.
 */
export async function listOpenSessions(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: WorkflowSession[]; error: string | null }> {
  const { data, error } = await supabase
    .from("workflow_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("closed_at", null)
    .order("last_action_at", { ascending: false })

  return {
    data: (data as WorkflowSession[]) || [],
    error: error?.message ?? null,
  }
}

/** Human-readable label for a stage code shown in the widget. */
export function stageLabel(_entityType: WorkflowEntityType, stage: string): string {
  const map: Record<string, string> = {
    // stock_entry
    picking_in_progress: "Đang xuất kho",
    collecting_payment: "Đang thu tiền lái xe",
    // delivery
    delivering: "Đang giao",
    // driver_handover (T-07)
    handover_failed_orders: "Bàn giao đơn thất bại",
    handover_received_goods: "Nhận hàng về kho",
    // sales_order
    editing_lines: "Đang sửa dòng đơn",
  }
  return map[stage] ?? stage
}

/** Human-readable entity label fallback. */
export function entityLabel(entityType: WorkflowEntityType): string {
  switch (entityType) {
    case "sales_order":
      return "Đơn hàng"
    case "stock_entry":
      return "Phiếu xuất kho"
    case "delivery":
      return "Chuyến giao"
    case "driver_handover":
      return "Bàn giao lại"
  }
}
