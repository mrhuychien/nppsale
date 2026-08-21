"use client"

/**
 * Banner trên /home gợi ý Chủ NPP chạy trình hướng dẫn khi
 * organizations.settings.setup_completed_at chưa được set.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Rocket, ArrowRight, X } from "lucide-react"

export function SetupBanner() {
  const { user } = useAuth()
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!user?.org_id || user.role !== "owner") return
    if (typeof window !== "undefined" && sessionStorage.getItem("setup-banner-dismissed") === "1") {
      setDismissed(true)
      return
    }
    const supabase = createClient()
    let cancelled = false
    ;(async () => {
      const { data, error: dataErr } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", user.org_id)
        .maybeSingle()
      if (dataErr) console.error("[setup/setup-banner] truy vấn lỗi:", dataErr.message)
      if (cancelled) return
      const settings = ((data as { settings?: Record<string, unknown> } | null)?.settings || {}) as Record<string, unknown>
      if (!settings.setup_completed_at) setShow(true)
    })()
    return () => { cancelled = true }
  }, [user?.org_id, user?.role])

  const dismiss = () => {
    setDismissed(true)
    if (typeof window !== "undefined") {
      sessionStorage.setItem("setup-banner-dismissed", "1")
    }
  }

  if (!show || dismissed) return null

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
        <Rocket className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">Hoàn thiện cài đặt NPP</p>
        <p className="text-xs text-muted-foreground">
          Bạn chưa chạy trình hướng dẫn cài đặt ban đầu — cấu hình NPP, quy tắc giá, lương cơ bản.
        </p>
      </div>
      <Link
        href="/setup"
        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Chạy hướng dẫn <ArrowRight className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng"
        className="text-muted-foreground hover:text-foreground p-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
