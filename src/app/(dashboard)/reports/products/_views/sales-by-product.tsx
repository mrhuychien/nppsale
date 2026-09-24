import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import { soLuongCoSoDongHd, type InvoiceLineRow } from "@/lib/analytics/sales"
import type { SanPhamQuyDoi } from "@/lib/analytics/units"
import { hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"

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
  /** Đơn vị cơ sở ("" khi gộp theo nhóm) — `qty`/`returnQty` đã quy về nó. */
  unit: string
  /** ⚠ Gộp theo nhóm thì lẫn đơn vị — chỉ để sắp xếp / xuất dòng một mặt hàng. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  revenue: number
  returnQty: number
  returnQtyTheoDv: SLTheoDonVi
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
  orderLines: InvoiceLineRow[]
  orderMap: Map<string, OrderMeta>
  /** Để quy SL dòng về đơn vị cơ sở khi mở chi tiết. */
  productMap: ReadonlyMap<string, SanPhamQuyDoi>
}

/** SL kèm đơn vị cơ sở, vd "640 hộp". */
function slDonVi(qty: number, unit: string): string {
  const s = qty.toLocaleString("vi-VN")
  return unit ? `${s} ${unit}` : s
}

export function SalesByProductView({ rows, orderLines, orderMap, productMap }: Props) {
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  // SL dòng tổng (nhiều mặt hàng): gộp theo đơn vị cơ sở, không cộng hộp + chai.
  const tongSL = tongSLTheoDonVi(rows)
  const tongSLTra = tongSLTheoDonVi(rows, (r) => r.returnQtyTheoDv)

  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "qty", label: "SL Bán", align: "right", render: (r) => hienSLTheoDonVi(r.qtyTheoDv) },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "rqty", label: "SL Trả", align: "right", render: (r) => hienSLTheoDonVi(r.returnQtyTheoDv) },
        { key: "rval", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0") },
        { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 3 },
            { content: hienSLTheoDonVi(tongSL), align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: hienSLTheoDonVi(tongSLTra), align: "right" },
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
          const e = grouped.get(l.invoice_id) || { qty: 0, line_total: 0 }
          // SL dòng (thùng/khay…) quy về đơn vị cơ sở trước khi cộng.
          e.qty += soLuongCoSoDongHd(l, productMap.get(l.product_id))
          e.line_total += Number(l.line_total || 0)
          grouped.set(l.invoice_id, e)
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
                <tr className="bg-[#ecfdf3]/60 text-foreground">
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
                        {slDonVi(d.qty, r.unit)}
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
