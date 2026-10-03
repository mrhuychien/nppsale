import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"
import { loadLotsByProduct } from "../src/lib/pos/load"
import { tonSauTheoKho, dieuKienDenNgay, type DongBienDong } from "../src/lib/inventory/lich-su-ton"
import { gopTonTheoSanPham } from "../src/components/inventory/stock-balance-table"

/**
 * KHO ĐỌC ĐỦ, KHÔNG ĐỂ 1.000 DÒNG / URL DÀI CẮT IM LẶNG (rà soát 03/10/2026).
 * Chỗ chạy được mã thật thì chạy trên Supabase giả (`helpers/fake-postgrest`: trần 1.000 dòng,
 * trần ~150 id trong `.in()`, trả lộn xộn khi thiếu mốc `id`); màn hình / hook thì soi nguồn.
 */

const ROOT = resolve(__dirname, "..")
const code = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("POS — lô hàng của cả giỏ lớn (loadLotsByProduct)", () => {
  const sp = Array.from({ length: 400 }, (_, i) => `p-${String(i).padStart(4, "0")}`)
  const lo = nRows(2400, (i) => ({
    product_id: sp[i % sp.length],
    batch_code: `L${i}`,
    expires_at: "2027-01-01",
    qty_on_hand: 5,
    warehouse_zone: "sale",
    status: "available",
  }))

  it("400 mã, 2.400 lô → đủ 2.400 lô, không vỡ URL `.in()`", async () => {
    const { client } = fakePostgrest({ batches: lo.map((r) => ({ ...r })) })
    const out = await loadLotsByProduct(client as never, sp)
    expect(Object.keys(out)).toHaveLength(400)
    expect(Object.values(out).reduce((s, l) => s + l.length, 0)).toBe(2400)
  })

  it("đọc hỏng thì NÉM, không trả `{}` như thể hết lô", async () => {
    const { client } = fakePostgrest({ batches: lo.map((r) => ({ ...r })) }, { failOn: (c) => c.table === "batches" })
    await expect(loadLotsByProduct(client as never, sp)).rejects.toThrow(/Lô hàng/)
  })
})

describe("Lịch sử tồn — tồn sau có tồn đầu kỳ (tonSauTheoKho)", () => {
  const d = (id: string, ngay: string, kho: "sale" | "date", sl: number): DongBienDong => ({
    id,
    warehouse_zone: kho,
    posted_at: `${ngay}T03:00:00Z`,
    created_at: `${ngay}T03:00:00Z`,
    signed_qty_in_base_uom: sl,
  })
  const rows = [
    d("a", "2026-09-01", "sale", 100),
    d("b", "2026-09-05", "date", 7),
    d("c", "2026-09-10", "sale", -30),
    d("e", "2026-09-20", "sale", -5),
    d("f", "2026-09-21", "date", -2),
  ]

  it("lọc Từ ngày: dòng đầu kỳ cộng tiếp từ tồn trước đó, không từ 0", () => {
    const { dong, dauKy } = tonSauTheoKho(rows, "2026-09-15")
    expect(dauKy).toEqual({ sale: 70, date: 7 })
    expect(dong.map((r) => [r.id, r.tonSau])).toEqual([
      ["f", 5],
      ["e", 65],
    ])
  })

  it("không lọc: cộng từ giao dịch đầu tiên, mới nhất trước", () => {
    const { dong } = tonSauTheoKho(rows, "")
    expect(dong.map((r) => r.tonSau)).toEqual([5, 65, 70, 7, 100])
  })

  it("mốc ngày theo giờ VN: 00:30 sáng 15/09 giờ VN thuộc ngày 15", () => {
    const r = { ...d("g", "x", "sale", 1), posted_at: "2026-09-14T17:30:00Z" }
    expect(tonSauTheoKho([r], "2026-09-15").dong).toHaveLength(1)
    expect(dieuKienDenNgay("2026-09-15")).toContain('"2026-09-15T23:59:59.999+07:00"')
  })

  it("ngăn kéo: lọc kho + Đến ngày trên máy chủ, đọc đủ theo trang, chỉ phiếu đã ghi sổ", () => {
    const s = code("src/components/inventory/stock-history-drawer.tsx")
    expect(s).not.toMatch(/\.limit\(500\)/)
    expect(s).toContain("fetchAllForAggregate<MovementRow>")
    expect(s).toContain('.eq("entry_status", "posted")')
    expect(s).toContain('q = q.eq("warehouse_zone", zoneFilter)')
    expect(s).toContain("q = q.or(dieuKienDenNgay(dateTo))")
    expect(s).toMatch(/\.order\("id"\)\.range\(from, to\)/)
    expect(s).toContain("tonSauTheoKho(rows, dateFrom)")
  })
})

