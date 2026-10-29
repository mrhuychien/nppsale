/**
 * BÁO CÁO ĐỌC NHANH — chủ nhà 29/10/2026 (Báo cáo tổng hợp › Bán hàng): "sao nó cứ dĩnh lỗi này nhỉ — Không đọc được số
 * liệu · Đọc số bán hàng hỏng: … đọc số bán: AbortError: Máy chủ chưa trả lời sau 10 giây — thao tác có thể đã được ghi".
 * Gốc: `bao_cao_so_ban` ngồi biên dịch JIT ~3 giây mỗi lần gọi (máy chủ thật chậm hơn → quá 10 giây), và gửi bằng POST nên
 * bộ hẹn giờ coi là câu GHI — không thử lại, dặn nhầm "có thể đã ghi". Sửa: mig 256 (JIT tắt ngay trên hàm, bỏ dong_don /
 * dong_hd_goc app không đọc) + hàm chỉ đọc gọi bằng GET + hàm báo cáo một lượt chờ 45 giây, một lượt.
 * SQL thật: scripts/sql/thu-256-bao-cao-doc-nhanh.sql · bấm thật: e2e/bao-cao-het-gio.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { PostgrestClient } from "@supabase/postgrest-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  DAN_CAU_GHI, HET_GIO_BAO_CAO_MS, HET_GIO_MS, HetGioError, LOI_HET_GIO, cauHetGio, fetchCoHetGio, laBaoCaoMotLuot, laHetGio,
} from "@/lib/supabase/fetch-het-gio"
import { goiMotLuot } from "@/lib/bao-cao/mot-luot"
import { fetchBalanceSheet, fetchCashFlow, fetchPnl } from "@/lib/finance"
import { errorMessage } from "@/lib/errors"
import { LoiDocSo, gopDauCham } from "@/components/bao-cao/khoi"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/256_bao_cao_doc_nhanh.sql")

/** Thân `$fn$ … $fn$` của bao_cao_so_ban trong một migration. */
function thanSoBan(sql: string): string {
  const dau = sql.indexOf("CREATE OR REPLACE FUNCTION public.bao_cao_so_ban(p_tu date, p_den date)")
  expect(dau).toBeGreaterThanOrEqual(0)
  const mo = sql.indexOf("$fn$", dau) + 4
  return sql.slice(mo, sql.indexOf("$fn$", mo))
}
/** Bỏ chú thích + gộp khoảng trắng — so cách chạy, không so lời giải thích. */
const chuan = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim()

