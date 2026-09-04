import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  baseTaxCode,
  buildIndex,
  decideStatus,
  matchDate,
  matchOne,
  type BookRow,
  type SnapshotRow,
} from "@/lib/misa/reconcile"

/**
 * Bảng snapshot + khớp bốn tầng.
 *
 * Toàn bộ phần khớp là hàm THUẦN nên test gọi thẳng, không mock gì.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/**
 * Bỏ chú thích trước khi soi mã — chú thích nhắc tên một lớp CSS làm test
 * xanh oan (đã dính bốn lần).
 *
 * QUÉT THEO DÒNG, KHÔNG DÙNG REGEX. Hai lần đo cho thấy vì sao:
 *
 *  1. Luật cho chú thích JSX phải khớp tới `*\/}`. `interface X {` mở
 *     ngoặc rồi tới một khối tài liệu sẽ khiến nó chạy tiếp xuống tận
 *     `*\/}` xa phía dưới — nuốt 19.294 ký tự (39%) của handover/page.tsx.
 *  2. Ngay cả luật `/*` … `*\/` trần cũng sai: `accept="image/*"` có
 *     `/*` bên trong một chuỗi, và nó nuốt 815 ký tự của
 *     pod-capture-sheet.tsx — mất luôn `capture="environment"` mà test
 *     đang đòi.
 *
 * Cả hai lần, vùng bị nuốt đều làm test XANH vì không còn gì để sai.
 *
 * Giới hạn đã biết: chỉ bỏ chú thích CHIẾM TRỌN DÒNG. Repo này viết chú
 * thích như vậy; `code() /* ghi chú *\/` giữa dòng sẽ không bị bỏ.
 */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes("*/")) inBlock = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}

function migration(namePart: string): string {
  const dir = resolve(ROOT, "supabase/migrations")
  const hit = readdirSync(dir).filter((f) => f.includes(namePart)).sort().pop()
  if (!hit) throw new Error(`không tìm thấy migration chứa "${namePart}"`)
  return readFileSync(resolve(dir, hit), "utf-8")
}

const MIG = migration("misa_invoice_snapshots")
const PULL = read("src/app/api/einvoice/pull-snapshots/route.ts")
const CLIENT = read("src/lib/misa/client.ts")

function bk(over: Partial<BookRow> = {}): BookRow {
  return {
    id: "inv-1",
    misa_ref_id: null,
    misa_lookup_code: null,
    misa_inv_series: null,
    misa_inv_no: null,
    customer_tax_code: null,
    match_date: null,
    total: null,
    ...over,
  }
}

function sn(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    ref_id: null,
    transaction_id: null,
    inv_series: null,
    inv_no: null,
    inv_date: null,
    buyer_tax_code: null,
    total_amount: null,
    ...over,
  }
}

// =====================================================================
describe("khớp bốn tầng — thứ tự và độ tin cậy", () => {
  it("tầng 1 RefID thắng mọi tầng khác", () => {
    const idx = buildIndex([
      bk({ id: "A", misa_ref_id: "G1" }),
      bk({ id: "B", misa_lookup_code: "T1", misa_inv_series: "1C25MHG", misa_inv_no: "123" }),
    ])
    const r = matchOne(sn({ ref_id: "G1", transaction_id: "T1", inv_series: "1C25MHG", inv_no: "123" }), idx)
    expect(r?.invoiceId).toBe("A")
    expect(r?.method).toBe("ref_id")
    expect(r?.confidence).toBe("certain")
  })

  it("tầng 2 TransactionID khi không có RefID", () => {
    const idx = buildIndex([bk({ id: "B", misa_lookup_code: "GJF2I1_8DELM" })])
    const r = matchOne(sn({ transaction_id: "GJF2I1_8DELM" }), idx)
    expect(r).toMatchObject({ invoiceId: "B", method: "transaction_id", confidence: "certain" })
  })

  /**
   * Tầng 3 là đường sống của dữ liệu CŨ: hoá đơn đã có sẵn trên MISA mang
   * RefID do MISA quản lý, không phải GUID app sinh, nên tầng 1 không bao
   * giờ trúng với chúng.
   */
  it("tầng 3 ký hiệu + số, chịu được số 0 đệm đầu", () => {
    const idx = buildIndex([bk({ id: "C", misa_inv_series: "1C26THG", misa_inv_no: "7140" })])
    const r = matchOne(sn({ inv_series: "1C26THG", inv_no: "00007140" }), idx)
    expect(r).toMatchObject({ invoiceId: "C", method: "inv_no", confidence: "certain" })
  })

  it("tầng 3 không phân biệt hoa thường và khoảng trắng của ký hiệu", () => {
    const idx = buildIndex([bk({ id: "C", misa_inv_series: " 1c26thg ", misa_inv_no: "7140" })])
    expect(matchOne(sn({ inv_series: "1C26THG", inv_no: "00007140" }), idx)?.invoiceId).toBe("C")
  })

  /**
   * ⚠ Khác ký hiệu thì KHÔNG được khớp ở tầng chắc chắn, dù trùng số.
   * Hai ký hiệu khác nhau dùng chung dải số là chuyện thường.
   */
  it("cùng số nhưng khác ký hiệu ⇒ không khớp ở tầng 3", () => {
    const idx = buildIndex([bk({ id: "C", misa_inv_series: "1C26THG", misa_inv_no: "7140" })])
    const r = matchOne(sn({ inv_series: "1C25MHG", inv_no: "7140" }), idx)
    expect(r?.method).not.toBe("inv_no")
  })
})

