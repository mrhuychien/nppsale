import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface ProfitByDayRow {
  date: string
  label: string
  revenue: number
  cogs: number
  profit: number
  margin: number
}

export function ProfitByTimeView({ rows }: { rows: ProfitByDayRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { revenue: 0, cogs: 0, profit: 0 }
  )
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.date}
      columns={[
        { key: "time", label: "Thời gian", render: (r) => <span className="font-medium text-primary">{r.label}</span> },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
        {
          key: "profit",
          label: "Lợi nhuận",
          align: "right",
          render: (r) => (
            <span className={r.profit >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
              {formatCurrency(r.profit)}
            </span>
          ),
        },
        { key: "m", label: "Biên LN", align: "right", render: (r) => `${r.margin.toFixed(1)}%` },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `Số ngày: ${rows.length}` },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: formatCurrency(totals.cogs), align: "right" },
            { content: formatCurrency(totals.profit), align: "right", className: "text-primary" },
            { content: `${totalMargin.toFixed(1)}%`, align: "right" },
          ]}
        />
      }
    />
  )
}
