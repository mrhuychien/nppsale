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
    if (approvedBy) return <Badge variant="success">Đã duyệt</Badge>
    if (status === "confirmed") return <Badge variant="success">Tự động duyệt</Badge>
    return null
  }

  if (total < APPROVAL_THRESHOLDS.AUTO_APPROVE) {
    return <Badge variant="outline">Tự động duyệt (&lt; {formatCurrency(APPROVAL_THRESHOLDS.AUTO_APPROVE)})</Badge>
  }
  if (total < APPROVAL_THRESHOLDS.MANAGER_APPROVE) {
    return <Badge variant="warning">Cần Manager duyệt</Badge>
  }
  return <Badge variant="danger">Cần Owner duyệt (&gt; {formatCurrency(APPROVAL_THRESHOLDS.MANAGER_APPROVE)})</Badge>
}
