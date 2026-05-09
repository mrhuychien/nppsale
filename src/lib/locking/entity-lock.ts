/**
 * T-06: entity_locks client helpers.
 *
 * The DB is the source of truth (acquire_entity_lock /
 * heartbeat_entity_lock / release_entity_lock RPCs). These wrappers
 * just unify the return shape for the React hook.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Stable string keys reused across call sites. The DB column is
 * free-form text so other features can extend the set without a
 * migration.
 */
export type LockEntityType =
  | "sales_order"
  | "stock_entry"
  | "delivery"
  | "driver_handover"

export interface LockHolder {
  holderId: string
  holderName: string | null
  lockedAt: string
}

export interface AcquireResult {
  /** True when the caller now holds the lock (newly taken or already
   *  theirs from a previous mount). */
  ok: boolean
  /** Always present — when ok=false this is the conflicting holder.
   *  When ok=true this is the caller themselves. */
  holder: LockHolder
}

interface RpcRow {
  ok: boolean
  holder_id: string
  holder_name: string | null
  locked_at: string
}

export async function acquireLock(
  supabase: SupabaseClient,
  entityType: LockEntityType,
  entityId: string
): Promise<{ data: AcquireResult | null; error: string | null }> {
  const { data, error } = await supabase
    .rpc("acquire_entity_lock", {
      p_entity_type: entityType,
      p_entity_id: entityId,
    })
    .single<RpcRow>()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: "Empty response" }
  return {
    data: {
      ok: data.ok,
      holder: {
        holderId: data.holder_id,
        holderName: data.holder_name,
        lockedAt: data.locked_at,
      },
    },
    error: null,
  }
}

export async function heartbeatLock(
  supabase: SupabaseClient,
  entityType: LockEntityType,
  entityId: string
): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc("heartbeat_entity_lock", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: data === true, error: null }
}

export async function releaseLock(
  supabase: SupabaseClient,
  entityType: LockEntityType,
  entityId: string
): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc("release_entity_lock", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: data === true, error: null }
}
