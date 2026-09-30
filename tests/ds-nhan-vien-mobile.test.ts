/**
 * Danh sách nhân viên trên điện thoại — thiết kế "ds-nhan-vien" (chủ nhà 30/09/2026: "Làm lại các màn").
 * Bấm thật: e2e/ds-nhan-vien-mobile-thiet-ke.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  chipNhanVien,
  dinhDangSdt,
  dongPhuNhanVien,
  dongPhuTheNv,
  khopLocNv,
  sapXepNhanVien,
  vietTatTenNv,
  type NvDong,
} from "@/lib/users/mobile-list"

const nv = (id: string, role: string, is_active = true, full_name = id, phone: string | null = null): NvDong => ({
  id, role, is_active, full_name, phone,
})

const DS: NvDong[] = [
  nv("chu", "owner"),
  nv("b1", "sales"), nv("b2", "sales"), nv("b3", "sales", false),
  nv("k1", "warehouse"),
  nv("kt", "accountant"),
]

describe("chip lọc nhân viên", () => {
  it("Đang hoạt động · theo vai (trừ Chủ NPP, chỉ người đang hoạt động) · Tạm khoá · Tất cả", () => {
    expect(chipNhanVien(DS, "active")).toEqual([
      { key: "active", label: "Đang hoạt động", count: 5 },
      { key: "role:sales", label: "NV Bán hàng", count: 2 },
      { key: "role:warehouse", label: "NV Kho", count: 1 },
      { key: "role:accountant", label: "Kế toán", count: 1 },
      { key: "locked", label: "Tạm khoá", count: 1 },
      { key: "all", label: "Tất cả", count: 6 },
    ])
  })
  it("không có người khoá thì không có chip Tạm khoá — trừ khi đang chọn nó", () => {
    const dang = DS.filter((u) => u.is_active)
    expect(chipNhanVien(dang, "active").map((c) => c.key)).not.toContain("locked")
    expect(chipNhanVien(dang, "locked").find((c) => c.key === "locked")?.count).toBe(0)
  })
  it("vai đang chọn mà hết người (vd tìm) vẫn giữ chip, số 0", () => {
    const c = chipNhanVien([nv("b1", "sales")], "role:warehouse")
    expect(c.find((x) => x.key === "role:warehouse")).toEqual({ key: "role:warehouse", label: "NV Kho", count: 0 })
  })
  it("lọc khớp đúng chip", () => {
    expect(DS.filter((u) => khopLocNv(u, "active")).length).toBe(5)
    expect(DS.filter((u) => khopLocNv(u, "locked")).map((u) => u.id)).toEqual(["b3"])
    expect(DS.filter((u) => khopLocNv(u, "role:sales")).map((u) => u.id)).toEqual(["b1", "b2"])
    expect(DS.filter((u) => khopLocNv(u, "all")).length).toBe(6)
  })
})

describe("đầu xanh và thẻ", () => {
  it("dòng phụ: 'N đang hoạt động · N tạm khoá', không có người khoá thì bỏ vế sau", () => {
    expect(dongPhuNhanVien(DS)).toBe("5 đang hoạt động · 1 tạm khoá")
    expect(dongPhuNhanVien(DS.filter((u) => u.is_active))).toBe("5 đang hoạt động")
  })
  it("Chủ NPP lên đầu, còn lại giữ thứ tự", () => {
    expect(sapXepNhanVien([nv("a", "sales"), nv("c", "owner"), nv("b", "sales")]).map((u) => u.id)).toEqual(["c", "a", "b"])
  })
  it("viết tắt tên: hai từ cuối, có dấu", () => {
    expect(vietTatTenNv("Đồng Thị Hiền")).toBe("TH")
    expect(vietTatTenNv("Nguyễn Đức Hùng")).toBe("ĐH")
    expect(vietTatTenNv("Trần Tiến")).toBe("TT")
    expect(vietTatTenNv("  Vũ  thị huyền trang ")).toBe("HT")
    expect(vietTatTenNv("An")).toBe("A")
    expect(vietTatTenNv("")).toBe("?")
    expect(vietTatTenNv(null)).toBe("?")
  })
  it("định dạng SĐT 0912 420 924", () => {
    expect(dinhDangSdt("0912420924")).toBe("0912 420 924")
    expect(dinhDangSdt("+84912420924")).toBe("0912 420 924")
    expect(dinhDangSdt("0912.420.924")).toBe("0912 420 924")
    expect(dinhDangSdt("02838123456")).toBe("0283 812 3456")
    expect(dinhDangSdt("12345")).toBe("12345")
    expect(dinhDangSdt(null)).toBe("")
  })
  it("dòng phụ thẻ: 'Vai trò · SĐT'", () => {
    expect(dongPhuTheNv(nv("x", "sales", true, "X", "0979222026"))).toBe("NV Bán hàng · 0979 222 026")
    expect(dongPhuTheNv(nv("x", "owner"))).toBe("Chủ NPP")
  })
})

describe("màn điện thoại", () => {
  const TRANG = readFileSync("src/app/(dashboard)/settings/users/page.tsx", "utf8")
  const MAN = readFileSync("src/components/users/ds-nhan-vien-dien-thoai.tsx", "utf8")
  it("trang dựng màn riêng, bỏ đầu xanh chung và thẻ chung", () => {
    expect(TRANG).toContain("<DsNhanVienDienThoai")
    expect(TRANG).toContain("cards={null}")
    expect(TRANG).not.toContain("mobileHead=")
    // Nút tạo: đúng quyền cũ (Chủ NPP).
    expect(TRANG).toContain("canCreate={!!isOwner}")
  })
  it("phím Enter trên nút đăng nhập không mở xem nhanh", () => {
    expect(MAN).toContain("if (e.target !== e.currentTarget) return")
  })
})
