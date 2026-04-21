import { cn } from "@/lib/utils"
import { InboxIcon } from "lucide-react"

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center page-enter", className)}>
      <div className="mb-6 rounded-2xl bg-muted/50 p-6 ring-1 ring-border/20">
        {icon || <InboxIcon className="h-10 w-10 text-muted-foreground/60" />}
      </div>
      <h3 className="mb-2 text-lg font-bold text-foreground">{title}</h3>
      {description && <p className="mb-6 max-w-md text-sm text-muted-foreground leading-relaxed">{description}</p>}
      {children}
    </div>
  )
}
