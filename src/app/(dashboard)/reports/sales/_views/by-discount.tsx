import { formatCurrency, formatDate } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface DiscountRow {
  id: string
  order_code: string
  order_date: string
  customer: string
  subtotal: number
  discount: number
  total: number
  pct: number
}

export function DiscountView({ rows }: { rows: DiscountRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      subtotal: acc.subtotal + r.subtotal,
      discount: acc.discount + r.discount,
      total: acc.total + r.total,
    }),
    { subtotal: 0, discount: 0, total: 0 }
  )
  const totalPct = totals.subtotal > 0 ? (totals.discount / totals.subtotal) * 100 : 0
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "code", label: "Mã hóa đơn", render: (r) => <span className="font-medium text-primary">{r.order_code}</span> },
        { key: "date", label: "Ngày", render: (r) => formatDate(r.order_date) },
        { key: "cust", label: "Khách hàng", render: (r) => r.customer },
        { key: "sub", label: "Tạm tính", align: "right", render: (r) => formatCurrency(r.subtotal) },
        {
          key: "disc",
          label: "Giảm giá",
          align: "right",
          render: (r) => <span className="font-semibold text-red-600">-{formatCurrency(r.discount)}</span>,
        },
        { key: "tot", label: "Thành tiền", align: "right", render: (r) => formatCurrency(r.total) },
        { key: "pct", label: "% giảm", align: "right", render: (r) => `${r.pct.toFixed(1)}%` },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL hóa đơn: ${rows.length}`, colSpan: 3 },
            { content: formatCurrency(totals.subtotal), align: "right" },
            { content: `-${formatCurrency(totals.discount)}`, align: "right", className: "text-red-600" },
            { content: formatCurrency(totals.total), align: "right", className: "text-primary" },
            { content: `${totalPct.toFixed(1)}%`, align: "right" },
          ]}
        />
      }
    />
  )
}
