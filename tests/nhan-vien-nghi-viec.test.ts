/**
 * Chủ nhà 02/10/2026: xoá nhân viên đã có chứng từ báo lỗi → chưa có chứng từ thì xoá hẳn, đã có thì
 * "Cho nghỉ việc"; "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại sau" (mig 223).
 * Máy chủ: scripts/sql/thu-223-nghi-viec.sql. Bấm thật: e2e/nhan-vien-nghi-viec.spec.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  chonDuocNv, loiNhanVien, tomTatChungTu, trangThaiNv, xoaHanDuoc,
} from "@/lib/users/nghi-viec"
import { chipNhanVien, dongPhuNhanVien, khopLocNv } from "@/lib/users/mobile-list"
import { loadSellers } from "@/lib/pos/load"

describe("trạng thái nhân viên", () => {
  it("đã nghỉ đứng trước tạm khoá; is_active NULL = chưa ai khoá", () => {
    expect(trangThaiNv({ is_active: true })).toBe("active")
    expect(trangThaiNv({ is_active: null })).toBe("active")
    expect(trangThaiNv({ is_active: false })).toBe("locked")
    expect(trangThaiNv({ is_active: false, left_at: "2026-10-02T00:00:00Z" })).toBe("left")
    expect(chonDuocNv({ is_active: false, left_at: "2026-10-02" })).toBe(false)
    expect(chonDuocNv({ is_active: true })).toBe(true)
  })
})

describe("xoá hay cho nghỉ", () => {
  it("chỉ xoá hẳn khi không có chứng từ", () => {
    expect(xoaHanDuoc({ tong: 0 })).toBe(true)
    expect(xoaHanDuoc({ tong: 1 })).toBe(false)
  })
  it("tóm tắt gộp theo bảng (hai cột người của một bảng không đếm đôi)", () => {
    const t = tomTatChungTu({
      chi_tiet: [
        { bang: "sales_orders", cot: "sales_user_id", so: 6 },
        { bang: "returns", cot: "requested_by", so: 3 },
        { bang: "returns", cot: "sales_user_id", so: 3 },
        { bang: "sales_invoices", cot: "sales_user_id", so: 3 },
      ],
    })
    expect(t).toBe("6 đơn hàng · 3 phiếu trả · 3 hóa đơn")
  })
  it("câu lỗi tiếng Việt cho mã lỗi máy chủ", () => {
    expect(loiNhanVien("TU_NGHI: x")).toBe("Không tự cho mình nghỉ việc được.")
    expect(loiNhanVien("NV_KHONG_HOP_LE: x")).toMatch(/đã nghỉ/)
    expect(loiNhanVien('Could not find the function public.cho_nhan_vien_nghi in the schema cache')).toMatch(/migration 223/)
  })
})

describe("danh sách nhân viên điện thoại có chip Đã nghỉ", () => {
  const ds = [
    { id: "1", full_name: "A", role: "sales", is_active: true },
    { id: "2", full_name: "B", role: "sales", is_active: false },
    { id: "3", full_name: "C", role: "sales", is_active: false, left_at: "2026-10-02" },
  ]
  it("tạm khoá và đã nghỉ tách riêng", () => {
    expect(khopLocNv(ds[1], "locked")).toBe(true)
    expect(khopLocNv(ds[2], "locked")).toBe(false)
    expect(khopLocNv(ds[2], "left")).toBe(true)
    expect(chipNhanVien(ds, "active").map((c) => `${c.label} ${c.count}`)).toEqual([
      "Đang hoạt động 1", "NV Bán hàng 1", "Tạm khoá 1", "Đã nghỉ 1", "Tất cả 3",
    ])
    expect(dongPhuNhanVien(ds)).toBe("1 đang hoạt động · 1 tạm khoá · 1 đã nghỉ")
  })
})

describe("ô chọn người đứng tên (POS) bỏ người đã nghỉ / tạm khoá", () => {
  it("loadSellers lọc is_active = false", async () => {
    const data = [
      { id: "1", full_name: "A", role: "sales", is_active: true },
      { id: "2", full_name: "B", role: "sales", is_active: false },
      { id: "3", full_name: "C", role: "owner", is_active: null },
    ]
    const q = { select: () => q, eq: () => q, in: () => q, order: async () => ({ data, error: null }) }
    const sb = { from: () => q } as unknown as Parameters<typeof loadSellers>[0]
    expect((await loadSellers(sb, "org")).map((u) => u.id)).toEqual(["1", "3"])
  })
})

/* ── API xoá: đã có chứng từ thì KHÔNG gọi xoá tài khoản ──────────────────────────────────── */
const rpc = vi.fn()
const deleteUser = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "chu" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "owner", org_id: "o" }, error: null }) }) }) }),
    rpc,
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: "o" }, error: null }) }) }) }),
    auth: { admin: { deleteUser } },
  }),
}))

describe("DELETE /api/admin/users/:id", () => {
  beforeEach(() => {
    rpc.mockReset()
    deleteUser.mockReset()
    deleteUser.mockResolvedValue({ error: null })
  })
  it("đã có chứng từ → 409 CO_CHUNG_TU, không xoá", async () => {
    rpc.mockResolvedValue({ data: { tong: 5, chi_tiet: [], khach: 0, lich_tuyen: 0, so_khoan_no: 1, tien_no: 1 }, error: null })
    const { DELETE } = await import("@/app/api/admin/users/[id]/route")
    const res = await DELETE(new Request("http://x"), { params: { id: "nv" } })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("CO_CHUNG_TU")
    expect(deleteUser).not.toHaveBeenCalled()
  })
  it("chưa có chứng từ → xoá hẳn", async () => {
    rpc.mockResolvedValue({ data: { tong: 0, chi_tiet: [], khach: 0, lich_tuyen: 0, so_khoan_no: 0, tien_no: 0 }, error: null })
    const { DELETE } = await import("@/app/api/admin/users/[id]/route")
    const res = await DELETE(new Request("http://x"), { params: { id: "nv" } })
    expect(res.status).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith("nv")
  })
  it("không đếm được (chưa chạy mig 223) → không liều xoá", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.so_chung_tu_nhan_vien in the schema cache" } })
    const { DELETE } = await import("@/app/api/admin/users/[id]/route")
    const res = await DELETE(new Request("http://x"), { params: { id: "nv" } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/migration 223/)
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