describe("⚠ tầng 3b — bỏ chữ số đầu ký hiệu là SUY ĐOÁN", () => {
  /**
   * Chữ số đầu là mẫu số (InvTemplateNo): có nơi ghi kèm ký hiệu, có nơi
   * tách riêng, cùng một dải số. Nên phải khớp được — nhưng KHÔNG được
   * coi là chắc chắn.
   */
  it("khớp được khi một bên có mẫu số, bên kia không", () => {
    const idx = buildIndex([bk({ id: "D", misa_inv_series: "C25MHG", misa_inv_no: "123" })])
    const r = matchOne(sn({ inv_series: "1C25MHG", inv_no: "0000123" }), idx)
    expect(r).toMatchObject({ invoiceId: "D", method: "inv_no_loose", confidence: "review" })
    expect(r?.note).toContain("bỏ chữ số đầu")
  })

  /**
   * ⚠ '1C25MHG' và '2C25MHG' là HAI MẪU SỐ khác nhau, rút gọn về cùng
   * 'C25MHG'. Nhiều tờ trùng nghĩa là KHÔNG phân biệt được — phải bỏ, chứ
   * không được chọn bừa một tờ.
   */
  it("nhiều mẫu số cùng rút gọn ⇒ KHÔNG khớp, không chọn bừa", () => {
    const idx = buildIndex([
      bk({ id: "D1", misa_inv_series: "1C25MHG", misa_inv_no: "123" }),
      bk({ id: "D2", misa_inv_series: "2C25MHG", misa_inv_no: "123" }),
    ])
    // Ký hiệu '3C25MHG' không khớp chính xác tờ nào, rút gọn thì trùng cả hai.
    expect(matchOne(sn({ inv_series: "3C25MHG", inv_no: "123" }), idx)).toBeNull()
  })

  /** Khớp chính xác vẫn phải thắng, không rơi xuống tầng dự phòng. */
  it("có khớp chính xác thì không dùng tầng 3b", () => {
    const idx = buildIndex([
      bk({ id: "E1", misa_inv_series: "1C25MHG", misa_inv_no: "123" }),
      bk({ id: "E2", misa_inv_series: "2C25MHG", misa_inv_no: "123" }),
    ])
    const r = matchOne(sn({ inv_series: "1C25MHG", inv_no: "123" }), idx)
    expect(r).toMatchObject({ invoiceId: "E1", method: "inv_no", confidence: "certain" })
  })
})

