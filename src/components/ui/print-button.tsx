"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"

/**
 * Mở hộp thoại in của trình duyệt — KHỔ GIẤY DO HỘP THOẠI QUYẾT.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "tao muốn chọn khổ nào thì tràn ra khổ đấy trên hộp thoại in
 *   của trình duyệt". Vì vậy KHÔNG đặt `@page { size }` ở đâu cả: đặt `size` là Chrome
 *   khoá / bỏ qua ô "Khổ giấy" trong hộp thoại. Tờ in tự giãn theo khổ đã chọn nhờ các
 *   khối `@media print and (min-width: …)` trong globals.css — khi in, `width` là bề
 *   rộng vùng in của tờ giấy thật.
 *
 * ⚠ MỘT PHÉP IN, DÙNG CHUNG. Nút In và in tự động (sau khi xuất hàng) cùng đi qua hàm
 *   này — mỗi bên tự viết thì một ngày nào đó hai bên in khác nhau.
 */
export function moHopThoaiIn(): void {
  requestAnimationFrame(() => window.print())
}

interface PrintButtonProps extends Omit<ButtonProps, "onClick"> {
  label?: string
}

export function PrintButton({ label = "In phiếu", variant = "outline", size = "sm", ...rest }: PrintButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      title="Chọn khổ giấy (A5, A4…) trong hộp thoại in — tờ in tự giãn theo khổ"
      onClick={moHopThoaiIn}
      {...rest}
    >
      <Printer className="h-4 w-4 mr-2" />
      {label}
    </Button>
  )
}
