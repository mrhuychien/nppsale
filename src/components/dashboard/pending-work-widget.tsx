"use client"

/**
 * T-05: PendingWorkWidget — list of the calling user's open workflow
 * sessions ("Việc đang dở"). Each row resumes via `last_url`.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import {
  listOpenSessions,
  stageLabel,
  entityLabel,
  type WorkflowSession,
} from "@/lib/workflow/sessions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return "vừa xong"
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} phút trước`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} giờ trước`
  return `${Math.round(diff / 86_400_000)} ngày trước`
}

export function PendingWorkWidget() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<WorkflowSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    let cancelled = false
    listOpenSessions(supabase, user.id).then(({ data }) => {
      if (cancelled) return
      setSessions(data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  if (!user) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" /> Việc đang dở
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có việc đang dở. Khi bạn mở một quy trình (xuất kho, giao hàng,
            thu tiền…) và rời tab giữa chừng, nó sẽ xuất hiện ở đây.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border bg-muted/10 px-3 py-2 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="warning">
                      {stageLabel(s.entity_type, s.stage)}
                    </Badge>
                    <span className="text-sm font-semibold truncate">
                      {s.entity_label || entityLabel(s.entity_type)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Hoạt động cuối: {formatRelative(s.last_action_at)}
                  </p>
                </div>
                <Link href={s.last_url}>
                  <Button size="sm" variant="outline">
                    Tiếp tục <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
