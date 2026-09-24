import { formatCurrency } from "@/lib/utils"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import { hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"

export interface StockMovementRow {
  id: string
  sku: string
  name: string
  /** Tồn đầu kỳ (ước lượng) */
  beginQty: number
  importQty: number
  importValue: number
  exportQty: number
  exportValue: number
  endQty: number
  /** SL theo từng đơn vị cơ sở — số `…Qty` gộp nhóm thì lẫn đơn vị, không hiện. */
  beginTheoDv: SLTheoDonVi
  importTheoDv: SLTheoDonVi
  exportTheoDv: SLTheoDonVi
  endTheoDv: SLTheoDonVi
}

interface DetailLine {
  date: string
  type: "import" | "export" | "stocktake" | "transfer"
  doc: string
  qty: number
  /** Đơn vị cơ sở của mặt hàng trên dòng. */
  unit?: string
  unit_cost: number
}

interface Props {
  rows: StockMovementRow[]
  detail?: boolean
  detailLines?: Map<string, DetailLine[]>
}

export function StockMovementView({ rows, detail = false, detailLines }: Props) {
  const totals = {
    importValue: rows.reduce((s, r) => s + r.importValue, 0),
    exportValue: rows.reduce((s, r) => s + r.exportValue, 0),
  }
  // SL dòng tổng: gộp theo đơn vị cơ sở.
  const tong = {
    begin: tongSLTheoDonVi(rows, (r) => r.beginTheoDv),
    import: tongSLTheoDonVi(rows, (r) => r.importTheoDv),
    export: tongSLTheoDonVi(rows, (r) => r.exportTheoDv),
    end: tongSLTheoDonVi(rows, (r) => r.endTheoDv),
  }

  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "sku", label: "Mã hàng", render: (r) => <span className="font-medium text-primary">{r.sku}</span> },
        { key: "name", label: "Tên hàng", render: (r) => r.name },
        { key: "begin", label: "Tồn đầu", align: "right", render: (r) => hienSLTheoDonVi(r.beginTheoDv) },
        { key: "iq", label: "SL nhập", align: "right", render: (r) => hienSLTheoDonVi(r.importTheoDv) },
        { key: "iv", label: "Giá trị nhập", align: "right", render: (r) => formatCurrency(r.importValue) },
        { key: "eq", label: "SL xuất", align: "right", render: (r) => hienSLTheoDonVi(r.exportTheoDv) },
        { key: "ev", label: "Giá trị xuất", align: "right", render: (r) => formatCurrency(r.exportValue) },
        { key: "end", label: "Tồn cuối", align: "right", render: (r) => <span className="font-semibold">{hienSLTheoDonVi(r.endTheoDv)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL mặt hàng: ${rows.length}`, colSpan: 2 },
            { content: hienSLTheoDonVi(tong.begin), align: "right" },
            { content: hienSLTheoDonVi(tong.import), align: "right" },
            { content: formatCurrency(totals.importValue), align: "right" },
            { content: hienSLTheoDonVi(tong.export), align: "right" },
            { content: formatCurrency(totals.exportValue), align: "right" },
            { content: hienSLTheoDonVi(tong.end), align: "right", className: "text-primary" },
          ]}
        />
      }
      expandable={
        detail && detailLines
          ? (r) => {
              const lines = detailLines.get(r.id) || []
              return (
                <div className="rounded-md border border-border/40 bg-background/60">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#ecfdf3]/60">
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Thời gian</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Loại</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Chứng từ</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá vốn</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-2 text-center text-xs text-muted-foreground">
                            Không có biến động trong kỳ
                          </td>
                        </tr>
                      ) : (
                        lines
                          .slice()
                          .sort((a, b) => a.date.localeCompare(b.date))
                          .map((l, i) => (
                            <tr key={i} className="border-t border-border/30">
                              <td className="px-3 py-1.5">
                                {new Date(l.date).toLocaleDateString("vi-VN")}
                              </td>
                              <td className="px-3 py-1.5">
                                <span
                                  className={
                                    l.type === "import"
                                      ? "text-tertiary"
                                      : l.type === "export"
                                        ? "text-error"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {l.type === "import"
                                    ? "Nhập"
                                    : l.type === "export"
                                      ? "Xuất"
                                      : l.type === "stocktake"
                                        ? "Kiểm kê"
                                        : "Chuyển"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 font-mono text-xs">{l.doc}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {Math.abs(l.qty).toLocaleString("vi-VN")}
                                {l.unit ? ` ${l.unit}` : ""}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatCurrency(l.unit_cost)}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {formatCurrency(Math.abs(l.qty) * l.unit_cost)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              )
            }
          : undefined
      }
    />
  )
}
