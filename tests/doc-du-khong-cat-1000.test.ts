import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"
import { loadSellRefData } from "../src/lib/sell/ref-data"
import { loadApprovalContext } from "../src/lib/sell/approval-context"
import {
  docCongNoTheoKhach,
  docThanhToanCuaPhieu,
} from "../src/app/(dashboard)/receivables/by-customer/doc-so-cong-no"
import { reconcileOrg, BOOK_CAP } from "../src/app/api/einvoice/pull-snapshots/reconcile-org"
import {
  demAnhTheoKhach,
  docKhachDangBan,
  docPhuTrachChinh,
} from "../src/app/(dashboard)/customers/missing-photos/doc-anh"
import { demTheoTrangThai } from "../src/app/(dashboard)/invoices/reconcile/dem-trang-thai"
import { MATCH_CAP, idsMatching } from "../src/lib/search/list-search"
import { ID_MOI_LO } from "../src/lib/supabase/aggregate"
import { transformSync } from "esbuild"

// Bộ nhớ đệm offline dùng IndexedDB — không có trong môi trường node.
vi.mock("../src/lib/offline/ref-cache", () => ({
  cacheOrderRefData: async () => undefined,
  getCachedOrderRefData: async () => null,
}))

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * ĐỌC ĐỦ, KHÔNG ĐỂ `db.max_rows = 1000` CẮT IM LẶNG (đợt QA 23/09/2026).
 *
 * ⚠ MỌI CHỐT Ở ĐÂY CHẠY MÃ THẬT trên Supabase giả (`helpers/fake-postgrest`)
 *   — giả đúng trần 1.000 dòng, trần ~150 id trong `.in()`, và trả lộn xộn
 *   khi thiếu khoá thứ tự duy nhất. Đọc chữ trong tệp thì một đột biến
 *   đổi chỗ khác vẫn lọt.
 */

describe("B5 — nợ danh mục của nhân viên đọc đủ, không dừng ở 1.000 phiếu", () => {
  it("2.500 phiếu mở → cộng đủ 2.500, và KHÔNG gắn cờ hỏng", async () => {
    const { client } = fakePostgrest({
      receivables: nRows(2500, () => ({ sales_user_id: "u", customer_id: "x", status: "open", amount: 100, paid: 0 })),
    })
    const ctx = await loadApprovalContext(client, { orgId: "o", customerId: "c", salesUserId: "u" })
    expect(ctx.repPortfolioDebt).toBe(250_000)
    expect(ctx.failed).toBe(false)
  })

  it("nợ của MỘT khách vượt 1.000 phiếu cũng cộng đủ", async () => {
    const { client } = fakePostgrest({
      receivables: nRows(1500, () => ({ sales_user_id: "z", customer_id: "c", status: "open", amount: 10, paid: 0, due_date: "2020-01-01" })),
    })
    const ctx = await loadApprovalContext(client, { orgId: "o", customerId: "c", salesUserId: "u" })
    expect(ctx.customerDebt).toBe(15_000)
    expect(ctx.customerOverdue).toBe(15_000)
  })

  it("chạm trần 20.000 dòng (tổng đang THIẾU) cũng là `failed`", async () => {
    const { client } = fakePostgrest({
      receivables: nRows(20_001, () => ({ sales_user_id: "u", status: "open", amount: 1, paid: 0 })),
    })
    const ctx = await loadApprovalContext(client, { orgId: "o", customerId: "c", salesUserId: "u" })
    expect(ctx.failed).toBe(true)
  })

  it("một trang giữa chừng hỏng → `failed`, không cộng thiếu mà im", async () => {
    let n = 0
    const { client } = fakePostgrest(
      { receivables: nRows(2500, () => ({ sales_user_id: "u", status: "open", amount: 1, paid: 0 })) },
      { failOn: (c) => c.table === "receivables" && c.filters.includes("eq.sales_user_id") && ++n === 2 }
    )
    const ctx = await loadApprovalContext(client, { orgId: "o", customerId: "c", salesUserId: "u" })
    expect(ctx.failed).toBe(true)
  })
})

