"use client"

/**
 * Per-user payslip — full breakdown, ready for window.print().
 *
 * Rendered by the payroll runs page into a `.print-payslip-only`
 * section; html[data-print-mode='payslip'] is toggled before print().
 * Print font is Times New Roman 8pt (see globals.css) to match the
 * official VN business-document aesthetic. Content may flow to a
 * second A5 page for busy months — that's intentional, the goal is a
 * complete handout the employee can keep.
 */

import type { CSSProperties } from "react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"

export interface PayslipOrderLine {
  order_code: string
  order_date: string
  total: number
  status: string
}

export interface PayslipKpiTier {
  min_percent: number
  bonus: number
  label?: string
  passed: boolean
}

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
  /** Context from computed_breakdown — for transparency. */
  revenue?: number | null
  kpiPct?: number | null
  kpiTargetRevenue?: number | null
  kpiModel?: string | null
  lowPerf?: string | null
  overTargetPercent?: number | null
  under60Percent?: number | null
  kpiTierBreakdown?: PayslipKpiTier[]
  gasAllowance?: number | null
  phoneAllowance?: number | null
  allowanceDropped?: boolean
  ocCount?: number | null
  ocMinCount?: number | null
  ocMinValue?: number | null
  ocBonusPerOrder?: number | null
  /**
   * Doanh số THUẦN (mig 095) — `revenue` ở trên đã là số thuần dùng để tính
   * lương. Ba trường này để phiếu lương chỉ ra được phép trừ, nếu không thì
   * NV bán 100tr nhìn thấy "Doanh số kỳ 55.000.000" và tưởng phần mềm sai.
   */
  revenueGross?: number | null
  returnsDeducted?: number | null
  /** Doanh số thuần THẬT, có thể âm; `revenue` đã kẹp về 0. */
  revenueNetRaw?: number | null
  revenueClamped?: boolean
  periodStart?: string | null
  periodEnd?: string | null
  /** Đơn hàng tính lương trong kỳ. */
  orders?: PayslipOrderLine[]
}

const BORDER = "0.4mm solid #333"
const HAIR = "0.2mm solid #999"

function td(extra?: CSSProperties): CSSProperties {
  return { padding: "1mm 2mm", border: HAIR, ...extra }
}
function th(extra?: CSSProperties): CSSProperties {
  return { padding: "1mm 2mm", border: HAIR, background: "#eee", fontWeight: 700, ...extra }
}
function sectionTitle(text: string) {
  return (
    <div
      style={{
        fontWeight: 700,
        textTransform: "uppercase",
        fontSize: "8.5pt",
        margin: "3.5mm 0 1.2mm",
        borderBottom: "0.3mm solid #333",
        paddingBottom: "0.6mm",
      }}
    >
      {text}
    </div>
  )
}

