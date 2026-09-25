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
/** Id của khối `<style>` chứa `@page` đang in — xem `datKhoGiay`. */
export const KHO_GIAY_STYLE_ID = "npp-kho-giay-in"

/** `@page` cho từng khổ — lề A4 phóng theo đúng tỉ lệ khổ (≈1,41 × A5). */
export const PAGE_RULE: Record<PaperSize, string> = {
  A5: "@page { size: A5 portrait; margin: 8mm; }",
  A4: "@page { size: A4 portrait; margin: 11mm; }",
}

/**
 * Đặt khổ giấy THẬT cho lần in.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "khi chọn khổ A4, tự giãn ra đầy trang". Bản cũ khai
 *   `html[data-paper-size="A4"] @page { size: A4 }` trong CSS — CSS KHÔNG cho lồng
 *   `@page` trong bộ chọn, trình duyệt bỏ nguyên quy tắc: chọn A4 vẫn ra trang
 *   148 × 210 mm (đo bằng PDF), in giấy A4 thì nội dung co một góc. Cách hợp lệ
 *   duy nhất đổi `@page` lúc chạy là một khối `<style>` riêng — nó đứng sau CSS
 *   chung nên thắng.
 */
export function datKhoGiay(size: PaperSize, doc: Document = document): () => void {
  const html = doc.documentElement
  const previous = html.getAttribute("data-paper-size")
  if (size === "A4") html.setAttribute("data-paper-size", "A4")
  else html.removeAttribute("data-paper-size")
  doc.getElementById(KHO_GIAY_STYLE_ID)?.remove()
  const st = doc.createElement("style")
  st.id = KHO_GIAY_STYLE_ID
  st.textContent = `@media print { ${PAGE_RULE[size]} }`
  doc.head.appendChild(st)
  return () => {
    st.remove()
    if (previous == null) html.removeAttribute("data-paper-size")
    else html.setAttribute("data-paper-size", previous)
  }
}

export function printWithPaper(size: PaperSize): void {
  const traLai = datKhoGiay(size)
  requestAnimationFrame(() => {
    window.print()
    setTimeout(traLai, 200)
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
