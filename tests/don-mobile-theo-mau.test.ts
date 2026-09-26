import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { diaChiKhach, dongPhuDon, BUOC_TAI_DON, type DonMobile } from "@/components/orders/mobile-orders-screen"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Viết lại màn danh sách đơn hàng trên mobile theo mẫu … Load 20 đơn
 *   hàng 1 lần thôi cho nhanh. Khi nhân viên xem thì danh sách không cần hiện tên nhân viên nữa."
 */
const don: DonMobile = {
  id: "o1", order_code: "DH-0900", order_date: "2026-09-26", created_at: "2026-09-26T09:00:00Z",
  status: "completed", total: 475_000,
  customer: { store_name: "Hiền béo", phone: "0903 357 312", address: "Số 195 Hàng Kênh", ward: "P. Vĩnh Niệm", district: "Lê Chân", province: "Hải Phòng" },
  sales_user: { full_name: "Nguyễn Thị Hiền" },
}

describe("danh sách đơn điện thoại theo mẫu", () => {
  it("dòng phụ: giờ · mã · NV — NVBH xem thì bỏ tên NV", () => {
    expect(dongPhuDon(don, true)).toBe("16:00 · DH-0900 · NV Nguyễn Thị Hiền")
    expect(dongPhuDon(don, false)).toBe("16:00 · DH-0900")
  })
  it("địa chỉ ghép đủ phần, bỏ phần trống / trùng", () => {
    expect(diaChiKhach(don.customer)).toBe("Số 195 Hàng Kênh, P. Vĩnh Niệm, Lê Chân, Hải Phòng")
    expect(diaChiKhach({ address: "12 Lê Lợi, Hải Phòng", province: "Hải Phòng" })).toBe("12 Lê Lợi, Hải Phòng")
    expect(diaChiKhach(null)).toBe("")
  })
  it("tải 20 đơn một lần trên điện thoại, máy tính giữ 50", () => {
    expect(BUOC_TAI_DON).toBe(20)
    const p = readFileSync(resolve(__dirname, "../src/app/(dashboard)/orders/page.tsx"), "utf-8")
    expect(p).toContain('window.matchMedia?.("(min-width: 1024px)").matches ? 50 : BUOC_TAI_DON')
    expect(p).toContain("showSalesName={!isSales}")
  })
})

describe("chuông thông báo gắn hai lần không làm trắng màn", () => {
  /* Đầu trang xanh gắn một chuông trong khi app bar (ẩn bằng CSS) vẫn gắn chuông của nó —
     cùng tên kênh là supabase ném "cannot add postgres_changes callbacks after subscribe()". */
  it("mỗi chuông một kênh realtime riêng", () => {
    const b = readFileSync(resolve(__dirname, "../src/components/layout/notification-bell.tsx"), "utf-8")
    expect(b).toContain(".channel(`notifications-${authUser.id}-${Math.random().toString(36).slice(2, 10)}`)")
  })
})
