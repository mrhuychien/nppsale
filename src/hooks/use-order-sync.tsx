"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useOnlineStatus } from "./use-online-status"
import { listOutbox } from "@/lib/offline/outbox"
import { syncOutbox } from "@/lib/offline/sync"
import { useToast } from "./use-toast"

interface OrderSyncValue {
  online: boolean
  pendingCount: number
  errorCount: number
  syncing: boolean
  syncNow: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<OrderSyncValue | null>(null)

/**
 * Điều phối đồng bộ đơn offline: đếm hàng chờ, tự đẩy khi có mạng lại,
 * và định kỳ thử lại. Mount 1 lần trong DashboardShell.
 */
export function OrderSyncProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus()
  const { toast } = useToast()
  const [pendingCount, setPendingCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const runningRef = useRef(false)

  const refresh = useCallback(async () => {
    const entries = await listOutbox()
    setPendingCount(entries.filter((e) => e.status === "pending").length)
    setErrorCount(entries.filter((e) => e.status === "error").length)
  }, [])

  const syncNow = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setSyncing(true)
    try {
      const before = (await listOutbox()).filter((e) => e.status === "pending").length
      if (before === 0) return
      const res = await syncOutbox()
      if (res.synced > 0) {
        toast({
          title: `Đã đồng bộ ${res.synced} đơn tạo offline`,
          description:
            res.remaining > 0 ? `Còn ${res.remaining} đơn chờ.` : "Tất cả đơn đã lên hệ thống.",
        })
      }
      if (res.failed > 0) {
        toast({
          title: `${res.failed} đơn đồng bộ lỗi`,
          description: "Mở bảng đơn chờ để xem chi tiết và xử lý.",
          variant: "destructive",
        })
      }
    } finally {
      runningRef.current = false
      setSyncing(false)
      await refresh()
    }
  }, [toast, refresh])

  // Đếm lần đầu.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Có mạng trở lại → thử đẩy ngay.
  useEffect(() => {
    if (online) void syncNow()
  }, [online, syncNow])

  // Có mạng + còn đơn chờ → thử lại mỗi 30s.
  useEffect(() => {
    if (!online) return
    const t = setInterval(() => {
      if (pendingCount > 0) void syncNow()
    }, 30000)
    return () => clearInterval(t)
  }, [online, pendingCount, syncNow])

  return (
    <Ctx.Provider value={{ online, pendingCount, errorCount, syncing, syncNow, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useOrderSync(): OrderSyncValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return {
      online: true,
      pendingCount: 0,
      errorCount: 0,
      syncing: false,
      syncNow: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
