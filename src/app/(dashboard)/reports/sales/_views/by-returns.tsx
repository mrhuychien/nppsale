import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface ReturnSummaryRow {
  id: string
  date: string
  customer: string
  reason: string
  status: string
  amount: number
}

const REASON_LABEL: Record<string, string> = {
  damaged: "Hỏng/vỡ",
  wrong_item: "Sai hàng",
  near_expiry: "Cận date",
  expired: "Hết hạn",
  refused: "Khách từ chối",
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  completed: "Hoàn tất",
}

export function ReturnsView({ rows }: { rows: ReturnSummaryRow[] }) {
  const totals = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "id", label: "Mã trả", render: (r) => <span className="font-mono text-xs text-primary">{r.id.slice(0, 8)}</span> },
        { key: "date", label: "Ngày", render: (r) => new Date(r.date).toLocaleDateString("vi-VN") },
        { key: "cust", label: "Khách hàng", render: (r) => r.customer },
        { key: "reason", label: "Lý do", render: (r) => REASON_LABEL[r.reason] || r.reason || "—" },
        { key: "status", label: "Trạng thái", render: (r) => STATUS_LABEL[r.status] || r.status },
        { key: "amt", label: "Giá trị trả", align: "right", render: (r) => <span className="font-semibold text-error">{formatCurrency(r.amount)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL phiếu trả: ${rows.length}`, colSpan: 5 },
            { content: formatCurrency(totals), align: "right", className: "text-error" },
          ]}
        />
      }
    />
  )
}
