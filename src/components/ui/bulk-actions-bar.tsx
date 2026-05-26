"use client"

import * as React from "react"
import { X } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface BulkAction {
  key: string
  label: string
  icon?: LucideIcon
  onClick: () => void | Promise<void>
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost"
  disabled?: boolean
  loading?: boolean
  /** Tooltip giải thích nếu disabled. */
  disabledReason?: string
}

interface BulkActionsBarProps {
  count: number
  onClear: () => void
  actions: BulkAction[]
  /** Tiếng Việt cho entity, vd "đơn hàng". */
  entityLabel?: string
}

/**
 * Sticky bar hiện ở đáy viewport khi user đã tick chọn ≥1 dòng.
 * Render các action button per-entity (Duyệt, Hủy, …).
 *
 * Mobile: stack actions; desktop: hàng ngang.
 */
export function BulkActionsBar({
  count,
  onClear,
  actions,
  entityLabel,
}: BulkActionsBarProps) {
  if (count === 0) return null

  return (
    <div
      className={cn(
        "fixed bottom-0 inset-x-0 z-40 border-t bg-card shadow-lg",
        "lg:left-72"
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground tabular-nums">
            {count}
          </span>
          <span className="text-sm font-medium">
            {entityLabel
              ? `${entityLabel} đã chọn`
              : "Dòng đã chọn"}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Bỏ chọn
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((a) => {
            const Icon = a.icon
            return (
              <Button
                key={a.key}
                variant={a.variant || "default"}
                size="sm"
                onClick={a.onClick}
                disabled={a.disabled || a.loading}
                title={a.disabled ? a.disabledReason : undefined}
                className="min-w-[88px]"
              >
                {Icon && <Icon className="mr-1.5 h-4 w-4" />}
                {a.loading ? "Đang xử lý..." : a.label}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
