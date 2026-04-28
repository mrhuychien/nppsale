import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import type { SalesOrderLineRow } from "@/lib/analytics/sales"

export interface ProductMeta {
  id: string
  sku: string
  name: string
  base_unit: string
}

export interface SalesByProductRow {
  id: string
  sku: string
  name: string
  qty: number
  revenue: number
  returnQty: number
  returnValue: number
  netRevenue: number
}

interface OrderMeta {
  id: string
  order_code: string
  order_date: string
  customer_name?: string
}

interface Props {
  rows: SalesByProductRow[]
  orderLines: SalesOrderLineRow[]
  orderMap: Map<string, OrderMeta>
}

export function SalesByProductView({ rows, orderLines, orderMap }: Props) {
  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      revenue: acc.revenue + r.revenue,
      returnQty: acc.returnQty + r.returnQty,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { qty: 0, revenue: 0, returnQty: 0, returnValue: 0, netRevenue: 0 }
  )

  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "qty", label: "SL Bán", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "rqty", label: "SL Trả", align: "right", render: (r) => r.returnQty.toLocaleString("vi-VN") },
        { key: "rval", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0") },
        { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.qty.toLocaleString("vi-VN"), align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: totals.returnQty.toLocaleString("vi-VN"), align: "right" },
            {
              content: totals.returnValue > 0 ? `-${formatCurrency(totals.returnValue)}` : "0",
              align: "right",
            },
            { content: formatCurrency(totals.netRevenue), align: "right", className: "text-primary" },
          ]}
        />
      }
      expandable={(r) => {
        const lines = orderLines.filter((l) => l.product_id === r.id)
        const grouped = new Map<string, { qty: number; line_total: number }>()
        for (const l of lines) {
          const e = grouped.get(l.order_id) || { qty: 0, line_total: 0 }
          e.qty += Number(l.quantity || 0)
          e.line_total += Number(l.line_total || 0)
          grouped.set(l.order_id, e)
        }
        const drillRows = Array.from(grouped.entries())
          .map(([oid, e]) => {
            const o = orderMap.get(oid)
            return {
              id: oid,
              order_code: o?.order_code || "—",
              order_date: o?.order_date || "",
              customer_name: o?.customer_name || "—",
              qty: e.qty,
              line_total: e.line_total,
            }
          })
          .sort((a, b) => b.line_total - a.line_total)

        return (
          <div className="rounded-md border border-border/40 bg-background/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-emerald-100/60 text-foreground">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hóa đơn</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Khách hàng</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Số lượng</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {drillRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-center text-xs text-muted-foreground">
                      Không có chi tiết
                    </td>
                  </tr>
                ) : (
                  drillRows.map((d) => (
                    <tr key={d.id} className="border-t border-border/30">
                      <td className="px-3 py-1.5 font-mono text-xs text-primary">{d.order_code}</td>
                      <td className="px-3 py-1.5">
                        {d.order_date
                          ? new Date(d.order_date).toLocaleDateString("vi-VN")
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5">{d.customer_name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {d.qty.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatCurrency(d.line_total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      }}
    />
  )
}
