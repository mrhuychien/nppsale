"use client"

import { useEffect, useState } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { useOrderSync } from "@/hooks/use-order-sync"
import { listOutbox, removeEntry, type OutboxEntry } from "@/lib/offline/outbox"
import { formatCurrency } from "@/lib/utils"
import { WifiOff, CloudUpload, RefreshCw, AlertTriangle, Trash2, CheckCircle2 } from "lucide-react"

/**
 * Hiển thị ở header: trạng thái ngoại tuyến + số đơn tạo offline đang
 * chờ đẩy. Bấm để xem danh sách, đẩy ngay, hoặc xoá đơn lỗi.
 * Ẩn hoàn toàn khi đang online và không có đơn chờ.
 */
export function OfflineIndicator() {
  const { online, pendingCount, errorCount, syncing, syncNow, refresh } = useOrderSync()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<OutboxEntry[]>([])

  const total = pendingCount + errorCount

  useEffect(() => {
    if (open) listOutbox().then(setEntries)
  }, [open, pendingCount, errorCount])

  // Online + không có gì chờ → không hiển thị gì.
  if (online && total === 0) return null

  const handleDelete = async (id: string) => {
    await removeEntry(id)
    await refresh()
    setEntries(await listOutbox())
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            !online
              ? "bg-amber-100 text-amber-700"
              : errorCount > 0
                ? "bg-error-container text-on-error-container"
                : "bg-primary/10 text-primary"
          }`}
          title={online ? "Đơn chờ đồng bộ" : "Đang ngoại tuyến"}
        >
          {!online ? (
            <>
              <WifiOff className="h-4 w-4" />
              <span className="hidden sm:inline">Ngoại tuyến</span>
            </>
          ) : (
            <>
              <CloudUpload className="h-4 w-4" />
              <span className="hidden sm:inline">Đơn chờ</span>
            </>
          )}
          {total > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-current px-1 text-[10px] font-bold text-white">
              {total}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <div>
            <p className="text-sm font-semibold">Đơn tạo ngoại tuyến</p>
            <p className="text-[11px] text-muted-foreground">
              {online ? "Đang có mạng" : "Mất mạng — sẽ tự đẩy khi có mạng lại"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!online || syncing || pendingCount === 0}
            onClick={() => syncNow()}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Đẩy ngay
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 text-success" />
              Không có đơn nào đang chờ.
            </div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 border-b p-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.payload.meta.customerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.payload.order.order_code} • {e.payload.meta.lineCount} SP •{" "}
                    {formatCurrency(e.payload.meta.total)}
                  </p>
                  {e.status === "error" && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-error">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {e.lastError || "Đồng bộ lỗi"}
                    </p>
                  )}
                </div>
                {e.status === "error" ? (
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="shrink-0 rounded-md p-1.5 text-error hover:bg-error-container"
                    title="Xoá đơn lỗi này"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Chờ
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
