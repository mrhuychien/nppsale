import { Badge } from "@/components/ui/badge"
import { APPROVAL_THRESHOLDS } from "@/lib/constants"
import { formatCurrency } from "@/lib/utils"

interface ApprovalBadgeProps {
  total: number
  status: string
  approvedBy?: string | null
}

export function ApprovalBadge({ total, status, approvedBy }: ApprovalBadgeProps) {
  if (status !== "draft") {
    if (approvedBy) return <Badge variant="success">Da duyet</Badge>
    if (status === "confirmed") return <Badge variant="success">Tu dong duyet</Badge>
    return null
  }

  if (total < APPROVAL_THRESHOLDS.AUTO_APPROVE) {
    return <Badge variant="outline">Tu dong duyet (&lt; {formatCurrency(APPROVAL_THRESHOLDS.AUTO_APPROVE)})</Badge>
  }
  if (total < APPROVAL_THRESHOLDS.MANAGER_APPROVE) {
    return <Badge variant="warning">Can Manager duyet</Badge>
  }
  return <Badge variant="danger">Can Owner duyet (&gt; {formatCurrency(APPROVAL_THRESHOLDS.MANAGER_APPROVE)})</Badge>
}
