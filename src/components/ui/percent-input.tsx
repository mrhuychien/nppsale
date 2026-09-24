"use client"

import * as React from "react"

/**
 * Ô nhập PHẦN TRĂM (giảm giá %) — có phần lẻ ("2,5"), khác `MoneyInput`.
 *
 * ⚠ GIỮ CHUỖI ĐANG GÕ. Ô cũ đổi ngay chuỗi ra số rồi in lại, nên gõ "2," hay
 *   "2." là mất dấu phẩy — không gõ được 2,5%.
 * ⚠ ĐANG GÕ MÀ LÀ 0 THÌ Ô TRỐNG (chủ nhà 24/09/2026: "ấn vào thì mất số 0 chỉ
 *   việc gõ số") — cùng luật với `MoneyInput`.
 */
export function PercentInput({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number
  onChange: (v: number) => void
}) {
  const [nhap, setNhap] = React.useState<string | null>(null)
  const hien = nhap ?? (value === 0 ? "0" : String(value).replace(".", ","))
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={hien}
      onFocus={(e) => { setNhap(value === 0 ? "" : String(value).replace(".", ",")); props.onFocus?.(e) }}
      onBlur={(e) => { setNhap(null); props.onBlur?.(e) }}
      onChange={(e) => {
        /* Chỉ chữ số và MỘT dấu thập phân (phẩy hoặc chấm). */
        let t = e.target.value.replace(/[^\d.,]/g, "").replace(".", ",")
        const i = t.indexOf(",")
        if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, "")
        setNhap(t)
        onChange(Number(t.replace(",", ".")) || 0)
      }}
    />
  )
}
