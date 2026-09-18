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

type PaperSize = "A5" | "A4"

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
  const print = (size: PaperSize) => {
    const html = document.documentElement
    const previous = html.getAttribute("data-paper-size")
    if (size === "A4") html.setAttribute("data-paper-size", "A4")
    else html.removeAttribute("data-paper-size")
    // Defer print so the attribute change settles before the dialog
    requestAnimationFrame(() => {
      window.print()
      // Reset after the print dialog closes
      setTimeout(() => {
        if (previous == null) html.removeAttribute("data-paper-size")
        else html.setAttribute("data-paper-size", previous)
      }, 200)
    })
  }

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
