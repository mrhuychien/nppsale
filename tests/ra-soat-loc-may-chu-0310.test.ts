/**
 * RÀ SOÁT 03/10/2026 — các bộ lọc / số đếm từng chỉ tính trên TRANG ĐANG TẢI (hoặc bị `db.max_rows` cắt ở 1.000).
 *
 * ⚠ Phần logic chạy MÃ THẬT trên Supabase giả (`helpers/fake-postgrest`: trần 1.000 dòng, trần ~150 id trong
 *   `.in()`, trả lộn xộn khi thiếu khoá thứ tự duy nhất). Phần nối dây vào màn thì đọc mã nguồn.
 *   Bấm thật: e2e/cong-no-tuoi-no-may-chu.spec.ts, e2e/khach-loc-nhanh-va-loc-khac.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fakePostgrest as fakeGoc, nRows } from "./helpers/fake-postgrest"
import { getAgingStatus } from "@/lib/utils"
import { khoangHanTuoiNo, locTuoiNo, congNgay, NHOM_TUOI_NO, type NhomTuoiNo } from "@/lib/receivables/tuoi-no"
import { docCongNoDeThu } from "@/lib/receivables/doc-cong-no-thu"
import { locDanhSachMa, catTrangMa, xepTheoMa } from "@/lib/customers/loc-nhanh"
import { cacNgayDangHien, congTheoNgay, docThongKeNgay } from "@/lib/list/thong-ke-ngay"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

afterEach(() => { vi.useRealTimers() })

/** `client.from()` của Supabase giả trả kiểu lỏng — ép một lần ở đây cho gọn các chốt bên dưới. */
const fakePostgrest = (...a: Parameters<typeof fakeGoc>) => {
  const r = fakeGoc(...a)
  return { ...r, client: r.client as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/* ---------------------------------------------------------------- #1 tuổi nợ → khoảng due_date */
describe("#1 công nợ: chip tuổi nợ lọc trên máy chủ theo khoảng hạn", () => {
  const HOM_NAY = "2026-10-03"

  it("congNgay qua tháng / năm / năm nhuận", () => {
    expect(congNgay("2026-10-03", -3)).toBe("2026-09-30")
    expect(congNgay("2026-01-01", -1)).toBe("2025-12-31")
    expect(congNgay("2028-03-01", -1)).toBe("2028-02-29")
  })

  it("khoảng hạn của mỗi nhóm KHỚP getAgingStatus cho mọi ngày −120…+30", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-03T05:00:00Z")) // 12:00 giờ VN
    const trong = (d: string, nhom: NhomTuoiNo) => {
      const k = khoangHanTuoiNo(nhom, HOM_NAY)
      return (!k.tu || d >= k.tu) && (!k.den || d <= k.den)
    }
    for (let n = -120; n <= 30; n++) {
      const d = congNgay(HOM_NAY, n)
      const dung = getAgingStatus(d)
      for (const nhom of NHOM_TUOI_NO) expect([d, nhom, trong(d, nhom)]).toEqual([d, nhom, nhom === dung])
    }
  })

  it("biên: hôm nay = Trong hạn; hôm qua = Cảnh báo; 30/31/60/61 ngày", () => {
    expect(khoangHanTuoiNo("current", HOM_NAY)).toEqual({ tu: HOM_NAY, kemKhongHan: true })
    expect(khoangHanTuoiNo("warning", HOM_NAY)).toEqual({ tu: "2026-09-03", den: "2026-10-02" })
    expect(khoangHanTuoiNo("overdue", HOM_NAY)).toEqual({ tu: "2026-08-04", den: "2026-09-02" })
    expect(khoangHanTuoiNo("critical", HOM_NAY)).toEqual({ den: "2026-08-03" })
  })

  it("locTuoiNo: bỏ khoản đã thu xong; Trong hạn gồm cả khoản không đặt hạn; null = không lọc", () => {
    const goi: string[] = []
    const q = {
      neq: (c: string, v: string) => (goi.push(`neq ${c} ${v}`), q),
      gte: (c: string, v: string) => (goi.push(`gte ${c} ${v}`), q),
      lte: (c: string, v: string) => (goi.push(`lte ${c} ${v}`), q),
      or: (f: string) => (goi.push(`or ${f}`), q),
    }
    locTuoiNo(q, null, HOM_NAY)
    expect(goi).toEqual([])
    locTuoiNo(q, "current", HOM_NAY)
    expect(goi).toEqual(["neq status paid", "or due_date.is.null,due_date.gte.2026-10-03"])
    goi.length = 0
    locTuoiNo(q, "critical", HOM_NAY)
    expect(goi).toEqual(["neq status paid", "lte due_date 2026-08-03"])
  })

  it("màn Công nợ: lọc tuổi nợ trong truy vấn, đổi chip thì đọc lại + về trang 1, không lọc lại trang đã tải", () => {
    const s = code(read("src/app/(dashboard)/receivables/page.tsx"))
    expect(s).toContain("return locTuoiNo(q, agingFilter, vnDateKey(new Date()))")
    expect(s).toMatch(/pg\.reset\(\)\s*\}, \[locNC\.key, debouncedSearch, agingFilter[\],]/)
    expect(s).toMatch(/\[pg\.from, pg\.to, locNC\.ready, locNC\.key, debouncedSearch, listSearch, agingFilter[\],]/)
    expect(s).not.toContain("receivables.filter(")
    expect(s).not.toContain("mobileReceivables")
    // Số trên chip = số đếm trên máy chủ cùng bộ lọc ("Tất cả" không đổi theo chip đang chọn).
    expect(s).toContain('select("id", { count: "exact", head: true })')
    expect(s).toContain("count: demChip?.all ??")
    expect(s).toContain("count: demChip?.[key] ?? buckets[key].count")
  })
})

