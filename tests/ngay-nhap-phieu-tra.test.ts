/** Chủ nhà 28/09/2026: "Các phiếu trả tự sinh tao muốn sửa ngày lúc nhập kho" (mig 211). */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { loiNgayNhap } from "@/lib/returns/ngay-nhap"
import { explainReturnError } from "@/lib/returns/complete-return"

describe("ngày nhập kho phiếu trả tự sinh", () => {
  it("không sau hôm nay, không trước ngày hóa đơn", () => {
    expect(loiNgayNhap("2026-09-28", "2026-09-28", "2026-09-20")).toBeNull()
    expect(loiNgayNhap("2026-09-20", "2026-09-28", "2026-09-20")).toBeNull()
    expect(loiNgayNhap("2026-09-29", "2026-09-28", null)).toMatch(/sau hôm nay/)
    expect(loiNgayNhap("2026-09-19", "2026-09-28", "2026-09-20")).toMatch(/trước ngày hóa đơn/)
    expect(loiNgayNhap("", "2026-09-28", null)).toMatch(/Chọn ngày/)
  })
  it("lỗi máy chủ ra câu tiếng Việt", () => {
    expect(explainReturnError("NGAY_NHAP_TRUOC_HOA_DON: ngày nhập kho 19/09/2026 trước ngày hóa đơn 20/09/2026"))
      .toBe("ngày nhập kho 19/09/2026 trước ngày hóa đơn 20/09/2026")
  })
  it("mig 211: bản 3 tham số không mặc định, gọi bản 2 tham số, dời mốc phiếu nhập, chỉ phiếu tự sinh", () => {
    const m = readFileSync("supabase/migrations/211_ngay_nhap_kho_phieu_tra_tu_sinh.sql", "utf8")
    expect(m).toMatch(/complete_return\(p_return_id uuid, p_zone text, p_ngay date\)/)
    expect(m).not.toMatch(/p_ngay date DEFAULT/i)
    expect(m).toMatch(/FROM public\.complete_return\(p_return_id, p_zone\) c/)
    expect(m).toMatch(/UPDATE stock_entries SET posted_at = v_moc WHERE id = v_entry/)
    expect(m).toContain("NGAY_NHAP_CHI_TU_SINH")
    expect(m).not.toMatch(/revenue_date\s*=/)
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 211")
  })
})