describe("⚠ tầng 4 — chỉ nhận khi DUY NHẤT một hoá đơn trùng", () => {
  const base = { match_date: "2026-09-01", total: 1_100_000, customer_tax_code: "0301175691" }

  it("duy nhất một tờ trùng MST + ngày + tiền ⇒ khớp, cần review", () => {
    const idx = buildIndex([bk({ id: "F", ...base })])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691", inv_date: "2026-09-01T00:00:00", total_amount: 1_100_000 }),
      idx
    )
    expect(r).toMatchObject({ invoiceId: "F", method: "tax_date_amount", confidence: "review" })
  })

  /**
   * ⚠ Nhiều hoá đơn cùng MST/ngày/tiền là chuyện thường (giao nhiều đợt
   * cho một khách trong một ngày). Đoán bừa ở đây là sai báo cáo thuế.
   */
  it("hai tờ trùng cả ba vế ⇒ KHÔNG khớp", () => {
    const idx = buildIndex([bk({ id: "F1", ...base }), bk({ id: "F2", ...base })])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691", inv_date: "2026-09-01", total_amount: 1_100_000 }),
      idx
    )
    expect(r).toBeNull()
  })

  /**
   * ⚠ MST so HAI VÒNG: khớp đủ chuỗi trước, chỉ rút về gốc ở vòng ngoài.
   * Đã đo 4 đuôi chi nhánh khác nhau trong cùng một mẫu — strip sớm là
   * nhập nhằng giữa các chi nhánh, mà chúng là người mua KHÁC NHAU.
   */
  it("MST đủ chuỗi thắng MST gốc", () => {
    const idx = buildIndex([
      bk({ id: "G1", ...base, customer_tax_code: "0301175691-044" }),
      bk({ id: "G2", ...base, customer_tax_code: "0301175691-001" }),
    ])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691-044", inv_date: "2026-09-01", total_amount: 1_100_000 }),
      idx
    )
    expect(r?.invoiceId).toBe("G1")
  })

  /**
   * ⚠ Hai chi nhánh cùng ngày cùng tiền: vòng trong không trúng ai (MST
   * đủ chuỗi của MISA khác cả hai), vòng ngoài rút gọn thì trùng CẢ HAI →
   * phải bỏ, không được chọn chi nhánh nào.
   */
  it("nhiều chi nhánh cùng gốc ⇒ KHÔNG khớp", () => {
    const idx = buildIndex([
      bk({ id: "H1", ...base, customer_tax_code: "0301175691-044" }),
      bk({ id: "H2", ...base, customer_tax_code: "0301175691-001" }),
    ])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691-031", inv_date: "2026-09-01", total_amount: 1_100_000 }),
      idx
    )
    expect(r).toBeNull()
  })

  it("chỉ một chi nhánh ⇒ khớp được qua MST gốc, có ghi chú cảnh báo", () => {
    const idx = buildIndex([bk({ id: "I1", ...base, customer_tax_code: "0301175691-044" })])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691", inv_date: "2026-09-01", total_amount: 1_100_000 }),
      idx
    )
    expect(r?.invoiceId).toBe("I1")
    expect(r?.note).toContain("chi nhánh")
  })

  /**
   * ⚠ Tiền trên MISA CÓ THỂ ÂM (hoá đơn điều chỉnh giảm) trong khi sổ ghi
   * dương. So không xử dấu là bỏ sót đúng nhóm hoá đơn cần soi nhất.
   */
  it("tiền âm bên MISA vẫn khớp với sổ ghi dương", () => {
    const idx = buildIndex([bk({ id: "J", ...base, total: 786_240 })])
    const r = matchOne(
      sn({ buyer_tax_code: "0301175691", inv_date: "2026-09-01", total_amount: -786_240 }),
      idx
    )
    expect(r?.invoiceId).toBe("J")
  })

  it("khác ngày thì không khớp", () => {
    const idx = buildIndex([bk({ id: "K", ...base })])
    expect(
      matchOne(sn({ buyer_tax_code: "0301175691", inv_date: "2026-09-02", total_amount: 1_100_000 }), idx)
    ).toBeNull()
  })

  it("không có MST thì không khớp tầng 4", () => {
    const idx = buildIndex([bk({ id: "L", ...base, customer_tax_code: null })])
    expect(
      matchOne(sn({ buyer_tax_code: null, inv_date: "2026-09-01", total_amount: 1_100_000 }), idx)
    ).toBeNull()
  })
})

describe("chuẩn hoá phụ trợ", () => {
  it("baseTaxCode bỏ đuôi chi nhánh", () => {
    expect(baseTaxCode("0301175691-044")).toBe("0301175691")
    expect(baseTaxCode(" 0301175691 ")).toBe("0301175691")
    expect(baseTaxCode(null)).toBe("")
  })

  /** InvDate có lúc kèm offset (+07:00), có lúc không — cắt 10 ký tự đầu. */
  it("matchDate cắt 10 ký tự đầu, không parse tự đoán", () => {
    expect(matchDate("2026-08-17T00:00:00+07:00")).toBe("2026-08-17")
    expect(matchDate("2026-08-17T00:00:00")).toBe("2026-08-17")
    expect(matchDate("17/08/2026")).toBeNull()
    expect(matchDate(null)).toBeNull()
  })
})

