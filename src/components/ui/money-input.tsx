"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Numeric value backing the input (the "real" number, not the formatted text). */
  value: number | string | null | undefined
  /** Called with the parsed number whenever the user types. NaN → 0. */
  onChange: (value: number) => void
  /** Show "đ" suffix at the right side. Default true. */
  showSuffix?: boolean
}

/**
 * Input chuyên cho tiền VND. Tự động chèn dấu phẩy nhóm hàng nghìn khi
 * user gõ ("1500000" → "1,500,000") và emit số nguyên thuần qua onChange.
 *
 * Nguyên tắc:
 *  - Mọi ký tự không phải số đều bị strip ngay khi parse.
 *  - Caret position được giữ tương đối (không nhảy về cuối) bằng cách
 *    đếm số digit trước caret rồi đặt lại sau khi format.
 *  - Hỗ trợ value rỗng để render placeholder.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    { value, onChange, showSuffix = true, className, ...props },
    forwardedRef
  ) {
    const innerRef = React.useRef<HTMLInputElement | null>(null)
    const setRef = (el: HTMLInputElement | null) => {
      innerRef.current = el
      if (typeof forwardedRef === "function") forwardedRef(el)
      else if (forwardedRef) {
        ;(forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      }
    }

    const numericValue = (() => {
      if (value === null || value === undefined || value === "") return ""
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d-]/g, ""))
      if (!Number.isFinite(n)) return ""
      return n
    })()
    const display =
      numericValue === ""
        ? ""
        : new Intl.NumberFormat("vi-VN").format(numericValue as number)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      // Đếm digit trước caret để khôi phục vị trí sau khi format lại.
      const caret = e.target.selectionStart ?? raw.length
      const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length

      const digitsOnly = raw.replace(/\D/g, "")
      const parsed = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10)
      onChange(Number.isFinite(parsed) ? parsed : 0)

      // Đặt caret sau khi React render xong giá trị mới.
      requestAnimationFrame(() => {
        const node = innerRef.current
        if (!node) return
        const formatted = node.value
        let pos = 0
        let seen = 0
        while (pos < formatted.length && seen < digitsBeforeCaret) {
          if (/\d/.test(formatted[pos])) seen++
          pos++
        }
        node.setSelectionRange(pos, pos)
      })
    }

    return (
      <div className={cn("relative", className)}>
        <input
          ref={setRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          {...props}
          value={display}
          onChange={handleChange}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            showSuffix ? "pr-7 text-right" : "",
            (props as { className?: string }).className
          )}
        />
        {showSuffix ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
            đ
          </span>
        ) : null}
      </div>
    )
  }
)
