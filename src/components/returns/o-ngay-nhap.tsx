"use client"

/** Ô chọn ngày nhập kho khi hoàn thành phiếu trả tự sinh (mig 211). */

import { loiNgayNhap } from "@/lib/returns/ngay-nhap"

export function ONgayNhap({
  value,
  onChange,
  homNay,
  ngayHoaDon,
}: {
  value: string
  onChange: (v: string) => void
  homNay: string
  ngayHoaDon?: string | null
}) {
  const loi = loiNgayNhap(value, homNay, ngayHoaDon)
  return (
    <label className="grid gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Ngày nhập kho</span>
      <input
        type="date"
        value={value}
        min={ngayHoaDon ?? undefined}
        max={homNay}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Ngày nhập kho"
        className="h-11 rounded-xl border bg-card px-3 text-sm"
      />
      {loi && <span className="text-xs font-semibold text-destructive">{loi}</span>}
    </label>
  )
}
