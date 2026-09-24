import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import { hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"

export interface ProfitByProductRow {
  id: string
  sku: string
  name: string
  /** ⚠ Gộp theo nhóm thì lẫn đơn vị — không hiện. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  revenue: number
  cogs: number
  profit: number
  margin: number
}

export function ProfitByProductView({ rows }: { rows: ProfitByProductRow[] }) {
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
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "qty", label: "SL Bán", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
        {
          key: "profit",
          label: "Lợi nhuận",
          align: "right",
          render: (r) => (
            <span className={r.profit >= 0 ? "font-semibold text-tertiary" : "font-semibold text-error"}>
              {formatCurrency(r.profit)}
            </span>
          ),
        },
        {
          key: "margin",
          label: "Biên LN",
          align: "right",
          render: (r) => `${r.margin.toFixed(1)}%`,
        },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 2 },
            { content: hienSLTheoDonVi(tongSLTheoDonVi(rows)), align: "right" },
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
