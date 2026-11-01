/**
 * TỔNG CỦA DANH SÁCH CỘNG TRÊN MÁY CHỦ + POS MỞ NHANH — chủ nhà 01/11/2026: "em rà soát xem thêm 1 số thao tác như tìm
 * kiếm trong danh sách (đơn hàng, hóa đơn...) nhiều khi còn chậm hoặc mở đơn hàng, sửa đơn hàng, hóa đơn... ở pos còn chậm".
 *
 * Đo bằng app build production + PostgREST thật trên sổ thử 40.000 HĐ: dải "Tổng tiền" / đếm theo tuyến tải MỌI dòng khớp
 * bộ lọc rồi cộng ở máy (kỳ "Tất cả": 20 câu rồi chạm trần), hoá đơn còn tra hàng trả nối đuôi 200 HĐ một câu (NVBH: 86–100
 * câu / 66–68 đợt, điện thoại ~10 giây); POS tải từng lô để cộng tồn và dựng khoá tìm 2–3 lần cho cùng danh mục.
 * SQL thật: scripts/sql/thu-257-tong-danh-sach.sql · bấm thật: e2e/tong-danh-sach-may-chu.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { docDemTheoTuyen, docTongGop, gopMayChu, NHOM_TUYEN } from "@/lib/list/tong-may-chu"
import { traTheoHoaDon } from "@/lib/analytics/net-revenue"
import { creditOnInvoice } from "@/lib/orders/invoice-credit"
import { loadSellStock } from "@/lib/sell/ref-data"
import { boSo0Dau, taoMucTim, viNormalize, viSearchKey } from "@/lib/search"
import type { SupabaseClient } from "@supabase/supabase-js"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/257_tong_danh_sach_may_chu.sql")

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("đọc kết quả gộp của PostgREST", () => {
  it("docTongGop: cộng mọi nhóm; sum null (không dòng nào khớp) / mảng rỗng (nhóm theo tuyến) = 0", () => {
    expect(docTongGop([{ sum: 1_200_000 }])).toBe(1_200_000)
    expect(docTongGop([{ sum: null }])).toBe(0)
    expect(docTongGop([])).toBe(0)
    expect(docTongGop([{ sum: "12.5", customer: { channel: "T1" } }, { sum: 7, customer: { channel: "T1" } }])).toBe(19.5)
  })
  it("docTongGop: hình dạng lạ → null (nơi gọi lùi về cách cũ, không hiện số 0)", () => {
    for (const x of [null, undefined, {}, "1", [{ count: 3 }], [null], [{ sum: "abc" }], [{ sum: Infinity }]]) expect(docTongGop(x)).toBeNull()
  })
  it("docDemTheoTuyen: cộng theo tuyến của điểm bán, bỏ nhóm không tuyến; hình dạng lạ → null", () => {
    expect(docDemTheoTuyen([
      { count: 3, customer: { channel: "T1" } }, { count: 2, customer: { channel: "T1" } },
      { count: 4, customer: { channel: "T2" } }, { count: 9, customer: null }, { count: 1, customer: { channel: "" } },
    ])).toEqual({ T1: 5, T2: 4 })
    expect(docDemTheoTuyen([])).toEqual({})
    for (const x of [null, {}, [{ sum: 1 }], [{ count: "x", customer: { channel: "T1" } }]]) expect(docDemTheoTuyen(x)).toBeNull()
  })
  it("gopMayChu: lỗi / câu ném / hình dạng lạ → null kèm ghi log; được thì trả số", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await gopMayChu(Promise.resolve({ data: [{ sum: 5 }], error: null }), docTongGop, "x")).toBe(5)
    expect(await gopMayChu(Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }), docTongGop, "x")).toBeNull()
    expect(await gopMayChu(Promise.reject(new Error("mạng")), docTongGop, "x")).toBeNull()
    expect(await gopMayChu(Promise.resolve({ data: [{ nope: 1 }], error: null }), docTongGop, "x")).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(NHOM_TUYEN).toBe("customer:customers!inner(channel)")
  })
})

describe("hai màn danh sách: cộng / đếm trên máy chủ TRƯỚC, hỏng mới lùi về cách cũ", () => {
  const don = read("src/app/(dashboard)/orders/page.tsx")
  const hd = read("src/app/(dashboard)/sales-invoices/page.tsx")
  it("Đơn hàng: tổng tiền = total.sum() với ĐÚNG bộ lọc + trạng thái (tab Tất cả bỏ đơn huỷ); lỗi → fetchAllForAggregate", () => {
    const i = don.indexOf('(routeFilter !== "all" ? `total.sum(), ${NHOM_TUYEN}` : "total.sum()") as string')
    expect(i).toBeGreaterThan(0)
    const doan = don.slice(i - 400, i + 1500)
    expect(doan).toContain("applyStatusFilter(")
    expect(doan).toContain("applyCommonFilters(")
    expect(doan).toMatch(/if \(effectiveStatus === "all"\) qGop = qGop\.neq\("status", "cancelled"\)\s*const gop = await gopMayChu\(qGop, docTongGop, "orders"\)/)
    expect(doan).toMatch(/if \(gop !== null\) \{\s*setFilteredTotal\(gop\)\s*return\s*\}\s*const res = await fetchAllForAggregate/)
  })
  it("Đơn hàng: số đơn đã duyệt theo tuyến = count() nhóm theo tuyến; lỗi → đếm theo cách cũ", () => {
    expect(don).toMatch(/select\(`count\(\), \$\{NHOM_TUYEN\}` as string\)\.eq\("status", "submitted"\),\s*docDemTheoTuyen/)
    expect(don).toMatch(/if \(gop !== null\) \{\s*setRouteCounts\(gop\)\s*return\s*\}\s*const res = await fetchAllForAggregate/)
  })
  it("Hoá đơn: tổng CÒN LẠI = con_lai.sum() trên view v_hoa_don_con_lai, cùng applyFilters + trạng thái; lỗi → cách cũ", () => {
    const i = hd.indexOf('supabase.from("v_hoa_don_con_lai")')
    expect(i).toBeGreaterThan(0)
    const doan = hd.slice(i, i + 1200)
    expect(doan).toContain('`con_lai.sum(), ${NHOM_TUYEN}` : "con_lai.sum()"')
    expect(doan).toContain('status !== "all" ? locTrangThai(qGop, status) : qGop.neq("status", "cancelled")')
    expect(doan).toContain("applyFilters(qGop as never)")
    expect(doan).toMatch(/if \(gop !== null\) \{\s*setFilteredTotal\(gop\)\s*return\s*\}/)
    expect(hd.slice(i)).toContain("traTheoHoaDon(supabase, res.rows.map((r) => r.id))")
  })
  it("Hoá đơn: số tờ theo tuyến = count() nhóm theo tuyến, BỎ bộ lọc tuyến (applyFilters(q, true)); lỗi → cách cũ", () => {
    expect(hd).toMatch(/select\(`count\(\), \$\{NHOM_TUYEN\}` as string\)\s*qGop = locTrangThai\(qGop, status\)\s*const gop = await gopMayChu\(applyFilters\(qGop as never, true\)/)
    expect(hd).toMatch(/if \(gop !== null\) \{\s*setRouteCounts\(gop\)\s*return\s*\}/)
  })
})

/** Supabase giả cho `traTheoHoaDon`: ghi số câu đang chạy cùng lúc. */
function sbTra(rows: Array<{ invoice_id: string; status: string; credit_with_invoice: boolean; credit_note_amount: number }>, loiCau = -1) {
  const tk = { soCau: 0, dangChay: 0, songSongMax: 0, lo: [] as number[] }
  const sb = {
    from: (bang: string) => ({
      select: (cot: string) => ({
        in: async (c: string, ids: string[]) => {
          expect([bang, cot, c]).toEqual(["returns", "invoice_id, status, credit_with_invoice, credit_note_amount", "invoice_id"])
          const so = ++tk.soCau
          tk.lo.push(ids.length)
          tk.dangChay++
          tk.songSongMax = Math.max(tk.songSongMax, tk.dangChay)
          await new Promise((r) => setTimeout(r, 5))
          tk.dangChay--
          if (so === loiCau) return { data: null, error: { message: "mất mạng" } }
          return { data: rows.filter((r) => ids.includes(r.invoice_id)), error: null }
        },
      }),
    }),
  } as unknown as SupabaseClient
  return { sb, tk }
}