/* ---------------------------------------------------------------- #2 màn thu tiền */
describe("#2 thu tiền: đọc đủ, tra đúng khoản receivableId", () => {
  const OPEN = nRows(1500, (i) => ({
    customer_id: i === 1300 ? "kh-xa" : `kh-${i % 7}`,
    amount: 100_000,
    paid: 0,
    status: "open",
    due_date: `2026-${String(1 + (i % 9)).padStart(2, "0")}-15`,
  }))

  it("không customerId: đọc đủ 1.500 khoản (qua trần 1.000), khoá thứ tự due_date + id", async () => {
    const { client, calls } = fakePostgrest({ receivables: OPEN.map((r) => ({ ...r })) })
    const kq = await docCongNoDeThu(client, {})
    expect(kq.error).toBeNull()
    expect(kq.list).toHaveLength(1500)
    expect(new Set(kq.list.map((r) => r.id)).size).toBe(1500)
    expect(calls.every((c) => c.orders.join(",") === "due_date,id")).toBe(true)
  })

  it("chỉ receivableId (nằm sau dòng 1.000): tra theo id → khách của khoản đó → khoản có trong danh sách", async () => {
    const { client } = fakePostgrest({ receivables: OPEN.map((r) => ({ ...r })) })
    const xa = OPEN[1300].id as string
    const kq = await docCongNoDeThu(client, { receivableId: xa })
    expect(kq.customerId).toBe("kh-xa")
    expect(kq.list.map((r) => r.id)).toEqual([xa])
    expect(kq.list[0].customer_id).toBe("kh-xa")
  })

  it("bỏ khoản âm / đã thu đủ (dư có không phải khoản để thu)", async () => {
    const { client } = fakePostgrest({
      receivables: [
        { id: "a", customer_id: "k", amount: 100, paid: 0, status: "open", due_date: null },
        { id: "b", customer_id: "k", amount: -50, paid: 0, status: "open", due_date: null },
        { id: "c", customer_id: "k", amount: 100, paid: 120, status: "open", due_date: null },
      ],
    })
    const kq = await docCongNoDeThu(client, { customerId: "k" })
    expect(kq.list.map((r) => r.id)).toEqual(["a"])
  })

  it("màn thu tiền dùng docCongNoDeThu và hiện lỗi / cảnh báo thiếu", () => {
    const s = code(read("src/app/(dashboard)/receivables/collect/page.tsx"))
    expect(s).toContain("docCongNoDeThu(supabase, { customerId: customerIdParam, receivableId: receivableIdParam })")
    expect(s).toContain("{truncationWarning()}")
    expect(s).toContain("{loadError}")
  })
})