describe("mig 256 — tệp migration", () => {
  it("VÌ SAO trích lời chủ nhà + ngày + số đo; luật migration (idempotent, NOTIFY, câu tóm tắt)", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 29/10/2026 (Báo cáo tổng hợp › Bán hàng): "sao nó cứ dĩnh lỗi này nhỉ')
    expect(MIG).toContain("JIT tắt 0,5–0,6 giây; JIT BẬT 3,4–4,1 giây")
    expect(MIG).toContain("CREATE OR REPLACE FUNCTION public.bao_cao_so_ban(p_tu date, p_den date)")
    expect(MIG).not.toMatch(/\bCREATE\s+FUNCTION\b/)
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
    // Thẻ dollar ASCII.
    for (const the of MIG.match(/\$[^$\s]*\$/g) ?? []) expect(the).toMatch(/^\$[a-z]*\$$/)
  })

  it("bao_cao_so_ban: STABLE SECURITY INVOKER + jit = off NGAY TRÊN HÀM; anon không gọi được", () => {
    expect(MIG).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET jit = off AS $fn$")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.bao_cao_so_ban(date, date) FROM PUBLIC, anon;")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.bao_cao_so_ban(date, date) TO authenticated;")
    expect(MIG).not.toMatch(/SECURITY DEFINER/)
  })

  it("thân = mig 228 BỎ dong_hd_goc + dong_don, user_org_id() tính một lần mỗi câu — không đổi phần nào app đọc", () => {
    const cu = chuan(thanSoBan(read("supabase/migrations/228_sua_loi_kho_bao_cao.sql")))
    const tu = cu.indexOf("'dong_hd_goc', COALESCE((")
    const den = cu.indexOf("'tra', COALESCE(")
    expect(tu).toBeGreaterThan(0)
    expect(den).toBeGreaterThan(tu)
    const mongDoi = (cu.slice(0, tu) + cu.slice(den)).replaceAll("public.user_org_id()", "(SELECT public.user_org_id())")
    const moi = chuan(thanSoBan(MIG))
    expect(moi).toBe(mongDoi)
    expect(moi).not.toMatch(/dong_don|dong_hd_goc|sales_order_lines/)
    for (const k of ["'hd'", "'dong_hd'", "'tra'", "'dong_tra'", "'gv'", "'gv_tra'"]) expect(moi).toContain(k)
  })

  it("app không còn đọc dong_don / dong_hd_goc ở đâu (bỏ khỏi hàm là an toàn)", () => {
    let thay = ""
    try {
      thay = execFileSync("grep", ["-rlE", "dong_don|dong_hd_goc", resolve(__dirname, "..", "src")], { encoding: "utf-8" })
    } catch {
      thay = "" // grep không thấy gì → mã 1
    }
    expect(thay).toBe("")
  })

  it("các hàm báo cáo nặng khác: ALTER FUNCTION … SET jit = off, hàm sổ chưa có thì bỏ qua (không vỡ tệp)", () => {
    for (const ham of [
      "public.bao_cao_cong_no(date, date)", "public.bao_cao_ton_kho(date, date)", "public.dashboard_summary(date)",
      "public.dashboard_top_customers(date, integer)", "public.dashboard_channel_revenue(date)", "public.finance_pnl(date, date)",
      "public.finance_cash_flow(date, date)", "public.finance_balance_sheet(date)",
    ]) expect(MIG).toContain(`'${ham}'`)
    expect(MIG).toContain("IF to_regprocedure(v) IS NULL THEN")
    expect(MIG).toContain("EXECUTE format('ALTER FUNCTION %s SET jit = off', to_regprocedure(v));")
  })

  it("khám sổ có dòng 95; schema gộp đã sinh lại; luật ghi ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 95, 'Mig 256 (Báo cáo đọc nhanh")
    expect(read("supabase/schema_full.sql")).toContain("BÁO CÁO ĐỌC NHANH — tắt JIT ngay trên các hàm báo cáo")
    const md = read("CLAUDE.md")
    expect(md).toContain("**Hàm báo cáo tắt JIT ngay trên hàm** (mig 256, chủ nhà 29/10/2026")
    expect(md).toContain("`rpc(…, { get: true })`")
  })
})

describe("hàm chỉ đọc gọi bằng GET (bộ hẹn giờ coi là câu đọc, không dặn 'có thể đã ghi')", () => {
  it("goiMotLuot: sb.rpc(hàm, tham số, { get: true })", async () => {
    const rpc = vi.fn(async () => ({ data: { hd: [] }, error: null }))
    await goiMotLuot({ rpc } as unknown as SupabaseClient, "bao_cao_so_ban", { p_tu: "2026-09-01", p_den: "2026-09-30" }, "đọc số bán")
    expect(rpc).toHaveBeenCalledWith("bao_cao_so_ban", { p_tu: "2026-09-01", p_den: "2026-09-30" }, { get: true })
  })

  it("finance_pnl / finance_balance_sheet / finance_cash_flow: { get: true }", async () => {
    const goi: unknown[][] = []
    const sb = {
      rpc: (...a: unknown[]) => {
        goi.push(a)
        return { maybeSingle: async () => ({ data: {}, error: null }) }
      },
    } as unknown as SupabaseClient
    await fetchPnl(sb, "org", { from: "2026-09-01", to: "2026-09-30" })
    await fetchBalanceSheet(sb, "org", "2026-09-30")
    await fetchCashFlow(sb, "org", { from: "2026-09-01", to: "2026-09-30" })
    expect(goi).toEqual([
      ["finance_pnl", { p_from: "2026-09-01", p_to: "2026-09-30" }, { get: true }],
      ["finance_balance_sheet", { p_as_of: "2026-09-30" }, { get: true }],
      ["finance_cash_flow", { p_from: "2026-09-01", p_to: "2026-09-30" }, { get: true }],
    ])
  })

  it("trang chủ (dashboard): ba hàm tổng hợp gọi bằng GET", () => {
    const s = read("src/app/(dashboard)/dashboard/page.tsx")
    expect(s).toContain('supabase.rpc("dashboard_summary", { p_period_start: periodStart }, { get: true }).maybeSingle()')
    expect(s).toContain('supabase.rpc("dashboard_top_customers", { p_period_start: periodStart, p_limit: 5 }, { get: true })')
    expect(s).toContain('supabase.rpc("dashboard_channel_revenue", { p_period_start: periodStart }, { get: true })')
    expect(s).not.toMatch(/rpc\("dashboard_(summary|top_customers|channel_revenue)", \{[^}]*\}\)/)
  })
})

