import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  viNormalize, viValueKey, viQueryWords, viSearchKey, viMatchKey, viMatchAllWords, boSo0Dau,
  taoMucTim, diemTim, BAC_TIM, locXepHang, timXepHang, khoangCachSua, soChuDuocSai,
} from "../src/lib/search"
import {
  tachTuTim, dieuKienTim, buildOrFilter, coTimKd, _quenDoTimKd, canTraTron, tachSoChu,
  BANG_TIM_KHONG_DAU, BANG_TIM_KD_TINH, KHONG_DONG_NAO, menhDeTimDanhSach,
} from "../src/lib/search/list-search"
import { khoaTim as khoaTimGia } from "../e2e/fake-supabase.mjs"

/**
 * TÌM KIẾM CHUNG — chủ nhà 27/09/2026: "tìm kiếm chính xác, linh hoạt hơn, tìm
 * kiếm được không dấu. Xem thuật toán tìm kiếm nào tối ưu nhất hiện nay thì sử
 * dụng."
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const MIG = read("supabase/migrations/205_tim_kiem_chung.sql")

/**
 * ⚠ CẶP MẪU DÙNG CHUNG BA BÊN: `viValueKey` (trình duyệt), `khoa_tim()` (mig 205,
 *   đã chạy đúng từng cặp trên Postgres 16 — xem dòng 44 của kham-so-that.sql),
 *   và `khoaTim` của máy chủ giả e2e. Sửa luật ở một bên là cặp nào đó lệch.
 */
export const CAP_KHOA: Array<[string, string]> = [
  ["DH-0123", "dh 0123 dh0123 dh123"],
  ["0912 345 678", "0912 345 678 0912345678 912345678"],
  ["0912.345.678", "0912 345 678 0912345678 912345678"],
  ["Sữa hộp", "sua hop suahop"],
  ["  Bánh ĐẬU  Xanh Hà Nội ", "banh dau xanh ha noi banhdauxanhhanoi"],
  ["Q.8", "q 8 q8"],
  ["SP001945", "sp001945 sp1945"],
  ["HD-260927-0001", "hd 260927 0001 hd2609270001 hd2609271"],
  ["Kẹo dẻo\tbắp\n400g", "keo deo bap 400g keodeobap400g"],
  ["Bánh Đậu", "banh dau banhdau"],
  ['O\'Neil "x" 50%_', "o neil x 50 oneilx50"],
  ["Tạp hoá Minh Châu", "tap hoa minh chau taphoaminhchau"],
  ["Cà phê sữa đá", "ca phe sua da caphesuada"],
  ["000", "000 0"],
  ["---", ""],
  ["", ""],
]

describe("viValueKey — khoá tìm của một giá trị (trùng khoa_tim của mig 205)", () => {
  it.each(CAP_KHOA)("%j → %j", (vao, mong) => {
    expect(viValueKey(vao)).toBe(mong)
  })
  it("máy chủ giả e2e dùng đúng luật ấy", () => {
    for (const [vao, mong] of CAP_KHOA) expect(khoaTimGia(vao), vao).toBe(mong)
  })
  it("null / undefined / số không làm vỡ", () => {
    expect(viValueKey(null)).toBe("")
    expect(viValueKey(undefined)).toBe("")
    expect(viValueKey(123)).toBe("123")
  })
  it("bỏ số 0 đầu mỗi dãy số, không đụng số 0 ở giữa", () => {
    expect(boSo0Dau("0123")).toBe("123")
    expect(boSo0Dau("sp0012")).toBe("sp12")
    expect(boSo0Dau("100")).toBe("100")
    expect(boSo0Dau("hd2609270001")).toBe("hd2609270001")
  })
  it("khoá nhiều trường bỏ trường rỗng", () => {
    expect(viSearchKey("DH-01", null, "", "Sữa")).toBe("dh 01 dh01 dh1 sua")
  })
})

describe("viQueryWords — từ gõ viết liền trong từ", () => {
  it("bỏ dấu, chữ thường, dấu câu trong một từ bị bỏ", () => {
    expect(viQueryWords("  HD-0123   Sữa  ")).toEqual(["hd0123", "sua"])
    expect(viQueryWords("0912.345.678")).toEqual(["0912345678"])
    expect(viQueryWords("Q.8")).toEqual(["q8"])
  })
  it("từ lặp lại và từ chỉ có dấu câu bị bỏ", () => {
    expect(viQueryWords("sua - sua")).toEqual(["sua"])
    expect(viQueryWords("   ")).toEqual([])
  })
})

