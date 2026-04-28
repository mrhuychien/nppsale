import { Badge } from "@/components/ui/badge"
import {
  ORDER_STATUS_MAP,
  CUSTOMER_STATUS_MAP,
  DELIVERY_STATUS_MAP,
  RETURN_STATUS_MAP,
  PO_STATUS_MAP,
  PURCHASE_INVOICE_STATUS_MAP,
  PAYMENT_STATUS_MAP,
} from "@/lib/constants"

type StatusType =
  | "order"
  | "customer"
  | "delivery"
  | "return"
  | "po"
  | "purchase_invoice"
  | "payment"

const STATUS_MAPS: Record<StatusType, Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }>> = {
  order: ORDER_STATUS_MAP,
  customer: CUSTOMER_STATUS_MAP,
  delivery: DELIVERY_STATUS_MAP,
  return: RETURN_STATUS_MAP,
  po: PO_STATUS_MAP,
  purchase_invoice: PURCHASE_INVOICE_STATUS_MAP,
  payment: PAYMENT_STATUS_MAP,
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

/**
 * Suy ra trạng thái thanh toán của 1 đơn từ receivable tương ứng.
 *  - null: chưa có receivable (chưa giao hàng) → không hiển thị badge
 *  - "open" / "partial" / "paid" / "overdue"
 */
export function derivePaymentStatus(
  receivable:
    | { amount?: number; paid?: number; status?: string; due_date?: string | null }
    | null
    | undefined
): "open" | "partial" | "paid" | "overdue" | null {
  if (!receivable) return null
  const amount = Number(receivable.amount || 0)
  const paid = Number(receivable.paid || 0)
  const remaining = amount - paid
  // Trust DB-provided status when present, but cross-check with paid
  // amount so a stale row doesn't mislead the UI.
  if (paid <= 0 || remaining >= amount) {
    return receivable.status === "overdue" ? "overdue" : "open"
  }
  if (remaining > 0) {
    return receivable.status === "overdue" ? "overdue" : "partial"
  }
  return "paid"
}

export function PaymentStatusBadge({
  receivable,
}: {
  receivable:
    | { amount?: number; paid?: number; status?: string; due_date?: string | null }
    | null
    | undefined
}) {
  const status = derivePaymentStatus(receivable)
  if (!status) return null
  return <StatusBadge status={status} type="payment" />
}
