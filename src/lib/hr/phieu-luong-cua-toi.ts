/**
 * Phiếu lương của tôi (chủ nhà 26/09/2026) — một dòng `my_payslips()` (mig 201) dựng thành các
 * khoản cộng / trừ để nhân viên đọc trên điện thoại.
 */

export interface DongPhieuLuong {
  payroll_run_id: string
  month: string
  locked_at: string | null
  base_salary: number | string | null
  standard_workdays: number | string | null
  actual_workdays: number | string | null
  prorated_base: number | string | null
  allowances: number | string | null
  kpi_bonus: number | string | null
  order_count_bonus: number | string | null
  activity_bonus: number | string | null
  overtime: number | string | null
  deductions: number | string | null
  social_insurance: number | string | null
  manual_adjustment: number | string | null
  net_salary: number | string | null
  computed_breakdown: Record<string, unknown> | null
  notes: string | null
}

export interface KhoanLuong {
  label: string
  /** Số có dấu: khoản trừ là số âm. */
  amount: number
}

const so = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** "Tháng 09/2026" từ `month` (ngày đầu tháng). */
export function nhanThangLuong(month: string): string {
  const [y, m] = month.slice(0, 7).split("-")
  return y && m ? `Tháng ${m}/${y}` : month
}

/**
 * Các khoản của phiếu, theo thứ tự trên bảng lương. Khoản bằng 0 bỏ đi (trừ lương cơ bản).
 * Khấu trừ và BHXH mang dấu âm; điều chỉnh tay giữ dấu như đã nhập.
 */
export function khoanLuong(r: DongPhieuLuong): KhoanLuong[] {
  const ngay = `${so(r.actual_workdays)}/${so(r.standard_workdays)} công`
  const ds: KhoanLuong[] = [
    { label: `Lương cơ bản (${ngay})`, amount: so(r.prorated_base) },
    { label: "Phụ cấp", amount: so(r.allowances) },
    { label: "Thưởng KPI doanh số", amount: so(r.kpi_bonus) },
    { label: "Thưởng số đơn", amount: so(r.order_count_bonus) },
    { label: "Thưởng hoạt động", amount: so(r.activity_bonus) },
    { label: "Tăng ca", amount: so(r.overtime) },
    { label: "Khấu trừ", amount: -so(r.deductions) },
    { label: "BHXH", amount: -so(r.social_insurance) },
    { label: "Điều chỉnh", amount: so(r.manual_adjustment) },
  ]
  return ds.filter((k, i) => i === 0 || k.amount !== 0)
}

/** Doanh số tính lương (thuần, sau hàng trả) nếu bảng lương có ghi. */
export function doanhSoTinhLuong(r: DongPhieuLuong): number | null {
  const v = r.computed_breakdown?.revenue
  return v == null ? null : so(v)
}
