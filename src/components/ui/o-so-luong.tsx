"use client"

import { useState } from "react"
import { docSoLuongGo } from "@/lib/ui/so-luong-go"

/**
 * Ô SỐ LƯỢNG GÕ ĐƯỢC giữa nút − / + (điện thoại) — chủ nhà 09/11/2026: "phần số lượng dùng bàn phím numpad và gõ được,
 * ngoài việc +/-". Bàn phím số (`inputMode`), chạm vào là chọn cả số (gõ là thay), xoá trắng rồi gõ được; rời ô khi còn trống
 * / 0 → về số cũ. Luật chữ: `docSoLuongGo`.
 * ⚠ iOS bỏ qua `select()` gọi ngay trong `focus` — đặt lại vùng chọn sau một nhịp.
 */
export function OSoLuong({
  value, onChange, ariaLabel, className, thapPhan = true,
}: {
  value: number
  onChange: (n: number) => void
  ariaLabel: string
  className?: string
  /** Cho gõ số lẻ (bàn phím có dấu thập phân). */
  thapPhan?: boolean
}) {
  const [nhap, setNhap] = useState<string | null>(null)
  return (
    <input
      type="text"
      inputMode={thapPhan ? "decimal" : "numeric"}
      pattern={thapPhan ? undefined : "[0-9]*"}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={ariaLabel}
      value={nhap ?? String(value)}
      onFocus={(e) => {
        const o = e.currentTarget
        setNhap(String(value))
        setTimeout(() => {
          try {
            o.setSelectionRange(0, o.value.length)
          } catch {
            /* ô đã rời trang */
          }
        }, 0)
      }}
      onChange={(e) => {
        const g = docSoLuongGo(e.target.value, thapPhan)
        setNhap(g.chu)
        if (g.so !== null) onChange(g.so)
      }}
      onBlur={() => setNhap(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
      className={className}
    />
  )
}