describe("viMatchAllWords — mọi từ phải có mặt, thứ tự nào cũng được", () => {
  const SP = ["SP001945", "8934673123456", "Sữa hộp Vinamilk 180ml"]
  const KH = ["0912 345 678", "Tạp hoá Đông Hưng", "Nguyễn Văn Đức", "12 Hàng Kênh, Q.8"]
  const DON = ["DH-0123"]
  it("không dấu, đ → d", () => {
    expect(viMatchAllWords("sua", ...SP)).toBe(true)
    expect(viMatchAllWords("dong hung", ...KH)).toBe(true)
    expect(viMatchAllWords("duc", ...KH)).toBe(true)
  })
  it("đảo thứ tự từ: 'hop sua' ra 'Sữa hộp'", () => {
    expect(viMatchAllWords("hop sua", ...SP)).toBe(true)
    expect(viMatchAllWords("vinamilk sua 180", ...SP)).toBe(true)
  })
  it("từ nằm ở các trường khác nhau", () => {
    expect(viMatchAllWords("duc hang kenh", ...KH)).toBe(true)
  })
  it("thiếu một từ là không khớp", () => {
    expect(viMatchAllWords("sua coca", ...SP)).toBe(false)
  })
  it("mã có gạch / dấu cách / số 0 đầu: dh0123, dh-0123, DH 0123, dh123", () => {
    for (const q of ["dh0123", "dh-0123", "DH 0123", "dh123", "DH-123", "0123", "123"]) {
      expect(viMatchAllWords(q, ...DON), q).toBe(true)
    }
    expect(viMatchAllWords("dh124", ...DON)).toBe(false)
  })
  it("SĐT gõ liền, cách, chấm, bỏ số 0 đầu", () => {
    for (const q of ["0912345678", "0912 345 678", "0912.345.678", "912345678", "345678", "0912"]) {
      expect(viMatchAllWords(q, ...KH), q).toBe(true)
    }
  })
  it("địa chỉ viết tắt có dấu chấm: 'q8' ra 'Q.8'", () => {
    expect(viMatchAllWords("q8", ...KH)).toBe(true)
    expect(viMatchAllWords("hang kenh q.8", ...KH)).toBe(true)
  })
  it("gõ liền không dấu cách vẫn ra: 'suahop'", () => {
    expect(viMatchAllWords("suahop", ...SP)).toBe(true)
  })
  it("hoa thường, khoảng trắng thừa", () => {
    expect(viMatchAllWords("  SỮA    HỘP ", ...SP)).toBe(true)
  })
  it("chỉ mục dựng sẵn cho đúng kết quả như đường trực tiếp", () => {
    const k = viSearchKey(...KH)
    for (const q of ["duc hang kenh", "0912345678", "q8", "khong co", "hung dong"]) {
      expect(viMatchKey(k, viQueryWords(q)), q).toBe(viMatchAllWords(q, ...KH))
    }
  })
})

