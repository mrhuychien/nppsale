import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { taiDanhMucLoc } from "@/lib/analytics/filter-catalogs"
import { locPhieuXuatBan, type PostedStockEntryRow } from "@/lib/analytics/sales"
import { fakePostgrest } from "./helpers/fake-postgrest"
import { taoBoLuot } from "@/hooks/use-luot-nap"

/**
 * RÀ BỘ LỌC — BÁO CÁO CŨ (/reports/*, /analytics/*) (chủ nhà 09/10/2026: "rà soát lại phần báo cáo xem các bộ lọc có
 * hoạt động không?"). Phần màn hình (React) chốt bằng phép quét mã (bỏ chú thích); phần thư viện chạy thật trên
 * PostgREST giả. Hành vi trên màn có e2e riêng (`e2e/bao-cao-cu-loc-ra-soat.spec.ts`).
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8")
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
const code = (p: string) => boChuThich(doc(p))
const ORG = "org"

describe("danh mục ô lọc: gồm người đã nghỉ / hàng ngừng bán / tuyến ngừng — có ghi chú, xếp sau", () => {
  it("đọc cả mục ngừng, mục đang dùng đứng trước; nhãn tuyến vẫn là TÊN (nơi gọi khớp kênh theo tên)", async () => {
    const f = fakePostgrest({
      customers: [{ id: "c1", org_id: ORG, store_name: "Khách", phone: null }],
      users: [
        { id: "u1", org_id: ORG, full_name: "A Nghỉ", role: "sales", is_active: false },
        { id: "u2", org_id: ORG, full_name: "B Đang", role: "sales", is_active: true },
      ],
      products: [
        { id: "p1", org_id: ORG, sku: "S1", name: "A ngừng", brand: "X", status: "inactive" },
        { id: "p2", org_id: ORG, sku: "S2", name: "B bán", brand: "Y", status: "active" },
      ],
      customer_groups: [],
      sales_routes: [
        { id: "r1", org_id: ORG, code: "T1", name: "Tuyến cũ", is_active: false, sort_order: 0 },
        { id: "r2", org_id: ORG, code: "T2", name: "Tuyến mới", is_active: true, sort_order: 1 },
      ],
      suppliers: [],
    })
    const { lists } = await taiDanhMucLoc(f.client as never, ORG)
    expect(lists.salesUsers.map((u) => [u.id, u.ghiChu])).toEqual([["u2", undefined], ["u1", "đã nghỉ"]])
    expect(lists.allUsers.find((u) => u.id === "u1")?.label).toBe("A Nghỉ")
    expect(lists.products.map((p) => [p.id, p.ghiChu])).toEqual([["p2", undefined], ["p1", "ngừng bán"]])
    expect(lists.routes.map((r) => [r.id, r.label, r.ghiChu])).toEqual([["r2", "Tuyến mới", undefined], ["r1", "Tuyến cũ", "ngừng"]])
    // Thương hiệu chỉ của hàng đang bán.
    expect(lists.brands.map((b) => b.id)).toEqual(["Y"])
  })
  it("ô chọn hiện ghi chú mờ sau tên, không đưa vào nhãn", () => {
    const s = code("src/components/analytics/report-shell.tsx")
    expect(s.match(/\{o\.ghiChu && <span className="text-muted-foreground"> \(\{o\.ghiChu\}\)<\/span>\}/g)?.length).toBe(2)
  })
})

describe("khung báo cáo cũ: nút 'Xuất tất cả' theo quyền xuất file", () => {
  it("ReportShell kiểm duocXuatFile như ReportFrame", () => {
    const s = code("src/components/analytics/report-shell.tsx")
    expect(s).toContain('const xuat = duocXuatFile(user?.role, "reports")')
    expect(s).toContain("{onExportCsv && xuat ? (")
  })
})

describe("phiếu xuất BÁN cho giá vốn — bỏ phiếu đảo phiếu trả và phiếu của HĐ đã huỷ", () => {
  it("locPhieuXuatBan", async () => {
    const e = (id: string, type: PostedStockEntryRow["type"], notes = ""): PostedStockEntryRow => ({ id, type, status: "posted", posted_at: "2026-09-10T03:00:00Z", entry_code: id, supplier_id: null, notes })
    const f = fakePostgrest({
      sales_invoices: [
        { id: "h1", stock_entry_id: "x-huy", status: "cancelled" },
        { id: "h2", stock_entry_id: "x-ban", status: "posted" },
      ],
    })
    const ds = await locPhieuXuatBan(f.client as unknown as SupabaseClient, [
      e("x-ban", "export"),
      e("x-huy", "export"),
      e("x-dao", "export", "Đảo phiếu trả 123"),
      e("n-1", "import"),
    ])
    expect(ds.map((x) => x.id)).toEqual(["x-ban"])
  })
})

describe("báo cáo Bán hàng (cũ): lọc NCC = phần tiền của hàng NCC ấy, mọi tab cùng bộ lọc", () => {
  const s = code("src/app/(dashboard)/reports/sales/page.tsx")
  it("hoá đơn / phiếu trả chia tiền theo dòng; phiếu trả lọc theo dòng trả", () => {
    expect(s).toContain("out.push({ ...o, total: phanTienQuaLoc(Number(o.total || 0), ls, quaHang) })")
    expect(s).toContain("credit_note_amount: phanTienQuaLoc(Number(r.credit_note_amount || 0), ls, quaHang)")
    expect(s).toContain("fetchReturnLines(supabase, returnsRes.rows.map((r) => r.id))")
  })
  it("tab Trả hàng dùng phiếu đã lọc; tab Giảm giá chia giảm giá theo dòng", () => {
    expect(s).toMatch(/const returnsRows: ReturnSummaryRow\[\] = useMemo\(\(\) => \{\s*return filteredReturns/)
    expect(s).toContain("giam: phanTienQuaLoc(giamHd, ls, quaHang)")
  })
  it("tab Lợi nhuận: đang lọc thì giá vốn của đúng hàng đã lọc, không phải cả sổ", () => {
    expect(s).toContain("const dangLoc = coLocHang || priceListFilter.length > 0 || routeFilter.length > 0")
    expect(s).toContain("giaVonTraCuaPhieu(returnCosts.get(r.id), supplierPasses)")
    expect(s).toMatch(/if \(!dangLoc\) \{[\s\S]*?stockLines[\s\S]*?\}\s*const avgCost = giaVonBinhQuanCoSo\(stockLines\)/)
  })
})

describe("báo cáo Đặt hàng: tab Giao dịch qua cùng bộ lọc", () => {
  const s = code("src/app/(dashboard)/reports/orders/page.tsx")
  it("bảng giá / nhóm khách lọc ở cấp đơn; hàng hoá / thương hiệu lọc dòng và chia tiền đơn", () => {
    expect(s).toContain("if (groupFilter && customerMap.get(o.customer_id)?.group_id !== groupFilter) return false")
    expect(s).toContain("if (coLocHang && !coDongQuaLoc(ls, quaHang)) continue")
    expect(s).toContain("total: coLocHang ? phanTienQuaLoc(Number(o.total || 0), ls, quaHang) : Number(o.total || 0)")
  })
})

describe("báo cáo Hàng hoá: giá vốn từ phiếu xuất bán; XNT theo kỳ; bỏ ô lọc chết", () => {
  const s = code("src/app/(dashboard)/reports/products/page.tsx")
  it("giá vốn chỉ từ phiếu xuất bán (locPhieuXuatBan)", () => {
    expect(s).toContain("locPhieuXuatBan(supabase, entriesRes.rows)")
    expect(s).toContain("const exportLines = stockLines.filter((l) => phieuXuatBan.has(l.entry_id))")
    expect(s).not.toMatch(/stockEntryMap\.get\(l\.entry_id\)\?\.type === "export"\s*\)/)
  })
  it("tồn đầu / tồn cuối theo kỳ (tinhXnt), không lấy tồn hiện tại làm tồn cuối", () => {
    expect(s).toContain("tinhXnt(tonNay, bienDong, range.from, range.to)")
    expect(s).toContain("napBienDong(supabase, orgId, range.from)")
    expect(s).not.toContain("e.beginQty = Math.max(0, e.endQty - e.importQty + e.exportQty)")
  })
  it("không còn ô Bảng giá / Nhóm khách (không tab nào dùng)", () => {
    expect(s).not.toContain("groupFilter")
    expect(s).not.toContain('label="Bảng giá / Nhóm khách"')
  })
})

describe("báo cáo Cuối ngày (cũ): LN gộp đang lọc dùng giá vốn của đúng các hoá đơn đã lọc", () => {
  const s = code("src/app/(dashboard)/reports/end-of-day/page.tsx")
  it("giá vốn theo phiếu xuất của chính hoá đơn; giá vốn trả của phiếu đã lọc; có khung chờ", () => {
    expect(s).toContain("const giaVonBan = dangLoc ? filteredDelivered.reduce((s, o) => s + (giaVonHd.get(o.id) || 0), 0) : cogs")
    expect(s).toContain("const returnsCost = (dangLoc ? filteredReturns : returnRows).reduce((s, r) => s + r.cost, 0)")
    expect(s).toContain("const [loading, setLoading] = useState(true)")
    expect(s).toMatch(/\) : loading \? \(\s*<Skeleton/)
  })
})

describe("Phân tích › Tổng quan kinh doanh: không còn nút 'Phân tích theo' chết", () => {
  it("không còn TABS / activeTab chỉ đổi dòng chữ", () => {
    const s = code("src/app/(dashboard)/analytics/business/overview/page.tsx")
    expect(s).not.toContain("activeTab")
    expect(s).not.toContain("Phân tích theo")
  })
})

describe("lượt nạp mới nhất: lượt cũ về muộn không đè số của kỳ / lọc mới", () => {
  it("taoBoLuot: chỉ lượt mở sau cùng còn 'mới'", () => {
    const bat = taoBoLuot()
    const cu = bat()
    const moi = bat()
    expect(cu()).toBe(false)
    expect(moi()).toBe(true)
  })

  // Mọi màn báo cáo cũ có hàm nạp: mở lượt đầu hàm, và MỌI `set…` sau `await` đầu tiên đều hỏi `conMoi()`.
  const goc = resolve(__dirname, "..")
  const tep: string[] = []
  const di = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) di(p)
      else if (f === "page.tsx") tep.push(p.slice(goc.length + 1))
    }
  }
  di(resolve(goc, "src/app/(dashboard)/reports"))
  di(resolve(goc, "src/app/(dashboard)/analytics"))
  const coNap = tep.filter((f) => doc(f).includes("const load = useCallback(async () => {"))
  it("phép quét còn thấy các màn có hàm nạp", () => {
    expect(coNap.length).toBeGreaterThanOrEqual(20)
  })
  it.each(coNap)("%s", (f) => {
    const s = code(f)
    const a = s.indexOf("const load = useCallback(async () => {")
    const than = s.slice(a, s.indexOf("\n  }, [", a))
    expect(than).toContain("const conMoi = batLuot()")
    let quaAwait = false
    for (const dong of than.split("\n")) {
      if (dong.includes("await ")) quaAwait = true
      const t = dong.trim()
      if (quaAwait && /^set[A-Z]\w*\(/.test(t)) throw new Error(`set chưa hỏi conMoi(): ${t}`)
      if (/if \(conMoi\(\)\) set\w+\(await /.test(t)) throw new Error(`await nằm SAU phép hỏi conMoi(): ${t}`)
    }
  })
})