describe("B8 — công nợ theo khách đọc đủ mọi trang của RPC", () => {
  it("2.500 khách (nhiều người cùng số nợ) → đủ 2.500, không lặp, không sót", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      customer_id: `c-${i}`,
      remaining: i % 3 === 0 ? 500 : 100, // cố tình hoà nhau thật nhiều
    }))
    const { client } = fakePostgrest(
      { "rpc:receivables_by_customer": rows },
      { unique: { "rpc:receivables_by_customer": "customer_id" } }
    )
    const r = await docCongNoTheoKhach<{ customer_id: string; remaining: number }>(client)
    expect(new Set(r.rows.map((x) => x.customer_id)).size).toBe(2500)
    expect(r.rows.reduce((s, x) => s + x.remaining, 0)).toBe(rows.reduce((s, x) => s + x.remaining, 0))
    // Thứ tự của hàm SQL (nợ nhiều nhất trước) vẫn giữ.
    expect(r.rows[0].remaining).toBe(500)
    expect(r.truncated).toBe(false)
  })

  it("RPC hỏng thì NÉM, không ra bảng trống", async () => {
    const { client } = fakePostgrest({}, { failOn: () => true })
    await expect(docCongNoTheoKhach(client)).rejects.toThrow(/Công nợ theo khách/)
  })
})

describe("M1 — lần thu tiền của cả nghìn phiếu: chia lô, đọc đủ, lỗi thì ném", () => {
  const recIds = Array.from({ length: 1200 }, (_, i) => `r-${i}`)
  const payments = nRows(3000, (i) => ({ receivable_id: `r-${i % 1200}`, amount: 10, collected_at: "2026-01-01" }))

  it("1.200 phiếu / 3.000 lần thu → đủ 3.000, không lệnh `.in()` nào quá 150 id", async () => {
    const { client } = fakePostgrest({ payments })
    const r = await docThanhToanCuaPhieu<{ id: string; amount: number }>(client, recIds, "id, amount")
    expect(new Set(r.map((p) => p.id)).size).toBe(3000)
    expect(r.reduce((s, p) => s + p.amount, 0)).toBe(30_000)
  })

  it("một lô vượt 1.000 lần thu cùng giờ → phân trang theo khoá duy nhất, không lặp/sót", async () => {
    const dong = nRows(2500, (i) => ({ receivable_id: `r-${i % 100}`, amount: 1, collected_at: "2026-01-01" }))
    const { client } = fakePostgrest({ payments: dong })
    const r = await docThanhToanCuaPhieu<{ id: string }>(client, recIds.slice(0, 100), "id")
    expect(new Set(r.map((p) => p.id)).size).toBe(2500)
  })

  it("một lô hỏng thì NÉM (bản cũ: `[]` → cột Có trống)", async () => {
    let n = 0
    const { client } = fakePostgrest({ payments }, { failOn: (c) => c.table === "payments" && ++n === 3 })
    await expect(docThanhToanCuaPhieu(client, recIds, "id")).rejects.toThrow(/Lần thu tiền/)
  })
})

