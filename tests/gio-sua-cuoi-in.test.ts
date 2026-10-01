/**
 * Chủ nhà 01/10/2026: "Sửa mẫu in hoá đơn. Thời gian trên phiếu là ngày giờ tạo chứ ko phải ngày giờ in"
 * → "Giờ sửa cuối. Hiện tại đang giờ tạo lần đầu". Kịch bản SQL: scripts/sql/thu-220-gio-sua-cuoi.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docGioSuaCuoi, docStampAt, gioSuaCuoi } from "@/lib/printing/doc-stamp"

const MIG = readFileSync("supabase/migrations/220_gio_sua_cuoi_chung_tu.sql", "utf8")
const TRANG = {
  sales_invoices: readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8"),
  sales_orders: readFileSync("src/app/(dashboard)/orders/[id]/print/page.tsx", "utf8"),
  returns: readFileSync("src/app/(dashboard)/returns/[id]/print/page.tsx", "utf8"),
}

const sb = (kq: { data: unknown; error: unknown } | Error) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => (kq instanceof Error ? Promise.reject(kq) : Promise.resolve(kq)),
      }),
    }),
  }),
})

describe("giờ trên tờ in = giờ sửa cuối", () => {
  it("có giờ sửa thì lấy giờ sửa, không thì giờ tạo", () => {
    const tao = "2026-09-30T08:00:00+07:00"
    const sua = "2026-10-01T15:42:00+07:00"
    expect(gioSuaCuoi(sua, tao)).toBe(sua)
    expect(gioSuaCuoi(null, tao)).toBe(tao)
    expect(gioSuaCuoi("hỏng", tao)).toBe(tao)
    expect(gioSuaCuoi(undefined, undefined)).toBeNull()
    const at = docStampAt(gioSuaCuoi(sua, tao), "2026-10-01").at
    expect(at?.toISOString()).toBe(new Date(sua).toISOString())
  })
  it("đọc giờ sửa: cột chưa có / mất mạng thì null (tờ in vẫn ra giờ tạo)", async () => {
    expect(await docGioSuaCuoi(sb({ data: { updated_at: "2026-10-01T08:00:00Z" }, error: null }), "sales_invoices", "x")).toBe("2026-10-01T08:00:00Z")
    expect(await docGioSuaCuoi(sb({ data: null, error: { message: "column updated_at does not exist" } }), "returns", "x")).toBeNull()
    expect(await docGioSuaCuoi(sb(new Error("mất mạng")), "sales_orders", "x")).toBeNull()
  })
  it("ba trang in dùng giờ sửa cuối, chờ đọc xong mới tắt loading (in tự động ?auto=1)", () => {
    for (const [bang, s] of Object.entries(TRANG)) {
      expect(s, bang).toContain(`docGioSuaCuoi(supabase as never, "${bang}", id)`)
      expect(s, bang).toMatch(/gioSuaCuoi\(gioSua, (inv|order|ret)\.created_at\)/)
      expect(s, bang).not.toMatch(/(docStampAt|mocInPhieuTra)\((inv|order|ret)\.created_at/)
      const cho = s.indexOf("setGioSua(await gioSuaP)")
      expect(cho, bang).toBeGreaterThan(0)
      expect(s.indexOf("setLoading(false)", cho), bang).toBeGreaterThan(cho)
    }
  })
  it("mig 220: chỉ sửa NỘI DUNG mới đổi giờ — trạng thái, số đã xuất HĐ thì không", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS updated_at timestamptz/)
    expect(MIG).toContain("ARRAY['invoiced_qty', 'batch_id', 'sort_order']")
    const don = MIG.slice(MIG.indexOf("_sua_luc_don()"), MIG.indexOf("$fn$;", MIG.indexOf("_sua_luc_don()")))
    expect(don).not.toContain("status")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._sua_luc_tu_dong() FROM PUBLIC, anon, authenticated")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