describe("diemTim / locXepHang — xếp hạng", () => {
  const HANG = [
    { id: "a", sku: "SP0100", name: "Bánh sữa dừa" },
    { id: "b", sku: "SP0010", name: "Sữa tươi Vinamilk" },
    { id: "c", sku: "SP0001", name: "Kẹo sữa" },
    { id: "d", sku: "SUA01", name: "Nước suối" },
    { id: "e", sku: "SP0002", name: "Bột ngọt, túi sữa hộp" },
  ]
  const tim = (q: string, opt = {}) => timXepHang(HANG, q, (p) => [p.sku, p.name], opt).ketQua.map((p) => p.id)

  it("mã trùng khớp đứng đầu (gõ liền, bỏ số 0 đầu cũng được)", () => {
    expect(tim("sp10")[0]).toBe("b")
    expect(tim("SP0010")[0]).toBe("b")
    expect(tim("sp0001")[0]).toBe("c")
  })
  it("đầu mã / đầu tên trước đầu từ, đầu từ trước chứa", () => {
    // "sua": SUA01 (đầu mã) → "Sữa tươi" (đầu tên) → "Bánh sữa", "Kẹo sữa", "túi sữa" (đầu từ).
    const r = tim("sua")
    expect(r[0]).toBe("d")
    expect(r[1]).toBe("b")
    expect(r.slice(2).sort()).toEqual(["a", "c", "e"])
  })
  it("mọi từ là đầu từ trong CÙNG một trường xếp trên rải rác", () => {
    const m1 = taoMucTim("SP1", "Sữa hộp")
    const m2 = taoMucTim("Hộp", "Sữa")
    const w = viQueryWords("sua hop")
    expect(diemTim(m1, w)).toBeGreaterThan(diemTim(m2, w))
  })
  it("chứa ở giữa từ thì điểm thấp nhất", () => {
    const m = taoMucTim("Vinamilk")
    expect(diemTim(m, viQueryWords("milk"))).toBe(BAC_TIM.CHUA)
    expect(diemTim(m, viQueryWords("vina"))).toBe(BAC_TIM.DAU_MA)
    expect(diemTim(m, viQueryWords("vinamilk"))).toBe(BAC_TIM.TRUNG_KHOP)
    expect(diemTim(m, viQueryWords("coca"))).toBe(0)
  })
  it("SĐT trùng khớp đứng đầu dù khách khác có SĐT chứa dãy ấy", () => {
    const KH = [
      { id: "x", phone: "0912345678999", name: "Anh X" },
      { id: "y", phone: "0912 345 678", name: "Chị Y" },
    ]
    expect(timXepHang(KH, "0912.345.678", (c) => [c.phone, c.name]).ketQua[0].id).toBe("y")
  })
  it("cùng điểm thì giữ thứ tự gốc, hoặc theo `soPhu`", () => {
    const ds = ["Kẹo A", "Kẹo B", "Kẹo C"]
    const muc = ds.map((t) => taoMucTim(t))
    expect(locXepHang(ds, muc, "keo").ketQua).toEqual(ds)
    expect(locXepHang(ds, muc, "keo", { soPhu: (a, b) => b - a }).ketQua).toEqual(["Kẹo C", "Kẹo B", "Kẹo A"])
  })
  it("đếm ĐỦ số khớp, chỉ cắt phần trả về", () => {
    const r = timXepHang(HANG, "sp", (p) => [p.sku, p.name], { gioiHan: 2 })
    expect(r.ketQua).toHaveLength(2)
    expect(r.soKhop).toBe(4)
  })
  it("chữ rỗng: nguyên danh sách, nguyên thứ tự", () => {
    expect(tim("  ")).toEqual(["a", "b", "c", "d", "e"])
  })
})

describe("gần đúng — gõ sai chữ (Damerau–Levenshtein, như Meilisearch)", () => {
  const HANG = ["Sữa Vinamilk", "Nước mắm Nam Ngư", "Kem đậu xanh", "Bánh quy Cosy", "DH-0124"]
  const tim = (q: string) => timXepHang(HANG, q, (t) => [t])

  it("khoảng cách sửa chữ: thêm, bớt, thay, đảo hai chữ liền", () => {
    expect(khoangCachSua("vinamilk", "vinamilk")).toBe(0)
    expect(khoangCachSua("vinamik", "vinamilk")).toBe(1)
    expect(khoangCachSua("vinamlik", "vinamilk")).toBe(1)
    expect(khoangCachSua("vinamilkk", "vinamilk")).toBe(1)
    expect(khoangCachSua("abc", "xyz")).toBe(3)
  })
  it("không có gì khớp thật thì gợi ý gần đúng", () => {
    const r = tim("vinamlik")
    expect(r.soKhop).toBe(0)
    expect(r.ganDung).toBe(1)
    expect(r.ketQua).toEqual(["Sữa Vinamilk"])
  })
  it("đang gõ dở một từ dài mà sai một chữ vẫn ra", () => {
    expect(tim("vinamu").ketQua).toEqual(["Sữa Vinamilk"])
  })
  it("từ ngắn (< 5 chữ) phải đúng — 'banh' không ra 'xanh'", () => {
    expect(soChuDuocSai("banh")).toBe(0)
    expect(tim("banj").ketQua).toEqual([])
  })
  it("chữ đầu phải đúng", () => {
    expect(tim("binamilk").ketQua).toEqual([])
  })
  it("từ có chữ số KHÔNG được sai — mã 0123 không ra đơn 0124", () => {
    expect(soChuDuocSai("dh0123")).toBe(0)
    expect(tim("dh0123").ketQua).toEqual([])
  })
  it("đã có kết quả khớp thật thì không chêm gợi ý", () => {
    const r = tim("cosy")
    expect(r.soKhop).toBe(1)
    expect(r.ganDung).toBe(0)
  })
  it("tắt được", () => {
    expect(timXepHang(HANG, "vinamlik", (t) => [t], { ganDung: false }).ketQua).toEqual([])
  })
})