// =====================================================================
describe("⚠ trạng thái đối soát — vòng đời đọc từ cờ THẬT", () => {
  const empty = new Map<string, BookRow>()
  const hit = { invoiceId: "inv-1", confidence: "certain", note: null }

  /**
   * Hoá đơn ĐÃ HUỶ / ĐÃ BỊ THAY THẾ phải được kết luận TRƯỚC khi hỏi "có
   * khớp được không". Xếp một hoá đơn đã chết vào rổ "chỉ có trên MISA"
   * là báo động giả — nó không phải hoá đơn ngoài sổ.
   */
  it("đã huỷ ⇒ 'cancelled', kể cả khi không khớp được tờ nào", () => {
    const r = decideStatus({ relation: "new", is_deleted: true, total_amount: 1 }, null, empty)
    expect(r.match_status).toBe("cancelled")
  })

  it("đã bị thay thế ⇒ 'replaced', không phải 'misa_only'", () => {
    const r = decideStatus({ relation: "replaced", is_deleted: false, total_amount: 1 }, null, empty)
    expect(r.match_status).toBe("replaced")
  })

  /** Đây là lý do bảng snapshot tồn tại: hoá đơn phát hành ngoài app. */
  it("không khớp được ⇒ 'misa_only'", () => {
    const r = decideStatus({ relation: "new", is_deleted: false, total_amount: 1 }, null, empty)
    expect(r.match_status).toBe("misa_only")
    expect(r.match_note).toContain("ngoài app")
  })

  it("khớp bằng suy đoán ⇒ 'needs_review', giữ nguyên lý do", () => {
    const r = decideStatus(
      { relation: "new", is_deleted: false, total_amount: 1 },
      { invoiceId: "inv-1", confidence: "review", note: "lý do X" },
      empty
    )
    expect(r.match_status).toBe("needs_review")
    expect(r.match_note).toBe("lý do X")
  })

  it("khớp chắc chắn + tiền khớp ⇒ 'matched'", () => {
    const book = new Map([["inv-1", bk({ id: "inv-1", total: 1_100_000 })]])
    const r = decideStatus({ relation: "new", is_deleted: false, total_amount: 1_100_000 }, hit, book)
    expect(r.match_status).toBe("matched")
  })

  it("lệch tiền ⇒ 'amount_diff', ghi rõ hai bên", () => {
    const book = new Map([["inv-1", bk({ id: "inv-1", total: 1_100_000 })]])
    const r = decideStatus({ relation: "new", is_deleted: false, total_amount: 2_000_000 }, hit, book)
    expect(r.match_status).toBe("amount_diff")
    expect(r.match_note).toContain("sổ 1100000, MISA 2000000")
  })

  it("dung sai 1đ", () => {
    const book = new Map([["inv-1", bk({ id: "inv-1", total: 1_100_000 })]])
    expect(
      decideStatus({ relation: "new", is_deleted: false, total_amount: 1_100_001 }, hit, book).match_status
    ).toBe("matched")
    expect(
      decideStatus({ relation: "new", is_deleted: false, total_amount: 1_100_002 }, hit, book).match_status
    ).toBe("amount_diff")
  })

  /** ⚠ Hoá đơn điều chỉnh mang số CHÊNH — so với sổ là lệch giả, mọi tờ. */
  it("hoá đơn điều chỉnh KHÔNG bị đem so tiền", () => {
    const book = new Map([["inv-1", bk({ id: "inv-1", total: 1_100_000 })]])
    const r = decideStatus({ relation: "adjustment", is_deleted: false, total_amount: 50_000 }, hit, book)
    expect(r.match_status).toBe("matched")
    expect(r.match_note).toContain("số chênh")
  })

  /** Tiền âm bên MISA, dương trong sổ — cùng một tờ, không phải lệch. */
  it("tiền âm khớp trị tuyệt đối", () => {
    const book = new Map([["inv-1", bk({ id: "inv-1", total: 786_240 })]])
    const r = decideStatus({ relation: "new", is_deleted: false, total_amount: -786_240 }, hit, book)
    expect(r.match_status).toBe("matched")
  })
})

