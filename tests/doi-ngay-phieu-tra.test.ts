/**
 * Chủ nhà 08/10/2026: "phiếu tự sinh theo đơn đặt hàng tao cũng muốn sửa được ngày tháng". Máy chủ:
 * scripts/sql/thu-doi-ngay-phieu-tra-tu-sinh.sql (5/5). Bấm thật: e2e/doi-ngay-phieu-tra-tu-sinh.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { giaiThichDoiNgay, hanhDongPhieuTra, loiDoiNgayPhieuTra } from "@/lib/returns/loai-phieu"

const TU_SINH = { status: "submitted", credit_with_invoice: true, invoice_id: "hd", order_id: "o" }

describe("loiDoiNgayPhieuTra", () => {
  it("phiếu tự sinh đổi được ngày (dù sửa hàng / tiền vẫn khoá)", () => {
    expect(hanhDongPhieuTra(TU_SINH).sua).toBe(false)
    expect(loiDoiNgayPhieuTra(TU_SINH, "2026-10-04", "2026-10-08")).toBeNull()
    expect(loiDoiNgayPhieuTra({ ...TU_SINH, status: "completed" }, "2026-10-04", "2026-10-08")).toBeNull()
  })
  it("không cho ngày sau hôm nay; phiếu huỷ không đổi; ngày sai dạng thì nhắc chọn", () => {
    expect(loiDoiNgayPhieuTra(TU_SINH, "2026-10-09", "2026-10-08")).toMatch(/sau hôm nay/)
    expect(loiDoiNgayPhieuTra({ ...TU_SINH, status: "cancelled" }, "2026-10-01", "2026-10-08")).toMatch(/huỷ/)
    expect(loiDoiNgayPhieuTra(TU_SINH, "", "2026-10-08")).toMatch(/Chọn ngày/)
  })
  it("câu giải thích nói đúng ngày đổi ảnh hưởng tới đâu", () => {
    expect(giaiThichDoiNgay(TU_SINH)).toMatch(/vẫn tính theo ngày hóa đơn/)
    expect(giaiThichDoiNgay({ status: "completed", credit_with_invoice: false })).toMatch(/đi theo ngày mới/)
  })
})

describe("nối dây", () => {
  it("trang chi tiết phiếu trả có Đổi ngày cho phiếu chưa huỷ, theo quyền sửa phiếu (RLS)", () => {
    const s = readFileSync("src/app/(dashboard)/returns/[id]/page.tsx", "utf8")
    expect(s).toMatch(/\{canEdit && ret\.status !== "cancelled" && \(\s*<DoiNgayPhieuTra /)
  })
  it("ghi ngày đếm số dòng (RLS từ chối = 0 dòng)", () => {
    const s = readFileSync("src/components/returns/doi-ngay-phieu-tra.tsx", "utf8")
    expect(s).toMatch(/update\(\{ return_date: gt \}\)[\s\S]{0,60}\.select\("id"\)/)
    expect(s).toMatch(/!data \|\| data\.length === 0/)
  })
})
