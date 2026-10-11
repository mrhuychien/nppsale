import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"
import {
  napPhuTrachKhach, nhanTuyenXuat, phuTrachTheoKhach, xuatKhachHang, type KhachXuat,
} from "@/lib/customers/xuat-excel"
import { duocXuatFile } from "@/lib/permissions"

/**
 * XUẤT EXCEL DANH SÁCH KHÁCH HÀNG — chủ nhà 11/10/2026: "phần danh sách khách hàng thêm cho tao phần xuất excel chi
 * tiết thông tin". Mọi khách khớp bộ lọc đang xem, mỗi khách một dòng, đủ thông tin.
 */
const GOC = resolve(__dirname, "..")
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf-8")

const khach = (id: string, o: Partial<KhachXuat> = {}): KhachXuat => ({
  id, store_name: `Tạp hoá ${id}`, owner_name: "Cô Ba", phone: " 0911222333 ", address: "1 Lê Lợi", province: "Hải Phòng",
  district: "Hồng Bàng", ward: "Hoàng Văn Thụ", channel: "T7", credit_limit: "5000000", payment_terms: "COD", status: "active",
  gps_lat: "20.8561", gps_lng: 106.6822, created_at: "2026-10-10T18:30:00Z", created_by: "u1", billing_name: "Cty Cô Ba",
  tax_code: "0201234567", billing_address: "1 Lê Lợi, Hải Phòng", billing_email: "coba@x.vn", payment_method_label: "TM/CK",
  group: { name: "Nhóm sỉ" }, ...o,
})

const COT = [
  "Tên cửa hàng", "Chủ cửa hàng", "SĐT", "Địa chỉ", "Phường/xã", "Quận/huyện", "Tỉnh/TP", "Tuyến", "Nhóm giá",
  "NV phụ trách chính", "NV cùng phụ trách", "Công nợ hiện tại", "Nợ quá hạn", "Hạn mức công nợ", "Điều khoản thanh toán",
  "Trạng thái", "Mã số thuế", "Tên đơn vị xuất HĐ", "Địa chỉ xuất HĐ", "Email xuất HĐ", "Hình thức thanh toán", "Vĩ độ",
  "Kinh độ", "Ngày tạo", "Người tạo",
]

describe("xuatKhachHang — một sheet, mỗi khách một dòng, đủ thông tin", () => {
  const ctx = {
    no: { a: 1500000, b: -200000 } as Record<string, number>,
    quaHan: { a: 300000 } as Record<string, number>,
    phuTrach: new Map([["a", { chinh: "Lan", khac: "Minh, Tú (đã nghỉ)" }]]),
    tenNguoi: new Map([["u1", "Kế toán Lan"]]),
    tuyen: [{ code: "T7", name: "Thứ bảy" }],
  }

  it("tiêu đề đúng thứ tự; số là SỐ, SĐT là chữ giữ số 0; ngày theo giờ VN; nhãn trạng thái / tuyến", () => {
    const [s] = xuatKhachHang([khach("a"), khach("b", { status: "suspended", channel: null, gps_lat: null, created_by: null, group: null })], ctx)
    expect(s.ten).toBe("Khách hàng")
    expect(s.rows[0]).toEqual(COT)
    const a = Object.fromEntries(COT.map((c, i) => [c, s.rows[1][i]]))
    expect(a).toEqual({
      "Tên cửa hàng": "Tạp hoá a", "Chủ cửa hàng": "Cô Ba", SĐT: "0911222333", "Địa chỉ": "1 Lê Lợi", "Phường/xã": "Hoàng Văn Thụ",
      "Quận/huyện": "Hồng Bàng", "Tỉnh/TP": "Hải Phòng", Tuyến: "T7 — Thứ bảy", "Nhóm giá": "Nhóm sỉ", "NV phụ trách chính": "Lan",
      "NV cùng phụ trách": "Minh, Tú (đã nghỉ)", "Công nợ hiện tại": 1500000, "Nợ quá hạn": 300000, "Hạn mức công nợ": 5000000,
      "Điều khoản thanh toán": "COD", "Trạng thái": "Đang hoạt động", "Mã số thuế": "0201234567", "Tên đơn vị xuất HĐ": "Cty Cô Ba",
      "Địa chỉ xuất HĐ": "1 Lê Lợi, Hải Phòng", "Email xuất HĐ": "coba@x.vn", "Hình thức thanh toán": "TM/CK", "Vĩ độ": 20.8561,
      "Kinh độ": 106.6822, "Ngày tạo": "11/10/2026", "Người tạo": "Kế toán Lan",
    })
    const b = Object.fromEntries(COT.map((c, i) => [c, s.rows[2][i]]))
    // Công nợ âm (dư có) giữ dấu; không có nợ quá hạn → 0; không phân công → trống.
    expect(b).toMatchObject({
      "Công nợ hiện tại": -200000, "Nợ quá hạn": 0, "NV phụ trách chính": "", Tuyến: "", "Nhóm giá": "", "Vĩ độ": "",
      "Trạng thái": "Tạm ngưng", "Người tạo": "",
    })
  })

  it("công nợ KHÔNG đọc được → ô trống, không ghi 0 (0 là 'không nợ')", () => {
    const [s] = xuatKhachHang([khach("a")], { ...ctx, no: null, quaHan: null })
    expect(s.rows[1][COT.indexOf("Công nợ hiện tại")]).toBe("")
    expect(s.rows[1][COT.indexOf("Nợ quá hạn")]).toBe("")
  })

  it("giữ đúng thứ tự danh sách đang xem", () => {
    const [s] = xuatKhachHang([khach("c"), khach("a"), khach("b")], ctx)
    expect(s.rows.slice(1).map((r) => r[0])).toEqual(["Tạp hoá c", "Tạp hoá a", "Tạp hoá b"])
  })

  it("nhanTuyenXuat: mã — tên; mã lạ thì ghi mã; trống thì trống", () => {
    expect(nhanTuyenXuat("T2", [{ code: "T2", name: "Thứ hai" }])).toBe("T2 — Thứ hai")
    expect(nhanTuyenXuat("X9", [{ code: "T2", name: "Thứ hai" }])).toBe("X9")
    expect(nhanTuyenXuat("T2", [{ code: "T2", name: "T2" }])).toBe("T2")
    expect(nhanTuyenXuat(null, [])).toBe("")
  })
})

