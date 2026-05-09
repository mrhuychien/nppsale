"use client"

/**
 * Per-user payslip — A5 portrait, ready for window.print().
 *
 * Shipped as part of T-16 / Pack3 close-out. The payroll runs page
 * renders one of these into a `.print-payslip-only` section and
 * toggles html[data-print-mode='payslip'] before calling print().
 */

import { formatCurrency, formatDate } from "@/lib/utils"

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
}

export function Payslip(p: PayslipProps) {
  const gross =
    p.proratedBase + p.kpiBonus + p.orderCountBonus + p.activityBonus + p.overtime
  const totalDeductions = p.deductions + p.socialInsurance
  return (
    <div className="a5-doc print-page" style={{ width: "148mm", padding: "8mm" }}>
      <header style={{ textAlign: "center", marginBottom: "4mm" }}>
        <div style={{ fontSize: "9pt", fontWeight: 600 }}>{p.organizationName}</div>
        <h1 style={{ fontSize: "12pt", fontWeight: 700, marginTop: "2mm" }}>
          PHIẾU LƯƠNG THÁNG {p.period}
        </h1>
      </header>

      <table style={{ width: "100%", marginBottom: "3mm", fontSize: "8pt" }}>
        <tbody>
          <tr>
            <td style={{ width: "30%" }}>Họ tên:</td>
            <td style={{ fontWeight: 600 }}>{p.employeeName}</td>
            <td style={{ width: "20%" }}>Vai trò:</td>
            <td>{p.employeeRole || "—"}</td>
          </tr>
          <tr>
            <td>Công chuẩn:</td>
            <td>{p.standardWorkdays} ngày</td>
            <td>Công thực:</td>
            <td>{p.actualWorkdays} ngày</td>
          </tr>
          <tr>
            <td>Lương cơ bản:</td>
            <td colSpan={3} style={{ fontWeight: 600 }}>
              {formatCurrency(p.baseSalary)} / tháng
            </td>
          </tr>
        </tbody>
      </table>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "8pt",
          marginBottom: "3mm",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "left",
              }}
            >
              Khoản
            </th>
            <th
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "right",
              }}
            >
              Cộng
            </th>
            <th
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "right",
              }}
            >
              Trừ
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
              Lương theo công
            </td>
            <td
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "right",
              }}
            >
              {formatCurrency(p.proratedBase)}
            </td>
            <td style={{ border: "1px solid #999" }}></td>
          </tr>
          {p.kpiBonus > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Thưởng KPI doanh số
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.kpiBonus)}
              </td>
              <td style={{ border: "1px solid #999" }}></td>
            </tr>
          )}
          {p.orderCountBonus > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Thưởng số đơn
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.orderCountBonus)}
              </td>
              <td style={{ border: "1px solid #999" }}></td>
            </tr>
          )}
          {p.activityBonus > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Thưởng hoạt động
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.activityBonus)}
              </td>
              <td style={{ border: "1px solid #999" }}></td>
            </tr>
          )}
          {p.overtime > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Thưởng OT
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.overtime)}
              </td>
              <td style={{ border: "1px solid #999" }}></td>
            </tr>
          )}
          {p.socialInsurance > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                BHXH (10.5%)
              </td>
              <td style={{ border: "1px solid #999" }}></td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.socialInsurance)}
              </td>
            </tr>
          )}
          {p.deductions > 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Khấu trừ khác
              </td>
              <td style={{ border: "1px solid #999" }}></td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {formatCurrency(p.deductions)}
              </td>
            </tr>
          )}
          {p.manualAdjustment !== 0 && (
            <tr>
              <td style={{ border: "1px solid #999", padding: "1mm 2mm" }}>
                Điều chỉnh thủ công
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {p.manualAdjustment > 0 ? formatCurrency(p.manualAdjustment) : ""}
              </td>
              <td
                style={{
                  border: "1px solid #999",
                  padding: "1mm 2mm",
                  textAlign: "right",
                }}
              >
                {p.manualAdjustment < 0 ? formatCurrency(-p.manualAdjustment) : ""}
              </td>
            </tr>
          )}
          <tr style={{ fontWeight: 600 }}>
            <td
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                background: "#f4f4f4",
              }}
            >
              Tổng
            </td>
            <td
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "right",
                background: "#f4f4f4",
              }}
            >
              {formatCurrency(gross + Math.max(0, p.manualAdjustment))}
            </td>
            <td
              style={{
                border: "1px solid #999",
                padding: "1mm 2mm",
                textAlign: "right",
                background: "#f4f4f4",
              }}
            >
              {formatCurrency(totalDeductions + Math.max(0, -p.manualAdjustment))}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        style={{
          textAlign: "right",
          fontSize: "11pt",
          fontWeight: 700,
          marginBottom: "4mm",
        }}
      >
        Thực lĩnh: {formatCurrency(p.netSalary)} VNĐ
      </div>

      {p.notes && (
        <p style={{ fontSize: "8pt", fontStyle: "italic", marginBottom: "4mm" }}>
          Ghi chú: {p.notes}
        </p>
      )}

      <footer
        className="signatures"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "2mm",
          textAlign: "center",
          marginTop: "8mm",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>Người nhận</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Kế toán</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>Giám đốc</div>
          <div style={{ fontStyle: "italic" }}>(Ký, họ tên)</div>
        </div>
      </footer>

      {(p.computedAt || p.lockedAt) && (
        <p
          style={{
            marginTop: "4mm",
            fontSize: "7pt",
            color: "#666",
            textAlign: "right",
          }}
        >
          {p.computedAt ? `Tính ngày ${formatDate(p.computedAt)}` : ""}
          {p.lockedAt ? ` • Khoá ngày ${formatDate(p.lockedAt)}` : ""}
        </p>
      )}
    </div>
  )
}