describe("B4 — đối soát MISA đọc đủ sổ, và KHÔNG cắt liên kết khi sổ đọc thiếu", () => {
  const FROM = "2026-09-01"
  const TO = "2026-09-30"
  const hoaDon = (n: number) =>
    nRows(n, (i) => ({
      org_id: "o",
      misa_ref_id: `REF-${i}`,
      issued_at: "2026-09-10T08:00:00+07:00",
      total: 100,
    }))
  const snapshot = (n: number, invoice: (i: number) => string | null) =>
    nRows(n, (i) => ({
      org_id: "o",
      ref_id: `REF-${i}`,
      inv_date: "2026-09-10",
      total_amount: 100,
      relation: null,
      is_deleted: false,
      invoice_id: invoice(i),
      match_method: invoice(i) ? "ref_id" : null,
    }))

  it("1.500 hoá đơn → khớp đủ 1.500 snapshot, không cái nào thành `misa_only`", async () => {
    const invoices = hoaDon(1500)
    const snaps = snapshot(1500, (i) => invoices[i].id as string)
    const { client } = fakePostgrest({ invoices, misa_invoice_snapshots: snaps })
    const r = await reconcileOrg(client, "o", FROM, TO)
    expect(r.matched).toBe(1500)
    expect(r.misaOnly).toBe(0)
    expect(snaps.every((s) => s.invoice_id !== null)).toBe(true)
  })

  it("sổ chạm trần → snapshot không khớp được thì BỎ QUA, không cắt liên kết cũ", async () => {
    const invoices = hoaDon(BOOK_CAP + 5)
    // Snapshot cuối trỏ tới hoá đơn nằm NGOÀI phần sổ đọc được, ref lạ.
    const last = invoices[invoices.length - 1].id as string
    const snaps = snapshot(3, (i) => (i === 2 ? last : null))
    snaps[2].ref_id = "KHONG-CO-TRONG-SO"
    snaps[1].ref_id = "CUNG-KHONG-CO"
    const { client } = fakePostgrest({ invoices, misa_invoice_snapshots: snaps })
    const r = await reconcileOrg(client, "o", FROM, TO)
    expect(r.bookTruncated).toBe(true)
    expect(snaps[2].invoice_id).toBe(last)
    // Sổ thiếu thì "không có trong sổ" là KHÔNG CÓ CĂN CỨ → không gắn misa_only.
    expect(snaps[1].match_status).toBeUndefined()
    expect(r.skippedUnlink).toBe(2)
  })

  it("liên kết trỏ tới hoá đơn ngoài khung ngày vừa đọc → không cắt", async () => {
    const invoices = hoaDon(2)
    invoices[1].issued_at = "2026-08-01T08:00:00+07:00" // ngoài khung
    const snaps = snapshot(1, () => invoices[1].id as string)
    snaps[0].ref_id = "LECH"
    const { client } = fakePostgrest({ invoices, misa_invoice_snapshots: snaps })
    await reconcileOrg(client, "o", FROM, TO)
    expect(snaps[0].invoice_id).toBe(invoices[1].id)
  })

  it("sổ ĐỦ và không có liên kết cũ → vẫn gắn `misa_only` như trước", async () => {
    const snaps = snapshot(1, () => null)
    snaps[0].ref_id = "NGOAI-SO"
    const { client } = fakePostgrest({ invoices: hoaDon(1), misa_invoice_snapshots: snaps })
    const r = await reconcileOrg(client, "o", FROM, TO)
    expect(r.misaOnly).toBe(1)
    expect(snaps[0].match_status).toBe("misa_only")
  })
})

describe("M2 — danh mục bán hàng (bộ nhớ đệm sell-app) không lặp / sót khi trùng tên", () => {
  it("2.500 khách + 2.500 mặt hàng CÙNG TÊN → đủ, mỗi cái đúng một lần", async () => {
    const customers = nRows(2500, () => ({ status: "active", store_name: "Tạp hoá Hương" }))
    const products = nRows(2500, () => ({ status: "active", name: "Mì gói" }))
    const { client } = fakePostgrest({ customers, products, batches: [] })
    const r = await loadSellRefData(client)
    expect(new Set(r.customers.map((c) => c.id)).size).toBe(2500)
    expect(new Set(r.products.map((p) => p.id)).size).toBe(2500)
  })
})

/**
 * Máy quét các phép đọc PHÂN TRANG trong những tệp của đợt này: mỗi hàm
 * dựng trang (`fetchAllForAggregate` / `docDuHoacNem` / `docTheoLoId`, tới
 * `.range(`) PHẢI có một `.order(...)` theo khoá DUY NHẤT.
 *
 * ⚠ VÌ SAO: các trang chạy SONG SONG. Sắp theo `due_date`, `store_name`,
 *   `earned`… không duy nhất thì Postgres trả mỗi trang một kiểu — dòng
 *   lặp ở hai trang, dòng khác rơi mất. Không lỗi, chỉ sai số.
 */
const KHOA_DUY_NHAT = /\.order\(\s*"(id|customer_id)"/
function trangThieuKhoa(src: string): string[] {
  const c = code(src)
  const bad: string[] = []
  const re = /\b(fetchAllForAggregate|docDuHoacNem|docTheoLoId)\b(?!\s*,)(?!\s*\})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(c))) {
    const end = c.indexOf(".range(", m.index)
    if (end < 0) continue
    const seg = c.slice(m.index, end)
    // Một đoạn chứa lời gọi khác nữa → đoạn này không phải hàm dựng trang.
    if (/\b(fetchAllForAggregate|docDuHoacNem|docTheoLoId)\b/.test(seg.slice(m[0].length))) continue
    if (!KHOA_DUY_NHAT.test(seg)) bad.push(seg.slice(0, 160).replace(/\s+/g, " "))
  }
  return bad
}

