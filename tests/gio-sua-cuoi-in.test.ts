/**
 * Mốc trên tờ in. Chủ nhà 01/10/2026: "Thời gian trên phiếu là ngày giờ tạo chứ ko phải ngày giờ in" → "Giờ sửa
 * cuối" → "Sao không lấy luôn trường ngày trên hoá đơn" (chọn: chỉ in ngày hoá đơn, bỏ hẳn giờ).
 * - Hoá đơn / đơn hàng: NGÀY chứng từ (`invoice_date` / `order_date`), không giờ.
 * - Phiếu trả: giờ sửa cuối (mig 220) nếu cùng ngày trả, khác ngày thì chỉ ngày (`mocInPhieuTra`).
 * Kịch bản SQL: scripts/sql/thu-220-gio-sua-cuoi.sql. Bấm thật: e2e/in-gio-sua-cuoi.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dateVN, docGioSuaCuoi, gioSuaCuoi, longDateVN, ngayChungTu } from "@/lib/printing/doc-stamp"

const MIG = readFileSync("supabase/migrations/220_gio_sua_cuoi_chung_tu.sql", "utf8")
const MAU = readFileSync("src/components/printing/sales-invoice.tsx", "utf8")
const HD = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
const DON = readFileSync("src/app/(dashboard)/orders/[id]/print/page.tsx", "utf8")
const TRA = readFileSync("src/app/(dashboard)/returns/[id]/print/page.tsx", "utf8")

const sb = (kq: { data: unknown; error: unknown } | Error) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => (kq instanceof Error ? Promise.reject(kq) : Promise.resolve(kq)),
      }),
    }),
  }),
})

describe("mốc trên tờ in", () => {
  it("ngày chứng từ: đúng ngày ghi trên HĐ, không trượt múi giờ", () => {
    expect(dateVN(ngayChungTu("2026-09-28"))).toBe("28/09/2026")
    expect(longDateVN(ngayChungTu("2026-01-01"))).toBe("Ngày 01 tháng 01 năm 2026")
    expect(ngayChungTu(null)).toBeNull()
    expect(ngayChungTu("hỏng")).toBeNull()
  })
  it("hoá đơn / đơn hàng in ngày chứng từ, không giờ, không còn lấy giờ tạo", () => {
    expect(MAU).toContain("Ngày {issuedHasTime === false ? dateVN(issuedAt) : stampVN(issuedAt)}")
    for (const [ten, s, cot] of [["hoá đơn", HD, "inv.invoice_date"], ["đơn hàng", DON, "order.order_date"]] as const) {
      expect(s, ten).toContain(`issuedAt={ngayChungTu(${cot})}`)
      expect(s, ten).toContain("issuedHasTime={false}")
      expect(s, ten).not.toMatch(/docStampAt\(|gioSuaCuoi\(/)
    }
  })
  it("phiếu trả: giờ sửa cuối, lùi về giờ tạo; chờ đọc xong mới tắt loading (in tự động ?auto=1)", () => {
    expect(gioSuaCuoi("2026-10-01T15:42:00+07:00", "2026-09-30T08:00:00+07:00")).toBe("2026-10-01T15:42:00+07:00")
    expect(gioSuaCuoi(null, "2026-09-30T08:00:00+07:00")).toBe("2026-09-30T08:00:00+07:00")
    expect(gioSuaCuoi("hỏng", null)).toBeNull()
    expect(TRA).toContain("mocInPhieuTra(gioSuaCuoi(gioSua, ret.created_at), ngayTra)")
    const cho = TRA.indexOf("setGioSua(await gioSuaP)")
    expect(cho).toBeGreaterThan(0)
    expect(TRA.indexOf("setLoading(false)", cho)).toBeGreaterThan(cho)
  })
  it("đọc giờ sửa: cột chưa có / mất mạng thì null", async () => {
    expect(await docGioSuaCuoi(sb({ data: { updated_at: "2026-10-01T08:00:00Z" }, error: null }), "returns", "x")).toBe("2026-10-01T08:00:00Z")
    expect(await docGioSuaCuoi(sb({ data: null, error: { message: "column updated_at does not exist" } }), "returns", "x")).toBeNull()
    expect(await docGioSuaCuoi(sb(new Error("mất mạng")), "returns", "x")).toBeNull()
  })
  it("mig 220: chỉ sửa NỘI DUNG mới đổi giờ — trạng thái, số đã xuất HĐ thì không", () => {
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS updated_at timestamptz/)
    expect(MIG).toContain("ARRAY['invoiced_qty', 'batch_id', 'sort_order']")
    const don = MIG.slice(MIG.indexOf("_sua_luc_don()"), MIG.indexOf("$fn$;", MIG.indexOf("_sua_luc_don()")))
    expect(don).not.toContain("status")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._sua_luc_tu_dong() FROM PUBLIC, anon, authenticated")
  })
})
