import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import {
  CATALOG_FRESH_MS, FRESH_MS, isCachedCatalogFresh, isSellCatalogFresh, isSellRefDataFresh,
  loadSellRefDataShared, refreshSellStockShared, resetSellRefData, peekSellRefData, seedSellRefData,
} from "../src/lib/sell/ref-store"
import type { SellRefData } from "../src/lib/sell/ref-data"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "tối ưu lại hiệu năng tốc độ truy cập, độ trễ thao tác phần
 *   sell mobile … mượt như app mobile". Đo (perf/sell.perf.ts, điện thoại giả lập):
 *   mở lại /sell tải 177 KB → 23 KB khi chỉ làm mới tồn; danh mục bỏ cột thừa −30%.
 */
const SRC = readFileSync("src/lib/sell/ref-data.ts", "utf8")
const cot = (ten: string) => {
  const m = SRC.match(new RegExp(`const ${ten} =\\s*([\\s\\S]*?)\\n\\n`))
  return (m?.[1] ?? "").replace(/"\s*\+\s*"/g, "")
}

describe("danh mục /sell chỉ lấy cột cần dùng", () => {
  it("sản phẩm: đủ cột màn bán đọc, KHÔNG giá vốn, không cột kho / mô tả", () => {
    const P = cot("PROD_COLS")
    for (const c of ["id", "sku", "name", "barcode", "base_unit", "vat_rate", "status", "sell_price", "images", "allow_price_edit"]) {
      expect(P, c).toMatch(new RegExp(`\\b${c}\\b`))
    }
    expect(P).toContain("price_lists(id, product_id, unit_name, price, group_id)")
    expect(P).toContain("units:product_units(id, product_id, unit_name, conversion)")
    for (const c of ["cost_price", "description", "warranty_info", "shelf_location", "min_stock", "max_stock", "primary_supplier_id", "price_lists(*)"]) {
      expect(P, c).not.toContain(c)
    }
  })
  it("khách: đủ cột màn bán đọc (giá theo nhóm, hạn mức, điều khoản), bỏ GPS / hoá đơn điện tử", () => {
    const C = cot("CUST_COLS")
    for (const c of ["store_name", "owner_name", "phone", "address", "group_id", "credit_limit", "payment_terms", "group:customer_groups(id, name)"]) {
      expect(C, c).toContain(c)
    }
    for (const c of ["gps_lat", "billing_email", "tax_code", "customer_groups(*)"]) expect(C, c).not.toContain(c)
  })
  it("sổ thiếu cột → vẫn có đường dự phòng lấy đủ", () => {
    expect(SRC).toContain('pageAll<SellProduct>("*, price_lists(*), units:product_units(*)", "products", "name")')
  })
})

const mau = (stock: Record<string, number>): SellRefData => ({
  customers: [], products: [{ id: "p1" } as never], stockByProduct: stock, source: "server", warnings: [],
})

describe("làm mới: tồn kho 2 phút, danh mục 30 phút", () => {
  beforeEach(() => resetSellRefData())
  it("danh mục tải đủ → cả hai mới; quá 2 phút chỉ tồn cũ; quá 30 phút danh mục cũ", async () => {
    let now = 1_000_000
    await loadSellRefDataShared(async () => mau({ p1: 5 }), () => now)
    expect(isSellRefDataFresh(now)).toBe(true)
    expect(isSellCatalogFresh(now)).toBe(true)
    now += FRESH_MS + 1
    expect(isSellRefDataFresh(now)).toBe(false)
    expect(isSellCatalogFresh(now)).toBe(true)
    now += CATALOG_FRESH_MS
    expect(isSellCatalogFresh(now)).toBe(false)
  })
  it("làm mới tồn: thay tồn, GIỮ danh mục, đóng dấu lại mốc tồn", async () => {
    let now = 1_000_000
    await loadSellRefDataShared(async () => mau({ p1: 5 }), () => now)
    now += FRESH_MS + 1
    const st = await refreshSellStockShared(async () => ({ p1: 2 }), () => now)
    expect(st).toEqual({ p1: 2 })
    expect(peekSellRefData()?.stockByProduct).toEqual({ p1: 2 })
    expect(peekSellRefData()?.products).toHaveLength(1)
    expect(isSellRefDataFresh(now)).toBe(true)
  })
  it("đọc tồn hỏng (null) → giữ số đang hiện, không thay bằng tồn 0", async () => {
    await loadSellRefDataShared(async () => mau({ p1: 5 }))
    expect(await refreshSellStockShared(async () => null)).toBeNull()
    expect(peekSellRefData()?.stockByProduct).toEqual({ p1: 5 })
  })
  it("bản trên máy chưa quá 30 phút làm gốc được; quá hạn / hỏng thì không", () => {
    const now = Date.parse("2026-09-25T10:00:00Z")
    expect(isCachedCatalogFresh("2026-09-25T09:45:00Z", now)).toBe(true)
    expect(isCachedCatalogFresh("2026-09-25T09:00:00Z", now)).toBe(false)
    expect(isCachedCatalogFresh(null, now)).toBe(false)
    expect(isCachedCatalogFresh("rác", now)).toBe(false)
    seedSellRefData(mau({ p1: 9 }), now)
    expect(isSellCatalogFresh(now)).toBe(true)
    expect(isSellRefDataFresh(now), "tồn của bản trên máy luôn phải làm mới").toBe(false)
  })
  it("màn /sell: danh mục còn mới thì chỉ làm mới tồn; 'Tải lại' vẫn tải đủ", () => {
    const H = readFileSync("src/hooks/use-sell-data.tsx", "utf8")
    expect(H).toContain("if (tick === 0 && isSellCatalogFresh()) {")
    expect(H).toContain("const stock = await refreshSellStockShared(() => loadSellStock(createClient()))")
  })
})

describe("vùng chạy function trên Vercel", () => {
  /**
   * ⚠ CHỦ NHÀ 25/09/2026: "supabase đang ở singapore, chuyển vùng vercel sang sin1 đi".
   *   Mặc định `iad1` (Mỹ): mọi lượt vẽ trang / chuyển màn đi VN → Mỹ, và mỗi truy
   *   vấn phía máy chủ còn Mỹ ↔ Singapore. Gói Hobby chỉ một vùng — đúng một phần tử.
   */
  it("chạy ở sin1, cạnh Supabase (Singapore)", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8"))
    expect(v.regions).toEqual(["sin1"])
  })
})
