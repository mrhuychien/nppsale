import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface EmployeeRow {
  id: string
  name: string
  role: string
  orders: number
  revenue: number
  cogs: number
  profit: number
  aov: number
}

export function EmployeeView({ rows }: { rows: EmployeeRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Nhân viên", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "role", label: "Vai trò", render: (r) => r.role },
        { key: "orders", label: "Số đơn", align: "right", render: (r) => r.orders },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
        {
          key: "profit",
          label: "Lợi nhuận",
          align: "right",
          render: (r) => <span className="font-semibold text-tertiary">{formatCurrency(r.profit)}</span>,
        },
        { key: "aov", label: "TB/đơn", align: "right", render: (r) => formatCurrency(r.aov) },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL nhân viên: ${rows.length}`, colSpan: 2 },
            { content: totals.orders, align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: formatCurrency(totals.cogs), align: "right" },
            { content: formatCurrency(totals.profit), align: "right", className: "text-primary" },
            {
              content: formatCurrency(totals.orders > 0 ? totals.revenue / totals.orders : 0),
              align: "right",
            },
          ]}
        />
      }
    />
  )
}
