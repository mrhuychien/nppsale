/**
 * ĐỘI TEST "LIÊN MÔ-ĐUN" — KIỂM CHÉO SQL ↔ TypeScript trên CÙNG một sổ thật.
 *
 * Chạy `scripts/sql/doi-test/lien-module-chuoi.sql` trên Postgres thử (đủ migration). Kịch bản in ảnh chụp sổ
 * ('ANH|{json}') ở các bước của chuỗi dài (xuất HĐ giao thiếu, trả gắn HĐ, trả độc lập nợ âm, Sửa HĐ, huỷ
 * phiếu trả, phiếu tự sinh + hàng đổi, cuối tháng, HĐ âm). Với mỗi ảnh, các hàm TypeScript mà màn hình dùng
 * phải ra ĐÚNG số của sổ (CLAUDE.md §1):
 *   · loadCustomerDebt (POS) / loadDebtByCustomer (/sell)  ==  nợ khách tính trên máy chủ (Σ amount − paid, ≠ 'paid')
 *   · tổng HĐ − creditOnInvoice / traTheoHoaDon (khối Cộng tiền, danh sách HĐ)  ==  receivables.amount của HĐ
 *     (kể cả HĐ ÂM — không kẹp 0)
 *   · Σ HĐ ghi sổ − traCuaKhach (theo revenue_date)  ==  doanh số thuần trên dashboard_summary (Δ)
 *   · bước cuối mỗi chuỗi: tất cả kịch bản SQL ĐẠT (TONG|).
 *
 * Không có Postgres thử (máy CI) → bỏ qua cả khối, không đỏ giả.
 *   Biến môi trường: PG_THU_HOST (mặc định /tmp/pgtest), PG_THU_PORT (55432), PG_THU_DB (npp_lien_module).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"

type Row = Record<string, unknown>
type Anh = {
  buoc: string
  kh: string
  tu: string
  no_sql: number
  ds_delta: number
  receivables: Row[]
  invoices: Row[]
  returns: Row[]
}

const HOST = process.env.PG_THU_HOST || "/tmp/pgtest"
const PORT = process.env.PG_THU_PORT || "55432"
const DB = process.env.PG_THU_DB || "npp_lien_module"

/** Có Postgres thử với DB của đội không (phân biệt "không có DB" với "kịch bản nổ lỗi"). */
function coKetNoi(): boolean {
  try {
    execFileSync("psql", ["-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-Atc", "SELECT 1"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 })
    return true
  } catch {
    return false
  }
}

function chay(): { anh: Anh[]; tong: { tong: number; dat: number } } | null {
  try {
    const out = execFileSync(
      "psql",
      ["-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-f",
        resolve(__dirname, "..", "scripts/sql/doi-test/lien-module-chuoi.sql")],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }
    )
    const dong = out.split("\n")
    const anh = dong.filter((l) => l.startsWith("ANH|")).map((l) => JSON.parse(l.slice(4)) as Anh)
    const t = dong.find((l) => l.startsWith("TONG|"))
    if (!t || anh.length === 0) return null
    return { anh, tong: JSON.parse(t.slice(5)) }
  } catch {
    return null
  }
}

/**
 * Supabase giả có ÁP bộ lọc (eq / neq / in / gte / lt / lte) lên các dòng thật của sổ — để hàm TS tự lọc
 * như với PostgREST, không phải nhận dòng đã lọc sẵn.
 */
function sbGia(bang: Record<string, Row[]>): SupabaseClient {
  const tao = (rows: Row[]) => {
    let r = rows.slice()
    const b: Record<string, unknown> = {}
    const then = (res: (v: unknown) => void) => res({ data: r, error: null, count: r.length })
    Object.assign(b, {
      select: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => ((r = r.filter((x) => String(x[c]) === String(v))), b),
      neq: (c: string, v: unknown) => ((r = r.filter((x) => String(x[c]) !== String(v))), b),
      in: (c: string, vs: unknown[]) => ((r = r.filter((x) => vs.map(String).includes(String(x[c])))), b),
      gte: (c: string, v: string) => ((r = r.filter((x) => x[c] != null && String(x[c]) >= v)), b),
      lt: (c: string, v: string) => ((r = r.filter((x) => x[c] != null && String(x[c]) < v)), b),
      lte: (c: string, v: string) => ((r = r.filter((x) => x[c] != null && String(x[c]) <= v)), b),
      range: (from: number, to: number) => Promise.resolve({ data: r.slice(from, to + 1), error: null, count: r.length }),
      then,
    })
    return b
  }
  return { from: (t: string) => tao(bang[t] || []) } as unknown as SupabaseClient
}

let bangHienTai: Record<string, Row[]> = {}
vi.mock("@/lib/supabase/client", () => ({ createClient: () => sbGia(bangHienTai) }))

// ⚠ Có DB mà kịch bản nổ lỗi (RPC đổi tên, lỗi mới chặn ngang chuỗi) thì PHẢI ĐỎ, không được bỏ qua.
const coDb = coKetNoi()
const kq = coDb ? chay() : null