/* ---------------------------------------------------------------- #3 khách: thẻ lọc nhanh + lọc khác */
describe("#3 khách: thẻ lọc nhanh + bộ lọc khác lọc cả danh sách mã rồi mới cắt trang", () => {
  // 400 mã (> 2 lô 150), chỉ mã chia hết cho 10 có status 'inactive'.
  const KH = nRows(400, (i) => ({ status: i % 10 === 0 ? "inactive" : "active" }))
  const quick = KH.map((r) => r.id as string).reverse() // thứ tự lọc nhanh: ngược tên

  it("lọc trên TOÀN BỘ danh sách mã (theo lô), giữ thứ tự quickIds", async () => {
    const { client, calls } = fakePostgrest({ customers: KH })
    const ds = await locDanhSachMa(quick, true, (lo, from, to) =>
      client.from("customers").select("id", { count: "exact" }).in("id", lo).eq("status", "inactive").order("id").range(from, to)
    )
    expect(ds).toHaveLength(40)
    expect(ds).toEqual(quick.filter((id) => Number(id.slice(3)) % 10 === 0))
    expect(calls.length).toBeGreaterThanOrEqual(3) // 400 mã → 3 lô
    // Trang 1 đủ 20 khách (bản cũ: 20 mã đầu → chỉ 2 khớp).
    expect(catTrangMa(ds, 0, 19)).toHaveLength(20)
    expect(catTrangMa(ds, 20, 39)).toHaveLength(20)
    expect(catTrangMa(ds, 40, 59)).toHaveLength(0)
  })

  it("không có bộ lọc khác → không đọc gì, trả nguyên danh sách", async () => {
    const { client, calls } = fakePostgrest({ customers: KH })
    const ds = await locDanhSachMa(quick, false, (lo, from, to) => client.from("customers").select("id").in("id", lo).range(from, to))
    expect(ds).toEqual(quick)
    expect(calls).toHaveLength(0)
  })

  it("đọc hỏng thì NÉM (không thành danh sách rỗng)", async () => {
    const { client } = fakePostgrest({ customers: KH }, { failOn: () => true })
    await expect(
      locDanhSachMa(quick, true, (lo, from, to) => client.from("customers").select("id", { count: "exact" }).in("id", lo).order("id").range(from, to))
    ).rejects.toThrow()
  })

  it("xepTheoMa giữ thứ tự danh sách mã", () => {
    expect(xepTheoMa([{ id: "a" }, { id: "b" }, { id: "c" }], ["c", "a", "b"]).map((r) => r.id)).toEqual(["c", "a", "b"])
  })

  it("màn khách: lọc danh sách mã trước, đếm trên danh sách đã lọc; tuyến hôm nay đọc đủ", () => {
    const s = code(read("src/app/(dashboard)/customers/page.tsx"))
    expect(s).toContain("quickLoc = await locDanhSachMa(quickIds, coLocKhac,")
    expect(s).toContain("const idSlice = quickLoc ? catTrangMa(quickLoc, pg.from, pg.to) : null")
    expect(s).toContain("pg.setTotal(quickLoc ? quickLoc.length : res.count ?? 0)")
    expect(s).not.toContain("quickIds.slice(pg.from")
    expect(s).toMatch(/from\("pjp_routes"\)[\s\S]{0,200}\.order\("visit_order"\)\s*\.order\("id"\)\s*\.range\(from, to\)/)
  })
})

/* ---------------------------------------------------------------- #4 chi tiết khách */
describe("#4 chi tiết khách: bảng giá đọc đủ, số lần ghé đếm trên máy chủ", () => {
  it("price_lists qua fetchAllForAggregate, khoá product_id + id; tab Ghé thăm dùng head count", () => {
    const s = code(read("src/app/(dashboard)/customers/[id]/page.tsx"))
    expect(s).toMatch(/fetchAllForAggregate<PriceRow>[\s\S]{0,400}from\("price_lists"\)[\s\S]{0,500}\.order\("product_id"\)\.order\("id"\)\.range\(from, to\)/)
    expect(s).toMatch(/from\("visit_logs"\)\s*\.select\("id", \{ count: "exact", head: true \}\)/)
    expect(s).toContain("Ghé thăm ({visitCount ?? visits.length})")
  })
})

