import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import {
  fetchRevenueInvoices,
  fetchRevenueInvoicesDu,
  fetchInvoiceLines,
  fetchAllOrders,
  fetchReturnsValue,
  fetchReturnsValueDu,
  fetchReturnsRows,
  fetchCogsForRange,
  fetchOrgRows,
  fetchPostedStockEntries,
  vnDateOf,
} from "../src/lib/analytics/sales"
import { AGGREGATE_ROW_CAP } from "../src/lib/supabase/aggregate"

/**
 * BÁO CÁO PHẢI ĐỌC ĐỦ, VÀ ĐỌC HỎNG THÌ PHẢI NÓI RA.
 *
 * ⚠ QA ĐO ĐƯỢC (23/09/2026) CÙNG MỘT HÌNH DẠNG Ở MƯỜI MÀN BÁO CÁO: đọc
 *   trần (PostgREST `db.max_rows` = 1.000 → trả đúng 1.000 dòng, 200, không
 *   lỗi), `.in(...)` cả danh sách id (URL quá dài → lỗi), rồi lỗi chỉ được
 *   `console.error` và trang dùng `data || []`. Kết quả: giá vốn 0 → lãi
 *   100%, công nợ 0, khách thứ 1.001 rơi vào kênh "Bán trực tiếp".
 *
 * ⚠ PHẦN 1 CHẠY HÀM THẬT trên một PostgREST giả có trần 1.000 dòng, trần
 *   URL 150 id, và ĐÒI mốc chia trang `id` — thiếu mốc là nó trả lỗi, nên
 *   mọi ca dưới đây đều đo luật "thứ tự duy nhất" luôn.
 * ⚠ PHẦN 2 QUÉT MÃ các màn `reports/**` (là component React, không chạy
 *   được ở đây); mỗi phép quét có ca tự thử để chứng minh nó còn nhìn thấy.
 */

// =====================================================================
// PostgREST giả
// =====================================================================

type Row = Record<string, unknown>

interface GiaOpts {
  /** Bảng → các dòng. */
  bang: Record<string, Row[]>
  /** Bảng → lỗi trả về cho MỌI lần đọc bảng ấy. */
  loi?: Record<string, string>
  /** Bảng → cột mà câu `select` nhắc tới thì báo lỗi 42703 (cột chưa có). */
  thieuCot?: Record<string, string>
  /** Bảng → `count` giả (để thử chạm trần mà không phải dựng 20.000 dòng). */
  demGia?: Record<string, number>
}

const MAX_ROWS = 1000
const TRAN_URL = 150

function postgrestGia(o: GiaOpts) {
  const nhatKy: Array<{ bang: string; order: string[]; inLen: number[] }> = []
  function from(bang: string) {
    const loc: Array<(r: Row) => boolean> = []
    const order: string[] = []
    const inLen: number[] = []
    let cols = ""
    let dem = false
    let loiRieng: string | null = null
    const q = {
      select(c: string, opts?: { count?: string }) {
        cols = c
        dem = opts?.count === "exact"
        const thieu = o.thieuCot?.[bang]
        if (thieu && c.includes(thieu)) loiRieng = `42703 column ${bang}.${thieu} does not exist`
        return q
      },
      eq(c: string, v: unknown) { loc.push((r) => r[c] === v); return q },
      neq(c: string, v: unknown) { loc.push((r) => r[c] !== v); return q },
      gt(c: string, v: number) { loc.push((r) => Number(r[c]) > v); return q },
      gte(c: string, v: string) { loc.push((r) => String(r[c]) >= v); return q },
      lte(c: string, v: string) { loc.push((r) => String(r[c]) <= v); return q },
      in(c: string, vs: unknown[]) {
        inLen.push(vs.length)
        if (vs.length > TRAN_URL) loiRieng = "414 Request-URI Too Large"
        const s = new Set(vs)
        loc.push((r) => s.has(r[c]))
        return q
      },
      order(c: string) { order.push(c); return q },
      range(a: number, b: number) {
        nhatKy.push({ bang, order: order.slice(), inLen: inLen.slice() })
        const tra = (v: unknown) => ({ then: (r: (x: unknown) => unknown) => r(v) })
        const loi = o.loi?.[bang] ?? loiRieng
        if (loi) return tra({ data: null, error: { message: loi }, count: null })
        /* ⚠ Không có mốc `id` thì Postgres được phép trả mỗi trang một thứ
           tự — giả lập bằng cách TỪ CHỐI, để mọi ca đều đo luật này. */
        if (!order.includes("id")) {
          return tra({ data: null, error: { message: `range không có mốc duy nhất (order: ${order.join(",") || "∅"})` }, count: null })
        }
        const khop = (o.bang[bang] || []).filter((r) => loc.every((f) => f(r)))
        khop.sort((x, y) => String(x.id).localeCompare(String(y.id)))
        const trang = khop.slice(a, Math.min(b + 1, a + MAX_ROWS))
        void cols
        return tra({ data: trang, error: null, count: dem ? (o.demGia?.[bang] ?? khop.length) : null })
      },
    }
    return q
  }
  return { client: { from } as never, nhatKy }
}

