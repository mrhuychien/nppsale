import { Badge } from "@/components/ui/badge"
import { ORDER_STATUS_MAP, CUSTOMER_STATUS_MAP, DELIVERY_STATUS_MAP, RETURN_STATUS_MAP } from "@/lib/constants"

type StatusType = "order" | "customer" | "delivery" | "return"

const STATUS_MAPS: Record<StatusType, Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }>> = {
  order: ORDER_STATUS_MAP,
  customer: CUSTOMER_STATUS_MAP,
  delivery: DELIVERY_STATUS_MAP,
  return: RETURN_STATUS_MAP,
}

interface StatusBadgeProps {
  status: string
  type: StatusType
}

export function StatusBadge({ status, type }: StatusBadgeProps) {
  const map = STATUS_MAPS[type]
  const config = map[status] || { label: status, variant: "outline" as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
