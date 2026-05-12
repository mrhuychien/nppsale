"use client"

/**
 * Per-user payslip — A5 portrait, ready for window.print().
 *
 * Rendered by the payroll runs page into a `.print-payslip-only`
 * section; html[data-print-mode='payslip'] is toggled before print().
 * Print font is Times New Roman 8pt (see globals.css) to match the
 * official VN business-document aesthetic used by the other slips.
 */

import type { CSSProperties } from "react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"

export interface PayslipProps {
  organizationName: string
  employeeName: string
  employeeRole?: string | null
  /** Period as yyyy-mm. */
  period: string
  baseSalary: number
  standardWorkdays: number
  actualWorkdays: number
  proratedBase: number
  /** Tổng phụ cấp (xăng xe + điện thoại). */
  allowances?: number
  kpiBonus: number
  orderCountBonus: number
  activityBonus: number
  overtime: number
  deductions: number
  socialInsurance: number
  manualAdjustment: number
  netSalary: number
  notes?: string | null
  computedAt?: string | null
  lockedAt?: string | null
  /** Optional context from computed_breakdown — for transparency. */
  revenue?: number | null
  kpiPct?: number | null
  kpiTargetRevenue?: number | null
  periodStart?: string | null
  periodEnd?: string | null
}

const BORDER = "0.4mm solid #333"
const HAIR = "0.2mm solid #999"

function cell(extra?: CSSProperties): CSSProperties {
  return { padding: "1.2mm 2.5mm", borderBottom: HAIR, ...extra }
}