const ORG = "org-1"
const KY = { from: "2026-09-01", to: "2026-09-30" }
const pad = (i: number) => String(i).padStart(6, "0")

/* Doanh thu tính theo HÓA ĐƠN (chủ nhà 24/09/2026) — hóa đơn đã ghi sổ. */
function hoaDon(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `i-${pad(i)}`,
    org_id: ORG,
    order_id: `o-${pad(i % 700)}`,
    status: "posted",
    // Cố ý dồn cả nghìn hóa đơn vào vài ngày — `invoice_date` không duy nhất.
    invoice_date: `2026-09-0${1 + (i % 3)}`,
    total: 1000,
    sales_user_id: null,
  }))
}

// =====================================================================
// PHẦN 1 — hàm thật
// =====================================================================

describe("lib/analytics/sales: đọc đủ, hỏng thì ném", () => {
  // Đổi từ `fetchDeliveredOrdersDu` (đơn "Hoàn thành") sang hóa đơn đã ghi
  // sổ — doanh thu tính theo hóa đơn (chủ nhà 24/09/2026).
  it("hóa đơn đã ghi sổ vượt 1.000 dòng vẫn đọc đủ, không trùng", async () => {
    const { client, nhatKy } = postgrestGia({
      bang: { sales_invoices: [...hoaDon(2500), { ...hoaDon(1)[0], id: "i-huy", status: "cancelled" }] },
    })
    const r = await fetchRevenueInvoicesDu(client, ORG, KY)
    expect(r.rows).toHaveLength(2500)
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(2500)
    expect(r.truncated).toBe(false)
    /* Hóa đơn chưa gán người → chuỗi rỗng, không phải null. */
    expect(r.rows[0].sales_user_id).toBe("")
    /* Sắp theo ngày cho người xem, nhưng mốc CUỐI phải là `id`. */
    for (const k of nhatKy) expect(k.order[k.order.length - 1]).toBe("id")
  })

  it.each([
    ["fetchRevenueInvoices", () => fetchRevenueInvoices, "sales_invoices"],
    ["fetchAllOrders", () => fetchAllOrders, "sales_orders"],
  ])("%s: đọc hỏng thì NÉM, không trả mảng rỗng", async (_t, ham, bang) => {
    const { client } = postgrestGia({ bang: {}, loi: { [bang]: "rớt mạng" } })
    await expect(ham()(client, ORG, KY)).rejects.toThrow(/rớt mạng/)
  })

  it("chạm trần thì bản `…Du` gắn cờ `truncated`", async () => {
    const { client } = postgrestGia({
      bang: { sales_invoices: hoaDon(10) },
      demGia: { sales_invoices: AGGREGATE_ROW_CAP + 5 },
    })
    const r = await fetchRevenueInvoicesDu(client, ORG, KY)
    expect(r.truncated).toBe(true)
  })

  it("dòng hóa đơn: chia lô ≤150 id, đọc đủ", async () => {
    const dong = hoaDon(400).map((h, i) => ({
      id: `sil-${pad(i)}`, invoice_id: h.id, product_id: "p", unit_name: "thùng",
      conversion_factor: 1, quantity: 2, unit_price: 500, line_total: 1000,
    }))
    const { client, nhatKy } = postgrestGia({ bang: { sales_invoice_lines: dong } })
    const r = await fetchInvoiceLines(client, dong.map((d) => String(d.invoice_id)))
    expect(r).toHaveLength(400)
    const lo = nhatKy.filter((k) => k.bang === "sales_invoice_lines").flatMap((k) => k.inLen)
    expect(Math.max(...lo)).toBeLessThanOrEqual(150)
  })

  it("phiếu trả: hỏng thì NÉM (cả tổng lẫn danh sách)", async () => {
    const { client } = postgrestGia({ bang: {}, loi: { returns: "hết giờ" } })
    await expect(fetchReturnsValue(client, ORG, KY)).rejects.toThrow(/hết giờ/)
    await expect(fetchReturnsRows(client, ORG, KY)).rejects.toThrow(/hết giờ/)
  })

  it("phiếu trả: thiếu cột `credited_at` thì LÙI về `created_at`, không ném", async () => {
    const tra = Array.from({ length: 1200 }, (_, i) => ({
      id: `r-${pad(i)}`, org_id: ORG, status: "approved",
      created_at: "2026-09-10T03:00:00Z", credit_note_amount: -10,
    }))
    const { client } = postgrestGia({ bang: { returns: tra }, thieuCot: { returns: "credited_at" } })
    const r = await fetchReturnsValueDu(client, ORG, KY)
    /* 1.200 phiếu × 10 — đủ cả phần vượt 1.000 dòng. */
    expect(r.total).toBe(12000)
    const rows = await fetchReturnsRows(client, ORG, KY)
    expect(rows).toHaveLength(1200)
  })

  it("giá vốn: đọc phiếu xuất hỏng thì NÉM — không thành 'giá vốn 0, lãi 100%'", async () => {
    const { client } = postgrestGia({ bang: {}, loi: { stock_entries: "RLS" } })
    await expect(fetchCogsForRange(client, ORG, KY)).rejects.toThrow(/RLS/)
  })

  it("giá vốn: 1.200 phiếu, chia lô ≤150 id, cộng đủ mọi dòng", async () => {
    const phieu = Array.from({ length: 1200 }, (_, i) => ({
      id: `e-${pad(i)}`, org_id: ORG, type: "export", status: "posted",
      posted_at: "2026-09-05T02:00:00Z", entry_code: `PX${i}`, supplier_id: null,
    }))
    const dong = phieu.map((p, i) => ({
      id: `l-${pad(i)}`, entry_id: p.id, product_id: "p", quantity: -2, unit_cost: 5,
    }))
    const { client, nhatKy } = postgrestGia({ bang: { stock_entries: phieu, stock_entry_lines: dong } })
    const r = await fetchCogsForRange(client, ORG, KY)
    expect(r.lines).toHaveLength(1200)
    expect(r.cogs).toBe(1200 * 2 * 5)
    expect(r.truncated).toBe(false)
    const lo = nhatKy.filter((k) => k.bang === "stock_entry_lines").flatMap((k) => k.inLen)
    expect(Math.max(...lo)).toBeLessThanOrEqual(150)
  })

  it("phiếu kho: mốc kỳ theo giờ Việt Nam (+07), không phải UTC", async () => {
    const phieu = [
      // 23:30 ngày 31/08 UTC = 06:30 sáng 01/09 giờ Việt Nam → TRONG kỳ.
      { id: "a", org_id: ORG, type: "export", status: "posted", posted_at: "2026-08-31T23:30:00Z" },
    ]
    const { client } = postgrestGia({ bang: { stock_entries: phieu } })
    /* Giả so chuỗi — nên so bằng mốc +07 đã đổi ra; chỉ cần mốc đầu
       KHÔNG phải "…T00:00:00Z" là đủ bắt lỗi cũ. */
    let seen = ""
    const spy = {
      from: (b: string) => {
        const q = (client as unknown as { from: (b: string) => Record<string, (...a: unknown[]) => unknown> }).from(b)
        const gte = q.gte
        q.gte = (c: unknown, v: unknown) => { seen = String(v); return gte(c, v) }
        return q
      },
    }
    await fetchPostedStockEntries(spy as never, ORG, KY, "export")
    expect(seen).toBe("2026-09-01T00:00:00+07:00")
  })

  it("bảng tra cứu (khách hàng) vượt 1.000 dòng vẫn đọc đủ; hỏng thì NÉM", async () => {
    const kh = Array.from({ length: 1500 }, (_, i) => ({ id: `c-${pad(i)}`, org_id: ORG, channel: "T1" }))
    const { client } = postgrestGia({ bang: { customers: kh } })
    const r = await fetchOrgRows<{ id: string }>(client, "customers", ORG, "id, channel", "đọc khách")
    expect(r.rows).toHaveLength(1500)
    const hong = postgrestGia({ bang: {}, loi: { customers: "403" } })
    await expect(
      fetchOrgRows(hong.client, "customers", ORG, "id", "đọc khách")
    ).rejects.toThrow(/đọc khách: 403/)
  })

  it("ngày Việt Nam của một mốc UTC", () => {
    expect(vnDateOf("2026-08-31T23:30:00Z")).toBe("2026-09-01")
    expect(vnDateOf("2026-09-01T10:00:00+07:00")).toBe("2026-09-01")
  })
})

