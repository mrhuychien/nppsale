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
}

export function PrintButton({
  label = "In phiếu",
  variant = "outline",
  size = "sm",
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
        <DropdownMenuItem onClick={() => print("A5")}>
          <Check className="h-3.5 w-3.5 mr-2 text-primary" />
          Khổ A5 (mặc định)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => print("A4")}>
          <span className="w-3.5 mr-2" />
          Khổ A4
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
          Chọn cùng khổ trong hộp In nếu trình duyệt hỏi.
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