/* ---------------------------------------------------------------- #5 hóa đơn: số theo tuyến */
describe("#5 hóa đơn: số hóa đơn theo tuyến đếm trên máy chủ", () => {
  it("không đếm từ `rows`; cùng bộ lọc (bỏ chính bộ lọc tuyến)", () => {
    const s = code(read("src/app/(dashboard)/sales-invoices/page.tsx"))
    expect(s).not.toMatch(/routeCounts = useMemo\([\s\S]{0,120}for \(const r of rows\)/)
    expect(s).toContain('.select("id, customer:customers!inner(channel)", { count: "exact" })')
    expect(s).toContain("applyFilters(q as never, true)")
    expect(s).toContain('if (routeFilter !== "all" && !boTuyen) x = x.eq("customer.channel", routeFilter)')
  })
})

/* ---------------------------------------------------------------- #6 đầu nhóm ngày */
describe("#6 đầu nhóm ngày điện thoại: số + tổng của cả ngày, đếm trên máy chủ", () => {
  it("cacNgayDangHien / congTheoNgay", () => {
    const r = [{ d: "2026-10-03", t: 5 }, { d: "2026-10-03T08:00", t: 1 }, { d: "2026-10-02", t: 2 }, { d: "", t: 9 }]
    expect(cacNgayDangHien(r, (x) => x.d)).toEqual(["2026-10-03", "2026-10-02"])
    expect(congTheoNgay(r, (x) => x.d, (x) => x.t)).toEqual({ "2026-10-03": { count: 2, total: 6 }, "2026-10-02": { count: 1, total: 2 } })
  })

  it("đọc đủ cả ngày (qua trần 1.000), chỉ những ngày đang hiện; truTien trừ hàng trả", async () => {
    const rows = nRows(1600, (i) => ({ order_date: i < 1200 ? "2026-10-03" : i < 1500 ? "2026-10-02" : "2026-10-01", total: 1000 }))
    const { client } = fakePostgrest({ sales_orders: rows })
    const days = ["2026-10-03", "2026-10-02"]
    const kq = await docThongKeNgay<{ id: string; order_date: string; total: number }>(
      days,
      (from, to) => client.from("sales_orders").select("id, order_date, total", { count: "exact" }).in("order_date", days).order("id").range(from, to),
      (r) => r.order_date,
      (r) => r.total,
      async () => (r) => r.total - 100
    )
    expect(kq).toEqual({ "2026-10-03": { count: 1200, total: 1_080_000 }, "2026-10-02": { count: 300, total: 270_000 } })
  })

  it("chạm trần 20.000 dòng → null (số cả ngày đang thiếu thì không hiện)", async () => {
    const { client } = fakePostgrest({ sales_orders: nRows(20_001, () => ({ order_date: "2026-10-03", total: 1 })) })
    const kq = await docThongKeNgay<{ order_date: string; total: number }>(
      ["2026-10-03"],
      (from, to) => client.from("sales_orders").select("id, order_date, total", { count: "exact" }).order("id").range(from, to),
      (r) => r.order_date,
      (r) => r.total
    )
    expect(kq).toBeNull()
  })

  it("đọc hỏng → null (đầu nhóm quay về số đã tải, không hiện số bịa)", async () => {
    const { client } = fakePostgrest({ sales_orders: [] }, { failOn: () => true })
    const kq = await docThongKeNgay(["2026-10-03"], (from, to) => client.from("sales_orders").select("id", { count: "exact" }).range(from, to), () => "", () => 0)
    expect(kq).toBeNull()
  })

  it("hai khuôn điện thoại dùng dayStats; màn Đơn hàng + Hóa đơn truyền số máy chủ", () => {
    for (const f of ["src/components/orders/mobile-orders-screen.tsx", "src/components/returns/mobile-returns-screen.tsx"]) {
      const s = code(read(f))
      expect(s).toContain("dayStats?.[g.key]?.count ?? g.items.length")
      expect(s).toContain("dayStats?.[g.key]?.total ?? g.total")
    }
    for (const f of ["src/app/(dashboard)/orders/page.tsx", "src/app/(dashboard)/sales-invoices/page.tsx"]) {
      const s = code(read(f))
      expect(s).toContain("dayStats={dayStats}")
      expect(s).toContain("docThongKeNgay")
    }
  })
})

/* ---------------------------------------------------------------- #7 – #10 */
describe("#7–#10 thứ tự / đọc đủ", () => {
  it("#7 đơn hàng: mặc định xếp order_date ↓, created_at ↓, id (khớp nhóm ngày điện thoại)", () => {
    const s = code(read("src/app/(dashboard)/orders/page.tsx"))
    expect(s).toContain('(x) => x.order("order_date", { ascending: false }).order("created_at", { ascending: false }).order("id")')
  })
  it("#8 khuyến mãi đọc đủ qua fetchAllForAggregate + báo thiếu", () => {
    const s = code(read("src/app/(dashboard)/promotions/page.tsx"))
    expect(s).toMatch(/fetchAllForAggregate<Promotion>[\s\S]{0,300}\.order\("priority", \{ ascending: false \}\)\s*\.order\("id"\)\s*\.range\(from, to\)/)
    expect(s).toContain("{truncationWarning()}")
  })
  it("#9 chi phí: mốc phụ id + hiện lỗi / thiếu", () => {
    const s = code(read("src/app/(dashboard)/finance/expenses/page.tsx"))
    expect(s).toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id"\)\s*\.range\(from, to\)/)
    expect(s).toContain("{truncationWarning()}")
    // Danh sách gộp cả phiếu chi trả NCC (mig 242): thiếu ở bất kỳ nguồn nào cũng báo.
    expect(s).toContain("setTruncated(expensesRes.truncated || nccRes.truncated)")
  })
  it("#10 thông báo: mốc phụ id", () => {
    const s = code(read("src/app/(dashboard)/notifications/page.tsx"))
    expect(s).toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id"\)\s*\.range\(from, to\)/)
  })
})