// =====================================================================
// PHẦN 2 — quét các màn reports/**
// =====================================================================

const ROOT = resolve(__dirname, "..")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function moiTep(dir: string, acc: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten)
    if (statSync(p).isDirectory()) moiTep(p, acc)
    else if (ten.endsWith(".ts") || ten.endsWith(".tsx")) acc.push(p)
  }
  return acc
}
const GOC = resolve(ROOT, "src/app/(dashboard)/reports")
const TEP = moiTep(GOC).map((p) => ({ rel: p.slice(ROOT.length + 1), src: code(readFileSync(p, "utf-8")) }))

/** Từng câu truy vấn: từ `.from("` tới `.from("` kế tiếp (tối đa 700 ký tự). */
function cauTruyVan(src: string): Array<{ bang: string; than: string }> {
  const out: Array<{ bang: string; than: string }> = []
  const re = /\.from\("(\w+)"\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const ke = src.indexOf('.from("', m.index + 7)
    const het = ke === -1 ? m.index + 700 : Math.min(ke, m.index + 700)
    out.push({ bang: m[1], than: src.slice(m.index, het) })
  }
  return out
}

/** Luật: đọc lỗi thì không được chỉ ghi console. */
const nuotLoi = (src: string) => /console\.error\(/.test(src)
/** Luật: mọi câu đọc phải phân trang (hoặc chỉ đếm). */
const docTran = (src: string) =>
  cauTruyVan(src).filter((c) => !/\.range\(/.test(c.than) && !/head: true/.test(c.than)).map((c) => c.bang)
/** Luật: câu phân trang phải có mốc duy nhất `id`. */
const khongMoc = (src: string) =>
  cauTruyVan(src).filter((c) => /\.range\(/.test(c.than) && !/\.order\("id"\)/.test(c.than)).map((c) => c.bang)
/** Luật: `.in(...)` với một danh sách biến phải là lô `lo` của `docTheoLoId`. */
const inCaDanhSach = (src: string) =>
  Array.from(src.matchAll(/\.in\(\s*"(\w+)",\s*([^)\]]+?)\s*[,)]/g))
    .filter((m) => !m[2].trim().startsWith("[") && m[2].trim() !== "lo")
    .map((m) => `${m[1]} ← ${m[2].trim()}`)
/** Luật: lô tồn kho chỉ đọc lô CÒN HÀNG. */
const loRong = (src: string) =>
  cauTruyVan(src).filter((c) => c.bang === "batches" && !/\.gt\("qty_on_hand", 0\)/.test(c.than)).length > 0
/** Luật: không gọi thẳng `fetchAllForAggregate` (nó trả lỗi thay vì ném). */
const goiThang = (src: string) => /fetchAllForAggregate/.test(src)
/** Luật: không gọi bản cũ nuốt cờ `truncated` — dùng bản `…Du`. */
const nuotCo = (src: string) => /\bfetch(RevenueInvoices|AllOrders|ReturnsRows|ReturnsValue)\(/.test(src)

describe("reports/**: các phép quét còn nhìn thấy lỗi", () => {
  it("nhận ra `console.error` nuốt lỗi", () => {
    expect(nuotLoi('if (qErr) console.error("[x]", qErr.message)')).toBe(true)
    expect(nuotLoi("setLoadError(errorMessage(err))")).toBe(false)
  })
  it("nhận ra câu đọc trần, bỏ qua câu chỉ đếm", () => {
    expect(docTran('supabase.from("customers").select("id").eq("org_id", o),')).toEqual(["customers"])
    expect(docTran('supabase.from("products").select("id", { count: "exact", head: true })')).toEqual([])
    expect(docTran('supabase.from("x").select("id", { count: "exact" }).order("id").range(a, b)')).toEqual([])
  })
  it("nhận ra câu phân trang thiếu mốc `id`", () => {
    expect(khongMoc('.from("sales_orders").select("*").order("order_date").range(a, b)')).toEqual(["sales_orders"])
    expect(khongMoc('.from("sales_orders").select("*").order("order_date").order("id").range(a, b)')).toEqual([])
  })
  it("nhận ra `.in(...)` nhét cả danh sách id", () => {
    expect(inCaDanhSach('.in("entry_id", stockEntryIds)')).toEqual(["entry_id ← stockEntryIds"])
    expect(inCaDanhSach('.in(\n  "return_id",\n  returnsRows.map((r) => r.id)\n)')).toHaveLength(1)
    expect(inCaDanhSach('.in("entry_id", lo)')).toEqual([])
    expect(inCaDanhSach('.in("status", ["open", "partial"])')).toEqual([])
  })
  it("nhận ra đọc cả lô đã hết hàng", () => {
    expect(loRong('.from("batches").select("id").eq("org_id", o).order("id").range(a, b)')).toBe(true)
    expect(loRong('.from("batches").select("id").gt("qty_on_hand", 0).order("id").range(a, b)')).toBe(false)
  })
  it("nhận ra gọi bản nuốt cờ", () => {
    expect(nuotCo("fetchRevenueInvoices(supabase, org, range)")).toBe(true)
    expect(nuotCo("fetchRevenueInvoicesDu(supabase, org, range)")).toBe(false)
  })
})

/**
 * Ba màn tài chính con chỉ đọc SỐ TỔNG từ RPC cộng sổ phía máy chủ
 * (`finance_pnl`, `finance_balance_sheet`, `finance_cash_flow` qua
 * `src/lib/finance.ts`) — không đọc dòng nào, nên không có chuyện chạm
 * trần 1.000 dòng và không cần dải "số liệu chưa đầy đủ".
 *
 * ⚠ 23/09/2026: `lib/finance` đã thôi nuốt lỗi (trước đó lỗi RPC thành mọi
 *   số bằng 0) — đợt sửa phân tích. Ba màn bắt lỗi và vẽ dải báo lỗi.
 * ⚠ Chốt dưới đòi chúng THẬT SỰ không đọc bảng nào: thêm một `.from(...)`
 *   là phải ra khỏi danh sách này và đi đúng luật đọc đủ + báo thiếu.
 */
const MAN_CHI_DOC_TONG_RPC = [
  "src/app/(dashboard)/reports/finance/balance-sheet/page.tsx",
  "src/app/(dashboard)/reports/finance/cash-flow/page.tsx",
  "src/app/(dashboard)/reports/finance/pnl/page.tsx",
]

describe("reports/**: mọi màn đọc đủ và nói ra khi hỏng", () => {
  it("lib/finance không nuốt lỗi; ba màn chỉ đọc tổng thì không đọc bảng nào", () => {
    const lib = code(readFileSync(resolve(ROOT, "src/lib/finance.ts"), "utf-8"))
    expect(lib, "lib/finance lại nuốt lỗi thành số 0").not.toMatch(/if \(error\) console\.error/)
    for (const rel of MAN_CHI_DOC_TONG_RPC) {
      const t = TEP.find((x) => x.rel === rel)
      expect(t, `${rel} không còn`).toBeTruthy()
      expect(t!.src, `${rel} đọc bảng — ra khỏi MAN_CHI_DOC_TONG_RPC`).not.toMatch(/\.from\(/)
      expect(t!.src, `${rel} không vẽ dải báo lỗi`).toMatch(/<ReportLoadNotice error=\{loadError\}/)
    }
  })

  it("phép quét thật sự có tệp để quét", () => {
    expect(TEP.length).toBeGreaterThan(10)
  })

  it.each([
    ["không `console.error` nuốt lỗi", nuotLoi],
    ["không gọi thẳng fetchAllForAggregate", goiThang],
    ["không gọi bản cũ nuốt cờ truncated", nuotCo],
    ["lô tồn kho chỉ đọc lô còn hàng", loRong],
  ] as const)("%s", (_t, luat) => {
    expect(TEP.filter((t) => luat(t.src)).map((t) => t.rel)).toEqual([])
  })

  it("mọi câu đọc đều phân trang", () => {
    const bad = TEP.flatMap((t) => docTran(t.src).map((b) => `${t.rel} → ${b}`))
    expect(bad, "đọc trần: quá 1.000 dòng thì API trả đúng 1.000, không lỗi").toEqual([])
  })

  it("mọi câu phân trang đều có mốc `id`", () => {
    const bad = TEP.flatMap((t) => khongMoc(t.src).map((b) => `${t.rel} → ${b}`))
    expect(bad, "trang song song không có mốc duy nhất → dòng lặp/sót").toEqual([])
  })

  it("không `.in(...)` nào nhét cả danh sách id", () => {
    const bad = TEP.flatMap((t) => inCaDanhSach(t.src).map((b) => `${t.rel} → ${b}`))
    expect(bad, "URL quá dài khi kỳ lớn — dùng docTheoLoId").toEqual([])
  })

  /**
   * ⚠ ĐÒI THỨ NGƯỜI XEM NHÌN THẤY. Mỗi màn có nạp dữ liệu phải vẽ dải báo
   *   lỗi, VÀ vẽ dải báo chạm trần (hoặc câu `truncationWarning()`).
   */
  it("mọi màn nạp dữ liệu đều vẽ dải báo lỗi và báo thiếu", () => {
    const man = TEP.filter(
      (t) => t.rel.endsWith("page.tsx") && /createClient\(\)/.test(t.src) && !MAN_CHI_DOC_TONG_RPC.includes(t.rel)
    )
    expect(man.length).toBeGreaterThanOrEqual(10)
    for (const t of man) {
      expect(t.src, `${t.rel} không vẽ dải báo lỗi`).toMatch(/<ReportLoadNotice error=\{loadError\}/)
      expect(
        /<ReportLoadNotice truncated=\{truncated\}/.test(t.src) || /truncationWarning\(\)/.test(t.src),
        `${t.rel} bỏ cờ truncated — số thiếu mà không ai biết`
      ).toBe(true)
      expect(t.src, `${t.rel} không bắt lỗi khi nạp`).toMatch(/catch \(err\) \{\s*setLoadError\(/)
    }
  })
})
