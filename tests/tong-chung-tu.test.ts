import { describe, it, expect } from "vitest"
import { tongChungTu, kyDangLoc } from "../src/lib/orders/list-summary"

describe("tongChungTu — khối thống kê danh sách", () => {
  const rows = [
    { total: 100_000, status: "completed" },
    { total: "250000.5", status: "draft" },
    { total: 999_999, status: "cancelled" },
    { total: null, status: "draft" },
  ]
  it("cộng mọi phiếu trừ phiếu huỷ; số phiếu đếm cả", () => {
    expect(tongChungTu(rows, (r) => r.total, (r) => r.status === "cancelled")).toEqual({ soPhieu: 4, tong: 350_001 })
  })
  /** ⚠ Chưa đủ thì tổng "—", nhưng số phiếu vẫn là số đang hiện — không phải "0 phiếu". */
  it("danh sách chưa đủ → số phiếu vẫn đúng, tổng null", () => {
    expect(tongChungTu(rows, (r) => r.total, () => false, false)).toEqual({ soPhieu: 4, tong: null })
  })
})

/**
 * ⚠ LỖI THẬT tìm ra khi làm khối thống kê (23/09/2026): viên thuốc khoảng
 *   thời gian (mặc định "Tháng này") chỉ có ở điện thoại nhưng lọc cả máy
 *   tính — danh sách đơn / hóa đơn trên máy tính bị lọc ngầm còn tháng này.
 */
describe("kyDangLoc", () => {
  it("máy tính: không lọc theo viên thuốc", () => {
    expect(kyDangLoc("month", true)).toBe("all")
    expect(kyDangLoc("today", true)).toBe("all")
  })
  it("điện thoại: đúng viên thuốc đang chọn", () => {
    expect(kyDangLoc("month", false)).toBe("month")
    expect(kyDangLoc("week", false)).toBe("week")
  })
})
