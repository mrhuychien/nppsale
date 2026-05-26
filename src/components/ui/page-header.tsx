"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
  backHref?: string
  backLabel?: string
}

export function PageHeader({
  title,
  description,
  children,
  className,
  backHref,
  backLabel,
}: PageHeaderProps) {
  const router = useRouter()

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-card-gap page-enter", className)}>
      <div className="space-y-2 min-w-0">
        {backHref !== undefined && (
          <div className="mb-1">
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant hover:text-primary transition-colors group"
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
                <span>{backLabel || "Quay lại"}</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-on-surface-variant hover:text-primary transition-colors group"
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
                <span>{backLabel || "Quay lại"}</span>
              </button>
            )}
          </div>
        )}
        <h1 className="text-2xl lg:text-headline-xl font-bold tracking-tight text-on-surface leading-tight">{title}</h1>
        {description && <p className="text-sm text-on-surface-variant">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 flex-wrap">{children}</div>}
    </div>
  )
}
