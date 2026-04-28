import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"

export interface StockValueRow {
  id: string
  sku: string
  name: string
  category: string
  qty: number
  unit_cost: number
  value: number
  batches: number
}

export function StockValueView({ rows }: { rows: StockValueRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      value: acc.value + r.value,
      batches: acc.batches + r.batches,
    }),
    { qty: 0, value: 0, batches: 0 }
  )

  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "cat", label: "Nhóm hàng", render: (r) => r.category },
        { key: "qty", label: "SL tồn", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
        { key: "cost", label: "Giá vốn TB", align: "right", render: (r) => formatCurrency(r.unit_cost) },
        { key: "val", label: "Giá trị tồn", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.value)}</span> },
        { key: "batches", label: "Số lô", align: "right", render: (r) => r.batches },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.qty.toLocaleString("vi-VN"), align: "right" },
            { content: "—", align: "right" },
            { content: formatCurrency(totals.value), align: "right", className: "text-primary" },
            { content: totals.batches.toLocaleString("vi-VN"), align: "right" },
          ]}
        />
      }
    />
  )
}
