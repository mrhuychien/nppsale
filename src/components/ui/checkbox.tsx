"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      /* Ô 16×16 là vùng chạm NHỎ NHẤT trong app (đo được 107 vùng chạm
         dưới 44px riêng ở /orders, tệ nhất là checkbox chọn đơn 16×16).
         Không phóng to ô vuông (xấu và phá layout bảng) — mở rộng vùng
         chạm bằng pseudo-element vô hình 44×44 bao quanh, chỉ trên mobile.
         `relative` là bắt buộc để `after:absolute` neo vào chính ô này. */
      "peer relative h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background " +
        "after:absolute after:-inset-3.5 after:content-[''] lg:after:hidden " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
        "disabled:cursor-not-allowed disabled:opacity-50 " +
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