describe("máy chủ — từng từ một, ghép VÀ", () => {
  it("tách từ: nguyên dạng cho cột thường, bỏ dấu viết liền cho tim_kd", () => {
    expect(tachTuTim(" DH-0123  Sữa ")).toEqual([
      { go: "DH-0123", kd: ["dh0123", "dh-0123"] },
      { go: "Sữa", kd: ["sua"] },
    ])
  })
  it("một từ: hình dạng cũ; nhiều từ: and(or(…),or(…))", () => {
    expect(dieuKienTim("sales_orders", ["order_code"], "0123")).toBe('order_code.ilike."%0123%"')
    expect(dieuKienTim("sales_orders", ["order_code"], "dh 0123", true)).toBe(
      'and(or(order_code.ilike."%dh%",tim_kd.ilike."%dh%"),or(order_code.ilike."%0123%",tim_kd.ilike."%0123%"))'
    )
  })
  it("không có cột nào để so thì không dòng nào khớp (không phải cả sổ)", () => {
    expect(dieuKienTim("sales_orders", [], "abc", false)).toBe(KHONG_DONG_NAO)
  })
  it("tra trộn 'minh 0123': từ số ở mã đơn VÀ từ chữ ở khách", () => {
    expect(tachSoChu("Minh 0123 hoa")).toEqual({ so: "0123", chu: "Minh hoa" })
    expect(canTraTron("minh 0123", true, 1)).toBe("minh")
    expect(canTraTron("minh hoa", true, 1)).toBeNull()
    expect(canTraTron("minh 0123", false, 1)).toBeNull()
    const r = buildOrFilter(
      "minh 0123",
      ["order_code"],
      [{ column: "customer_id", match: { ids: [], truncated: false } }],
      { tron: [{ ids: ["c1"], truncated: false }] }
    )
    expect(r.filter).toBe(
      'and(order_code.ilike."%minh%",order_code.ilike."%0123%"),' +
        'and(order_code.ilike."%0123%",customer_id.in.(c1))'
    )
  })
  it("ngân sách mã chung cho mọi danh sách in.(…) — vượt thì báo thiếu", () => {
    const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`)
    const r = buildOrFilter("x", ["code"], [
      { column: "a_id", match: { ids: ids(100, "a"), truncated: false } },
      { column: "b_id", match: { ids: ids(100, "b"), truncated: false } },
    ])
    expect((r.filter ?? "").split(",").length).toBe(1 + 150)
    expect(r.truncated).toBe(true)
  })
})

describe("coTimKd — dò cột tính tim_kd (mig 205) một lần, lùi về luật cũ nếu thiếu", () => {
  beforeEach(() => _quenDoTimKd())
  const sbGia = (tra: () => { error: { code?: string; message: string } | null } | Promise<never>) => {
    let goi = 0
    const q = {
      select: () => q,
      or: () => q,
      limit: () => {
        goi++
        return tra()
      },
    }
    return { sb: { from: () => q } as never, goi: () => goi }
  }
  it("bảng có cột thật: có, không hỏi", async () => {
    const g = sbGia(() => ({ error: null }))
    expect(await coTimKd(g.sb, "customers")).toBe(true)
    expect(g.goi()).toBe(0)
  })
  it("bảng chứng từ: hỏi một lần, nhớ kết quả", async () => {
    const g = sbGia(() => ({ error: null }))
    expect(await coTimKd(g.sb, "sales_orders")).toBe(true)
    expect(await coTimKd(g.sb, "sales_orders")).toBe(true)
    expect(g.goi()).toBe(1)
  })
  it("sổ chưa chạy mig 205 (42703): không có, và nhớ", async () => {
    const g = sbGia(() => ({ error: { code: "42703", message: "column sales_orders.tim_kd does not exist" } }))
    expect(await coTimKd(g.sb, "sales_orders")).toBe(false)
    expect(await coTimKd(g.sb, "sales_orders")).toBe(false)
    expect(g.goi()).toBe(1)
  })
  it("lỗi mạng: không có LẦN NÀY, không nhớ", async () => {
    const g = sbGia(() => ({ error: { message: "Failed to fetch" } }))
    expect(await coTimKd(g.sb, "returns")).toBe(false)
    await coTimKd(g.sb, "returns")
    expect(g.goi()).toBe(2)
  })
  it("bảng lạ: không có, không hỏi", async () => {
    const g = sbGia(() => ({ error: null }))
    expect(await coTimKd(g.sb, "notifications")).toBe(false)
    expect(g.goi()).toBe(0)
  })
  it("menhDeTimDanhSach: thiếu cột tính thì chỉ dùng cột cũ", async () => {
    const q: Record<string, unknown> = {}
    const chain = {
      select: () => chain, or: () => chain, order: () => chain, eq: () => chain,
      limit: () => Promise.resolve({ data: [], error: { code: "42703", message: "tim_kd" } }),
    }
    Object.assign(q, chain)
    const r = await menhDeTimDanhSach({ from: () => chain } as never, "sales_orders", "dh0123", null, ["order_code"], [])
    expect(r.timKd).toBe(false)
    expect(r.filter).toBe('order_code.ilike."%dh0123%"')
  })
})

describe("mig 205 khớp với phía trình duyệt", () => {
  it("luật khoá SQL có đủ các bước của viValueKey", () => {
    expect(MIG).toContain("regexp_split_to_array(public.khong_dau(p), '[^a-z0-9]+')")
    expect(MIG).toContain("regexp_replace(x, '(^|[a-z])0+(?=[0-9])', '\\1', 'g')")
    expect(MIG).toContain("CASE WHEN cardinality(tu) > 1 THEN ' ' || lien ELSE '' END")
    expect(MIG).toContain("CASE WHEN lien0 <> lien THEN ' ' || lien0 ELSE '' END")
    // Trình duyệt: cùng ký tự ngắt từ, cùng phép bỏ số 0.
    expect(read("src/lib/search.ts")).toContain("const NGAT_TU = /[^a-z0-9]+/")
    expect(read("src/lib/search.ts")).toContain('tu.replace(/(^|[a-z])0+(?=[0-9])/g, "$1")')
  })
  it("bảng có cột tính trong mig trùng BANG_TIM_KD_TINH và máy chủ giả", () => {
    const khoi = MIG.slice(MIG.indexOf("FOR r IN SELECT * FROM (VALUES\n    ('sales_orders'"))
    const bang = Array.from(khoi.slice(0, khoi.indexOf(") x(bang, cot)")).matchAll(/\('(\w+)',\s+ARRAY/g)).map((m) => m[1])
    expect(bang.sort()).toEqual(Array.from(BANG_TIM_KD_TINH).sort())
    const gia = read("e2e/fake-supabase.mjs")
    for (const b of [...Array.from(BANG_TIM_KD_TINH), ...Array.from(BANG_TIM_KHONG_DAU)]) expect(gia, b).toMatch(new RegExp(`\\n  ${b}: \\[`))
  })
  it("chỉ mục trigram GIN cho cả cột thật lẫn cột tính", () => {
    expect(MIG).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions")
    expect(MIG).toMatch(/USING gin \(tim_kd %I\.gin_trgm_ops\)/)
    expect(MIG).toMatch(/USING gin \(\(%s\) %I\.gin_trgm_ops\)/)
  })
  it("trigger tim_kd ghi khoá mới; điền lại chỉ dòng lệch", () => {
    expect(MIG).toContain("NEW.tim_kd := public.khoa_tim_ds(VARIADIC v_gt)")
    for (const b of Array.from(BANG_TIM_KHONG_DAU)) expect(MIG).toMatch(new RegExp(`UPDATE public\\.${b} SET tim_kd = NULL\\s+WHERE tim_kd IS DISTINCT FROM`))
  })
  it("đủ luật §3: VÌ SAO, NOTIFY, SELECT tóm tắt, REVOKE hàm trigger", () => {
    expect(MIG).toMatch(/VÌ SAO — chủ nhà 27\/09\/2026/)
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._trg_tim_kd() FROM PUBLIC, anon, authenticated")
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
  })
  it("kham-so-that có dòng 44", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 44, 'Mig 205")
  })
})

/* ------------------------------------------------------------------ */
/*  CHỐT: MỌI Ô TÌM ĐI QUA BỘ TÌM CHUNG                                 */
/* ------------------------------------------------------------------ */

/** Bỏ chú thích từng dòng (xem SKILL §"Testing UI by reading source"). */
function code(src: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const dong of src.split("\n")) {
    const t = dong.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(dong)
  }
  return out.join("\n")
}

const TEP: string[] = []
const di = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) di(p)
    else if (/\.tsx?$/.test(f)) TEP.push(p.slice(ROOT.length + 1))
  }
}
di(resolve(ROOT, "src"))

/**
 * Ô không đi qua bộ tìm chung — CÓ LÝ DO. Thêm vào đây là phải nói vì sao.
 */
const MIEN: Record<string, string> = {
  "src/app/(dashboard)/deliveries/page.tsx": "Luồng chuyến giao đã bỏ (chủ nhà 24/09/2026) — không làm thêm.",
  "src/components/bao-cao/thanh-loc.tsx": "Báo cáo tổng hợp đang có thay đổi khác sửa song song.",
  "src/components/customers/customer-form.tsx": "Ô phường là <datalist> của trình duyệt, không phải ô tìm.",
  "src/components/layout/header.tsx": "Chỉ chuyển sang /orders?q=… — tìm ở danh sách đơn.",
  "src/components/layout/mobile-search-overlay.tsx": "Chỉ chuyển sang /orders?q=… — tìm ở danh sách đơn.",
}

/** Dấu hiệu một tệp dùng bộ tìm chung (trình duyệt hoặc máy chủ). */
const DUNG_CHUNG = /viMatchAllWords\(|timXepHang\(|locXepHang\(|useListSearch\(|useFieldSearch\(|dieuKienTim\(|menhDeTimDanhSach\(|filterProducts\(|filterCustomers\(|<SearchDropdown|<SearchSelect|<ProductPicker|search[A-Z]\w*\(|onSearch|useAdvancedFilter/

describe("mọi ô tìm đi qua bộ tìm chung", () => {
  const coOTim = TEP.filter((f) => /placeholder=\{?"[^"]*\b(Tìm|tìm)\b/.test(code(read(f))))
  it("phép quét còn thấy ô tìm", () => {
    expect(coOTim.length).toBeGreaterThan(25)
  })
  it.each(coOTim.filter((f) => !MIEN[f]))("%s", (f) => {
    expect(code(read(f))).toMatch(DUNG_CHUNG)
  })
  it("miễn trừ nào cũng còn thật (không để lý do chết)", () => {
    for (const f of Object.keys(MIEN)) expect(TEP, f).toContain(f)
  })

  it("không còn lọc bằng viIncludes / viMatch (nguyên cụm) ngoài lib/search", () => {
    const hit = TEP.filter((f) => !f.startsWith("src/lib/search"))
      .filter((f) => /\bviIncludes\(|\bviMatch\(/.test(code(read(f))))
    expect(hit).toEqual([])
  })
  it("không còn so `toLowerCase().includes` trong ô tìm", () => {
    const hit = TEP.filter((f) => !MIEN[f])
      .filter((f) => /toLowerCase\(\)\s*\.includes\(|\.includes\([^)]*toLowerCase\(\)\)/.test(code(read(f))))
    expect(hit).toEqual([])
  })
  it("không còn tự dựng ilike ngoài lib/search (trừ tra ghi chú theo mã ở chuyến giao cũ)", () => {
    const hit = TEP.filter((f) => !f.startsWith("src/lib/search") && !f.includes("/deliveries/"))
      .filter((f) => /\.ilike\(|\.ilike\.\$\{|ilikeDk\(/.test(code(read(f))))
    expect(hit).toEqual([])
  })
  it("mọi danh sách dùng useListSearch đều truyền tên bảng (để tìm cả tim_kd)", () => {
    const man = TEP.filter((f) => code(read(f)).includes("useListSearch("))
      .filter((f) => !f.startsWith("src/hooks/"))
    expect(man.length).toBeGreaterThanOrEqual(6)
    for (const f of man) {
      const s = code(read(f))
      const i = s.indexOf("useListSearch(")
      const khoi = s.slice(i, s.indexOf("\n  )", i))
      // Không có cột riêng để tìm (`ownColumns = []`, vd công nợ chỉ tra khách / mã HĐ) thì không cần bảng.
      if (/useListSearch\(\s*\w+,\s*[\w.?]+,\s*[\w.?]+,\s*\[\],/.test(khoi)) continue
      expect(khoi, f).toMatch(/\],\s*"(\w+)"\s*$/)
      const bang = khoi.match(/"(\w+)"\s*$/)![1]
      expect(BANG_TIM_KD_TINH.has(bang), `${f}: ${bang}`).toBe(true)
    }
  })
})

describe("chuẩn hoá — mẫu phá được (mutation)", () => {
  it("đ/Đ phải thành d (NFD không tách được)", () => {
    expect(viNormalize("Đường")).toBe("duong")
  })
})
