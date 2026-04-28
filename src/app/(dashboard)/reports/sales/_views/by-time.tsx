import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface DayBucket {
  date: string
  label: string
  revenue: number
  returnValue: number
  netRevenue: number
  invoices: { id: string; code: string; time: string; customer: string; total: number }[]
}

export function ByTimeView({ buckets }: { buckets: DayBucket[] }) {
  const totals = buckets.reduce(
    (acc, b) => ({
      revenue: acc.revenue + b.revenue,
      returnValue: acc.returnValue + b.returnValue,
      netRevenue: acc.netRevenue + b.netRevenue,
    }),
    { revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  return (
    <ReportTable
      rows={buckets}
      rowKey={(r) => r.date}
      columns={[
        { key: "time", label: "Thời gian", render: (r) => <span className="font-medium text-primary">{r.label}</span> },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "ret", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0") },
        { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `Số ngày: ${buckets.length}` },
            { content: formatCurrency(totals.revenue), align: "right" },
            {
              content: totals.returnValue > 0 ? `-${formatCurrency(totals.returnValue)}` : "0",
              align: "right",
            },
            { content: formatCurrency(totals.netRevenue), align: "right", className: "text-primary" },
          ]}
        />
      }
      expandable={(r) => (
        <div className="rounded-md border border-border/40 bg-background/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-emerald-100/60">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hóa đơn</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Khách hàng</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {r.invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                    Không có hóa đơn
                  </td>
                </tr>
              ) : (
                r.invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-border/30">
                    <td className="px-3 py-1.5 font-mono text-xs text-primary">{inv.code}</td>
                    <td className="px-3 py-1.5">{inv.time}</td>
                    <td className="px-3 py-1.5">{inv.customer}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatCurrency(inv.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    />
  )
}
