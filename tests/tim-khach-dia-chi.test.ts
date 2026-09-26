import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { dieuKienTim } from "../src/lib/search/list-search"
import { COT_TIM_KHACH } from "../src/app/(dashboard)/customers/list-config"

/** ⚠ Chủ nhà 26/09/2026: "Sửa ô tìm kiếm ở màn danh sách khách hàng: thêm cả địa chỉ". */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("ô tìm khách theo cả địa chỉ", () => {
  it("cột tìm có địa chỉ, phường, quận, tỉnh", () => {
    for (const c of ["store_name", "owner_name", "phone", "address", "ward", "district", "province"]) {
      expect(COT_TIM_KHACH, c).toContain(c)
    }
    expect(dieuKienTim("customers", COT_TIM_KHACH, "Hàng Kênh")).toContain('address.ilike."%Hàng Kênh%"')
    expect(dieuKienTim("customers", COT_TIM_KHACH, "Hàng Kênh")).toContain('tim_kd.ilike."%hang kenh%"')
  })
  it("màn danh sách dùng đúng bộ cột; chữ gợi ý nói có địa chỉ", () => {
    const p = doc("src/app/(dashboard)/customers/page.tsx")
    expect(p).toContain('dieuKienTim("customers", COT_TIM_KHACH, debouncedSearch)')
    expect(p).toContain("SĐT, địa chỉ…")
    expect(doc("src/components/customers/mobile-customers-screen.tsx")).toContain('placeholder="Tên cửa hàng, chủ quán, SĐT, địa chỉ"')
  })
  it("mig 203: tim_kd của khách ghép cả địa chỉ (gõ không dấu vẫn ra), điền lại dòng cũ", () => {
    const m = doc("supabase/migrations/203_tim_khach_theo_dia_chi.sql")
    expect(m).toMatch(/_trg_tim_kd\(\s*'store_name', 'owner_name', 'phone', 'tax_code', 'address', 'ward', 'district', 'province'\)/)
    expect(m).toContain("UPDATE public.customers SET tim_kd = NULL")
    expect(m).toContain("NOTIFY pgrst, 'reload schema';")
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 203 (Tìm khách theo địa chỉ)")
  })
})