describe("M2 — mọi phép đọc phân trang trong các tệp của đợt này có khoá thứ tự duy nhất", () => {
  it("máy quét tự kiểm: bắt được bản thiếu khoá, tha bản có khoá", () => {
    const thieu = `fetchAllForAggregate((from, to) => sb.from("x").select("a", { count: "exact" }).order("due_date").range(from, to))`
    const du = `docDuHoacNem((from, to) => sb.from("x").select("a").order("due_date").order("id").range(from, to), "x")`
    expect(trangThieuKhoa(thieu)).toHaveLength(1)
    expect(trangThieuKhoa(du)).toHaveLength(0)
    expect(trangThieuKhoa(`import { fetchAllForAggregate } from "x"\n` + du)).toHaveLength(0)
  })

  const TEP = [
    "src/lib/sell/approval-context.ts",
    "src/lib/sell/ref-data.ts",
    "src/app/(dashboard)/receivables/by-customer/doc-so-cong-no.ts",
    "src/app/(dashboard)/receivables/by-customer/[customerId]/page.tsx",
    "src/app/(dashboard)/receivables/by-rep/[userId]/page.tsx",
    "src/app/(dashboard)/receivables/aging/page.tsx",
    "src/app/(dashboard)/finance/cash-receipts/new/page.tsx",
    "src/app/(dashboard)/hr/payroll/runs/page.tsx",
    "src/app/(dashboard)/commissions/page.tsx",
    "src/app/(dashboard)/returns/new/page.tsx",
    "src/app/(dashboard)/sell/customer/page.tsx",
    "src/app/(dashboard)/customers/[id]/page.tsx",
    "src/app/(dashboard)/customers/page.tsx",
    "src/app/(dashboard)/customers/missing-photos/page.tsx",
    "src/app/api/customers/photo-reminders/route.ts",
    "src/app/(dashboard)/hr/attendance/page.tsx",
    "src/app/(dashboard)/sales/visits/page.tsx",
    "src/app/(dashboard)/inventory/batches/page.tsx",
    "src/app/(dashboard)/inventory/entries/page.tsx",
    "src/app/(dashboard)/payables/page.tsx",
    "src/app/api/einvoice/pull-snapshots/reconcile-org.ts",
  ]
  for (const f of TEP) {
    it(f, () => {
      expect(trangThieuKhoa(read(f))).toEqual([])
    })
  }
})

describe("M7 — ảnh điểm bán / cron nhắc: đọc đủ, lọc đúng NPP", () => {
  it("3.000 ảnh (quá `.limit` cũ) → khách có ảnh KHÔNG bị đếm 0", async () => {
    const photos = nRows(3000, (i) => ({ org_id: "o", customer_id: `c-${i % 1500}` }))
    const { client } = fakePostgrest({ customer_photos: photos })
    const r = await demAnhTheoKhach(client, "o")
    expect(r.counts.size).toBe(1500)
    expect(r.counts.get("c-1499")).toBe(2)
    expect(r.truncated).toBe(false)
  })

  it("chỉ đếm ảnh / khách của NPP được trao (admin client bỏ qua RLS)", async () => {
    const { client } = fakePostgrest({
      customer_photos: [
        { id: "p1", org_id: "o", customer_id: "a" },
        { id: "p2", org_id: "khac", customer_id: "b" },
      ],
      customers: [
        { id: "a", org_id: "o", status: "active", store_name: "A" },
        { id: "b", org_id: "khac", status: "active", store_name: "B" },
      ],
    })
    expect(Array.from((await demAnhTheoKhach(client, "o")).counts.keys())).toEqual(["a"])
    expect((await docKhachDangBan<{ id: string }>(client, "id", "o")).rows.map((c) => c.id)).toEqual(["a"])
  })

  it("phân công đọc QUA khách để lọc NPP (bảng ấy không có `org_id`)", async () => {
    const { client, calls } = fakePostgrest({
      customer_assignments: [
        { id: "x1", customer_id: "a", user_id: "u1", role: "primary", status: "active", "customer.org_id": "o" },
        { id: "x2", customer_id: "b", user_id: "u2", role: "primary", status: "active", "customer.org_id": "khac" },
      ],
    })
    const r = await docPhuTrachChinh(client, "o")
    expect(Array.from(r.repOf.entries())).toEqual([["a", "u1"]])
    expect(calls[0].filters).toContain("eq.customer.org_id")
  })

  it("đọc hỏng thì NÉM, không ra danh sách 'chưa có ảnh'", async () => {
    const { client } = fakePostgrest({}, { failOn: () => true })
    await expect(demAnhTheoKhach(client, null)).rejects.toThrow(/Ảnh điểm bán/)
  })
})