export function Payslip(p: PayslipProps) {
  const allowances = p.allowances ?? 0
  const grossBeforeAdj =
    p.proratedBase + allowances + p.kpiBonus + p.orderCountBonus + p.activityBonus + p.overtime
  const totalDeductions = p.deductions + p.socialInsurance
  const monthLabel = (() => {
    const [y, m] = p.period.split("-")
    return m ? `${m}/${y}` : p.period
  })()
  const rangeLabel =
    p.periodStart && p.periodEnd
      ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`
      : ""

  const incomeRows: Array<{ label: string; value: number; hint?: string }> = [
    { label: "Lương cơ bản", value: p.proratedBase, hint: `cấu hình ${formatCurrency(p.baseSalary)}/tháng` },
    { label: "Phụ cấp xăng xe + điện thoại", value: allowances },
    { label: "Thưởng KPI doanh số", value: p.kpiBonus },
    { label: "Thưởng theo số đơn", value: p.orderCountBonus },
    { label: "Thưởng hoạt động", value: p.activityBonus },
  ]
  if (p.overtime > 0) incomeRows.push({ label: "Tăng ca / OT", value: p.overtime })

  const deductionRows: Array<{ label: string; value: number }> = [
    { label: "BHXH / BHYT / BHTN", value: p.socialInsurance },
  ]
  if (p.deductions > 0) deductionRows.push({ label: "Khấu trừ khác", value: p.deductions })

  return (
    <div
      className="a5-doc print-page"
      style={{
        width: "148mm",
        padding: "8mm",
        boxSizing: "border-box",
        color: "#111",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "3.5mm" }}>
        <div style={{ fontSize: "9pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3pt" }}>
          {p.organizationName}
        </div>
        <h1
          style={{
            fontSize: "13pt",
            fontWeight: 700,
            margin: "2mm 0 0.5mm",
            letterSpacing: "0.5pt",
          }}
        >
          PHIẾU LƯƠNG
        </h1>
        <div style={{ fontSize: "9pt" }}>
          Tháng {monthLabel}
          {rangeLabel ? ` · Kỳ ${rangeLabel}` : ""}
        </div>
      </div>

      {/* Employee info */}
      <table style={{ width: "100%", fontSize: "8.5pt", marginBottom: "3mm", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ width: "20%", padding: "0.8mm 0" }}>Họ và tên</td>
            <td style={{ fontWeight: 700, padding: "0.8mm 0" }}>{p.employeeName}</td>
            <td style={{ width: "18%", padding: "0.8mm 0" }}>Vai trò</td>
            <td style={{ padding: "0.8mm 0" }}>{p.employeeRole || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "0.8mm 0" }}>Công chuẩn</td>
            <td style={{ padding: "0.8mm 0" }}>{p.standardWorkdays} ngày</td>
            <td style={{ padding: "0.8mm 0" }}>Công thực</td>
            <td style={{ padding: "0.8mm 0" }}>
              {p.actualWorkdays} ngày
              <span style={{ color: "#666" }}> (lương không phụ thuộc chấm công)</span>
            </td>
          </tr>
          {(p.revenue != null || p.kpiTargetRevenue != null) && (
            <tr>
              <td style={{ padding: "0.8mm 0" }}>Doanh số kỳ</td>
              <td style={{ padding: "0.8mm 0", fontWeight: 600 }}>
                {formatCurrency(p.revenue ?? 0)}
              </td>
              <td style={{ padding: "0.8mm 0" }}>Mức chung A</td>
              <td style={{ padding: "0.8mm 0" }}>
                {p.kpiTargetRevenue ? formatCurrency(p.kpiTargetRevenue) : "—"}
                {p.kpiPct != null ? ` · đạt ${p.kpiPct}%` : ""}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Earnings + deductions */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "8.5pt",
          border: BORDER,
          marginBottom: "3mm",
        }}
      >
        <tbody>
          {/* A. Thu nhập */}
          <tr>
            <td colSpan={2} style={{ ...cell(), background: "#eee", fontWeight: 700, textTransform: "uppercase", fontSize: "8pt" }}>
              A · Các khoản thu nhập
            </td>
          </tr>
          {incomeRows.map((r, i) => (
            <tr key={`inc-${i}`} style={r.value === 0 ? { color: "#777" } : undefined}>
              <td style={cell()}>
                {i + 1}. {r.label}
                {r.hint ? <span style={{ color: "#777", fontStyle: "italic" }}> — {r.hint}</span> : null}
              </td>
              <td style={cell({ textAlign: "right", whiteSpace: "nowrap", width: "32mm" })}>
                {formatCurrency(r.value)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td style={cell({ textAlign: "right" })}>Tổng thu nhập (I)</td>
            <td style={cell({ textAlign: "right", whiteSpace: "nowrap" })}>{formatCurrency(grossBeforeAdj)}</td>
          </tr>

          {/* B. Khấu trừ */}
          <tr>
            <td colSpan={2} style={{ ...cell(), background: "#eee", fontWeight: 700, textTransform: "uppercase", fontSize: "8pt" }}>
              B · Các khoản khấu trừ
            </td>
          </tr>
          {deductionRows.map((r, i) => (
            <tr key={`ded-${i}`} style={r.value === 0 ? { color: "#777" } : undefined}>
              <td style={cell()}>{i + 1}. {r.label}</td>
              <td style={cell({ textAlign: "right", whiteSpace: "nowrap" })}>{formatCurrency(r.value)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td style={cell({ textAlign: "right" })}>Tổng khấu trừ (II)</td>
            <td style={cell({ textAlign: "right", whiteSpace: "nowrap" })}>{formatCurrency(totalDeductions)}</td>
          </tr>

          {/* C. Điều chỉnh */}
          {p.manualAdjustment !== 0 && (
            <tr>
              <td style={cell()}>
                C · Điều chỉnh thủ công
                {p.notes ? <span style={{ color: "#777", fontStyle: "italic" }}> — {p.notes}</span> : null}
              </td>
              <td style={cell({ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 })}>
                {p.manualAdjustment > 0 ? "+" : "−"}
                {formatCurrency(Math.abs(p.manualAdjustment))}
              </td>
            </tr>
          )}

          {/* Net */}
          <tr style={{ fontWeight: 700, fontSize: "10pt" }}>
            <td style={{ padding: "2mm 2.5mm", background: "#ddd", textTransform: "uppercase" }}>
              Thực lĩnh = I − II {p.manualAdjustment !== 0 ? (p.manualAdjustment > 0 ? "+ ĐC" : "− ĐC") : ""}
            </td>
            <td style={{ padding: "2mm 2.5mm", background: "#ddd", textAlign: "right", whiteSpace: "nowrap" }}>
              {formatCurrency(p.netSalary)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontSize: "8.5pt", fontStyle: "italic", marginBottom: "1mm" }}>
        Bằng chữ: {numberToVietnameseWords(p.netSalary)}.
      </div>
      {p.notes && p.manualAdjustment === 0 && (
        <div style={{ fontSize: "8pt", fontStyle: "italic", marginBottom: "1mm" }}>
          Ghi chú: {p.notes}
        </div>
      )}

      {/* Signatures */}
      <div style={{ fontSize: "8pt", textAlign: "right", color: "#444", margin: "5mm 0 1mm" }}>
        Ngày …… tháng …… năm ……
      </div>
      <table className="signatures" style={{ width: "100%", textAlign: "center", fontSize: "8pt" }}>
        <tbody>
          <tr style={{ fontWeight: 700 }}>
            <td style={{ padding: "0.5mm" }}>Người nhận</td>
            <td style={{ padding: "0.5mm" }}>Người lập</td>
            <td style={{ padding: "0.5mm" }}>Kế toán</td>
            <td style={{ padding: "0.5mm" }}>Giám đốc</td>
          </tr>
          <tr style={{ fontStyle: "italic", color: "#666" }}>
            <td>(Ký, họ tên)</td>
            <td>(Ký, họ tên)</td>
            <td>(Ký, họ tên)</td>
            <td>(Ký, họ tên)</td>
          </tr>
          <tr>
            <td style={{ height: "16mm" }}></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>

      {(p.computedAt || p.lockedAt) && (
        <p style={{ marginTop: "2mm", fontSize: "7pt", color: "#888", textAlign: "right" }}>
          {p.computedAt ? `Tính ngày ${formatDate(p.computedAt)}` : ""}
          {p.lockedAt ? ` · Khoá ngày ${formatDate(p.lockedAt)}` : ""}
        </p>
      )}
    </div>
  )
}
