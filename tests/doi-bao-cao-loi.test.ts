/**
 * ĐỘI TEST "BÁO CÁO" — LỖI ĐÃ XÁC MINH ở đường TypeScript (để NGUYÊN ĐỎ tới khi sửa).
 *
 * LỖI 3 — Huỷ phiếu trả tự lập đã hoàn thành sinh phiếu XUẤT "Đảo phiếu trả …" với unit_cost = 0
 *   (cancel_return, supabase/migrations/191_luat_phieu_tra_tu_sinh_va_tu_lap.sql). Báo cáo tổng hợp lấy
 *   "giá vốn bình quân / đơn vị cơ sở của phiếu xuất trong kỳ" (bao_cao_so_ban.gv → tuMotLuot; đường cũ
 *   fetchCogsForRange → giaVonBinhQuanCoSo) GỒM CẢ phiếu đảo này → bình quân bị kéo xuống → giá vốn hàng
 *   bán thấp, LÃI GỘP CAO GIẢ.
 *   Luật: CLAUDE.md "Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho)"; `unit_cost` là giá
 *   mỗi đơn vị cơ sở — P5 chỉ có MỘT lô 9.000/lon, bán 31 lon thì giá vốn là 279.000.
 *
 * Bộ dữ liệu: scripts/sql/doi-test/bao-cao-du-lieu.sql (R3 = 2 lon P5 hoàn thành rồi huỷ trong kỳ).
 * Tái hiện SQL tối thiểu: scripts/sql/doi-test/bao-cao-loi.sql (L3).
 * Không có Postgres thử → bỏ qua (skip).
 */
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { napSoBan, type SoBan } from "../src/lib/bao-cao/nap-ban-hang"
import { napDanhMuc } from "../src/lib/bao-cao/nap-danh-muc"
import { congBan, gomBan } from "../src/lib/bao-cao/cong"

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

describe.skipIf(so == null)("LỖI 3 — phiếu 'Đảo phiếu trả' giá 0 kéo giá vốn bình quân của Báo cáo tổng hợp", () => {
  let ban: SoBan
  const id = (k: string) => so!.ids[k] as string
  beforeAll(async () => {
    const bang = {
      customers: (so!.kh as { id: string; channel: string | null }[]).map((k) => ({ id: k.id, store_name: k.id, group_id: null, channel: k.channel, province: null, payment_terms: null, credit_limit: 0 })),
      products: (so!.sp as Record<string, unknown>[]).map((p) => ({ ...p, name: p.sku, brand: null, primary_supplier_id: null })),
      users: [],
    }
    const dm = (await napDanhMuc(sbGia(null, bang), "org")).dm
    ban = await napSoBan(sbGia(so!.so_ban, bang), "org", "", "", dm)
  })

  it("giá vốn hàng bán P5 kỳ K = 31 lon × 9.000 = 279.000", () => {
    const g = gomBan(ban.dong.filter((l) => l.loai > 0), (l) => l.sp)
    expect(g.get(id("P5"))!.cost).toBe(279000)
  })

  it("lãi gộp kỳ K = thuần 605.000 − (giá vốn bán 695.000 − giá vốn hàng trả đã nhập 227.000) = 137.000", () => {
    const t = congBan(ban.dong)
    expect(t.net).toBe(605000)
    expect(t.cost).toBe(468000)
    expect(t.gp).toBe(137000)
  })
})
