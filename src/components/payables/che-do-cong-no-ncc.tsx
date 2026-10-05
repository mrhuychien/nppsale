"use client"

import Link from "@/components/ui/link"
import { cn } from "@/lib/utils"

/**
 * Chuyển giữa hai cách xem Công nợ NCC — từng khoản nợ / gộp theo nhà cung cấp (chủ nhà 05/10/2026: "Phần công nợ
 * NCC thêm phần công nợ theo NCC"). Màn "Theo NCC" vốn có nhưng chỉ là một nút nhỏ cạnh nút tạo — nay là thanh chuyển
 * ở đầu cả hai màn, máy tính lẫn điện thoại.
 */
export function CheDoCongNoNcc({ dangXem, className }: { dangXem: "khoan" | "ncc"; className?: string }) {
  const nut = (key: "khoan" | "ncc", href: string, nhan: string) => (
    <Link
      href={href}
      aria-current={dangXem === key ? "page" : undefined}
      className={cn(
        "flex-1 rounded-lg px-3 py-2 text-center text-sm font-bold transition-colors",
        dangXem === key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {nhan}
    </Link>
  )
  return (
    <nav aria-label="Cách xem công nợ NCC" className={cn("flex gap-1 rounded-xl bg-muted/60 p-1 lg:max-w-sm", className)} data-testid="che-do-cong-no-ncc">
      {nut("khoan", "/payables", "Theo khoản nợ")}
      {nut("ncc", "/payables/by-supplier", "Theo NCC")}
    </nav>
  )
}
