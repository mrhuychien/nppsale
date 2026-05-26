"use client"

import * as React from "react"
import { Columns3, Filter, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ListViewOption<K extends string> {
  key: K
  label: string
  /** Cột/filter này luôn bật, không cho user tắt (vd: search box). */
  required?: boolean
}

interface PickerProps<K extends string> {
  /** Toàn bộ option khả dụng (theo thứ tự render). */
  available: readonly ListViewOption<K>[]
  /** Các key đang bật. */
  value: K[]
  onChange: (next: K[]) => void
  onReset?: () => void
  /** Trigger icon button title — vd: "Cột hiển thị", "Bộ lọc". */
  title: string
  /** Icon hiển thị trên trigger. */
  icon: React.ReactNode
}

function Picker<K extends string>({
  available,
  value,
  onChange,
  onReset,
  title,
  icon,
}: PickerProps<K>) {
  const valueSet = React.useMemo(() => new Set(value), [value])
  const onToggle = (key: K, next: boolean) => {
    if (next) {
      // Giữ thứ tự theo `available`
      const order = available.map((o) => o.key)
      const merged = new Set([...value, key])
      onChange(order.filter((k) => merged.has(k)))
    } else {
      onChange(value.filter((k) => k !== key))
    }
  }
  const activeCount = value.length
  const totalCount = available.length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {icon}
          <span className="hidden sm:inline">{title}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {activeCount}/{totalCount}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Mặc định
            </button>
          )}
        </div>
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {available.map((opt) => {
            const checked = valueSet.has(opt.key)
            const locked = !!opt.required
            return (
              <label
                key={opt.key}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  locked
                    ? "cursor-not-allowed text-muted-foreground"
                    : "cursor-pointer hover:bg-muted/40"
                )}
              >
                <Checkbox
                  checked={checked || locked}
                  disabled={locked}
                  onCheckedChange={(v) => onToggle(opt.key, !!v)}
                />
                <span className="flex-1">{opt.label}</span>
                {locked && (
                  <span className="text-[10px] uppercase text-muted-foreground">
                    bắt buộc
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ColumnPicker<K extends string>(props: {
  available: readonly ListViewOption<K>[]
  value: K[]
  onChange: (next: K[]) => void
  onReset?: () => void
}) {
  return (
    <Picker
      {...props}
      title="Cột hiển thị"
      icon={<Columns3 className="h-4 w-4" />}
    />
  )
}

export function FilterPicker<K extends string>(props: {
  available: readonly ListViewOption<K>[]
  value: K[]
  onChange: (next: K[]) => void
  onReset?: () => void
}) {
  return (
    <Picker
      {...props}
      title="Bộ lọc"
      icon={<Filter className="h-4 w-4" />}
    />
  )
}