describe("người phụ trách", () => {
  const u = (id: string, full_name: string, is_active = true) => ({ id, full_name, is_active })
  it("người CHÍNH riêng một cột, người cùng phụ trách gộp; người đã nghỉ có ghi chú; phân công đã gỡ bỏ qua", () => {
    const m = phuTrachTheoKhach([
      { customer_id: "k1", user_id: "u2", role: "secondary", status: "active", user: u("u2", "Tú", false) },
      { customer_id: "k1", user_id: "u1", role: "primary", status: "active", user: u("u1", "Lan") },
      { customer_id: "k1", user_id: "u3", role: "secondary", status: "active", user: u("u3", "Minh") },
      { customer_id: "k1", user_id: "u4", role: "secondary", status: "inactive", user: u("u4", "Gỡ rồi") },
      { customer_id: "k2", user_id: "u3", role: "secondary", status: "active", user: u("u3", "Minh") },
    ])
    expect(m.get("k1")).toEqual({ chinh: "Lan", khac: "Minh, Tú (đã nghỉ)" })
    expect(m.get("k2")).toEqual({ chinh: "", khac: "Minh" })
  })

  it("napPhuTrachKhach: đọc theo lô id (không vượt trần URL), chỉ phân công đang hoạt động", async () => {
    const ids = nRows(400, () => ({})).map((r) => r.id as string)
    const db = fakePostgrest({
      customer_assignments: [
        ...ids.map((id, i) => ({ id: `as-${i}`, customer_id: id, user_id: "u1", role: "primary", status: "active", user: { id: "u1", full_name: "Lan", is_active: true } })),
        { id: "as-x", customer_id: ids[399], user_id: "u9", role: "secondary", status: "inactive", user: { id: "u9", full_name: "Cũ", is_active: true } },
      ],
    })
    const m = await napPhuTrachKhach(db.client as never, ids)
    expect(m.size).toBe(400)
    expect(m.get(ids[399])).toEqual({ chinh: "Lan", khac: "" })
    expect(db.calls.every((c) => c.filters.includes("eq.status"))).toBe(true)
    expect(db.calls.length).toBeGreaterThanOrEqual(3)
  })
})

describe("màn Khách hàng: nút Xuất Excel", () => {
  const s = doc("src/app/(dashboard)/customers/page.tsx")

  it("nút theo quyền 'Xuất file' của mô-đun Khách hàng; báo theo 'khách hàng', không theo 'phiếu'", () => {
    expect(s).toMatch(/<XuatExcelButton\s+module="customers"\s+tenTep="khach-hang"\s+donVi="khách hàng"\s+chuanBi=\{xuatExcel\}/)
    expect(["owner", "manager", "accountant", "sales", "warehouse", "driver"].map((r) => duocXuatFile(r as never, "customers")))
      .toEqual([true, true, true, false, false, false])
    const nut = doc("src/components/ui/xuat-excel-button.tsx")
    expect(nut).toContain("`Đã xuất ${kq.soPhieu} ${donVi} ra Excel`")
    expect(nut).toContain("description: kq.thieu ? kq.ghiChu ?? truncationWarning() : undefined,")
  })

  it("xuất MỌI khách khớp CÙNG bộ lọc của danh sách (apLoc), không chỉ trang này; thứ tự như danh sách", () => {
    // Không thẻ lọc nhanh: đọc đủ (phân trang) bằng đúng bộ lọc, xếp theo tên rồi id (thứ tự ổn định).
    expect(s).toMatch(/fetchAllForAggregate<KhachXuat>\(\(from, to\) =>\s+apLoc\(supabase\.from\("customers"\)\.select\(CHON_KHACH_XUAT \+ chonNv\(nvLoc\), \{ count: "exact" \}\)\)\s+\.order\("store_name"\)\s+\.order\("id"\)/)
    // Thẻ lọc nhanh: danh sách mã giao bộ lọc khác, giữ thứ tự mã (điểm dừng / nợ).
    expect(s).toContain("const ma = quickIds.length === 0 ? [] : await locDanhSachMa(quickIds, coLocKhac,")
    expect(s).toContain("khach = xepTheoMa(rows, ma)")
    // Đọc hỏng → ném, không tải tệp thiếu.
    expect(s).toContain("if (res.error) throw new Error(`Không đọc được danh sách khách: ${res.error}`)")
  })

  it("công nợ: dùng số màn đã đọc đủ, chưa có thì hàm chung loadDebtByCustomer; không đọc được → báo 'chưa đủ'", () => {
    expect(s).toContain("debts ? Promise.resolve(debts) : loadDebtByCustomer(),")
    expect(s).toContain("thieu: thieuDong || no === null,")
    expect(s).toContain("setNoQuaHan(overdueMap)")
  })
})