describe.skipIf(!coDb)("liên mô-đun — sổ máy chủ ↔ hàm TypeScript của màn hình", () => {
  const n = (v: unknown) => Number(v ?? 0)

  it("kịch bản SQL liên mô-đun chạy hết và ĐẠT toàn bộ", () => {
    expect(kq, "kịch bản lien-module-chuoi.sql nổ lỗi giữa chừng — chạy tay bằng psql để xem").not.toBeNull()
    expect(kq!.tong.tong).toBeGreaterThan(300)
    expect(kq!.tong.dat).toBe(kq!.tong.tong)
  })

  it("có đủ ảnh chụp các bước then chốt", () => {
    const cac = kq!.anh.map((a) => a.buoc)
    for (const b of ["A3", "A5", "A6", "A8", "A9", "A10", "C1", "C5", "F4", "H2b"]) expect(cac).toContain(b)
  })

  describe.each((kq?.anh ?? []).map((a) => [a.buoc, a] as const))("ảnh %s", (_b, a) => {
    beforeEach(() => {
      bangHienTai = { receivables: a.receivables, returns: a.returns }
      vi.resetModules()
    })

    it("loadCustomerDebt (POS) = nợ trên máy chủ, không kẹp dòng âm", async () => {
      const { loadCustomerDebt } = await import("../src/lib/pos/load")
      const v = await loadCustomerDebt(sbGia({ receivables: a.receivables }), a.kh)
      expect(v).toBe(n(a.no_sql))
    })

    it("loadDebtByCustomer (/sell) = nợ trên máy chủ", async () => {
      const { loadDebtByCustomer } = await import("../src/lib/sell/debt")
      const m = await loadDebtByCustomer()
      expect(m).not.toBeNull()
      expect(m![a.kh] ?? 0).toBe(n(a.no_sql))
    })

    it("mỗi HĐ ghi sổ: tổng − khoản trừ (creditOnInvoice / traTheoHoaDon) = công nợ của HĐ", async () => {
      const { traTheoHoaDon } = await import("../src/lib/analytics/net-revenue")
      const { creditOnInvoice, netDueOnInvoice } = await import("../src/lib/orders/invoice-credit")
      const hd = a.invoices.filter((i) => i.status === "posted")
      const tru = await traTheoHoaDon(sbGia({ returns: a.returns }), hd.map((i) => String(i.id)))
      for (const i of hd) {
        const rc = a.receivables.find((r) => r.invoice_id === i.id)
        expect(rc, `HĐ ${i.id} phải có đúng một phiếu nợ`).toBeTruthy()
        const cuaHd = a.returns.filter((r) => r.invoice_id === i.id) as never[]
        expect(netDueOnInvoice(n(i.total), creditOnInvoice(cuaHd))).toBe(n(rc!.amount))
        expect(n(i.total) - (tru.get(String(i.id)) ?? 0)).toBe(n(rc!.amount))
      }
    })

    it("HĐ đã huỷ: không có phiếu nợ, không vào tổng nợ", () => {
      for (const i of a.invoices.filter((x) => x.status === "cancelled"))
        expect(a.receivables.some((r) => r.invoice_id === i.id)).toBe(false)
    })

    it("phiếu trả độc lập Hoàn thành ↔ đúng một dòng nợ âm −credit", () => {
      for (const r of a.returns.filter((x) => x.invoice_id == null && x.order_id == null && x.status === "completed")) {
        const rc = a.receivables.filter((x) => x.return_id === r.id)
        expect(rc).toHaveLength(1)
        expect(n(rc[0].amount)).toBe(-n(r.credit_note_amount))
      }
    })
  })

  // Chuỗi A, C và H chạy khi các chuỗi trước đã đưa doanh số về 0 → Δ dashboard là của riêng khách đang xét.
  describe.each(
    (kq?.anh ?? []).filter((a) => /^(A|C)/.test(a.buoc)).map((a) => [a.buoc, a] as const)
  )("doanh số thuần ảnh %s", (_b, a) => {
    it("Σ HĐ ghi sổ − traCuaKhach (revenue_date) = Δ dashboard_summary", async () => {
      const { traCuaKhach } = await import("../src/lib/analytics/net-revenue")
      const di = a.invoices
        .filter((i) => i.status === "posted" && String(i.invoice_date) >= a.tu)
        .reduce((s, i) => s + n(i.total), 0)
      const tra = await traCuaKhach(sbGia({ returns: a.returns }), a.kh, a.tu, null)
      expect(di - tra).toBe(n(a.ds_delta))
    })
  })

  it("con số then chốt theo luật (đọc từ ảnh)", () => {
    const lay = (b: string) => kq!.anh.find((x) => x.buoc === b)!
    expect(n(lay("A6").no_sql)).toBe(-80000) // trả độc lập vượt nợ → nợ âm
    expect(n(lay("A8").no_sql)).toBe(-150000) // Sửa HĐ: dư 50.000 trên HĐ + dư có 100.000
    expect(n(lay("A9").no_sql)).toBe(550000) // huỷ phiếu trả khi dư có đã dùng → nợ tăng lại
    expect(n(lay("A10").no_sql)).toBe(0)
    expect(n(lay("C5").ds_delta)).toBe(450000) // Sửa HĐ chọn Có: trả 3 lon, trừ ngày HĐ
    expect(n(lay("H2b").no_sql)).toBe(-240000) // HĐ âm không kẹp 0
  })
})
