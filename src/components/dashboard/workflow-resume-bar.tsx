"use client"

/**
 * Sticky bar hiển thị mọi workflow_session chưa hoàn tất của user
 * hiện tại. Mount cố định trên đầu mọi trang dashboard (layout.tsx)
 * để user resume bất kỳ bước nào ở mọi flow.
 *
 * Auto-refresh qua Supabase Realtime khi:
 *   - User mở 1 workflow mới (insert)
 *   - Form draft update (last_action_at refresh)
 *   - Workflow đóng (closed_at set)
 *
 * Hide khi:
 *   - User chưa login
 *   - Không có session đang mở
 *   - User dismiss bằng "Ẩn tạm" (giấu trong tab session, không lưu DB)
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  listOpenSessions,
  closeWorkflowSession,
  stageLabel,
  entityLabel,
  type WorkflowSession,
} from "@/lib/workflow/sessions"
import { Button } from "@/components/ui/button"
import { Clock, ArrowRight, X, EyeOff, RotateCw } from "lucide-react"

const SESSION_STORAGE_KEY = "ws-resume-bar-hidden"

function isHiddenInTab(): boolean {
  if (typeof window === "undefined") return false
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function setHiddenInTab(v: boolean) {
  try {
    if (v) sessionStorage.setItem(SESSION_STORAGE_KEY, "1")
    else sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // sessionStorage có thể bị block — bỏ qua.
  }
}

export function WorkflowResumeBar() {
  const { user } = useAuth()
  const pathname = usePathname()
  const [sessions, setSessions] = useState<WorkflowSession[]>([])
  const [hidden, setHidden] = useState<boolean>(() => isHiddenInTab())
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!user?.id) return
    setRefreshing(true)
    const supabase = createClient()
    const { data } = await listOpenSessions(supabase, user.id)
    setSessions(data)
    setRefreshing(false)
  }, [user?.id])

  // Initial fetch + Realtime subscribe on workflow_sessions for self.
  useEffect(() => {
    if (!user?.id) return
    refresh()
    const supabase = createClient()
    const channel = supabase
      .channel(`workflow_sessions:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_sessions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Re-fetch on any change. listOpenSessions already filters by
          // closed_at IS NULL so we get a clean live list.
          refresh()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, refresh])

  // Refresh nhẹ khi đổi route — đôi khi Realtime trễ so với router.push.
  useEffect(() => {
    if (!user?.id) return
    refresh()
  }, [pathname, user?.id, refresh])

  if (!user || hidden || sessions.length === 0) return null

  return (
    <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50/95 backdrop-blur supports-[backdrop-filter]:bg-amber-50/80">
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 shrink-0">
          <Clock className="h-3.5 w-3.5" />
          {sessions.length} việc đang dở
        </span>

        <div className="flex items-center gap-2 flex-1 overflow-x-auto">
          {sessions.map((s) => {
            const isHere = s.last_url === pathname
            return (
              <ResumeChip
                key={s.id}
                session={s}
                isHere={isHere}
                onClose={async () => {
                  if (!user) return
                  const supabase = createClient()
                  await closeWorkflowSession(supabase, {
                    userId: user.id,
                    entityType: s.entity_type,
                    entityId: s.entity_id,
                  })
                  refresh()
                }}
              />
            )
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-100"
            title="Làm mới"
          >
            <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setHidden(true)
              setHiddenInTab(true)
            }}
            className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-100"
            title="Ẩn tạm — bar sẽ hiện lại khi mở tab mới"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ResumeChipProps {
  session: WorkflowSession
  isHere: boolean
  onClose: () => Promise<void>
}

function ResumeChip({ session, isHere, onClose }: ResumeChipProps) {
  const stage = stageLabel(session.entity_type, session.stage)
  const label = session.entity_label || entityLabel(session.entity_type)
  return (
    <div
      className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        isHere
          ? "bg-amber-200 border-amber-400 text-amber-900 font-semibold"
          : "bg-white border-amber-200 text-amber-900 hover:border-amber-400"
      }`}
    >
      <span className="font-semibold">{stage}</span>
      <span className="text-amber-700">·</span>
      <span className="truncate max-w-[160px]">{label}</span>
      {isHere ? (
        <span className="text-[10px] text-amber-700 font-medium ml-0.5">
          (đang xem)
        </span>
      ) : (
        <Link
          href={session.last_url}
          className="inline-flex items-center gap-0.5 text-amber-700 hover:text-amber-900 ml-0.5"
        >
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          if (window.confirm(`Đóng việc đang dở "${stage} — ${label}"?`)) {
            onClose()
          }
        }}
        className="text-amber-600 hover:text-rose-600 ml-0.5"
        title="Đóng (đánh dấu hoàn tất)"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