/** fetch giả: mỗi lượt treo tới khi bị huỷ, hoặc trả lời khi gọi `traLoi()`. */
function fetchGia() {
  const luot: Array<{ input: RequestInfo | URL; init?: RequestInit; traLoi: (r?: Response) => void }> = []
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolveP, reject) => {
      const sig = init?.signal
      const huy = () => reject(sig?.reason instanceof Error ? sig.reason : new DOMException("Fetch is aborted", "AbortError"))
      if (sig?.aborted) return huy()
      sig?.addEventListener("abort", huy, { once: true })
      luot.push({ input, init, traLoi: (r) => resolveP(r ?? new Response('{"hd":[]}', { status: 200, headers: { "content-type": "application/json" } })) })
    })
  )
  return { fn, luot }
}
const xong = async <T,>(p: PromiseLike<T>) => Promise.resolve(p).then((v) => ({ ok: v }), (e) => ({ loi: e as Error }))

describe("hàm báo cáo một lượt (/rpc/bao_cao_*): chờ 45 giây, một lượt", () => {
  let f: ReturnType<typeof fetchGia>
  beforeEach(() => {
    vi.useFakeTimers()
    f = fetchGia()
    vi.stubGlobal("fetch", f.fn)
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {}, removeEventListener() {} })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const sb = () => new PostgrestClient("https://x/rest/v1", { fetch: fetchCoHetGio })
  const goiSoBan = () => sb().rpc("bao_cao_so_ban", { p_tu: "2026-09-01", p_den: "2026-09-30" }, { get: true })

  it("nhận ra câu báo cáo theo đường dẫn (chuỗi / URL / Request); hàm khác, bảng khác thì không", () => {
    expect(laBaoCaoMotLuot("https://x/rest/v1/rpc/bao_cao_so_ban?p_tu=2026-09-01")).toBe(true)
    expect(laBaoCaoMotLuot(new URL("https://x/rest/v1/rpc/bao_cao_cong_no"))).toBe(true)
    expect(laBaoCaoMotLuot(new Request("https://x/rest/v1/rpc/bao_cao_ton_kho"))).toBe(true)
    expect(laBaoCaoMotLuot("https://x/rest/v1/rpc/dashboard_summary")).toBe(false)
    expect(laBaoCaoMotLuot("https://x/rest/v1/bao_cao_so_ban")).toBe(false)
    expect(HET_GIO_BAO_CAO_MS).toBe(45_000)
  })

  it("thư viện thật gửi GET, tham số trên URL", async () => {
    const p = xong(goiSoBan())
    await vi.advanceTimersByTimeAsync(0)
    expect(f.fn).toHaveBeenCalledTimes(1)
    const { input, init } = f.luot[0]
    expect(init?.method).toBe("GET")
    expect(String(input)).toBe("https://x/rest/v1/rpc/bao_cao_so_ban?p_tu=2026-09-01&p_den=2026-09-30")
    f.luot[0].traLoi()
    expect(((await p) as { ok?: { data: unknown } }).ok?.data).toEqual({ hd: [] })
  })

  it("máy chủ trả lời ở giây 44: KHÔNG bị cắt ở giây 10, không gửi lượt hai — nhận đủ số", async () => {
    const p = xong(goiSoBan())
    await vi.advanceTimersByTimeAsync(HET_GIO_MS + 1)
    expect(f.fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(44_000 - HET_GIO_MS - 1)
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.luot[0].traLoi()
    const r = (await p) as { ok?: { data: unknown; error: unknown } }
    expect(r.ok?.error).toBeNull()
    expect(r.ok?.data).toEqual({ hd: [] })
  })

  it("quá 45 giây: lỗi hết giờ, MỘT lượt mạng, câu tiếng Việt — không dặn 'có thể đã ghi', không còn chữ AbortError", async () => {
    const p = xong(goiSoBan())
    await vi.advanceTimersByTimeAsync(HET_GIO_BAO_CAO_MS)
    await vi.advanceTimersByTimeAsync(60_000) // thư viện có tự thử thêm thì lộ ra ở đây
    const r = (await p) as { ok?: { error: { message: string } | null } }
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(r.ok?.error?.message).toBe(`AbortError: ${LOI_HET_GIO} sau 45 giây`)
    // Như goiMotLuot gói lỗi, rồi màn dịch qua errorMessage.
    const cau = errorMessage(new Error(`đọc số bán: ${r.ok?.error?.message}`))
    expect(cau).toBe(`Mạng chậm hoặc máy chủ đang bận: đọc số bán: ${LOI_HET_GIO} sau 45 giây. Kiểm tra mạng rồi thử lại.`)
    expect(cau).not.toContain(DAN_CAU_GHI)
    expect(cau).not.toContain("AbortError")
  })

  it("câu đọc thường vẫn 10 giây + thử lại một lần (không bị kéo dài theo)", async () => {
    const p = xong(sb().rpc("dashboard_summary", { p_period_start: "2026-10-01" }, { get: true }))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    expect(f.fn).toHaveBeenCalledTimes(2)
    f.luot[1].traLoi()
    expect(((await p) as { ok?: { error: unknown } }).ok?.error).toBeNull()
  })

  it("lỡ có nơi gửi POST tới hàm báo cáo: vẫn chờ 45 giây, là câu ghi thì không gửi lại", async () => {
    const p = xong(fetchCoHetGio("https://x/rest/v1/rpc/bao_cao_so_ban", { method: "POST", body: "{}" }))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS + 1)
    expect(f.fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HET_GIO_BAO_CAO_MS)
    const r = (await p) as { loi?: Error }
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(laHetGio(r.loi)).toBe(true)
    expect(r.loi?.message).toBe(`${LOI_HET_GIO} sau 45 giây — ${DAN_CAU_GHI}`)
  })
})

