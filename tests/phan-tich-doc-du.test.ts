import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { taiDanhMucLoc } from "../src/lib/analytics/filter-catalogs"
import { fetchPnl, fetchBalanceSheet, fetchCashFlow } from "../src/lib/finance"
import { demHoacNem } from "../src/app/(dashboard)/analytics/_shared/doc-du"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * PHÂN TÍCH / TỔNG QUAN / TÀI CHÍNH — ĐỌC ĐỦ, VÀ ĐỌC HỎNG THÌ NÓI RA.
 *
 * ⚠ ĐỢT QA 23/09/2026 tìm ra ba hình dạng của cùng một lỗi IM LẶNG:
 *   M3 · `customers` / `products` đọc bằng `.select()` trơn — PostgREST cắt
 *        ở 1.000 dòng: "Tổng khách hàng" dừng ở 1.000, ô lọc khách chỉ tới
 *        chữ "M", doanh thu của khách thứ 1.001 dồn vào "Chưa phân nhóm".
 *   M2 · phân trang SONG SONG mà không có mốc thứ tự duy nhất — dòng lặp ở
 *        hai trang, dòng khác không ở trang nào.
 *   M4 · lỗi RPC cộng sổ bị `console.error` rồi đọc `data || {}` — Lãi lỗ,
 *        Cân đối, Dòng tiền, Tổng quan hiện 0đ như một kỳ không phát sinh.
 *
 * ⚠ ƯU TIÊN CHẠY MÃ THẬT. Hai hàm thư viện (`taiDanhMucLoc`, `fetchPnl`…)
 *   chạy trên một client giả có trần 1.000 dòng và biết TRẢ THỨ TỰ LỘN XỘN
 *   khi không có mốc duy nhất — đúng như Postgres được phép làm. Phần màn
 *   hình (React) không chạy được ở đây nên chốt bằng phép quét mã, và mỗi
 *   phép quét có tự-kiểm chứng minh nó còn nhận ra mẫu xấu.
 */

// =====================================================================
// Client giả: trần 1.000 dòng, thứ tự lộn xộn khi thiếu mốc duy nhất
// =====================================================================

type Row = Record<string, unknown> & { id: string }

interface FakeOpts {
  tables: Record<string, Row[]>
  /** Bảng nào đọc thì lỗi. */
  loi?: Record<string, string>
  /** Hàm RPC → kết quả. */
  rpc?: Record<string, { data?: unknown; error?: { message: string; code?: string } | null }>
  maxRows?: number
}

/**
 * ⚠ THỨ TỰ LỘN XỘN CÓ CHỦ Ý. Không `.order(...)` kết thúc bằng một khoá
 *   duy nhất (`id`) thì mỗi LẦN GỌI trả các dòng theo một hoán vị khác —
 *   Postgres không hứa gì hơn thế. Nhờ vậy chốt "đọc đủ" đỏ ngay khi ai đó
 *   bỏ `.order("id")`: trang 1 và trang 2 lấy từ hai thứ tự khác nhau, ghép
 *   lại có dòng trùng và dòng thiếu.
 */
