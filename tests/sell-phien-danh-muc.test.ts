/**
 * Chủ nhà 28/09/2026: "Trên màn sell mobile NVBH khi sản phẩm cập nhật thì bao lâu mới xuất hiện"
 * → "Làm đi, thêm nút làm mới sản phẩm". Mig 209: số phiên danh mục; máy so số đó với bản đang giữ.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { kiemPhienDanhMucShared, loadSellRefDataShared, resetSellRefData, sellCatalogAt } from "@/lib/sell/ref-store"
import type { SellRefData } from "@/lib/sell/ref-data"

const du = (phien: number | null): SellRefData => ({ customers: [], products: [], stockByProduct: {}, source: "server", warnings: [], phien })

describe("so số phiên danh mục", () => {
  beforeEach(() => resetSellRefData())
  it("chưa có bản trong máy → không biết (null)", async () => {
    expect(await kiemPhienDanhMucShared(async () => 5)).toBeNull()
  })
  it("cùng số → chưa đổi; khác số → đã đổi; máy chủ không trả số → không biết", async () => {
    await loadSellRefDataShared(async () => du(7), () => 1000)
    expect(sellCatalogAt()).toBe(1000)
    expect(await kiemPhienDanhMucShared(async () => 7)).toBe(false)
    expect(await kiemPhienDanhMucShared(async () => 8)).toBe(true)
    expect(await kiemPhienDanhMucShared(async () => null)).toBeNull()
  })
  it("bản đang giữ không có số (sổ chưa chạy 209) → không biết, giữ luật 30 phút", async () => {
    await loadSellRefDataShared(async () => du(null))
    expect(await kiemPhienDanhMucShared(async () => 3)).toBeNull()
  })
  it("hai nơi hỏi cùng lúc → một lượt gọi", async () => {
    await loadSellRefDataShared(async () => du(1))
    let n = 0
    const loader = async () => { n++; return 2 }
    await Promise.all([kiemPhienDanhMucShared(loader), kiemPhienDanhMucShared(loader)])
    expect(n).toBe(1)
  })
})

describe("mig 209 + màn /sell", () => {
  const m = readFileSync("supabase/migrations/209_phien_danh_muc_ban.sql", "utf8")
  it("trigger MỨC CÂU LỆNH trên products / price_lists / product_units; không ai ghi thẳng", () => {
    expect(m).toMatch(/ARRAY\['products', 'price_lists', 'product_units'\]/)
    expect(m).toMatch(/FOR EACH STATEMENT EXECUTE FUNCTION public\._tang_phien_danh_muc_ban\(\)/)
    expect(m).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.danh_muc_ban_phien FROM PUBLIC, anon, authenticated/)
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\._tang_phien_danh_muc_ban\(\) FROM PUBLIC, anon, authenticated/)
  })
  it("mở màn / quay lại app: hỏi số phiên cùng tồn; nút Làm mới sản phẩm tải đủ", () => {
    const h = readFileSync("src/hooks/use-sell-data.tsx", "utf8")
    expect(h).toMatch(/kiemPhienDanhMucShared\(\(\) => docPhienDanhMuc\(sb\)\)/)
    expect(h).toMatch(/if \(stock && daDoi !== true\)/)
    expect(h).toMatch(/addEventListener\("visibilitychange"/)
    expect(readFileSync("src/app/(dashboard)/sell/page.tsx", "utf8")).toContain('aria-label="Làm mới sản phẩm"')
  })
})