// =====================================================================
describe("⚠ endpoint danh sách — ba chỗ dễ sai đã đo được", () => {
  const c = strip(CLIENT)
  const i = c.indexOf("export async function listInvoices")
  const fn = c.slice(i, c.indexOf("\nexport ", i + 10))

  /**
   * ⚠ Lưới web gửi ngày BỌC NHÁY KÉP vì tầng của nó tự bóc; bề mặt
   * /api/v2 model-bind thẳng vào DateTime nên chuỗi có nháy parse hỏng,
   * rơi về khoảng rỗng — và KHÔNG ném lỗi, chỉ trả 0 dòng.
   */
  it("ngày KHÔNG bọc nháy kép", () => {
    expect(i).toBeGreaterThan(0)
    expect(fn).toMatch(/form\.set\("fromDate", `\$\{params\.fromDate\}T00:00:00\.000Z`\)/)
    expect(fn).not.toMatch(/fromDate[^\n]*\\"/)
  })

  /** Body là form-urlencoded, khác mọi endpoint khác trong file. */
  it("gửi form-urlencoded, không phải JSON", () => {
    expect(fn).toContain("application/x-www-form-urlencoded")
    expect(fn).not.toContain("JSON.stringify(")
  })

  /** Tiền tố `code/` bắt buộc với hoá đơn có mã; bỏ đi thì trả 0 dòng. */
  it("có tiền tố code/ theo cờ isInvoiceWithCode", () => {
    expect(fn).toContain('cfg.isInvoiceWithCode ? "code/" : ""')
    expect(fn).toContain("v3sainvoice/paging")
  })

  /** `data` là chuỗi JSON lồng — phải parse hai lần. */
  it("parse hai lần và chịu được trang méo", () => {
    expect(fn).toContain("JSON.parse(dataStr)")
    expect(fn).toMatch(/catch\s*\{[\s\S]*?return \{ rows: \[\], recordsTotal \}/)
  })
})

describe("⚠ phân trang — dừng theo MẢNG RỖNG, không theo recordsTotal", () => {
  const c = strip(PULL)

  /**
   * Response mang dữ liệu có thể trả recordsTotal = 0 (đã đo). Lấy nó làm
   * điều kiện dừng là dừng ngay trang đầu và kéo thiếu toàn bộ, im lặng.
   */
  it("điều kiện dừng là mảng rỗng", () => {
    expect(c).toContain("if (!res.rows.length) break")
    const loop = c.slice(c.indexOf("for (let page = 0"), c.indexOf("} catch (e)"))
    expect(loop).not.toMatch(/recordsTotal\s*[<>=]/)
  })

  /** Chạm trần trang phải BÁO RA, không im lặng kéo thiếu. */
  it("chạm trần trang thì báo ra", () => {
    expect(c).toContain("report.hit_page_cap = true")
  })

  /** recordsTotal của endpoint này CÓ giá trị thật → dùng làm chốt chặn. */
  it("kéo thiếu so với recordsTotal thì báo đỏ", () => {
    expect(c).toMatch(/recordsTotal > rows\.length/)
    expect(c).toContain("short_pull")
  })
})

describe("⚠ chốt tay của người phải sống sót", () => {
  const c = strip(PULL)

  /**
   * `match_method = 'manual'` là người đã chốt tay. Vòng khớp tự động ghi
   * đè lên đó là xoá công của người, lặng lẽ, mỗi lần chạy.
   */
  it("vòng khớp bỏ qua bản ghi chốt tay", () => {
    expect(c).toContain('.or("match_method.is.null,match_method.neq.manual")')
  })

  /** UPSERT theo (org_id, ref_id) — kéo lại nhiều lần không nhân bản. */
  it("upsert theo khoá tự nhiên, và KHÔNG đụng cột đối soát", () => {
    expect(c).toContain('onConflict: "org_id,ref_id"')
    const i = c.indexOf("function toSnapshotRow")
    const fn = c.slice(i, c.indexOf("\nasync function reconcileOrg", i))
    for (const col of ["invoice_id", "match_method", "match_status", "match_confidence"]) {
      expect(fn, `toSnapshotRow ghi đè ${col}`).not.toContain(col)
    }
  })

  /**
   * Endpoint danh sách KHÔNG tách thuế (trả 0.0). Ghi 0 vào cột tiền là
   * nói dối rằng thuế bằng không — phải ghi null.
   */
  it("tiền thuế MISA không trả thì lưu null, không lưu 0", () => {
    expect(c).toContain("snap.totalWithoutVat || null")
    expect(c).toContain("snap.totalVat || null")
  })

  it("bỏ bản ghi thiếu RefID — không có khoá thì không lưu", () => {
    expect(c).toMatch(/if \(!refId\) return null/)
  })

  it("lưu nguyên bản ghi thô để tra lại", () => {
    expect(c).toMatch(/raw: raw as Record<string, unknown>/)
  })
})

// =====================================================================
describe("migration bảng snapshot", () => {
  it("khoá tự nhiên (org_id, ref_id) là duy nhất", () => {
    const i = MIG.indexOf("uq_misa_snapshot_ref")
    expect(i).toBeGreaterThan(0)
    expect(MIG.slice(i, MIG.indexOf(";", i))).toContain("(org_id, ref_id)")
  })

  /** Đường khớp chính cho dữ liệu cũ. */
  it("có chỉ mục theo ký hiệu + số đã chuẩn hoá", () => {
    const i = MIG.indexOf("idx_misa_snapshot_no")
    expect(i).toBeGreaterThan(0)
    const idx = MIG.slice(i, MIG.indexOf(";", i))
    expect(idx).toContain("inv_series_norm")
    expect(idx).toContain("inv_no_norm")
  })

  /**
   * ⚠ Cột chuẩn hoá phải SINH TỰ ĐỘNG. Để ứng dụng tự ghi là mở đường cho
   * chúng lệch với cột gốc mà không ai thấy.
   */
  it("hai cột chuẩn hoá là GENERATED, không do app ghi", () => {
    expect(MIG).toMatch(/inv_no_norm text\s+GENERATED ALWAYS AS/)
    expect(MIG).toMatch(/inv_series_norm text\s+GENERATED ALWAYS AS/)
  })

  /** '000' không được thành chuỗi rỗng — nuốt mất dữ liệu. */
  it("số hoá đơn toàn số 0 giữ nguyên", () => {
    const i = MIG.indexOf("inv_no_norm text")
    const decl = MIG.slice(i, MIG.indexOf("STORED", i))
    expect(decl).toContain("= '' THEN")
  })

  /**
   * ⚠ Chuẩn hoá ký hiệu ở tầng LƯU chỉ được viết hoa + bỏ khoảng trắng.
   * Bỏ chữ số đầu ở đây là gộp '1C25MHG' với '2C25MHG' — hai mẫu số khác
   * nhau — và mất dữ liệu vĩnh viễn.
   */
  it("inv_series_norm KHÔNG bỏ chữ số đầu", () => {
    const i = MIG.indexOf("inv_series_norm text")
    const decl = MIG.slice(i, MIG.indexOf("STORED", i))
    expect(decl).toContain("upper(")
    expect(decl).not.toMatch(/\^0-9|\^\\d|regexp_replace\([^)]*'\^\[0-9\]/)
  })

  /** Dữ liệu hoá đơn thuế — cùng mức nhạy cảm với bảng invoices. */
  it("bật RLS và giới hạn đúng ba vai trò", () => {
    expect(MIG).toContain("ENABLE ROW LEVEL SECURITY")
    const policies = MIG.match(/CREATE POLICY[\s\S]*?;/g) || []
    expect(policies.length).toBeGreaterThanOrEqual(2)
    for (const p of policies) {
      expect(p).toContain("public.user_org_id()")
      expect(p).toMatch(/'owner','accountant','manager'/)
    }
  })

  /** Ghi được cũng phải bị chặn theo org, không chỉ đọc. */
  it("policy ghi có WITH CHECK", () => {
    const i = MIG.indexOf('CREATE POLICY "Manage misa snapshots"')
    expect(i).toBeGreaterThan(0)
    expect(MIG.slice(i, MIG.indexOf(";", i))).toContain("WITH CHECK")
  })

  it("match_method có giá trị 'manual' để người chốt tay", () => {
    expect(MIG).toContain("'manual'")
  })
})