function fakeClient(opts: FakeOpts) {
  const max = opts.maxRows ?? 1000
  let luot = 0
  const client = {
    from(table: string) {
      const orders: string[] = []
      const filters: Array<(r: Row) => boolean> = []
      let range: [number, number] | null = null
      let head = false
      const q = {
        select(_cols: string, o?: { count?: string; head?: boolean }) {
          head = !!o?.head
          return q
        },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === undefined || r[c] === v); return q },
        gte() { return q },
        lte() { return q },
        gt() { return q },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q },
        order(c: string) { orders.push(c); return q },
        range(a: number, b: number) { range = [a, b]; return q },
        then<T>(ok: (v: unknown) => T, bad?: (e: unknown) => T) {
          return Promise.resolve(run()).then(ok, bad)
        },
      }
      function run() {
        if (opts.loi?.[table]) return { data: null, error: { message: opts.loi[table] }, count: null }
        let rows = (opts.tables[table] || []).filter((r) => filters.every((f) => f(r)))
        const total = rows.length
        if (head) return { data: null, error: null, count: total }
        if (orders[orders.length - 1] === "id") {
          rows = rows.slice().sort((x, y) => {
            for (const c of orders) {
              const a = String(x[c] ?? ""), b = String(y[c] ?? "")
              if (a !== b) return a < b ? -1 : 1
            }
            return 0
          })
        } else {
          // Hoán vị giả ngẫu nhiên, khác nhau mỗi lượt gọi.
          const seed = ++luot
          rows = rows
            .map((r, i) => ({ r, k: (i * 7919 + seed * 104729) % 1000003 }))
            .sort((a, b) => a.k - b.k)
            .map((x) => x.r)
        }
        const [a, b] = range ?? [0, total - 1]
        const het = Math.min(b, a + max - 1, total - 1)
        return { data: rows.slice(a, het + 1), error: null, count: total }
      }
      return q
    },
    rpc(fn: string) {
      const r = opts.rpc?.[fn] ?? { data: null, error: { message: `Could not find the function ${fn}`, code: "PGRST202" } }
      const res = { data: r.data ?? null, error: r.error ?? null }
      return { maybeSingle: () => Promise.resolve(res) }
    },
  }
  return client
}

