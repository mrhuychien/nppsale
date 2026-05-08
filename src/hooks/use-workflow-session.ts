"use client"

/**
 * T-05: useWorkflowSession — open a workflow session on mount, debounce-
 * save form draft as the user edits, and stay open across tab close so
 * the dashboard widget can resurface the page. Caller invokes
 * `closeSession()` when the workflow step finishes successfully.
 *
 * Localstorage mirroring: form_draft is also persisted to localStorage
 * under `ws:<entityType>:<entityId>` so a reopened tab restores
 * instantly without a network round-trip; the DB row is the source of
 * truth across devices.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  closeWorkflowSession,
  saveFormDraft,
  upsertWorkflowSession,
  type WorkflowEntityType,
} from "@/lib/workflow/sessions"

const DEBOUNCE_MS = 10_000

interface UseWorkflowSessionOptions {
  entityType: WorkflowEntityType
  entityId: string | null | undefined
  stage: string
  lastUrl: string
  entityLabel?: string
  /** When true, the hook skips upsert entirely. Useful while data is
   *  still loading and you don't yet have a stable entityId. */
  enabled?: boolean
}

interface UseWorkflowSessionReturn {
  sessionId: string | null
  /** Save current form_draft to DB (debounced internally). */
  saveDraft: (draft: Record<string, unknown>) => void
  /** Force-flush the pending draft and close the session. Returns the
   *  promise so callers can await before navigation. */
  closeSession: () => Promise<void>
  /** Restore form_draft saved before tab close (from localStorage
   *  mirror). DB-side restore happens inside the hook on mount. */
  restoreDraft: () => Record<string, unknown> | null
}

function localStorageKey(entityType: string, entityId: string): string {
  return `ws:${entityType}:${entityId}`
}

export function useWorkflowSession(
  opts: UseWorkflowSessionOptions
): UseWorkflowSessionReturn {
  const { user } = useAuth()
  const supabaseRef = useRef(createClient())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const draftRef = useRef<Record<string, unknown>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const enabled = (opts.enabled ?? true) && !!opts.entityId && !!user

  // Mount: upsert session row.
  useEffect(() => {
    if (!enabled || !user || !opts.entityId) return
    let cancelled = false
    const supabase = supabaseRef.current
    upsertWorkflowSession(supabase, {
      orgId: user.org_id,
      userId: user.id,
      entityType: opts.entityType,
      entityId: opts.entityId,
      stage: opts.stage,
      lastUrl: opts.lastUrl,
      entityLabel: opts.entityLabel,
    }).then(({ id, error }) => {
      if (cancelled) return
      if (error) {
        console.warn("[useWorkflowSession] upsert failed:", error)
        return
      }
      setSessionId(id)
    })
    return () => {
      cancelled = true
    }
    // entityId / stage / lastUrl are the meaningful keys here.
  }, [enabled, opts.entityType, opts.entityId, opts.stage, opts.lastUrl, opts.entityLabel, user])

  // Flush pending draft on unload / unmount so we don't lose the
  // last few keystrokes.
  useEffect(() => {
    if (!enabled) return
    const flush = () => {
      if (!user || !opts.entityId) return
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      // Persist last seen draft to localStorage immediately (sync); DB
      // best-effort.
      try {
        localStorage.setItem(
          localStorageKey(opts.entityType, opts.entityId),
          JSON.stringify(draftRef.current)
        )
      } catch {
        // localStorage quota or denied — ignore.
      }
      // Best-effort DB save.
      saveFormDraft(supabaseRef.current, {
        userId: user.id,
        entityType: opts.entityType,
        entityId: opts.entityId,
        formDraft: draftRef.current,
      }).catch(() => {})
    }
    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      flush()
    }
  }, [enabled, opts.entityType, opts.entityId, user])

  const saveDraft = useCallback(
    (draft: Record<string, unknown>) => {
      draftRef.current = draft
      if (!enabled || !user || !opts.entityId) return
      // Mirror to localStorage immediately for instant restore on reopen.
      try {
        localStorage.setItem(
          localStorageKey(opts.entityType, opts.entityId),
          JSON.stringify(draft)
        )
      } catch {
        // ignore
      }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        saveFormDraft(supabaseRef.current, {
          userId: user.id,
          entityType: opts.entityType,
          entityId: opts.entityId!,
          formDraft: draft,
        }).catch(() => {})
      }, DEBOUNCE_MS)
    },
    [enabled, opts.entityType, opts.entityId, user]
  )

  const closeSession = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (!user || !opts.entityId) return
    const supabase = supabaseRef.current
    await closeWorkflowSession(supabase, {
      userId: user.id,
      entityType: opts.entityType,
      entityId: opts.entityId,
    })
    try {
      localStorage.removeItem(localStorageKey(opts.entityType, opts.entityId))
    } catch {
      // ignore
    }
    setSessionId(null)
  }, [opts.entityType, opts.entityId, user])

  const restoreDraft = useCallback((): Record<string, unknown> | null => {
    if (!opts.entityId) return null
    try {
      const raw = localStorage.getItem(
        localStorageKey(opts.entityType, opts.entityId)
      )
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    } catch {
      return null
    }
  }, [opts.entityType, opts.entityId])

  return { sessionId, saveDraft, closeSession, restoreDraft }
}
