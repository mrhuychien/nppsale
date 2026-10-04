/**
 * ĐỘI TEST CÔNG NỢ & THU TIỀN — phần logic TypeScript (bộ chống lỗi lâu dài).
 *
 * Luật đối chiếu (CLAUDE.md §1):
 *  - Nợ của khách = Σ(amount − paid) trên các phiếu status <> 'paid' — `loadCustomerDebt` / `loadDebtByCustomer`.
 *  - KHÔNG kẹp từng dòng về 0: dòng âm / trả dư là dư có, trừ vào tổng nợ.
 *  - Màn thu tiền không liệt kê dòng âm. POS "Khách cần trả" kẹp 0, phần vượt là "Ghi có".
 *  - Kiểm hạn mức = nợ sẵn có + đơn này so với credit_limit.
 *  - Ngày (DATE) so theo giờ VN, không theo mốc UTC. Tuổi nợ: ≤0 trong hạn, 1–30 cảnh báo, 31–60 quá hạn, >60 khẩn.
 *
 * Supabase GIẢ ở đây là bảng trong bộ nhớ: lọc eq/neq/is/gte/lte/or, sắp xếp, `range` có TRẦN mỗi trang
 * (như `db.max_rows`) và `count: "exact"` — để thử cả đường phân trang của `fetchAllForAggregate`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { congNgay, khoangHanTuoiNo, locTuoiNo, laNhomTuoiNo, NHOM_TUOI_NO, type NhomTuoiNo } from "@/lib/receivables/tuoi-no"
import { getAgingStatus, daysOverdueOf } from "@/lib/utils"
import { vnDateKey } from "@/lib/orders/status-tone"
import { loadCustomerDebt, loadSupplierDebt } from "@/lib/pos/load"
import { docCongNoDeThu } from "@/lib/receivables/doc-cong-no-thu"
import { cashToCollect, explainReceiptError, createCashReceipt } from "@/lib/finance/cash-receipt"
import { remainingOf, creditOf, netPosition, totalCredit, totalRemaining, receivableStateLabel, isOverpaid } from "@/lib/receivables/credit"
import { tachPhaiTra } from "@/lib/pos/totals"
import { evaluateApproval, DEFAULT_APPROVAL_RULES } from "@/lib/approval"
import { parseAmount, trangThaiSauSuaSoTien, buildPlan } from "@/lib/opening-balance/parse"
import type { ApprovalRules } from "@/types"

// ───────────────────────── Supabase giả ─────────────────────────
type Row = Record<string, unknown>
class Q implements PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }> {
  private f: Array<(r: Row) => boolean> = []
  private ord: string[] = []
  private rg: [number, number] | null = null
  private single = false
  calls: string[] = []
  constructor(private rows: Row[], private cap: number, private err: string | null) {}
  select() { return this }
  eq(c: string, v: unknown) { this.calls.push(`eq:${c}=${v}`); this.f.push((r) => r[c] === v); return this }
  neq(c: string, v: unknown) { this.calls.push(`neq:${c}=${v}`); this.f.push((r) => r[c] !== v); return this }
  is(c: string, v: unknown) { this.f.push((r) => (r[c] ?? null) === v); return this }
  gte(c: string, v: string) { this.calls.push(`gte:${c}=${v}`); this.f.push((r) => r[c] != null && String(r[c]) >= v); return this }
  lte(c: string, v: string) { this.calls.push(`lte:${c}=${v}`); this.f.push((r) => r[c] != null && String(r[c]) <= v); return this }
  or(s: string) {
    this.calls.push(`or:${s}`)
    // chỉ hỗ trợ dạng "due_date.is.null,due_date.gte.YYYY-MM-DD"
    const m = /^(\w+)\.is\.null,(\w+)\.gte\.(.+)$/.exec(s)
    if (m) this.f.push((r) => r[m[1]] == null || String(r[m[2]]) >= m[3])
    return this
  }
  order(c: string) { this.ord.push(c); return this }
  range(a: number, b: number) { this.rg = [a, b]; return this }
  maybeSingle() { this.single = true; return this }
  then<A, B>(ok?: (v: { data: unknown; error: { message: string } | null; count: number | null }) => A | PromiseLike<A>, ko?: (e: unknown) => B | PromiseLike<B>) {
    return Promise.resolve(this.run()).then(ok, ko)
  }
  private run() {
    if (this.err) return { data: null, error: { message: this.err }, count: null }
    let rs = this.rows.filter((r) => this.f.every((fn) => fn(r)))
    for (const c of [...this.ord].reverse()) rs = [...rs].sort((x, y) => String(x[c] ?? "").localeCompare(String(y[c] ?? "")))
    if (this.single) return { data: rs[0] ?? null, error: null, count: null }
    const count = rs.length
    if (this.rg) {
      const [a, b] = this.rg
      rs = rs.slice(a, Math.min(b + 1, a + this.cap))
    }
    return { data: rs, error: null, count }
  }
}
function sbGia(bang: Record<string, Row[]>, opt: { cap?: number; err?: string } = {}) {
  const qs: Q[] = []
  return {
    qs,
    from: (t: string) => { const q = new Q(bang[t] ?? [], opt.cap ?? 1000, opt.err ?? null); qs.push(q); return q },
  }
}
const rc = (id: string, customer_id: string, amount: number, paid: number, status: string, due_date: string | null = null): Row =>
  ({ id, customer_id, amount, paid, status, due_date, supplier_id: customer_id })

// ═════════════════ 1. Tuổi nợ (tuoi-no.ts) — khớp getAgingStatus và receivables_summary ═════════════════
describe("tuổi nợ: congNgay / khoangHanTuoiNo / locTuoiNo", () => {
  it("congNgay cộng trừ theo LỊCH: qua tháng, qua năm, năm nhuận", () => {
    expect(congNgay("2026-10-04", -4)).toBe("2026-09-30")
    expect(congNgay("2026-01-01", -1)).toBe("2025-12-31")
    expect(congNgay("2028-02-28", 1)).toBe("2028-02-29")
    expect(congNgay("2026-02-28", 1)).toBe("2026-03-01")
    expect(congNgay("2026-10-04", -61)).toBe("2026-08-04")
  })
  it("khoảng hạn từng nhóm: current ≥ hôm nay (+ không hạn); warning 1–30; overdue 31–60; critical > 60", () => {
    expect(khoangHanTuoiNo("current", "2026-10-04")).toEqual({ tu: "2026-10-04", kemKhongHan: true })
    expect(khoangHanTuoiNo("warning", "2026-10-04")).toEqual({ tu: "2026-09-04", den: "2026-10-03" })
    expect(khoangHanTuoiNo("overdue", "2026-10-04")).toEqual({ tu: "2026-08-05", den: "2026-09-03" })
    expect(khoangHanTuoiNo("critical", "2026-10-04")).toEqual({ den: "2026-08-04" })
  })
  it("locTuoiNo trên sổ giả: mỗi khoản rơi đúng MỘT nhóm, khoản đã thu đủ không vào nhóm nào", async () => {
    const homNay = "2026-10-04"
    const lech = [-5, 0, 1, 30, 31, 60, 61, 200]
    const rows: Row[] = lech.map((d, i) => rc(`r${i}`, "k", 100, 0, "open", congNgay(homNay, -d)))
    rows.push(rc("khong-han", "k", 100, 0, "open", null))
    rows.push(rc("da-thu", "k", 100, 100, "paid", congNgay(homNay, -45)))
    const ket: Record<string, string[]> = {}
    for (const n of NHOM_TUOI_NO) {
      const sb = sbGia({ receivables: rows })
      const q = locTuoiNo(sb.from("receivables") as unknown as Q, n, homNay)
      ket[n] = (((await q) as { data: Row[] }).data).map((r) => r.id as string).sort()
    }
    expect(ket.current).toEqual(["khong-han", "r0", "r1"])
    expect(ket.warning).toEqual(["r2", "r3"])
    expect(ket.overdue).toEqual(["r4", "r5"])
    expect(ket.critical).toEqual(["r6", "r7"])
    expect(Object.values(ket).flat()).not.toContain("da-thu")
  })
  it("locTuoiNo(null) không thêm bộ lọc nào", () => {
    const sb = sbGia({ receivables: [] })
    const q = sb.from("receivables")
    locTuoiNo(q as unknown as Q, null, "2026-10-04")
    expect(q.calls).toEqual([])
  })
  it("laNhomTuoiNo chỉ nhận 4 khoá hợp lệ", () => {
    expect(laNhomTuoiNo("warning")).toBe(true)
    expect(laNhomTuoiNo("paid")).toBe(false)
    expect(laNhomTuoiNo("")).toBe(false)
    expect(laNhomTuoiNo(null)).toBe(false)
  })
})

describe("tuổi nợ theo giờ VN — lúc 00:30 sáng VN (17:30Z hôm trước)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T17:30:00Z")) })
  afterEach(() => vi.useRealTimers())
  it("hôm nay VN là 05/10 dù đồng hồ UTC còn 04/10", () => {
    expect(vnDateKey(new Date())).toBe("2026-10-05")
  })
  it("khoản hạn 04/10 đã quá 1 ngày (cảnh báo), hạn 05/10 trong hạn — getAgingStatus và locTuoiNo nói CÙNG một nhóm", async () => {
    expect(daysOverdueOf("2026-10-04")).toBe(1)
    expect(getAgingStatus("2026-10-04")).toBe("warning")
    expect(getAgingStatus("2026-10-05")).toBe("current")
    const homNay = vnDateKey(new Date())
    for (let d = -3; d <= 70; d++) {
      const han = congNgay(homNay, -d)
      const nhom = getAgingStatus(han) as NhomTuoiNo
      const sb = sbGia({ receivables: [rc("x", "k", 1, 0, "open", han)] })
      const r = (await locTuoiNo(sb.from("receivables") as unknown as Q, nhom, homNay)) as unknown as { data: Row[] }
      expect(r.data.length, `lệch ${d} ngày → ${nhom}`).toBe(1)
    }
  })
})

// ═════════════════ 2. Nợ của khách: loadCustomerDebt / loadSupplierDebt ═════════════════
describe("loadCustomerDebt — Σ(amount − paid), status <> 'paid', không kẹp 0", () => {
  const so: Row[] = [
    rc("a", "K", 1_100_000, 300_000, "partial"),
    rc("b", "K", 500_000, 0, "open"),
    rc("am", "K", -200_000, 0, "open"), // phiếu trả độc lập — dư có
    rc("du", "K", 500_000, 600_000, "open"), // trả dư (mig 212)
    rc("xong", "K", 900_000, 900_000, "paid"),
    rc("khac", "K2", 7_000_000, 0, "open"),
  ]
  it("cộng cả dòng âm và dòng trả dư: 800k + 500k − 200k − 100k = 1.000.000", async () => {
    expect(await loadCustomerDebt(sbGia({ receivables: so }) as never, "K")).toBe(1_000_000)
  })
  it("khách chỉ có dư có → nợ ÂM (khách đang dư), không phải 0", async () => {
    expect(await loadCustomerDebt(sbGia({ receivables: [rc("am", "K", -250_000, 0, "open")] }) as never, "K")).toBe(-250_000)
  })
  it("lọc đúng khách + bỏ phiếu 'paid'", async () => {
    const sb = sbGia({ receivables: so })
    await loadCustomerDebt(sb as never, "K")
    expect(sb.qs[0].calls).toEqual(expect.arrayContaining(["eq:customer_id=K", "neq:status=paid"]))
  })
  it("đọc ĐỦ qua nhiều trang (trần 2 dòng/trang) — vẫn 1.000.000", async () => {
    expect(await loadCustomerDebt(sbGia({ receivables: so }, { cap: 2 }) as never, "K")).toBe(1_000_000)
  })
  it("đọc hỏng → null (không phải 0)", async () => {
    expect(await loadCustomerDebt(sbGia({ receivables: so }, { err: "mạng rớt" }) as never, "K")).toBeNull()
  })
  it("số lẻ cộng không trôi: 3 × 0,1 phần lẻ", async () => {
    const r = await loadCustomerDebt(sbGia({ receivables: [rc("1", "K", 100.1, 0, "open"), rc("2", "K", 200.2, 0, "open")] }) as never, "K")
    expect(r).toBeCloseTo(300.3, 6)
  })
  it("loadSupplierDebt: nợ NCC kẹp từng dòng ≥ 0, bỏ 'paid'", async () => {
    const nc: Row[] = [rc("p1", "S", 1_000_000, 400_000, "partial"), rc("p2", "S", 100, 300, "open"), rc("p3", "S", 50, 50, "paid")]
    expect(await loadSupplierDebt(sbGia({ payables: nc }) as never, "S")).toBe(600_000)
  })
})

// ═════════════════ 3. loadDebtByCustomer (màn /sell) ═════════════════
describe("loadDebtByCustomer — gom theo khách, nhớ 2 phút, đọc hỏng không nhớ", () => {
  let bang: Row[] = []
  let loi: string | null = null
  let goi = 0
  beforeEach(() => {
    vi.resetModules()
    goi = 0
    loi = null
    vi.doMock("@/lib/supabase/client", () => ({
      createClient: () => ({ from: (t: string) => { goi++; return new Q(t === "receivables" ? bang : [], 2, loi) } }),
    }))
  })
  afterEach(() => { vi.doUnmock("@/lib/supabase/client"); vi.useRealTimers() })

  it("gom từng khách, cộng dòng âm, bỏ phiếu paid, đọc qua nhiều trang", async () => {
    bang = [rc("1", "A", 1000, 0, "open"), rc("2", "A", 500, 200, "partial"), rc("3", "A", -300, 0, "open"),
            rc("4", "B", 700, 700, "paid"), rc("5", "B", 400, 500, "open"), rc("6", "C", 50, 0, "overdue")]
    const { loadDebtByCustomer } = await import("@/lib/sell/debt")
    expect(await loadDebtByCustomer()).toEqual({ A: 1000, B: -100, C: 50 })
  })
  it("gọi lần hai trong 2 phút dùng bản nhớ; quá 2 phút đọc lại", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-04T03:00:00Z"))
    bang = [rc("1", "A", 1000, 0, "open")]
    const { loadDebtByCustomer, DEBT_TTL_MS } = await import("@/lib/sell/debt")
    await loadDebtByCustomer()
    const sau1 = goi
    bang = [rc("1", "A", 9999, 0, "open")]
    expect(await loadDebtByCustomer()).toEqual({ A: 1000 })
    expect(goi).toBe(sau1)
    vi.setSystemTime(new Date(Date.now() + DEBT_TTL_MS + 1))
    expect(await loadDebtByCustomer()).toEqual({ A: 9999 })
  })
  it("đọc hỏng → null, và KHÔNG ghi nhớ — lần sau đọc lại được", async () => {
    bang = [rc("1", "A", 1000, 0, "open")]
    loi = "hỏng"
    const { loadDebtByCustomer } = await import("@/lib/sell/debt")
    expect(await loadDebtByCustomer()).toBeNull()
    loi = null
    expect(await loadDebtByCustomer()).toEqual({ A: 1000 })
  })
})

// ═════════════════ 4. Màn thu tiền: docCongNoDeThu ═════════════════
describe("docCongNoDeThu — chỉ khoản CÒN phải thu", () => {
  const so: Row[] = [
    rc("a", "K", 500, 0, "open", "2026-10-10"), rc("am", "K", -200, 0, "open", null),
    rc("du", "K", 500, 600, "open", "2026-09-01"), rc("xong", "K", 300, 300, "paid", "2026-09-01"),
    rc("b", "K", 800, 100, "partial", "2026-09-20"), rc("c", "K2", 100, 0, "open", "2026-09-01"),
  ]
  it("theo khách: bỏ dòng âm, trả dư, đã thu; xếp theo hạn", async () => {
    const r = await docCongNoDeThu(sbGia({ receivables: so }) as never, { customerId: "K" })
    expect(r.list.map((x) => x.id)).toEqual(["b", "a"])
    expect(r.customerId).toBe("K")
  })
  it("chỉ có receivableId → tra ra khách rồi đọc các khoản của khách ấy", async () => {
    const r = await docCongNoDeThu(sbGia({ receivables: so }) as never, { receivableId: "c" })
    expect(r.customerId).toBe("K2")
    expect(r.list.map((x) => x.id)).toEqual(["c"])
  })
  it("không khách → cả sổ, qua nhiều trang", async () => {
    const r = await docCongNoDeThu(sbGia({ receivables: so }, { cap: 2 }) as never, {})
    expect(r.list.map((x) => x.id).sort()).toEqual(["a", "b", "c"])
  })
})

// ═════════════════ 5. Phiếu thu: số tiền, lỗi, tải trọng RPC ═════════════════
describe("phiếu thu — cashToCollect / explainReceiptError / createCashReceipt", () => {
  it("tiền thật = nợ chọn − cấn trừ − dư có dùng; không âm", () => {
    expect(cashToCollect(1_100_000, 0, 0)).toBe(1_100_000)
    expect(cashToCollect(500_000, 0, 200_000)).toBe(300_000)
    expect(cashToCollect(300_000, 100_000, 200_000)).toBe(0)
    expect(cashToCollect(100_000, 0, 150_000)).toBe(0)
    expect(cashToCollect(NaN as unknown as number, 0)).toBe(0)
  })
  it("mỗi mã lỗi RPC ra câu tiếng Việt; lỗi lạ giữ nguyên văn", () => {
    expect(explainReceiptError("BAD_RECEIVABLE_LINE: x")).toMatch(/vượt số còn nợ/)
    expect(explainReceiptError("EMPTY_RECEIPT: x")).toBe("Chưa chọn khoản nợ nào để thu.")
    expect(explainReceiptError("CUSTOMER_REQUIRED: x")).toBe("Chưa chọn khách hàng.")
    expect(explainReceiptError("CREDIT_BALANCE_TOO_LOW: khách chỉ còn 200000 số dư có")).toBe("Không đủ số dư có: khách chỉ còn 200000 số dư có")
    expect(explainReceiptError("CREDIT_EXCEEDS_SELECTED: x")).toMatch(/lớn hơn số nợ đã chọn/)
    expect(explainReceiptError("REASON_REQUIRED: x")).toBe("Phải ghi lý do huỷ phiếu thu.")
    expect(explainReceiptError("RECEIPT_NOT_VOIDABLE: phiếu ở trạng thái voided không huỷ được")).toBe("phiếu ở trạng thái voided không huỷ được")
    expect(explainReceiptError("FORBIDDEN: bạn không có quyền lập phiếu thu")).toBe("bạn không có quyền lập phiếu thu")
    expect(explainReceiptError("BAD_AMOUNT: số dư có dùng phải là số đồng chẵn")).toBe("số dư có dùng phải là số đồng chẵn")
    expect(explainReceiptError("ORG_MISMATCH")).toBe("Phiếu thu không thuộc đơn vị của bạn.")
    expect(explainReceiptError("lỗi gì đó")).toBe("lỗi gì đó")
  })
  it("tải trọng: mặc định cash, credits [], use_credit 0; client_key chỉ gửi khi có", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "id-1", error: null })
    const id = await createCashReceipt({ rpc } as never, { customer_id: "K", lines: [{ receivable_id: "r", amount: 1000 }] })
    expect(id).toBe("id-1")
    expect(rpc).toHaveBeenCalledWith("create_cash_receipt", { p: expect.objectContaining({ customer_id: "K", method: "cash", credits: [], use_credit: 0, notes: null }) })
    expect(rpc.mock.calls[0][1].p).not.toHaveProperty("client_key")
    await createCashReceipt({ rpc } as never, { customer_id: "K", lines: [], client_key: "k-1", use_credit: 5000, method: "transfer" })
    expect(rpc.mock.calls[1][1].p).toMatchObject({ client_key: "k-1", use_credit: 5000, method: "transfer" })
  })
  it("RPC lỗi → ném câu tiếng Việt; RPC không trả id → ném, không nuốt", async () => {
    const loi = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "BAD_RECEIVABLE_LINE: x" } }) }
    await expect(createCashReceipt(loi as never, { customer_id: "K", lines: [] })).rejects.toThrow(/vượt số còn nợ/)
    const rong = { rpc: vi.fn().mockResolvedValue({ data: [{ id: "x" }], error: null }) }
    await expect(createCashReceipt(rong as never, { customer_id: "K", lines: [] })).rejects.toThrow(/Không nhận được mã phiếu thu/)
  })
})

// ═════════════════ 6. Dư có (credit.ts) + POS tachPhaiTra ═════════════════
describe("dư có / còn phải đòi / vị thế ròng", () => {
  const rows = [{ amount: 500, paid: 600 }, { amount: 1000, paid: 200 }, { amount: -300, paid: 0 }, { amount: 100, paid: 100 }]
  it("còn đòi và dư có từng dòng không âm; dòng âm là dư có", () => {
    expect(remainingOf({ amount: 1000, paid: 200 })).toBe(800)
    expect(remainingOf({ amount: 500, paid: 600 })).toBe(0)
    expect(creditOf({ amount: 500, paid: 600 })).toBe(100)
    expect(creditOf({ amount: -300, paid: 0 })).toBe(300)
    expect(creditOf({ amount: null, paid: null })).toBe(0)
    expect(isOverpaid({ amount: -1, paid: 0 })).toBe(true)
  })
  it("vị thế ròng = Σ(amount − paid) = 800 − 400 = 400 (khớp công thức loadCustomerDebt)", () => {
    expect(totalRemaining(rows)).toBe(800)
    expect(totalCredit(rows)).toBe(400)
    expect(netPosition(rows)).toBe(rows.reduce((s, r) => s + r.amount - r.paid, 0))
  })
  it("nhãn: dư có → 'Dư có'; thu đủ → 'Đã thu đủ' dù hạn đã qua", () => {
    expect(receivableStateLabel({ amount: 500, paid: 600, due_date: "2020-01-01" })).toBe("Dư có")
    expect(receivableStateLabel({ amount: 500, paid: 500, due_date: "2020-01-01" })).toBe("Đã thu đủ")
  })
  it("POS: khách cần trả kẹp 0, phần vượt thành ghi có; làm tròn đồng", () => {
    expect(tachPhaiTra(-50_000)).toEqual({ due: 0, credit: 50_000 })
    expect(tachPhaiTra(120_000.4)).toEqual({ due: 120_000, credit: 0 })
    expect(tachPhaiTra(0)).toEqual({ due: 0, credit: 0 })
    expect(tachPhaiTra(NaN)).toEqual({ due: 0, credit: 0 })
  })
})

// ═════════════════ 7. Hạn mức: nợ sẵn có + đơn này ═════════════════
describe("hạn mức tín dụng (evaluateApproval)", () => {
  const rules = { ...DEFAULT_APPROVAL_RULES, id: "", org_id: "", created_at: "", updated_at: "", updated_by: null } as ApprovalRules
  const ctx = (o: object) => ({ orderTotal: 300_000, customer: { id: "k", credit_limit: 1_000_000 }, customerDebt: 0, customerOverdue: 0, repPortfolioDebt: 0, role: "sales" as const, ...o })
  const vuot = (o: object) => evaluateApproval(rules, ctx(o) as never).reasons.some((r) => r.includes("vượt hạn mức"))
  it("nợ 700k + đơn 300k = đúng hạn mức 1tr → KHÔNG cảnh báo", () => expect(vuot({ customerDebt: 700_000 })).toBe(false))
  it("nợ 700.001 + đơn 300k → vượt hạn mức", () => expect(vuot({ customerDebt: 700_001 })).toBe(true))
  it("dư có (nợ âm −200k) được trừ: −200k + đơn 1,2tr = 1tr → không vượt", () => expect(vuot({ customerDebt: -200_000, orderTotal: 1_200_000 })).toBe(false))
  it("hạn mức 0 = không giới hạn", () => expect(vuot({ customer: { id: "k", credit_limit: 0 }, customerDebt: 9e9 })).toBe(false))
  it("tắt enforce_credit_limit → không cảnh báo", () =>
    expect(evaluateApproval({ ...rules, enforce_credit_limit: false }, ctx({ customerDebt: 5e6 }) as never).reasons.some((r) => r.includes("hạn mức"))).toBe(false))
})

// ═════════════════ 8. Nợ đầu kỳ nhập từ Excel ═════════════════
describe("nợ đầu kỳ — đọc số, trạng thái khi sửa, kế hoạch ghi", () => {
  it("parseAmount: VND không số lẻ, không âm; phân cách nghìn đọc được", () => {
    expect(parseAmount("1.500.000")).toEqual({ ok: true, value: 1_500_000 })
    expect(parseAmount("1,500,000")).toEqual({ ok: true, value: 1_500_000 })
    expect(parseAmount(2500)).toEqual({ ok: true, value: 2500 })
    expect(parseAmount("1500,5").ok).toBe(false)
    expect(parseAmount(1500.5).ok).toBe(false)
    expect(parseAmount("-500").ok).toBe(false)
    expect(parseAmount(-5).ok).toBe(false)
    expect(parseAmount("")).toEqual({ ok: false, blank: true })
  })
  it("trangThaiSauSuaSoTien: tăng số nợ đã thu đủ → partial; hạ xuống ≤ đã thu → paid; giữa chừng giữ nguyên", () => {
    expect(trangThaiSauSuaSoTien("paid", 1_000_000, 3_000_000)).toBe("partial")
    expect(trangThaiSauSuaSoTien("paid", 0, 3_000_000)).toBe("open")
    expect(trangThaiSauSuaSoTien("partial", 200_000, 150_000)).toBe("paid")
    expect(trangThaiSauSuaSoTien("overdue", 0, 900_000)).toBeUndefined()
  })
  it("buildPlan: số 0 trên khoản đã thu → lỗi; hạ dưới số đã thu → cảnh báo dư có; trùng khách → lỗi", () => {
    const ents = [{ id: "k1", label: "Tạp hoá A", altKey: "0901" }, { id: "k2", label: "Tạp hoá B", altKey: "0902" }]
    const ex = [{ id: "o1", entityId: "k1", amount: 500_000, paid: 200_000, dueDate: null, note: null, status: "partial" }]
    const p = buildPlan([
      { rowNo: 2, id: "k1", amount: 0 },
      { rowNo: 3, id: "k2", amount: "300.000" },
      { rowNo: 4, id: "k2", amount: 1 },
    ], ents, ex)
    expect(p.rows[0]).toMatchObject({ action: "error" })
    expect(p.rows[0].message).toMatch(/không xoá được/)
    expect(p.rows[1]).toMatchObject({ action: "create", amount: 300_000 })
    expect(p.rows[2]).toMatchObject({ action: "error" })
    const q = buildPlan([{ rowNo: 2, altKey: "0901", amount: 150_000 }], ents, ex)
    expect(q.rows[0]).toMatchObject({ action: "update", amount: 150_000, status: "paid" })
    expect(q.rows[0].warning).toMatch(/số dư có/)
  })
})