const nhieu = (n: number, f: (i: number) => Record<string, unknown>): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, "0")}`, ...f(i) }))

const ORG = "org-1"

// =====================================================================
// M3 · ô lọc báo cáo phải có ĐỦ khách và sản phẩm
// =====================================================================

describe("taiDanhMucLoc — ô lọc báo cáo đọc đủ", () => {
  const bangDu = () => ({
    customers: nhieu(2600, (i) => ({ org_id: ORG, store_name: `Khách ${i}`, phone: null })),
    products: nhieu(1700, (i) => ({
      org_id: ORG, status: "active", sku: `SP${i}`, name: `Hàng ${i}`,
      category: `Nhóm ${i % 7}`, brand: `NH ${i % 3}`,
    })),
    users: nhieu(5, (i) => ({ org_id: ORG, full_name: `NV ${i}`, role: i === 0 ? "driver" : "sales", is_active: true })),
    customer_groups: nhieu(3, (i) => ({ org_id: ORG, name: `G${i}` })),
    sales_routes: nhieu(2, (i) => ({ org_id: ORG, is_active: true, code: `T${i}`, name: `Tuyến ${i}`, sort_order: i })),
    suppliers: nhieu(1200, (i) => ({ org_id: ORG, name: `NCC ${i}` })),
  })

  it("quá 1.000 khách / sản phẩm vẫn nhận đủ, không trùng, không sót", async () => {
    const tables = bangDu()
    const { lists, truncated } = await taiDanhMucLoc(fakeClient({ tables }), ORG)
    expect(truncated).toBe(false)
    expect(lists.customers).toHaveLength(2600)
    expect(new Set(lists.customers.map((c) => c.id)).size, "khách trùng/sót giữa các trang").toBe(2600)
    expect(lists.products).toHaveLength(1700)
    expect(new Set(lists.products.map((p) => p.id)).size, "hàng trùng/sót giữa các trang").toBe(1700)
    expect(new Set(lists.suppliers.map((s) => s.id)).size).toBe(1200)
    expect(lists.categories).toHaveLength(7)
    expect(lists.drivers).toHaveLength(1)
  })

  it("đọc hỏng thì NÉM, không trả ô lọc rỗng như thật", async () => {
    const tables = bangDu()
    await expect(
      taiDanhMucLoc(fakeClient({ tables, loi: { customers: "mạng rớt" } }), ORG)
    ).rejects.toThrow(/khách hàng: mạng rớt/)
    await expect(
      taiDanhMucLoc(fakeClient({ tables, loi: { products: "RLS" } }), ORG)
    ).rejects.toThrow(/danh mục hàng: RLS/)
  })

  /** ⚠ Client giả phải thật sự làm lộn thứ tự — nếu không chốt trên xanh vì mù. */
  it("client giả tự-kiểm: thiếu mốc `id` thì ghép trang ra trùng/sót", async () => {
    const c = fakeClient({ tables: { t: nhieu(2500, () => ({})) } })
    const a = (await (c.from("t").select("id", { count: "exact" }).order("name").range(0, 999) as unknown as PromiseLike<{ data: Row[] }>)).data
    const b = (await (c.from("t").select("id", { count: "exact" }).order("name").range(1000, 1999) as unknown as PromiseLike<{ data: Row[] }>)).data
    const ids = new Set([...a, ...b].map((r) => r.id))
    expect(ids.size).toBeLessThan(2000)
  })
})

// =====================================================================
// M4 · lib/finance: lỗi RPC → NÉM, không ra 0đ
// =====================================================================

describe("lib/finance — hàm cộng sổ lỗi thì ném", () => {
  const P = { from: "2026-09-01", to: "2026-09-30" }
  const sb = (rpc: FakeOpts["rpc"]) => fakeClient({ tables: {}, rpc }) as unknown as SupabaseClient

  it("Lãi lỗ: lỗi RPC → ném, giữ mã lỗi để màn hình dịch đúng", async () => {
    const e = await fetchPnl(sb({ finance_pnl: { error: { message: "mạng rớt", code: "08006" } } }), ORG, P)
      .then(() => null, (x) => x)
    expect(e, "fetchPnl nuốt lỗi — màn hình sẽ vẽ Lãi lỗ 0đ").toBeInstanceOf(Error)
    expect(String(e.message)).toMatch(/finance_pnl: mạng rớt/)
    expect(e.code).toBe("08006")
  })

  it("Cân đối và Dòng tiền: máy chủ chưa có hàm (PGRST202) → ném", async () => {
    await expect(fetchBalanceSheet(sb({}), ORG, "2026-09-30")).rejects.toThrow(/finance_balance_sheet/)
    await expect(fetchCashFlow(sb({}), ORG, P)).rejects.toThrow(/finance_cash_flow/)
  })

  it("đọc được thì số vẫn tính đúng", async () => {
    const r = await fetchPnl(
      sb({ finance_pnl: { data: { revenue: 1000, cogs: 600, exp_operating: 100, exp_hr: 50, exp_tax: 20, order_count: 3 } } }),
      ORG, P
    )
    expect(r.grossProfit).toBe(400)
    expect(r.operatingProfit).toBe(250)
    expect(r.netProfit).toBe(230)
    const bs = await fetchBalanceSheet(
      sb({ finance_balance_sheet: { data: { cash: 10, accounts_receivable: 20, inventory: 30, accounts_payable: 5, unpaid_expenses: 5 } } }),
      ORG, "2026-09-30"
    )
    expect(bs.equity.total).toBe(50)
    const cf = await fetchCashFlow(
      sb({ finance_cash_flow: { data: { cash_from_customers: 100, cash_to_suppliers: 30, cash_to_expenses: 20 } } }),
      ORG, P
    )
    expect(cf.netChange).toBe(50)
  })
})

describe("demHoacNem — đếm bằng head:true", () => {
  it("trả đúng số đếm, không bị trần 1.000", async () => {
    const c = fakeClient({ tables: { customers: nhieu(4321, () => ({ org_id: ORG })) } })
    const n = await demHoacNem(
      c.from("customers").select("id", { count: "exact", head: true }).eq("org_id", ORG) as never,
      "đếm khách"
    )
    expect(n).toBe(4321)
  })
  it("lỗi thì ném, không ra 0", async () => {
    const c = fakeClient({ tables: {}, loi: { customers: "hỏng" } })
    await expect(
      demHoacNem(c.from("customers").select("id", { count: "exact", head: true }) as never, "đếm khách")
    ).rejects.toThrow(/đếm khách: hỏng/)
  })
})

// =====================================================================
// Phép quét mã — phần màn hình không chạy được trong vitest
// =====================================================================

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function moiNguon(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) moiNguon(p, acc)
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

const PHAN_TICH = moiNguon(resolve(ROOT, "src/app/(dashboard)/analytics")).map((a) =>
  a.slice(ROOT.length + 1)
)
const MAN_TONG = [
  ...PHAN_TICH,
  "src/app/(dashboard)/dashboard/page.tsx",
  "src/lib/analytics/filter-catalogs.ts",
]

/**
 * Câu đọc `customers` / `products` nào không phân trang.
 *
 * ⚠ CỬA SỔ DỪNG Ở `.from("` KẾ TIẾP — cùng bài học với
 *   `tests/catalogue-full-load.test.ts`: cửa sổ trùm sang câu truy vấn khác
 *   thấy `.range(` của câu ấy và kết luận sai là "đã an toàn".
 */
function docTron(src: string): number[] {
  const bad: number[] = []
  const re = /\.from\("(customers|products)"\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const ke = src.indexOf('.from("', m.index + 7)
    const stmt = src.slice(m.index, ke === -1 ? m.index + 500 : Math.min(ke, m.index + 500))
    const lanh =
      /\.range\(/.test(stmt) ||
      /head:\s*true/.test(stmt) ||
      /\.eq\("id",/.test(stmt) ||
      /\.maybeSingle\(\)/.test(stmt) ||
      /\.single\(\)/.test(stmt) ||
      /\.limit\(/.test(stmt)
    if (!lanh) bad.push(m.index)
  }
  return bad
}

describe("quét: màn Phân tích / Tổng quan không đọc khách, hàng kiểu bị cắt", () => {
  it("mọi câu đọc `customers`/`products` đều phân trang hoặc chỉ đếm", () => {
    const bad: string[] = []
    for (const rel of MAN_TONG) {
      for (const at of docTron(code(read(rel)))) bad.push(`${rel} (vị trí ${at})`)
    }
    expect(
      bad,
      "đọc `customers`/`products` bằng `.select()` trơn — PostgREST cắt ở 1.000 dòng " +
        "mà không báo gì:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  it("phép quét còn nhận ra mẫu xấu", () => {
    expect(docTron('supabase.from("customers").select("id, store_name").eq("org_id", o)')).toHaveLength(1)
    expect(docTron('supabase.from("products").select("id").eq("org_id", o).order("name")')).toHaveLength(1)
    expect(docTron('supabase.from("customers").select("id", { count: "exact" }).order("id").range(a, b)')).toHaveLength(0)
    expect(docTron('supabase.from("customers").select("id", { count: "exact", head: true })')).toHaveLength(0)
    // Không mượn `.range(` của câu kế tiếp.
    expect(
      docTron('supabase.from("customers").select("id"); supabase.from("x").select("a").range(0, 9)')
    ).toHaveLength(1)
  })

  it("phép quét thật sự nhìn thấy các màn Phân tích", () => {
    expect(PHAN_TICH.filter((f) => f.endsWith("page.tsx")).length).toBeGreaterThanOrEqual(8)
  })
})

/**
 * ⚠ NUỐT LỖI RỒI ĐI TIẾP. `if (err) console.error(...)` trên một dòng, không
 *   có gì khác — rồi dùng `data || []`. Đây đúng là hình dạng đã biến lỗi
 *   RPC thành 0đ ở Tổng quan và ở ba báo cáo tài chính.
 */
function nuotLoi(src: string): boolean {
  return /if\s*\(\s*[\w.?]+\s*\)\s*console\.error\(/.test(src)
}

describe("quét: đọc hỏng không được nuốt thành số 0", () => {
  const TEP = [
    ...MAN_TONG,
    "src/lib/finance.ts",
    "src/app/(dashboard)/receivables/page.tsx",
  ]
  it("không tệp nào `if (lỗi) console.error(...)` rồi đi tiếp", () => {
    const bad = TEP.filter((rel) => nuotLoi(code(read(rel))))
    expect(bad, "lỗi đọc chỉ ghi console, màn hình vẽ số 0 như thật:\n  " + bad.join("\n  ")).toEqual([])
  })

  it("phép quét còn nhận ra mẫu xấu", () => {
    expect(nuotLoi('if (error) console.error("[x] lỗi:", error.message)')).toBe(true)
    expect(nuotLoi('if (qErr) console.error("[x]", qErr.message)')).toBe(true)
    expect(nuotLoi("if (qErr) throw qErr")).toBe(false)
    expect(nuotLoi('if (error) {\n  console.error("x")\n  setErr(error.message)\n  return\n}')).toBe(false)
  })

  /**
   * ⚠ Tổng công nợ ở màn Công nợ: đọc hỏng phải hiện ra THÀNH CHỮ, không
   *   phải "Tổng công nợ: 0 ₫".
   */
  it("màn Công nợ nói ra khi phần tổng đọc hỏng", () => {
    const s = code(read("src/app/(dashboard)/receivables/page.tsx"))
    const at = s.indexOf('rpc("receivables_summary")')
    expect(at).toBeGreaterThan(-1)
    expect(s.slice(at, at + 600)).toMatch(/setSummaryError\(errorMessage\(error/)
    expect(s).toMatch(/summaryError\s*\?\s*"Tổng công nợ: không tải được"/)
  })
})

/**
 * ⚠ HÀM ĐỌC CỦA `lib/analytics/sales` ĐANG CHUYỂN SANG NÉM. `fetchOrderLines`
 *   đã ném từ trước (đọc theo lô id). Màn gọi mà không bắt thì kẹt ở khung
 *   xương mãi; bắt rồi nuốt thì ra 0đ. Mỗi lời gọi phải nằm TRONG một khối
 *   `try` và màn phải có chỗ vẽ lỗi (`LoiTaiBaoCao`).
 */
// Doanh thu nay đọc hóa đơn (`fetchRevenueInvoices` / `fetchInvoiceLines`) thay
// cho `fetchDeliveredOrders` / `fetchOrderLines` — chủ nhà 24/09/2026.
const HAM_NEM = [
  "fetchRevenueInvoices", "fetchAllOrders", "fetchReturnsValue", "fetchReturnsRows",
  "fetchCogsForRange", "fetchInvoiceLines", "fetchOrderLines", "docDuHoacNem", "docTheoLoId",
]

function goiNgoaiTry(src: string): string[] {
  const bad: string[] = []
  const re = new RegExp(`\\b(${HAM_NEM.join("|")})(<[^>(]*>)?\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    // Nằm trong `try` = khối `try {` gần nhất phía trước chưa bị đóng bởi
    // một `} catch`. Thô nhưng đủ cho lối viết một `load()` của các màn này.
    const truoc = src.slice(0, m.index)
    const tryAt = truoc.lastIndexOf("try {")
    const catchAt = truoc.lastIndexOf("} catch")
    if (tryAt === -1 || catchAt > tryAt) bad.push(m[1])
  }
  return bad
}

describe("quét: màn Phân tích bắt lỗi của hàm đọc", () => {
  const MAN = PHAN_TICH.filter((f) => f.endsWith("page.tsx"))

  it("mọi lời gọi hàm đọc đều nằm trong `try`, và màn có chỗ vẽ lỗi", () => {
    const bad: string[] = []
    for (const rel of MAN) {
      const s = code(read(rel))
      if (!HAM_NEM.some((h) => s.includes(`${h}(`) || s.includes(`${h}<`))) continue
      // `fetchExpenses` ở cost-profit là hàm con; nó chỉ được gọi trong try
      // của `load()` — nên bỏ phần thân của nó ra trước khi quét.
      const bo = s.replace(/const fetchExpenses = useCallback\([\s\S]*?\n {2}\)\n/, "")
      const ngoai = goiNgoaiTry(bo)
      if (ngoai.length) bad.push(`${rel}: ${ngoai.join(", ")}`)
      if (!/<LoiTaiBaoCao\b/.test(s)) bad.push(`${rel}: không vẽ <LoiTaiBaoCao>`)
    }
    expect(bad, "gọi hàm đọc ngoài try / không có chỗ vẽ lỗi:\n  " + bad.join("\n  ")).toEqual([])
  })

  it("`fetchExpenses` chỉ được gọi trong try", () => {
    const s = code(read("src/app/(dashboard)/analytics/business/cost-profit/page.tsx"))
    const re = /\bfetchExpenses\(/g
    let m: RegExpExecArray | null
    let n = 0
    while ((m = re.exec(s))) {
      const truoc = s.slice(0, m.index)
      expect(truoc.lastIndexOf("try {")).toBeGreaterThan(truoc.lastIndexOf("} catch"))
      n++
    }
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it("phép quét còn nhận ra mẫu xấu", () => {
    expect(goiNgoaiTry("const x = await fetchRevenueInvoices(a, b, c)")).toEqual(["fetchRevenueInvoices"])
    expect(goiNgoaiTry("try { await fetchRevenueInvoices(a) } catch (e) {}")).toEqual([])
    expect(
      goiNgoaiTry("try { await x() } catch (e) {}\nawait docDuHoacNem<Row>((f, t) => q, 'x')")
    ).toEqual(["docDuHoacNem"])
  })
})

/**
 * ⚠ PHÂN TRANG SONG SONG MÀ KHÔNG `.order()` NÀO. Chốt mốc duy nhất ở
 *   `tests/ra-soat-toan-kho.test.ts` chỉ soi `.order("x").range(` — câu
 *   KHÔNG CÓ `.order()` nào thì lọt qua nó. Mà đó chính là hình dạng của
 *   thẻ "Tổng giá trị tồn kho", bảng tồn theo khu (view GROUP BY) và màn
 *   công nợ phân tích: `fetchAllForAggregate` bắn các trang cùng lúc, mỗi
 *   trang Postgres tự chọn một thứ tự — dòng lặp, dòng sót.
 *
 * ⚠ CHỈ SOI MẪU `.range(from, to)` — đó là chữ ký của hàm dựng trang trong
 *   `fetchAllForAggregate` / `docDuHoacNem` / `docTheoLoId`. Phân trang giao
 *   diện (`.range(pg.from, pg.to)`) chạy từng trang một, chốt kia đã lo.
 */
function trangKhongThuTu(src: string): number[] {
  const bad: number[] = []
  const re = /\.range\(from,\s*to\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const dau = src.lastIndexOf('.from("', m.index)
    if (dau === -1) continue
    if (!src.slice(dau, m.index).includes(".order(")) bad.push(m.index)
  }
  return bad
}

describe("quét: trang đọc song song phải có thứ tự", () => {
  const TEP = [
    ...MAN_TONG,
    "src/app/(dashboard)/inventory/page.tsx",
    "src/components/inventory/stock-balance-table.tsx",
  ]
  it("mọi hàm dựng trang đều `.order(...)` trước `.range(from, to)`", () => {
    const bad: string[] = []
    for (const rel of TEP) {
      for (const at of trangKhongThuTu(code(read(rel)))) bad.push(`${rel} (vị trí ${at})`)
    }
    expect(bad, "phân trang song song không có thứ tự — dòng lặp / sót giữa các trang:\n  " + bad.join("\n  ")).toEqual([])
  })

  it("phép quét còn nhận ra mẫu xấu", () => {
    expect(trangKhongThuTu('q.from("batches").select("a", { count: "exact" }).gt("qty", 0).range(from, to)')).toHaveLength(1)
    expect(trangKhongThuTu('q.from("batches").select("a").order("id").range(from, to)')).toHaveLength(0)
    // Không mượn `.order(` của câu phía trước.
    expect(
      trangKhongThuTu('q.from("a").order("id").range(0, 1); q.from("b").select("x").range(from, to)')
    ).toHaveLength(1)
  })
})
