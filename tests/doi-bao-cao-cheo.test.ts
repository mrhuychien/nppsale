/**
 * ĐỘI TEST "BÁO CÁO" — KIỂM CHÉO SQL ↔ TypeScript trên CÙNG một bộ dữ liệu thật.
 *
 * Dựng bộ dữ liệu `scripts/sql/doi-test/bao-cao-du-lieu.sql` trên Postgres thử (đủ migration) qua
 * `bao-cao-xuat-json.sql`, lấy số của máy chủ (dashboard_summary, finance_pnl, top khách, bao_cao_so_ban),
 * rồi cho đúng các dòng thô ấy đi qua đường nạp THẬT của Báo cáo tổng hợp (`napSoBan` gọi rpc
 * bao_cao_so_ban → `tuMotLuot` → `dungDongBan`; `napDanhMuc` dựng danh mục) và cộng bằng `congBan` /
 * `gomBan` / `chiTietBan`. Ba con số phải bằng nhau: SQL == TS == tính tay theo luật CLAUDE.md.
 *
 * Không có Postgres thử (máy CI) → bỏ qua cả khối (skip), không đỏ giả.
 *   Biến môi trường: PG_THU_HOST (mặc định /tmp/pgtest), PG_THU_PORT (55432), PG_THU_DB (npp_bao_cao).
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { napSoBan, type SoBan } from "../src/lib/bao-cao/nap-ban-hang"
import { napDanhMuc } from "../src/lib/bao-cao/nap-danh-muc"
import { congBan, gomBan, type DanhMucBC } from "../src/lib/bao-cao/cong"
import { chiTietBan } from "../src/lib/bao-cao/xuat-chi-tiet"

const HOST = process.env.PG_THU_HOST || "/tmp/pgtest"
const PORT = process.env.PG_THU_PORT || "55432"
const DB = process.env.PG_THU_DB || "npp_bao_cao"

function docSo(): Record<string, any> | null {
  try {
    const out = execFileSync(
      "psql",
      ["-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-At", "-v", "ON_ERROR_STOP=1", "-f",
        resolve(__dirname, "..", "scripts/sql/doi-test/bao-cao-xuat-json.sql")],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }
    )
    const dong = out.split("\n").find((l) => l.startsWith("{"))
    return dong ? JSON.parse(dong) : null
  } catch {
    return null
  }
}

/** Supabase giả tối thiểu: rpc trả JSON máy chủ; from(bang) trả các dòng đã cho, có phân trang. */
function sbGia(soBan: unknown, bang: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order", "gte", "lte", "lt", "neq", "is"]) b[m] = () => b
    b.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length })
    return b
  }
  return {
    rpc: (ham: string) => Promise.resolve(ham === "bao_cao_so_ban" ? { data: soBan, error: null } : { data: null, error: { code: "PGRST202", message: "x" } }),
    from: (t: string) => builder(bang[t] || []),
  } as unknown as SupabaseClient
}

const so = docSo()
const coDb = so != null

