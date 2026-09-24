import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import { hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"

export interface StockValueRow {
  id: string
  sku: string
  name: string
  category: string
  /** ⚠ Gộp theo nhóm thì lẫn đơn vị — không hiện. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  /** Giá vốn TB mỗi đơn vị cơ sở; `null` khi dòng gộp nhiều đơn vị cơ sở. */
  unit_cost: number | null
  value: number
  batches: number
}

export function StockValueView({ rows }: { rows: StockValueRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      value: acc.value + r.value,
      batches: acc.batches + r.batches,
    }),
    { value: 0, batches: 0 }
  )

  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "cat", label: "Nhóm hàng", render: (r) => r.category },
        { key: "qty", label: "SL tồn", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
        { key: "cost", label: "Giá vốn TB", align: "right", render: (r) => (r.unit_cost === null ? "—" : formatCurrency(r.unit_cost)) },
        { key: "val", label: "Giá trị tồn", align: "right", render: (r) => <span className="font-semibold">{formatCurrency(r.value)}</span> },
        { key: "batches", label: "Số lô", align: "right", render: (r) => r.batches },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 3 },
            { content: hienSLTheoDonVi(tongSLTheoDonVi(rows)), align: "right" },
            { content: "—", align: "right" },
            { content: formatCurrency(totals.value), align: "right", className: "text-primary" },
            { content: totals.batches.toLocaleString("vi-VN"), align: "right" },
          ]}
        />
      }
    />
  )
}
