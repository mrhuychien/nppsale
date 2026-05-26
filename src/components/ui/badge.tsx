import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary-fixed text-on-primary-fixed-variant",
        secondary: "bg-surface-container-low text-on-surface-variant",
        destructive: "bg-error-container text-on-error-container",
        outline: "border border-outline-variant text-on-surface-variant",
        success: "bg-[#ecfdf3] text-[#027a48]",
        warning: "bg-[#fff4ed] text-[#b54708]",
        danger: "bg-error-container text-on-error-container",
        info: "bg-[#eff8ff] text-[#175cd3]",
        draft: "bg-surface-container text-on-surface-variant",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