describe("traTheoHoaDon (đường lùi khi sổ chưa có view): song song từng nhóm 6 lô, vẫn 200 id một lô", () => {
  const ids = Array.from({ length: 2_350 }, (_, i) => `hd-${i}`)
  const tra = ids.flatMap((id, i) => (i % 7 === 0 ? [
    { invoice_id: id, status: "submitted", credit_with_invoice: true, credit_note_amount: 1000 },
    { invoice_id: id, status: "submitted", credit_with_invoice: false, credit_note_amount: 500 },
  ] : []))
  it("12 lô → 2 đợt (6 + 6), không câu nào quá 200 id, kết quả đúng luật creditOnInvoice", async () => {
    const { sb, tk } = sbTra(tra)
    const kq = await traTheoHoaDon(sb, [...ids, ...ids.slice(0, 50)]) // id lặp chỉ hỏi một lần
    expect(tk.soCau).toBe(12)
    expect(tk.songSongMax).toBe(6)
    expect(Math.max(...tk.lo)).toBe(200)
    expect(kq.size).toBe(Math.ceil(ids.length / 7))
    for (const [id, tien] of Array.from(kq)) expect(tien).toBe(creditOnInvoice(tra.filter((r) => r.invoice_id === id)))
    expect(kq.get("hd-0")).toBe(1000) // phiếu độc lập mới "submitted" không trừ
  })
  it("một lô hỏng → NÉM (dải tổng hiện '—'), không trả tổng thiếu", async () => {
    const { sb } = sbTra(tra, 9)
    await expect(traTheoHoaDon(sb, ids)).rejects.toThrow("Không đọc được phiếu trả của hóa đơn: mất mạng")
  })
})

