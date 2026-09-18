"use client"

import * as React from "react"
import { Printer, ChevronDown, Check } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Update #2 v2 §4.3 — In khổ A5 default + A4 option.
//
// The CSS in globals.css picks the page size based on
// `<html data-paper-size="A4">`. When the user picks A4 from the
// dropdown we toggle that attribute, call window.print(), and reset
// it back so the next print job defaults to A5 again.

export type PaperSize = "A5" | "A4"

/**
 * Mở cửa sổ in ở một khổ giấy.
 *
 * ⚠ TÁCH RA ĐỂ DÙNG CHUNG, không phải để gọn. Màn soạn hóa đơn bật cửa
 * sổ in ngay sau khi xuất hàng; nếu nó tự viết lại phép này thì một ngày
 * nào đó nút In dùng một đường, in tự động dùng một đường, và chỉ một
 * trong hai đặt đúng khổ giấy.
 *
 * ⚠ TRẢ THUỘC TÍNH VỀ NHƯ CŨ SAU KHI IN. Đặt `data-paper-size="A4"` rồi
 * để nguyên thì mọi lần in sau trên cùng một tab đều ra A4 — kể cả phiếu
 * giao vốn phải là A5.
 */
export function printWithPaper(size: PaperSize): void {
  const html = document.documentElement
  const previous = html.getAttribute("data-paper-size")
  if (size === "A4") html.setAttribute("data-paper-size", "A4")
  else html.removeAttribute("data-paper-size")
  requestAnimationFrame(() => {
    window.print()
    setTimeout(() => {
      if (previous == null) html.removeAttribute("data-paper-size")
      else html.setAttribute("data-paper-size", previous)
    }, 200)
  })
}

interface PrintButtonProps extends Omit<ButtonProps, "onClick"> {
  label?: string
  /**
   * Khổ giấy ưu tiên của chứng từ này.
   *
   * ⚠ A5 HỢP VỚI PHIẾU GIAO, KHÔNG HỢP VỚI MỌI THỨ. Hoá đơn bán hàng có
   * bảy cột; ở A5 chữ rơi xuống 8pt và hai cột tiền dính nhau. Chứng từ
   * nào cần A4 thì khai ở đây, đừng bắt người dùng nhớ mở dropdown mỗi
   * lần in.
   */
  defaultPaper?: PaperSize
}

export function PrintButton({
  label = "In phiếu",
  variant = "outline",
  size = "sm",
  defaultPaper = "A5",
  ...rest
}: PrintButtonProps) {
  const print = printWithPaper

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} {...rest}>
          <Printer className="h-4 w-4 mr-2" />
          {label}
          <ChevronDown className="h-3 w-3 ml-1.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {(["A5", "A4"] as PaperSize[]).map((sz) => (
          <DropdownMenuItem key={sz} onClick={() => print(sz)}>
            {sz === defaultPaper ? (
              <Check className="h-3.5 w-3.5 mr-2 text-primary" />
            ) : (
              <span className="w-3.5 mr-2" />
            )}
            Khổ {sz}
            {sz === defaultPaper ? " (mặc định)" : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
          Chọn cùng khổ trong hộp In nếu trình duyệt hỏi.
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
