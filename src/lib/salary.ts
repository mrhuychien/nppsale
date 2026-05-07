import type { HrSalaryConfig, Role } from "@/types"

/**
 * True khi role được cấu hình "bỏ qua chấm công" — lương = lương cứng
 * + thưởng (đầu thùng / đơn hàng / KPI) mà không nhân hệ số ngày
 * công. Default: NV Bán hàng (sales) được bỏ qua.
 */
export function isAttendanceBypassed(
  role: Role | string | null | undefined,
  config: Pick<HrSalaryConfig, "bypass_attendance_roles"> | null | undefined
): boolean {
  if (!role) return false
  const list = config?.bypass_attendance_roles
  if (!Array.isArray(list)) return role === "sales"
  return list.includes(role as Role)
}

/**
 * Hệ số ngày công cho 1 user trong kỳ: 1.0 nếu role bypass, ngược lại
 * = days_present / working_days_per_month (cap 1.0).
 *
 * @param daysPresent số ngày NV thực sự đi làm trong kỳ (theo
 *                    hr_attendance đã được duyệt).
 */
export function attendanceFactor(
  role: Role | string | null | undefined,
  daysPresent: number,
  config: Pick<
    HrSalaryConfig,
    "working_days_per_month" | "bypass_attendance_roles"
  > | null | undefined
): number {
  if (isAttendanceBypassed(role, config)) return 1
  const total = Math.max(1, Number(config?.working_days_per_month ?? 26))
  return Math.min(1, Math.max(0, Number(daysPresent || 0) / total))
}