describe("M7 — thẻ đếm đối soát MISA đếm ở database, không dừng ở 1.000", () => {
  it("2.500 snapshot `misa_only` → thẻ ghi 2.500", async () => {
    const snaps = nRows(2500, (i) => ({ match_status: i < 2400 ? "misa_only" : "matched" }))
    const { client, calls } = fakePostgrest({ misa_invoice_snapshots: snaps })
    const c = await demTheoTrangThai(client)
    expect(c.misa_only).toBe(2400)
    expect(c.matched).toBe(100)
    expect(calls.every((x) => x.head)).toBe(true)
  })

  it("đếm hỏng thì NÉM, không hiện 0", async () => {
    const { client } = fakePostgrest({}, { failOn: () => true })
    await expect(demTheoTrangThai(client)).rejects.toThrow()
  })
})

/**
 * `moiNhatTheoKhach` sống trong `customers/page.tsx` (tệp trang Next.js
 * không được export thêm). Chốt dịch ĐÚNG đoạn mã ấy bằng esbuild rồi
 * CHẠY nó — không chép lại, nên sửa ở trang là chốt thấy ngay.
 */
function layHamMoiNhat() {
  const src = read("src/app/(dashboard)/customers/page.tsx")
  const a = src.indexOf("type TrangMoiNhat")
  const b = src.indexOf("export default function CustomersPage")
  expect(a, "không tìm thấy moiNhatTheoKhach trong trang khách").toBeGreaterThan(0)
  const js = transformSync(src.slice(a, b), { loader: "ts" }).code
  return Function(`${js}; return moiNhatTheoKhach`)() as <T extends { customer_id: string }>(
    ids: string[],
    dung: (lo: string[]) => unknown
  ) => Promise<{ map: Record<string, T>; error: string | null }>
}

