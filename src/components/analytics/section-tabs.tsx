"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

export interface SectionTab {
  label: string
  href: string
}

interface Props {
  tabs: SectionTab[]
  className?: string
}

/**
 * Compact horizontal tab strip used at the top of grouped report /
 * analytics pages so the user can switch between sibling pages without
 * a vertical sidebar.
 */
export function SectionTabs({ tabs, className }: Props) {
  const pathname = usePathname()
  // Pick the tab whose href matches the longest prefix of pathname so that
  // sibling tabs sharing a common parent (e.g. /reports/finance and
  // /reports/finance/pnl) never both light up.
  let bestIdx = -1
  let bestLen = -1
  tabs.forEach((t, i) => {
    if (pathname === t.href || pathname.startsWith(t.href + "/")) {
      if (t.href.length > bestLen) {
        bestLen = t.href.length
        bestIdx = i
      }
    }
  })
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-xl border border-border/40 bg-card p-1 shadow-sm",
        className
      )}
    >
      {tabs.map((t, i) => {
        const active = i === bestIdx
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/[0.08] text-primary"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
