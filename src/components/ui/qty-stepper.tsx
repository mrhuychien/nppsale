"use client"

import { cn } from "@/lib/utils"

/**
 * Ô nhập số lượng có nút −/+, cả ba phần đều 44px.
 *
 * Nút −/+ cũ là 36×36 và ô số `h-9` (36px) — dưới sàn WCAG 2.5.5, và đây
 * là thứ NVBH bấm nhiều nhất khi đứng trước mặt khách.
 */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  warn,
  className,
  ariaLabel = "Số lượng",
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  /** Viền amber khi có bất thường (vượt tồn, khoá do đã pick…). */
  warn?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      className={cn(
        "flex items-stretch rounded-xl border",
        warn ? "border-[#fdb022]" : "border-outline-variant",
        className
      )}
    >
      <button
        type="button"
        aria-label="Giảm số lượng"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="h-11 w-11 shrink-0 rounded-l-xl text-xl font-semibold text-on-surface-variant active:bg-surface-container-high disabled:opacity-40"
      >
        −
      </button>
      <input
        // type="text" + inputMode="numeric": type="number" trên iOS hiện
        // bàn phím có cả dấu chấm và e, và cuộn trang làm đổi giá trị.
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "")
          // Chuỗi rỗng (người vừa xoá hết) KHÔNG được thành `min` ngay —
          // làm thế thì không xoá để gõ lại được. Giữ nguyên tới khi rời ô.
          if (digits === "") return
          const n = parseInt(digits, 10)
          onChange(Number.isFinite(n) ? Math.max(min, n) : min)
        }}
        // Chạm vào ô là bôi đen sẵn: NVBH gõ "24" đè lên "1" thay vì phải
        // xoá trước. Chi tiết nhỏ nhưng lặp lại ở mọi dòng hàng.
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 w-14 min-w-0 border-x border-inherit bg-transparent text-center text-base font-bold tabular-nums outline-none"
        aria-label={ariaLabel}
      />
      <button
        type="button"
        aria-label="Tăng số lượng"
        onClick={() => onChange(value + 1)}
        className="h-11 w-11 shrink-0 rounded-r-xl text-xl font-semibold text-on-surface-variant active:bg-surface-container-high"
      >
        +
      </button>
    </div>
  )
}