describe("M7 — danh sách khách: đơn / lần ghé gần nhất không trống vì trần 1.000", () => {
  const moiNhat = layHamMoiNhat()

  it("khách A đặt 1.200 đơn, khách B 1 đơn cũ → B vẫn có 'đơn gần nhất'", async () => {
    const orders = [
      ...nRows(1200, (i) => ({ customer_id: "A", order_date: `2026-09-${String((i % 20) + 1).padStart(2, "0")}` })),
      { id: "zz-b", customer_id: "B", order_date: "2024-01-01" },
    ]
    const { client } = fakePostgrest({ sales_orders: orders })
    const r = await moiNhat<{ customer_id: string; order_date: string }>(["A", "B", "C"], (lo) =>
      (client.from("sales_orders") as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select("customer_id, order_date")
        .in("customer_id", lo)
        .order("order_date", { ascending: false })
        .order("id")
    )
    expect(r.error).toBeNull()
    expect(r.map.A.order_date).toBe("2026-09-20")
    expect(r.map.B.order_date).toBe("2024-01-01")
    expect(r.map.C).toBeUndefined()
  })

  it("đọc hỏng thì trả `error` để trang hiện ra", async () => {
    const { client } = fakePostgrest({}, { failOn: () => true })
    const r = await moiNhat(["A"], (lo) =>
      (client.from("sales_orders") as any).select("customer_id").in("customer_id", lo).order("id") // eslint-disable-line @typescript-eslint/no-explicit-any
    )
    expect(r.error).toMatch(/mạng rớt/)
  })
})

describe("Nhỏ — trần tra cứu phụ của ô tìm không làm URL vỡ", () => {
  it("MATCH_CAP ≤ 150 và dùng chung con số với ID_MOI_LO", () => {
    expect(MATCH_CAP).toBeLessThanOrEqual(150)
    expect(MATCH_CAP).toBe(ID_MOI_LO)
  })

  it("400 khách khớp → trả đúng MATCH_CAP mã và báo chạm trần", async () => {
    const { client } = fakePostgrest({ customers: nRows(400, () => ({})) })
    const r = await idsMatching(client as never, "customers", ["store_name"], "hương")
    expect(r.ids).toHaveLength(MATCH_CAP)
    expect(r.truncated).toBe(true)
  })
})

/**
 * Những trang không tách được hàm (tệp trang Next.js) — chốt soi mã: phép
 * đọc từng bị cắt ở 1.000 nay PHẢI đi qua đường đọc đủ và nói ra khi thiếu.
 * (Đường đọc đủ tự nó đã có chốt chạy thật ở tests/doc-du-hoac-nem.test.ts
 * và tests/aggregate.test.ts; khoá thứ tự được máy quét M2 ở trên canh.)
 */
describe("M6 / M7 / payables — các trang dùng đường đọc đủ", () => {
  const khoi = (src: string, bang: string) => {
    const c = code(src)
    const i = c.indexOf(`.from("${bang}")`)
    expect(i, `không thấy .from("${bang}")`).toBeGreaterThan(0)
    return c.slice(Math.max(0, i - 200), i + 600)
  }

  it("lô hàng: đọc đủ mọi trang, báo chạm trần", () => {
    const src = read("src/app/(dashboard)/inventory/batches/page.tsx")
    expect(khoi(src, "batches")).toContain("fetchAllForAggregate")
    expect(code(src)).toContain("setTruncated(res.truncated)")
  })

  it("phiếu kho: đọc đủ mọi trang, lỗi thì hiện", () => {
    const src = read("src/app/(dashboard)/inventory/entries/page.tsx")
    expect(khoi(src, "stock_entries")).toContain("fetchAllForAggregate")
    expect(code(src)).toContain("setLoadError(res.error)")
    expect(code(src)).not.toContain('console.error("[inventory/entries] truy vấn lỗi:"')
  })

  it("hồ sơ khách: mọi đơn + công nợ đọc đủ", () => {
    const c = code(read("src/app/(dashboard)/customers/[id]/page.tsx"))
    expect(c).toMatch(/fetchAllForAggregate<OrderRow>\(\(from, to\) =>\s*supabase\s*\.from\("sales_orders"\)/)
    expect(c).toMatch(/fetchAllForAggregate<ReceivableRow>\(\(from, to\) =>\s*supabase\s*\.from\("receivables"\)/)
    expect(c).toContain("setStatsTruncated(allOrdersRes.truncated || receivablesRes.truncated)")
  })

  it("danh sách khách: đơn / lần ghé gần nhất qua moiNhatTheoKhach", () => {
    const c = code(read("src/app/(dashboard)/customers/page.tsx"))
    expect(c).toContain("moiNhatTheoKhach<LastOrderRow>(ids")
    expect(c).toContain("moiNhatTheoKhach<LastVisitRow>(ids")
  })

  it("chấm công: đọc đủ mọi trang, báo khi thiếu", () => {
    const src = read("src/app/(dashboard)/hr/attendance/page.tsx")
    expect(khoi(src, "hr_attendance")).toContain("fetchAllForAggregate")
    expect(code(src)).toContain("attendRes.error || attendRes.truncated")
  })

  it("lịch sử đi tuyến: đọc đủ mọi trang", () => {
    const src = read("src/app/(dashboard)/sales/visits/page.tsx")
    expect(khoi(src, "visit_logs")).toContain("fetchAllForAggregate")
    expect(code(src)).toContain("setTruncated(res.truncated)")
  })

  it("ảnh điểm bán + cron nhắc: đi qua doc-anh.ts", () => {
    const page = code(read("src/app/(dashboard)/customers/missing-photos/page.tsx"))
    expect(page).toContain("demAnhTheoKhach(supabase, null)")
    const cron = code(read("src/app/api/customers/photo-reminders/route.ts"))
    expect(cron).toContain("docPhuTrachChinh(admin, org.id)")
    expect(cron).toContain("photoRes.truncated || assignRes.truncated")
    expect(cron).not.toContain('.from("customer_assignments")')
  })

  it("đối soát MISA: thẻ đếm qua demTheoTrangThai", () => {
    const c = code(read("src/app/(dashboard)/invoices/reconcile/page.tsx"))
    expect(c).toContain("demTheoTrangThai(supabase)")
    expect(c).not.toMatch(/\.select\("match_status"\)/)
  })

  it("phải trả NCC: bốn ô tổng đọc đủ, kẹp 0 từng dòng, lỗi thì hiện", () => {
    const src = read("src/app/(dashboard)/payables/page.tsx")
    const c = code(src)
    expect(c).toMatch(/fetchAllForAggregate<[\s\S]*?\.from\("payables"\)\s*\.select\("amount, paid, due_date, supplier_id, status", \{ count: "exact" \}\)/)
    expect(c).toContain("Math.max(0, Number(p.amount) - Number(p.paid))")
    expect(c).not.toMatch(/sum \+ \(Number\(p\.amount\) - Number\(p\.paid\)\)/)
    expect(c).toContain("setStatsError(res.error)")
  })
})