describe.skipIf(!coDb)("kiểm chéo SQL ↔ TS — Báo cáo tổng hợp, kỳ K = [T-5, T]", () => {
  let ban: SoBan
  let banP: SoBan
  let dm: DanhMucBC
  const id = (k: string) => so!.ids[k] as string

  beforeAll(async () => {
    const bang = {
      customers: (so!.kh as { id: string; channel: string | null }[]).map((k, i) => ({
        id: k.id, store_name: "KH" + (i + 1), phone: "", address: "", group_id: null, channel: k.channel, province: null, payment_terms: "NET30", credit_limit: 0,
      })),
      products: (so!.sp as Record<string, unknown>[]).map((p) => ({ ...p, name: p.sku, brand: null, primary_supplier_id: null })),
      users: [{ id: id("NVA"), full_name: "NV A" }, { id: id("NVB"), full_name: "NV B" }],
    }
    dm = (await napDanhMuc(sbGia(null, bang), "org")).dm
    ban = await napSoBan(sbGia(so!.so_ban, bang), "org", "", "", dm)
    banP = await napSoBan(sbGia(so!.so_ban_P, bang), "org", "", "", dm)
  })

  it("doanh thu gộp / trả / thuần: TS == dashboard_summary == finance_pnl == 1.039.000 / 434.000 / 605.000", () => {
    const t = congBan(ban.dong)
    expect(t.rev).toBe(1039000)
    expect(t.ret).toBe(434000)
    expect(t.net).toBe(605000)
    expect(Number(so!.ds.period_revenue)).toBe(t.net)
    expect(Number(so!.pnl.revenue)).toBe(t.net)
    expect(Number(so!.pnl.revenue_gross)).toBe(t.rev)
    expect(Number(so!.pnl.returns_value)).toBe(t.ret)
  })

  it("số HĐ (đơn đã xuất) TS == dashboard_summary.period_orders == 4", () => {
    expect(congBan(ban.dong).nInv).toBe(4)
    expect(Number(so!.ds.period_orders)).toBe(4)
  })

  it("giá vốn hàng trả đã nhập kho: TS == finance_pnl.returns_cogs == 227.000 (R1 182.000 + R4 45.000; H3 chưa nhập = 0)", () => {
    const giaVonTra = ban.dong.filter((l) => l.loai < 0).reduce((s, l) => s + l.giaVon, 0)
    expect(giaVonTra).toBe(227000)
    expect(giaVonTra).toBe(Number(so!.pnl.returns_cogs))
  })

  it("giá vốn bán P1 / P3 (không có phiếu đảo trong kỳ): 8 lon × 7.000 = 56.000; 120 chai × 3.000 = 360.000", () => {
    const g = gomBan(ban.dong.filter((l) => l.loai > 0), (l) => l.sp)
    expect(g.get(id("P1"))!.cost).toBe(56000)
    expect(g.get(id("P3"))!.cost).toBe(360000)
  })

  it("theo NV: A = 205.000, B = 400.000; Σ NV = thuần", () => {
    const g = gomBan(ban.dong, (l) => l.nv)
    expect(g.get(id("NVA"))!.net).toBe(205000)
    expect(g.get(id("NVB"))!.net).toBe(400000)
    expect(Array.from(g.values()).reduce((s, x) => s + x.net, 0)).toBe(605000)
  })

  it("chênh lệch giá NV (trước thuế, đúng đơn vị): A bán +30.000, trả +12.000 → thuần +18.000; B bán −40.000, trả −8.000 → −32.000", () => {
    const g = gomBan(ban.dong, (l) => l.nv)
    const chenh = (k: string) => {
      const x = g.get(id(k))!
      return { ban: x.revTT - x.listed, tra: x.retTT - x.rlisted, thuan: x.revTT - x.listed - (x.retTT - x.rlisted) }
    }
    expect(chenh("NVA")).toEqual({ ban: 30000, tra: 12000, thuan: 18000 })
    expect(chenh("NVB")).toEqual({ ban: -40000, tra: -8000, thuan: -32000 })
  })

  it("giảm giá cả đơn là cột RIÊNG: Σ giamDon NV A = 50.000 (H2), không trộn vào chênh", () => {
    expect(gomBan(ban.dong, (l) => l.nv).get(id("NVA"))!.giamDon).toBe(50000)
  })

  it("theo khách: TS == dashboard_top_customers (KH3 400.000, KH2 389.000, KH1 −184.000)", () => {
    const g = gomBan(ban.dong, (l) => l.kh)
    for (const t of so!.top as { customer_id: string; total: number }[]) expect(g.get(t.customer_id)!.net).toBe(Number(t.total))
    expect(g.get(id("KH3"))!.net).toBe(400000)
    expect(g.get(id("KH2"))!.net).toBe(389000)
    expect(g.get(id("KH1"))!.net).toBe(-184000)
  })

  it("theo kênh: Σ từng kênh TS == dashboard_channel_revenue (cùng số tiền)", () => {
    const g = gomBan(ban.dong, (l) => dm.khach.get(l.kh)?.kenh || "")
    const ts = Array.from(g.values()).map((x) => x.net).sort((a, b) => a - b)
    const sql = (so!.kenh as { total: number }[]).map((k) => Number(k.total)).sort((a, b) => a - b)
    expect(ts).toEqual(sql)
  })

  it("theo mặt hàng, SL quy về đơn vị cơ sở: P3 bán 5 thùng = 120 chai, trả 1 thùng = 24 chai; P1 bán 8 lon, trả 24 lon (hàng đổi không tính)", () => {
    const g = gomBan(ban.dong, (l) => l.sp, dm)
    expect(g.get(id("P3"))).toMatchObject({ qty: 120, rqty: 24 })
    expect(g.get(id("P1"))).toMatchObject({ qty: 8, rqty: 24 })
    expect(g.get(id("P5"))).toMatchObject({ qty: 31, rqty: 5 })
  })

  it("Excel chi tiết dòng: Σ 'DT thuần (phân bổ)' = 605.000; dòng trả R1 đơn giá 240.000 (trước thuế), chênh −12.000", () => {
    const rows = chiTietBan({ dong: ban.dong, dm, hoaDon: ban.hoaDon, phieuTra: ban.phieuTra, giaVon: true })
    const dau = rows[0] as string[]
    const c = (t: string) => dau.indexOf(t)
    expect(rows.slice(1).reduce((s, r) => s + Number(r[c("DT thuần (phân bổ)")]), 0)).toBe(605000)
    const r1 = rows.find((r) => r[c("Loại")] === "Trả" && r[c("ĐVT")] === "Thung 24" && r[c("Thành tiền dòng")] === -264000)!
    expect(r1[c("Đơn giá")]).toBe(240000)
    expect(r1[c("Chênh lệch giá")]).toBe(-12000)
  })

  it("phiếu trả: tự sinh H3 ghi 'Tự sinh', ngày = ngày HĐ (T-2); R1 'Tự lập', ngày hoàn thành T", () => {
    const T = new Date(so!.T + "T00:00:00Z")
    const truoc = (n: number) => new Date(T.getTime() - n * 86400000).toISOString().slice(0, 10)
    const h3 = ban.phieuTra.find((p) => p.id === id("H3.tra"))!
    const r1 = ban.phieuTra.find((p) => p.id === id("R1"))!
    expect(h3).toMatchObject({ loai: "Tự sinh", ngay: truoc(2), tien: 100000 })
    expect(r1).toMatchObject({ loai: "Tự lập", ngay: so!.T, tien: 264000, hd: id("H1.hd") })
  })

  it("kỳ trước P: chỉ H1 585.000, không trừ R1 (trả khác kỳ)", () => {
    const t = congBan(banP.dong)
    expect(t).toMatchObject({ rev: 585000, ret: 0, net: 585000, nInv: 1 })
  })
})

describe("kiểm chéo — trạng thái môi trường", () => {
  it("ghi lại có / không có Postgres thử (không làm đỏ)", () => {
    expect(typeof coDb).toBe("boolean")
  })
})
