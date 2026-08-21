import { describe, it, expect } from "vitest"
import { isAttendanceBypassed, attendanceFactor } from "@/lib/salary"
import { computePerUnitBonus, computeOrderMilestoneBonus } from "@/lib/bonus"
import type { HrSalaryConfig } from "@/types"
import type { OrderMilestoneTier, PerUnitBonus } from "@/types"

/**
 * Lương và thưởng — sai ở đây là trả sai tiền cho nhân viên, và thường
 * chỉ bị phát hiện khi có người khiếu nại.
 */

const cfg = (over: Partial<HrSalaryConfig> = {}) =>
  ({ working_days_per_month: 26, bypass_attendance_roles: undefined, ...over } as HrSalaryConfig)

describe("isAttendanceBypassed — vai trò không tính theo ngày công", () => {
  it("mặc định chỉ NV bán hàng được bỏ qua chấm công", () => {
    expect(isAttendanceBypassed("sales", cfg())).toBe(true)
    expect(isAttendanceBypassed("warehouse", cfg())).toBe(false)
    expect(isAttendanceBypassed("driver", cfg())).toBe(false)
  })

  it("khi tổ chức cấu hình danh sách riêng thì theo danh sách đó", () => {
    const c = cfg({ bypass_attendance_roles: ["driver"] } as Partial<HrSalaryConfig>)
    expect(isAttendanceBypassed("driver", c)).toBe(true)
    // Quan trọng: cấu hình danh sách sẽ GHI ĐÈ mặc định — sales KHÔNG còn
    // được bỏ qua nếu không có tên trong danh sách.
    expect(isAttendanceBypassed("sales", c)).toBe(false)
  })

  it("danh sách rỗng nghĩa là KHÔNG ai được bỏ qua", () => {
    const c = cfg({ bypass_attendance_roles: [] } as Partial<HrSalaryConfig>)
    expect(isAttendanceBypassed("sales", c)).toBe(false)
  })

  it("không có vai trò thì không bỏ qua", () => {
    expect(isAttendanceBypassed(null, cfg())).toBe(false)
    expect(isAttendanceBypassed(undefined, cfg())).toBe(false)
  })
})

describe("attendanceFactor — hệ số ngày công", () => {
  it("vai trò được bỏ qua luôn hưởng hệ số 1", () => {
    expect(attendanceFactor("sales", 0, cfg())).toBe(1)
  })

  it("đi làm đủ công thì hệ số bằng 1", () => {
    expect(attendanceFactor("warehouse", 26, cfg())).toBe(1)
  })

  it("đi làm nửa tháng thì hệ số bằng 0,5", () => {
    expect(attendanceFactor("warehouse", 13, cfg())).toBe(0.5)
  })

  it("đi làm dư công KHÔNG được vượt quá 1", () => {
    expect(attendanceFactor("warehouse", 40, cfg())).toBe(1)
  })

  it("số ngày âm bị ép về 0 (không trừ ngược lương)", () => {
    expect(attendanceFactor("warehouse", -5, cfg())).toBe(0)
  })

  it("cấu hình ngày công 0 hoặc thiếu không gây chia cho 0", () => {
    expect(attendanceFactor("warehouse", 10, cfg({ working_days_per_month: 0 }))).toBe(1)
    expect(Number.isFinite(attendanceFactor("warehouse", 10, null))).toBe(true)
  })
})

const line = (product_id: string, unit_name: string, quantity: number) =>
  ({ product_id, unit_name, quantity } as never)

describe("computePerUnitBonus — thưởng theo đầu thùng", () => {
  const rules = [
    { product_id: "p1", unit_name: "thùng", bonus: 5000 } as PerUnitBonus,
  ]

  it("cộng thưởng theo số lượng khớp cả sản phẩm lẫn đơn vị", () => {
    const r = computePerUnitBonus([line("p1", "thùng", 4)], rules)
    expect(r.total).toBe(20000)
    expect(r.breakdown).toHaveLength(1)
  })

  it("không tính khi khác đơn vị", () => {
    expect(computePerUnitBonus([line("p1", "hộp", 4)], rules).total).toBe(0)
  })

  it("không tính khi khác sản phẩm", () => {
    expect(computePerUnitBonus([line("p2", "thùng", 4)], rules).total).toBe(0)
  })

  it("rule không có product_id thì áp cho MỌI sản phẩm", () => {
    const all = [{ product_id: null, unit_name: "thùng", bonus: 1000 } as PerUnitBonus]
    const r = computePerUnitBonus([line("p1", "thùng", 2), line("p9", "thùng", 3)], all)
    expect(r.total).toBe(5000)
  })

  it("bỏ qua rule có mức thưởng 0 hoặc âm", () => {
    const bad = [{ product_id: "p1", unit_name: "thùng", bonus: 0 } as PerUnitBonus]
    expect(computePerUnitBonus([line("p1", "thùng", 10)], bad).total).toBe(0)
  })

  it("không có dòng hàng thì thưởng bằng 0, không lỗi", () => {
    expect(computePerUnitBonus([], rules).total).toBe(0)
  })
})

describe("computeOrderMilestoneBonus — thưởng theo mốc số đơn", () => {
  const tiers = [
    { min_orders: 30, bonus: 10000 } as OrderMilestoneTier,
    { min_orders: 50, bonus: 14000 } as OrderMilestoneTier,
    { min_orders: 80, bonus: 18000 } as OrderMilestoneTier,
  ]

  it("chưa đạt mốc nào thì không có thưởng", () => {
    expect(computeOrderMilestoneBonus(29, tiers).total).toBe(0)
    expect(computeOrderMilestoneBonus(29, tiers).tier).toBeNull()
  })

  it("đúng bằng mốc thì được tính (dùng >=)", () => {
    expect(computeOrderMilestoneBonus(30, tiers).total).toBe(10000)
  })

  it("lấy mốc CAO NHẤT đạt được, không cộng dồn các mốc", () => {
    expect(computeOrderMilestoneBonus(85, tiers).total).toBe(18000)
    expect(computeOrderMilestoneBonus(60, tiers).total).toBe(14000)
  })

  it("thứ tự khai báo mốc không ảnh hưởng kết quả", () => {
    const daoNguoc = [...tiers].reverse()
    expect(computeOrderMilestoneBonus(60, daoNguoc).total).toBe(14000)
  })

  it("không có mốc nào thì thưởng bằng 0", () => {
    expect(computeOrderMilestoneBonus(999, []).total).toBe(0)
  })
})
