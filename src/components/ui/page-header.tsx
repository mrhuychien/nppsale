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
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6", className)}>
      <div className="space-y-2 min-w-0">
        {backHref !== undefined && (
          <div>
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors group"
              >
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                <span>{backLabel || "Quay lại"}</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors group"
              >
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                <span>{backLabel || "Quay lại"}</span>
              </button>
            )}
          </div>
        )}
        <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 flex-wrap">{children}</div>}
    </div>
  )
}