describe("câu lỗi trên màn báo cáo", () => {
  it("HetGioError ghi đúng số giây đã chờ", () => {
    expect(new HetGioError(1, false, HET_GIO_BAO_CAO_MS).message).toBe(`${LOI_HET_GIO} sau 45 giây`)
    expect(new HetGioError(2).message).toBe(`${LOI_HET_GIO} sau 10 giây (đã thử 2 lần)`)
  })

  it("cauHetGio bỏ 'AbortError:' cả khi nằm GIỮA câu (lỗi đã gói: 'đọc số bán: AbortError: …')", () => {
    const cu = `đọc số bán: AbortError: ${LOI_HET_GIO} sau 10 giây — ${DAN_CAU_GHI}`
    expect(cauHetGio(cu)).toBe(`Mạng chậm hoặc máy chủ đang bận: đọc số bán: ${LOI_HET_GIO} sau 10 giây — ${DAN_CAU_GHI}.`)
    expect(cauHetGio(`AbortError: ${LOI_HET_GIO} sau 10 giây`)).toBe(
      `Mạng chậm hoặc máy chủ đang bận: ${LOI_HET_GIO} sau 10 giây. Kiểm tra mạng rồi thử lại.`
    )
  })

  it("gộp '..' thành '.' (câu lỗi có dấu chấm + màn nối '. Màn này …'); không đụng '...' / '…'", () => {
    expect(gopDauCham("Đọc số bán hàng hỏng: … thử lại.. Màn này không hiện số 0 thay cho phần lỗi.")).toBe(
      "Đọc số bán hàng hỏng: … thử lại. Màn này không hiện số 0 thay cho phần lỗi."
    )
    expect(gopDauCham("hỏng.." )).toBe("hỏng.")
    expect(gopDauCham("chờ... rồi")).toBe("chờ... rồi")
    expect(gopDauCham("v1..v2")).toBe("v1..v2")
  })

  it("LoiDocSo hiện câu đã gộp dấu chấm", () => {
    const el = LoiDocSo({ text: "Đọc số bán hàng hỏng: x.. Màn này không hiện số 0 thay cho phần lỗi.", onThuLai: () => {} })
    const chu: string[] = []
    const duyet = (n: ReactNode) => {
      if (typeof n === "string") chu.push(n)
      else if (Array.isArray(n)) n.forEach(duyet)
      else if (isValidElement(n)) duyet((n as ReactElement<{ children?: ReactNode }>).props.children)
    }
    duyet(el)
    expect(chu).toContain("Đọc số bán hàng hỏng: x. Màn này không hiện số 0 thay cho phần lỗi.")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-256-bao-cao-doc-nhanh.sql")
describe.skipIf(!BO_THU)("mig 256 trên Postgres thử", () => {
  it("11/11 bước đạt (6 phần app đọc, đúng số, RLS NVBH, JIT tắt trên hàm, chạy hai lần không nhân đôi)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("11|11|0")
  })
})
