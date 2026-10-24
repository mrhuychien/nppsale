import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"
import { taiDanhMucLoc, taiDanhMucNang, taiDanhMucNhe } from "@/lib/analytics/filter-catalogs"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: mở báo cáo nào ở /reports cũng kéo cả sổ khách +
 *   danh mục hàng cho ô lọc chưa ai bấm (`/reports/sales` còn kéo mỗi thứ hai lần). Nay danh mục NHẸ (NV, nhóm khách,
 *   tuyến, NCC) tải lúc mở; danh mục NẶNG (khách, hàng, thương hiệu) tải khi ô chọn mở hoặc đã có giá trị cần nhãn.
 */
const ORG = "org-1"
const bang = () => ({
  customers: nRows(3, (i) => ({ org_id: ORG, store_name: `Khách ${i}`, phone: `09${i}` })),
  products: nRows(4, (i) => ({ org_id: ORG, sku: `SP${i}`, name: `Hàng ${i}`, brand: i % 2 ? "Vinamilk" : "TH", status: "active" })),
  users: nRows(2, (i) => ({ org_id: ORG, full_name: `NV ${i}`, role: "sales", is_active: true })),
  customer_groups: nRows(1, () => ({ org_id: ORG, name: "Sỉ" })),
  sales_routes: nRows(2, (i) => ({ org_id: ORG, code: `T${i}`, name: `Tuyến ${i}`, is_active: true, sort_order: i })),
  suppliers: nRows(1, () => ({ org_id: ORG, name: "NCC A" })),
})
const daHoi = (calls: Array<{ table: string }>, t: string) => calls.some((c) => c.table === t)

describe("danh mục lọc báo cáo: nhẹ tải trước, nặng tải khi cần", () => {
  it("taiDanhMucNhe: không đụng customers / products; đủ NV, nhóm, tuyến, NCC", async () => {
    const { client, calls } = fakePostgrest(bang())
    const { lists, truncated } = await taiDanhMucNhe(client, ORG)
    expect(daHoi(calls, "customers")).toBe(false)
    expect(daHoi(calls, "products")).toBe(false)
    expect(lists.salesUsers).toHaveLength(2)
    expect(lists.customerGroups).toEqual([{ id: expect.any(String), label: "Sỉ" }])
    expect(lists.routes).toHaveLength(2)
    expect(lists.suppliers).toHaveLength(1)
    expect(truncated).toBe(false)
  })

  it("taiDanhMucNang: chỉ customers + products; thương hiệu rút từ hàng, có sắp", async () => {
    const { client, calls } = fakePostgrest(bang())
    const { lists } = await taiDanhMucNang(client, ORG)
    expect(calls.map((c) => c.table).sort()).toEqual(["customers", "products"])
    expect(lists.customers).toHaveLength(3)
    expect(lists.products).toHaveLength(4)
    expect(lists.brands.map((b) => b.id)).toEqual(["TH", "Vinamilk"])
  })

  it("taiDanhMucLoc (đường cũ cho nơi cần đủ) = nhẹ + nặng", async () => {
    const { client } = fakePostgrest(bang())
    const { lists } = await taiDanhMucLoc(client, ORG)
    expect(Object.keys(lists).sort()).toEqual(
      ["allUsers", "brands", "customerGroups", "customers", "drivers", "products", "routes", "salesUsers", "suppliers"]
    )
    expect(lists.customers).toHaveLength(3)
    expect(lists.routes).toHaveLength(2)
  })
})

describe("hook + ô chọn: ba danh mục nặng chỉ tải khi ô mở", () => {
  const HOOK = readFileSync("src/lib/analytics/filter-catalogs.ts", "utf8")
  const SHELL = readFileSync("src/components/analytics/report-shell.tsx", "utf8")

  it("useFilterCatalogs: lượt mở gọi taiDanhMucNhe; taiDanhMucNang chờ nang(); trả nang + nangDangTai", () => {
    const i = HOOK.indexOf("export function useFilterCatalogs(")
    const than = HOOK.slice(i)
    expect(than).toContain("await taiDanhMucNhe(supabase, orgId)")
    expect(than).toContain("if (!orgId || !canNang) return")
    expect(than).toContain("await taiDanhMucNang(supabase, orgId)")
    expect(than).toContain("const nang = useCallback(() => setCanNang(true), [])")
    expect(than).toContain("nangDangTai: nangKq.loading,")
  })

  it("FilterSearchSelect / FilterMultiSelect gọi khiMo khi mở hoặc đã có giá trị mà chưa có mục", () => {
    expect(SHELL).toContain("if (open || (value && options.length === 0)) khiMo?.()")
    expect(SHELL).toContain("if (open || (value.length > 0 && options.length === 0)) khiMo?.()")
  })

  it("11 ô chọn khách / hàng / thương hiệu ở /reports đều nối khiMo và báo tải theo nangDangTai", () => {
    const tep = [
      "products", "end-of-day", "inventory", "customers", "channels", "orders", "employees",
    ].map((f) => readFileSync(`src/app/(dashboard)/reports/${f}/page.tsx`, "utf8")).join("\n")
    const nang = tep.match(/options=\{catalogs\.(customers|products|brands)\}\n\s*khiMo=\{catalogs\.nang\}/g) ?? []
    expect(nang.length).toBe(11)
    /* Không ô nặng nào còn báo "Đang tải…" theo lượt nhẹ. */
    for (const m of Array.from(tep.matchAll(/options=\{catalogs\.(customers|products|brands)\}[\s\S]{0,200}?\/>/g))) {
      expect(m[0], m[0]).not.toContain("loading={catalogs.loading}")
      expect(m[0], m[0]).toContain("loading={catalogs.nangDangTai}")
    }
  })
})
