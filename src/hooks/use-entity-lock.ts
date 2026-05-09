"use client"

/**
 * T-06: useEntityLock — pessimistic edit lock with heartbeat + Realtime.
 *
 * Lifecycle:
 *   - mount with `enabled=true` → acquire. State becomes 'mine' or 'other'.
 *   - heartbeat every 60s while mine.
 *   - subscribe to entity_locks Realtime channel; if the row is deleted
 *     externally we flip 'other' → 'released' and try to re-acquire.
 *   - unmount → release (if mine).
 *
 * Realtime channel name: entity_locks:<entityType>:<entityId> — Supabase
 * wraps INSERT/UPDATE/DELETE on the table filtered by these keys.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  acquireLock,
  heartbeatLock,
  releaseLock,
  type AcquireResult,
  type LockEntityType,
  type LockHolder,
} from "@/lib/locking/entity-lock"

const HEARTBEAT_MS = 60_000

export type LockState = "idle" | "acquiring" | "mine" | "other" | "released"

export interface UseEntityLockOptions {
  entityType: LockEntityType
  entityId: string | null | undefined
  /** When false the hook stays idle (no acquire). Use to defer until
   *  data has loaded. */
  enabled?: boolean
}

export interface UseEntityLockReturn {
  state: LockState
  holder: LockHolder | null
  /** Manual re-acquire (e.g. after seeing the holder leave). */
  retry: () => void
  /** Explicit release (e.g. user clicks Cancel). The hook also
   *  releases on unmount when mine. */
  release: () => Promise<void>
}

export function useEntityLock(
  opts: UseEntityLockOptions
): UseEntityLockReturn {
  const { user } = useAuth()
  const supabaseRef = useRef(createClient())
  const [state, setState] = useState<LockState>("idle")
  const [holder, setHolder] = useState<LockHolder | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  const enabled = (opts.enabled ?? true) && !!opts.entityId && !!user

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const startHeartbeat = useCallback(() => {
    if (!opts.entityId) return
    stopHeartbeat()
    heartbeatRef.current = setInterval(async () => {
      const { ok } = await heartbeatLock(
        supabaseRef.current,
        opts.entityType,
        opts.entityId!
      )
      if (!ok) {
        // Lost the lock (stale-cleanup or stolen). Flip to acquiring,
        // which Realtime/retry will resolve.
        stopHeartbeat()
        setState("released")
      }
    }, HEARTBEAT_MS)
  }, [opts.entityType, opts.entityId, stopHeartbeat])

  // Acquire on mount / retry / dependency change.
  useEffect(() => {
    if (!enabled) {
      setState("idle")
      setHolder(null)
      stopHeartbeat()
      return
    }
    let cancelled = false
    setState("acquiring")
    acquireLock(
      supabaseRef.current,
      opts.entityType,
      opts.entityId!
    ).then((res) => {
      if (cancelled) return
      if (res.error || !res.data) {
        // Network / RLS / RPC failure → leave as acquiring so caller
        // sees the spinner; UI should treat this as "other" defensive.
        setState("other")
        setHolder(null)
        return
      }
      const r: AcquireResult = res.data
      setHolder(r.holder)
      if (r.ok) {
        setState("mine")
        startHeartbeat()
      } else {
        stopHeartbeat()
        setState("other")
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled, opts.entityType, opts.entityId, retryToken, startHeartbeat, stopHeartbeat])

  // Realtime subscribe so a release by the holder propagates instantly.
  useEffect(() => {
    if (!enabled || !opts.entityId) return
    const supabase = supabaseRef.current
    const channelName = `entity_locks:${opts.entityType}:${opts.entityId}`
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entity_locks",
          filter: `entity_id=eq.${opts.entityId}`,
        },
        (payload) => {
          // Only react to events for our entity_type — payload.new / .old
          // don't include the type filter at server-side, so filter here.
          const row = (payload.new ?? payload.old) as
            | { entity_type?: string; locked_by?: string }
            | undefined
          if (!row || row.entity_type !== opts.entityType) return
          if (payload.eventType === "DELETE") {
            // Lock cleared — try to take it.
            setState("acquiring")
            setHolder(null)
            setRetryToken((t) => t + 1)
          } else if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            // Someone else just took / refreshed it. Re-acquire to
            // resync our perception.
            setRetryToken((t) => t + 1)
          }
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled, opts.entityType, opts.entityId])

  // Release on unmount when we hold it.
  useEffect(() => {
    const supabase = supabaseRef.current
    return () => {
      stopHeartbeat()
      if (state === "mine" && opts.entityId) {
        // Best-effort; ignore errors.
        releaseLock(supabase, opts.entityType, opts.entityId).catch(() => {})
      }
    }
    // We only want this to run on unmount; capture latest values via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Release on tab close.
  useEffect(() => {
    if (!enabled || !opts.entityId) return
    const handler = () => {
      if (state !== "mine") return
      // navigator.sendBeacon would be nicer but our RPC is auth-bound.
      releaseLock(
        supabaseRef.current,
        opts.entityType,
        opts.entityId!
      ).catch(() => {})
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [enabled, opts.entityType, opts.entityId, state])

  const retry = useCallback(() => {
    setRetryToken((t) => t + 1)
  }, [])

  const release = useCallback(async () => {
    stopHeartbeat()
    if (!opts.entityId) return
    if (state === "mine") {
      await releaseLock(supabaseRef.current, opts.entityType, opts.entityId)
    }
    setState("released")
    setHolder(null)
  }, [opts.entityType, opts.entityId, state, stopHeartbeat])

  return { state, holder, retry, release }
}
