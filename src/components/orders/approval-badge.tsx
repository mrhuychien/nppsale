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
    // KHÔNG lặp lại chữ "Đã duyệt" — StatusBadge ngay bên cạnh đã in nhãn
    // đó cho trạng thái `confirmed` (ORDER_STATUS_MAP trong lib/constants).
    // Trước đây hai badge cùng chữ "Đã duyệt" nằm sát nhau, một xanh dương
    // một xanh lá, không ai biết chúng khác nhau chỗ nào.
    // Badge này chỉ nói thêm điều StatusBadge KHÔNG nói: duyệt tay hay tự
    // động.
    if (approvedBy) return <Badge variant="success">Duyệt tay</Badge>
    if (status === "confirmed") return <Badge variant="outline">Tự động duyệt</Badge>
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