describe("Bảng tồn — mã ngừng bán còn tồn vẫn lên bảng (gopTonTheoSanPham)", () => {
  const sp = new Map([
    ["a", { id: "a", sku: "A", name: "Đang bán", base_unit: "lon", status: "active" }],
    ["b", { id: "b", sku: "B", name: "Ngừng còn tồn", base_unit: "lon", status: "inactive" }],
    ["c", { id: "c", sku: "C", name: "Ngừng hết tồn", base_unit: "lon", status: "inactive" }],
    ["d", { id: "d", sku: "D", name: "Đang bán hết tồn", base_unit: "lon", status: "active" }],
  ])
  const ton = [
    { product_id: "a", warehouse_zone: "sale" as const, qty_in_base_uom: 10, value: 100 },
    { product_id: "b", warehouse_zone: "date" as const, qty_in_base_uom: 4, value: 40 },
    { product_id: "c", warehouse_zone: "sale" as const, qty_in_base_uom: 0, value: 0 },
  ]

  it("chỉ hàng còn tồn: có cả mã ngừng bán còn tồn", () => {
    const ids = gopTonTheoSanPham(ton, sp, true).map((r) => r.product.id).sort()
    expect(ids).toEqual(["a", "b"])
  })

  it("hiện cả hết tồn: thêm mã ĐANG BÁN hết tồn, không thêm mã ngừng bán hết tồn", () => {
    const ids = gopTonTheoSanPham(ton, sp, false).map((r) => r.product.id).sort()
    expect(ids).toEqual(["a", "b", "d"])
  })

  it("truy vấn sản phẩm không còn lọc status = active", () => {
    const s = code("src/components/inventory/stock-balance-table.tsx")
    expect(s).not.toMatch(/from\("products"\)[\s\S]{0,200}\.eq\("status", "active"\)/)
  })
})

describe("Màn kho / sản phẩm — đọc đủ và có mốc `id`", () => {
  it("kiểm kê: tải toàn bộ tồn đọc đủ danh mục (loadCatalogue), lô có mốc id, hỏng thì dừng", () => {
    const s = code("src/app/(dashboard)/inventory/stocktake-adjust/page.tsx")
    expect(s).toMatch(/loadCatalogue<Product>\([\s\S]*?\{ activeOnly: true \}/)
    expect(s).toMatch(/\.gt\("qty_on_hand", 0\)\s*\.order\("id"\)\s*\.range/)
    expect(s).toContain("if (prodRes.truncated || batchRes.error || batchRes.truncated)")
  })

  it("thẻ kho: dòng phiếu kho đọc đủ, lọc đã ghi sổ trên máy chủ, có cảnh báo thiếu", () => {
    const s = code("src/app/(dashboard)/inventory/stock-card/[productId]/page.tsx")
    expect(s).toMatch(/from\("stock_entry_lines"\)[\s\S]*?\.eq\("entry\.status", "posted"\)\s*\.order\("id"\)\s*\.range/)
    expect(s).toMatch(/from\("batches"\)[\s\S]*?\.order\("id"\)\s*\.range/)
    expect(s).toContain("linesRes.truncated")
    expect(s).toContain("{thieu && (")
  })

  it("phiếu kho điện thoại: dòng phiếu đọc theo lô id, có mốc id", () => {
    const s = code("src/components/inventory/phieu-kho-dien-thoai.tsx")
    expect(s).toMatch(/docTheoLoId<DongPhieu>\(\s*thieu,/)
    expect(s).toMatch(/\.in\("entry_id", lo\)\s*\.order\("id"\)\s*\.range\(from, to\)/)
  })

  it("danh mục sản phẩm đọc đủ theo trang; đếm NCC dự phòng có mốc id", () => {
    const s = code("src/app/(dashboard)/products/page.tsx")
    expect(s).not.toMatch(/from\("products"\)\.select\("category"\)/)
    expect(s).toMatch(/select\("category", \{ count: "exact" \}\)\s*\.not\("category", "is", null\)\s*\.order\("id"\)\s*\.range/)
    expect(s).toMatch(/select\("primary_supplier_id, status", \{ count: "exact" \}\)\)\.order\("id"\)\.range/)
  })

  it("tra soát / hàng đã đặt / kiểm kê lô: phân trang song song có mốc duy nhất", () => {
    expect(code("src/app/(dashboard)/inventory/audit/page.tsx")).toMatch(
      /\.gt\("qty_on_hand", 0\)\s*\.order\("id"\)\s*\.range/
    )
    expect(code("src/hooks/use-committed-stock.tsx")).toMatch(
      /select\("product_id, committed_base"\)\s*\.order\("product_id"\)\s*\.range/
    )
    expect(code("src/app/(dashboard)/inventory/stocktake-check/page.tsx")).toMatch(
      /\.order\("product_id"\)\s*\.order\("id"\)\s*\.range/
    )
  })
})