/** Supabase giả cho tồn kho bán: hàm `ton_ban_theo_hang` + bảng lô (đường cũ). */
function sbTon(rpcKq: { data: unknown; error: unknown } | "khong-co-rpc", lo: Array<{ product_id: string; qty_on_hand: number }>) {
  const goi = { rpc: 0, lo: 0 }
  const sb: Record<string, unknown> = {
    from: (bang: string) => {
      expect(bang).toBe("batches")
      return {
        select: () => ({
          gt: () => ({ eq: () => ({ order: () => ({ range: async () => { goi.lo++; return { data: lo, error: null, count: lo.length } } }) }) }),
        }),
      }
    },
  }
  if (rpcKq !== "khong-co-rpc") {
    sb.rpc = async (fn: string, args: unknown, opts: unknown) => {
      goi.rpc++
      expect([fn, args, opts]).toEqual(["ton_ban_theo_hang", {}, { get: true }])
      return rpcKq
    }
  }
  return { sb, goi }
}

describe("tồn kho bán ở POS / bán hàng: MỘT câu qua ton_ban_theo_hang (mig 257)", () => {
  const lo = [{ product_id: "sua", qty_on_hand: 10 }, { product_id: "sua", qty_on_hand: 5 }, { product_id: "mi", qty_on_hand: 3 }]
  const online = () => vi.stubGlobal("navigator", { onLine: true })
  it("có hàm: dùng ngay kết quả (số hoá từ chuỗi), KHÔNG đọc bảng lô", async () => {
    online()
    const { sb, goi } = sbTon({ data: { sua: "15.000000", mi: 3 }, error: null }, lo)
    expect(await loadSellStock(sb)).toEqual({ sua: 15, mi: 3 })
    expect(goi).toEqual({ rpc: 1, lo: 0 })
  })
  it("sổ chưa có hàm (PGRST202) → đọc từng lô như cũ, cùng con số", async () => {
    online()
    const { sb, goi } = sbTon({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ton_ban_theo_hang" } }, lo)
    expect(await loadSellStock(sb)).toEqual({ sua: 15, mi: 3 })
    expect(goi).toEqual({ rpc: 1, lo: 1 })
  })
  it("lỗi khác (mạng, quyền) → null (giữ số đang hiện), KHÔNG gửi thêm câu đọc lô", async () => {
    online()
    const { sb, goi } = sbTon({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }, lo)
    expect(await loadSellStock(sb)).toBeNull()
    expect(goi).toEqual({ rpc: 1, lo: 0 })
  })
  it("client không có rpc (bản giả cũ) → đọc từng lô", async () => {
    online()
    const { sb, goi } = sbTon("khong-co-rpc", lo)
    expect(await loadSellStock(sb)).toEqual({ sua: 15, mi: 3 })
    expect(goi).toEqual({ rpc: 0, lo: 1 })
  })
  it("ref-data: loadSellRefData đọc tồn qua docTonBan, stockByProduct lấy thẳng kết quả", () => {
    const s = read("src/lib/sell/ref-data.ts")
    expect(s).toContain("    docTonBan(sb),")
    expect(s).toContain("const stockByProduct = batchRes.stock")
    expect(s).toContain('sb.rpc("ton_ban_theo_hang", {}, { get: true })')
  })
})

/** Bản `taoMucTim` CŨ (chuẩn hoá hai lần) — làm thước so. */
function mucTimCu(...values: unknown[]) {
  const truong = values.map((v) => {
    const tu = viNormalize(v).split(/[^a-z0-9]+/).filter(Boolean)
    const tu0 = tu.map(boSo0Dau)
    return { tu, tu0, lien: tu.join(""), lien0: tu0.join("") }
  })
  return { khoa: viSearchKey(...values), truong }
}

describe("taoMucTim: chuẩn hoá mỗi trường MỘT lần, nhớ theo nội dung", () => {
  const mau: unknown[][] = [
    ["SP001945", "8934563138165", "Sữa tươi Vinamilk 180ml"],
    ["SP-00012", "", "Mì Hảo Hảo tôm chua cay  (thùng 30 gói)"],
    ["0912 345 678", "Tạp hoá Cô Ba", "Nguyễn Thị Ba", "12 Đường số 5, P. Tân Phú"],
    ["", null, undefined],
    ["Đ đ ĐĐ", "A0B00C 007", "x"],
    [12, 0, "HD-000123"],
  ]
  it("khoá + từng trường y hệt bản cũ (chốt cùng luật với public.khoa_tim — mig 205)", () => {
    for (const v of mau) expect(taoMucTim(...v)).toEqual(mucTimCu(...v))
  })
  it("chuẩn hoá đúng số trường (bản cũ gấp đôi); lần sau cùng chữ không chuẩn hoá lại, trả CÙNG đối tượng", () => {
    const spy = vi.spyOn(String.prototype, "normalize")
    const v = ["SPX-9001", "8930000009001", `Hàng thử nhớ ${Date.now()}`]
    const a = taoMucTim(...v)
    expect(spy).toHaveBeenCalledTimes(3)
    const b = taoMucTim(...v)
    expect(spy).toHaveBeenCalledTimes(3)
    expect(b).toBe(a)
    expect(taoMucTim(...v.slice(0, 2), v[2] + "!")).not.toBe(a)
  })
  it("ranh giới trường không lẫn: hai bộ chữ khác nhau (ghép lại trùng nhau) không dùng chung chỉ mục", () => {
    const a = taoMucTim("Nhớ\u0001ranh", "giới")
    const b = taoMucTim("Nhớ", "ranh\u0001giới")
    expect(b).not.toBe(a)
    expect(a).toEqual(mucTimCu("Nhớ\u0001ranh", "giới"))
    expect(b).toEqual(mucTimCu("Nhớ", "ranh\u0001giới"))
  })
})

describe("mig 257 — tệp migration", () => {
  it("VÌ SAO trích lời chủ nhà + ngày + số đo; luật migration (NOTIFY, câu tóm tắt, thẻ dollar ASCII)", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 01/11/2026: "em rà soát xem thêm 1 số thao tác như tìm kiếm trong danh sách (đơn hàng, hóa đơn...)')
    expect(MIG).toContain("86–100 câu / 66–68 đợt")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
    for (const the of MIG.match(/\$[^$\s]*\$/g) ?? []) expect(the).toMatch(/^\$[a-z]*\$$/)
  })
  it("view: security_invoker (RLS người gọi — luật mig 092), dựng lại được, anon không đọc", () => {
    expect(MIG).toContain("DROP VIEW IF EXISTS public.v_hoa_don_con_lai;\nCREATE VIEW public.v_hoa_don_con_lai WITH (security_invoker = true) AS")
    expect(MIG).toContain("REVOKE ALL ON public.v_hoa_don_con_lai FROM PUBLIC, anon;")
    expect(MIG).toContain("GRANT SELECT ON public.v_hoa_don_con_lai TO authenticated;")
    expect(MIG).not.toMatch(/SECURITY DEFINER/)
  })
  it("luật trừ = creditCounted (đi cùng HĐ: submitted/completed; độc lập: completed), max(0, tiền); truy vấn con THEO TỜ", () => {
    expect(MIG).toContain("SELECT sum(GREATEST(0, COALESCE(r.credit_note_amount, 0)))")
    expect(MIG).toContain("((r.credit_with_invoice IS TRUE AND r.status IN ('submitted', 'completed'))")
    expect(MIG).toContain("OR (r.credit_with_invoice IS NOT TRUE AND r.status = 'completed'))")
    /* Đi chỉ mục idx_returns_invoice theo từng tờ — bản LEFT JOIN nhóm sẵn để Postgres đoán sai, 2–3,3 giây khi ô tìm rộng. */
    expect(MIG).toContain("WHERE r.invoice_id = i.id")
    expect(MIG).toMatch(/\), 0\) AS con_lai\n  FROM public\.sales_invoices i;/)
    const than = MIG.slice(MIG.indexOf("CREATE VIEW public.v_hoa_don_con_lai"), MIG.indexOf("COMMENT ON VIEW public.v_hoa_don_con_lai"))
    expect(than).toContain("FROM public.returns r")
    expect(than).not.toMatch(/JOIN|GROUP BY/)
  })
  it("ton_ban_theo_hang: STABLE SECURITY INVOKER + jit=off, chỉ lô kho bán còn hàng, đúng đơn vị", () => {
    expect(MIG).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET jit = off AS $fn$")
    expect(MIG).toContain("WHERE b.org_id = (SELECT public.user_org_id())\n         AND b.qty_on_hand > 0\n         AND b.warehouse_zone = 'sale'")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.ton_ban_theo_hang() FROM PUBLIC, anon;")
  })
  it("khám sổ có dòng 96 (thiếu security_invoker là LỆCH); schema gộp sinh lại; luật ghi ở CLAUDE.md", () => {
    const kham = read("scripts/sql/kham-so-that.sql")
    expect(kham).toContain("SELECT 96, 'Mig 257 (Tổng danh sách trên máy chủ")
    expect(kham).toContain("THIẾU security_invoker")
    /* View chốt cột lúc tạo (`i.*`) — migration sau thêm cột cho sales_invoices mà quên dựng lại view thì khám sổ phải kêu. */
    expect(kham).toContain("thiếu cột mới của sales_invoices")
    expect(read("supabase/schema_full.sql")).toContain("CREATE VIEW public.v_hoa_don_con_lai WITH (security_invoker = true) AS")
    const md = read("CLAUDE.md")
    expect(md).toContain("**Đợt 5** (chủ nhà 01/11/2026")
    expect(md).toContain("`v_hoa_don_con_lai`")
    expect(md).toContain("`ton_ban_theo_hang`")
    expect(md).toContain("thêm cột cho `sales_invoices` thì dựng lại `v_hoa_don_con_lai`")
    expect(md).toContain("khoản trừ là truy vấn con THEO TỪNG TỜ — đừng đổi về LEFT JOIN nhóm sẵn")
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
const BO_THU = chayBoThu("scripts/sql/thu-257-tong-danh-sach.sql")
describe.skipIf(!BO_THU)("mig 257 trên Postgres thử", () => {
  it("12/12 bước đạt (luật trừ từng trạng thái, RLS NVBH / NPP khác, security_invoker, đủ cột, tồn kho bán)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("12|12|0")
  })
})
