import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type IconSize = 16 | 18 | 20 | 24

interface IconProps {
  icon: LucideIcon
  size?: IconSize
  className?: string
}

/**
 * Standardized Lucide wrapper that mirrors the Material Symbols Outlined
 * weight used in the Stitch mockups (strokeWidth 1.75 → matches outlined
 * 400 weight). Use the `size` prop instead of arbitrary tailwind sizes so
 * icon scaling stays consistent across the app.
 */
export function Icon({ icon: IconComponent, size = 20, className }: IconProps) {
  return (
    <IconComponent
      size={size}
      strokeWidth={1.75}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    />
  )
}