export function Payslip(p: PayslipProps) {
  const allowances = p.allowances ?? 0
  const gas = p.gasAllowance ?? 0
  const phone = p.phoneAllowance ?? 0
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
  const lowPerf = p.lowPerf || "normal"
  const kpiTarget = p.kpiTargetRevenue ?? 0
  const revenue = p.revenue ?? 0
  // Kỳ lương tính TRƯỚC mig 095 không có ba trường này → returns = 0 và
  // phiếu in ra y như cũ, không hiện dòng giải thích thừa.
  const gross = p.revenueGross ?? revenue
  const returns = p.returnsDeducted ?? 0
  const clamped = p.revenueClamped === true
  const tiers = p.kpiTierBreakdown ?? []
  const ocMinCount = p.ocMinCount ?? 0
  const ocCount = p.ocCount ?? 0
  const ocMinValue = p.ocMinValue ?? 0
  const ocPerOrder = p.ocBonusPerOrder ?? 0
  const showOc = ocMinCount > 0 || ocCount > 0 || p.orderCountBonus > 0
  const orders = p.orders ?? []
  const numRight: CSSProperties = { textAlign: "right", whiteSpace: "nowrap" }

  const incomeRows: Array<{ label: string; value: number; hint?: string }> = [
    {
      label: "Lương cơ bản",
      value: p.proratedBase,
      hint:
        lowPerf === "under_60"
          ? `thay bằng doanh số ${formatCurrency(revenue)} × ${p.under60Percent ?? 0}%`
          : `theo cấu hình ${formatCurrency(p.baseSalary)}/tháng, không trừ theo chấm công`,
    },
    {
      label: "Phụ cấp xăng xe + điện thoại",
      value: allowances,
      hint: p.allowanceDropped
        ? "không có do đạt dưới 60% mức A (không hưởng lương cứng)"
        : `xăng xe ${formatCurrency(gas)} + điện thoại ${formatCurrency(phone)}`,
    },
    { label: "Thưởng KPI doanh số", value: p.kpiBonus, hint: "diễn giải ở mục B" },
    { label: "Thưởng theo số đơn", value: p.orderCountBonus, hint: showOc ? "diễn giải ở mục C" : undefined },
    { label: "Thưởng hoạt động", value: p.activityBonus },
  ]
  if (p.overtime > 0) incomeRows.push({ label: "Tăng ca / OT", value: p.overtime })

  const deductionRows: Array<{ label: string; value: number; hint?: string }> = [
    { label: "BHXH / BHYT / BHTN", value: p.socialInsurance, hint: "mặc định 10,5% lương cơ bản" },
  ]
  if (p.deductions > 0) deductionRows.push({ label: "Khấu trừ khác", value: p.deductions })

  return (
    <div
      className="a5-doc print-page"
      style={{ width: "148mm", padding: "8mm", boxSizing: "border-box", color: "#111" }}
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: "3mm" }}>
        <div style={{ fontSize: "9pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3pt" }}>
          {p.organizationName}
        </div>
        <h1 style={{ fontSize: "13pt", fontWeight: 700, margin: "2mm 0 0.5mm", letterSpacing: "0.5pt" }}>
          PHIẾU LƯƠNG
        </h1>
        <div style={{ fontSize: "9pt" }}>
          Tháng {monthLabel}
          {rangeLabel ? ` · Kỳ ${rangeLabel}` : ""}
        </div>
      </div>

      {/* ── Employee info ────────────────────────────────────── */}
      <table style={{ width: "100%", fontSize: "8.5pt", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ width: "18%", padding: "0.6mm 0" }}>Họ và tên</td>
            <td style={{ fontWeight: 700, padding: "0.6mm 0" }}>{p.employeeName}</td>
            <td style={{ width: "16%", padding: "0.6mm 0" }}>Vai trò</td>
            <td style={{ padding: "0.6mm 0" }}>{p.employeeRole || "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "0.6mm 0" }}>Công chuẩn</td>
            <td style={{ padding: "0.6mm 0" }}>{p.standardWorkdays} ngày</td>
            <td style={{ padding: "0.6mm 0" }}>Công thực</td>
            <td style={{ padding: "0.6mm 0" }}>
              {p.actualWorkdays} ngày <span style={{ color: "#666" }}>(lương không phụ thuộc chấm công)</span>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "0.6mm 0" }}>Doanh số kỳ</td>
            <td style={{ padding: "0.6mm 0", fontWeight: 600 }}>
              {formatCurrency(revenue)}
              {returns > 0 ? (
                <span style={{ color: "#666", fontWeight: 400 }}>
                  {" "}(thuần)
                </span>
              ) : null}
            </td>
            <td style={{ padding: "0.6mm 0" }}>Mức chung A</td>
            <td style={{ padding: "0.6mm 0" }}>
              {kpiTarget > 0 ? formatCurrency(kpiTarget) : "—"}
              {p.kpiPct != null ? ` · đạt ${p.kpiPct}%` : ""}
            </td>
          </tr>
          {returns > 0 && (
            <tr>
              <td style={{ padding: "0.6mm 0" }}>Cách ra doanh số</td>
              <td style={{ padding: "0.6mm 0" }} colSpan={3}>
                bán {formatCurrency(gross)} − hàng trả lại {formatCurrency(returns)} ={" "}
                <strong>{formatCurrency(revenue)}</strong>
                {clamped ? (
                  <span style={{ color: "#666" }}>
                    {" "}· hàng trả nhiều hơn hàng bán ({formatCurrency(p.revenueNetRaw ?? 0)}),
                    tính doanh số bằng 0
                  </span>
                ) : null}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── A. Thu nhập ──────────────────────────────────────── */}
      {sectionTitle("A · Các khoản thu nhập")}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", border: BORDER }}>
        <tbody>
          {incomeRows.map((r, i) => (
            <tr key={`inc-${i}`} style={r.value === 0 ? { color: "#777" } : undefined}>
              <td style={td()}>
                {i + 1}. {r.label}
                {r.hint ? <span style={{ color: "#777", fontStyle: "italic" }}> — {r.hint}</span> : null}
              </td>
              <td style={td({ ...numRight, width: "32mm" })}>{formatCurrency(r.value)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "#f2f2f2" }}>
            <td style={td({ textAlign: "right" })}>TỔNG THU NHẬP (I)</td>
            <td style={td(numRight)}>{formatCurrency(grossBeforeAdj)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── B. Diễn giải thưởng KPI ──────────────────────────── */}
      {sectionTitle("B · Cách tính thưởng KPI doanh số")}
      <div style={{ fontSize: "8.5pt", lineHeight: 1.35 }}>
        <p style={{ margin: "0 0 1mm" }}>
          Doanh số trong kỳ: <strong>{formatCurrency(revenue)}</strong>
          {returns > 0 ? (
            <span style={{ color: "#555" }}>
              {" "}(đã bán {formatCurrency(gross)}, trừ hàng trả lại {formatCurrency(returns)})
            </span>
          ) : null}
          {kpiTarget > 0 ? <> / mức chung A = {formatCurrency(kpiTarget)} → đạt <strong>{p.kpiPct != null ? `${p.kpiPct}%` : "—"}</strong></> : null}
        </p>
        {p.kpiModel === "per_user_tier" && (
          <p style={{ margin: "0 0 1mm", fontStyle: "italic", color: "#555" }}>Áp dụng bậc KPI riêng của nhân viên này.</p>
        )}
        {lowPerf === "under_60" && (
          <p style={{ margin: "0 0 1mm" }}>
            Đạt dưới 60% mức A → không hưởng lương cứng &amp; không có phụ cấp; lương = doanh số ×{" "}
            {p.under60Percent ?? 0}% = {formatCurrency(p.proratedBase)}; không thưởng KPI.
          </p>
        )}
        {lowPerf === "under_70" && (
          <p style={{ margin: "0 0 1mm" }}>Đạt dưới 70% mức A → chỉ lương cơ bản + phụ cấp, không thưởng KPI.</p>
        )}
        {lowPerf === "over_100" && (p.overTargetPercent ?? 0) > 0 && (
          <p style={{ margin: "0 0 1mm" }}>
            Vượt 100% mức A → thưởng thêm = (doanh số − A) × {p.overTargetPercent}% ={" "}
            {formatCurrency(Math.round((revenue - kpiTarget) * (p.overTargetPercent ?? 0) / 100))}.
          </p>
        )}
        {tiers.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt", border: BORDER, marginTop: "0.5mm" }}>
            <thead>
              <tr>
                <th style={th({ textAlign: "left" })}>Bậc</th>
                <th style={th(numRight)}>Cộng thêm</th>
                <th style={th({ textAlign: "center" })}>Đạt?</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={`tier-${i}`} style={t.passed ? undefined : { color: "#888" }}>
                  <td style={td()}>
                    {t.label || `Đạt ${t.min_percent}%`}
                    {kpiTarget > 0 ? ` (≥ ${formatCurrency(Math.round(kpiTarget * t.min_percent / 100))})` : ""}
                  </td>
                  <td style={td(numRight)}>+{formatCurrency(t.bonus)}</td>
                  <td style={td({ textAlign: "center" })}>{t.passed ? "✓" : "—"}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: "#f2f2f2" }}>
                <td style={td()} colSpan={2}>Tổng thưởng KPI doanh số</td>
                <td style={td(numRight)}>{formatCurrency(p.kpiBonus)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── C. Diễn giải thưởng số đơn ───────────────────────── */}
      {showOc && (
        <>
          {sectionTitle("C · Cách tính thưởng theo số đơn")}
          <div style={{ fontSize: "8.5pt", lineHeight: 1.35 }}>
            <p style={{ margin: "0 0 0.6mm" }}>
              Đơn đạt ngưỡng ({formatCurrency(ocMinValue)}/đơn): <strong>{ocCount}</strong> đơn (cần tối thiểu {ocMinCount} đơn).
            </p>
            <p style={{ margin: 0 }}>
              {ocCount >= ocMinCount && ocMinCount > 0 ? (
                <>Thưởng = {ocCount} × {formatCurrency(ocPerOrder)} = <strong>{formatCurrency(p.orderCountBonus)}</strong></>
              ) : (
                <span style={{ color: "#555" }}>Chưa đạt số đơn tối thiểu → không thưởng.</span>
              )}
            </p>
          </div>
        </>
      )}

      {/* ── D. Khấu trừ ──────────────────────────────────────── */}
      {sectionTitle("D · Các khoản khấu trừ")}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", border: BORDER }}>
        <tbody>
          {deductionRows.map((r, i) => (
            <tr key={`ded-${i}`} style={r.value === 0 ? { color: "#777" } : undefined}>
              <td style={td()}>
                {i + 1}. {r.label}
                {r.hint ? <span style={{ color: "#777", fontStyle: "italic" }}> — {r.hint}</span> : null}
              </td>
              <td style={td({ ...numRight, width: "32mm" })}>{formatCurrency(r.value)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, background: "#f2f2f2" }}>
            <td style={td({ textAlign: "right" })}>TỔNG KHẤU TRỪ (II)</td>
            <td style={td(numRight)}>{formatCurrency(totalDeductions)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Điều chỉnh + Thực lĩnh ───────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt", border: BORDER, marginTop: "2mm" }}>
        <tbody>
          {p.manualAdjustment !== 0 && (
            <tr>
              <td style={td()}>
                Điều chỉnh thủ công (III)
                {p.notes ? <span style={{ color: "#777", fontStyle: "italic" }}> — {p.notes}</span> : null}
              </td>
              <td style={td({ ...numRight, fontWeight: 600 })}>
                {p.manualAdjustment > 0 ? "+" : "−"}{formatCurrency(Math.abs(p.manualAdjustment))}
              </td>
            </tr>
          )}
          <tr style={{ fontWeight: 700, fontSize: "10.5pt", background: "#ddd" }}>
            <td style={{ padding: "2mm", border: HAIR, textTransform: "uppercase" }}>
              THỰC LĨNH = (I) − (II){p.manualAdjustment !== 0 ? (p.manualAdjustment > 0 ? " + (III)" : " − (III)") : ""}
            </td>
            <td style={{ padding: "2mm", border: HAIR, ...numRight, width: "32mm" }}>{formatCurrency(p.netSalary)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: "8.5pt", fontStyle: "italic", margin: "1mm 0" }}>
        Bằng chữ: {numberToVietnameseWords(p.netSalary)}.
      </div>
      {p.notes && p.manualAdjustment === 0 && (
        <div style={{ fontSize: "8pt", fontStyle: "italic", marginBottom: "1mm" }}>Ghi chú: {p.notes}</div>
      )}

      {/* ── E. Đơn hàng tính lương ───────────────────────────── */}
      {sectionTitle(`E · Đơn hàng tính lương (${orders.length} đơn)`)}
      {orders.length === 0 ? (
        <p style={{ fontSize: "8pt", color: "#666", margin: 0 }}>Không có đơn nào trong kỳ (trạng thái đã giao / đã xác nhận).</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt", border: BORDER }}>
          <thead>
            <tr>
              <th style={th({ textAlign: "left", width: "8mm" })}>STT</th>
              <th style={th({ textAlign: "left" })}>Mã đơn</th>
              <th style={th({ textAlign: "left" })}>Ngày</th>
              <th style={th({ textAlign: "left" })}>Trạng thái</th>
              <th style={th(numRight)}>Giá trị</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={`ord-${i}`}>
                <td style={td()}>{i + 1}</td>
                <td style={td({ fontFamily: "monospace" })}>{o.order_code}</td>
                <td style={td()}>{formatDate(o.order_date)}</td>
                <td style={td()}>{o.status}</td>
                <td style={td(numRight)}>{formatCurrency(Number(o.total || 0))}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: "#f2f2f2" }}>
              <td style={td()} colSpan={4}>Tổng doanh số</td>
              <td style={td(numRight)}>{formatCurrency(orders.reduce((s, o) => s + Number(o.total || 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* ── Signatures ───────────────────────────────────────── */}
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
            <td style={{ height: "15mm" }}></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>

      {(p.computedAt || p.lockedAt) && (
        <p style={{ marginTop: "1mm", fontSize: "7pt", color: "#888", textAlign: "right" }}>
          {p.computedAt ? `Tính ngày ${formatDate(p.computedAt)}` : ""}
          {p.lockedAt ? ` · Khoá ngày ${formatDate(p.lockedAt)}` : ""}
        </p>
      )}
    </div>
  )
}
