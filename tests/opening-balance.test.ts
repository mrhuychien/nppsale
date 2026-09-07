import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  parseAmount,
  parseDueDate,
  normalizeKey,
  normalizeName,
  buildPlan,
  planFingerprint,
  type Entity,
  type ExistingOpening,
  type SourceRow,
} from "../src/lib/opening-balance/parse"
import { mapHeaderRow, normalizeHeader, columnsFor } from "../src/lib/opening-balance/schema"
import { buildExportRows, formatVnDate } from "../src/lib/opening-balance/sheet"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/**
 * Bỏ chú thích trước khi soi mã — chú thích nhắc tên một lớp/chuỗi làm
 * test xanh oan. Quét THEO DÒNG, không regex: xem ghi chú dài ở
 * tests/mobile-actions-lines.test.ts về hai lần đo trả giá cho luật này.
 */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
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

// =====================================================================
describe("Đọc số tiền", () => {
  it("nhận số thật của Excel và chuỗi có dấu phân cách nghìn", () => {
    expect(parseAmount(12400000)).toEqual({ ok: true, value: 12400000 })
    for (const s of ["12.400.000", "12,400,000", "12 400 000", " 12400000 "]) {
      expect(parseAmount(s), `thua ở "${s}"`).toEqual({ ok: true, value: 12400000 })
    }
  })

  /**
   * ⚠ "12.5" có thể là 125 (dấu chấm phân cách nghìn kiểu VN gõ thiếu)
   * hoặc 12,5 (kiểu Anh). Đoán sai là lệch 10 lần trên sổ tiền. Phải
   * TỪ CHỐI, không được tự chọn một cách hiểu.
   */
  it("TỪ CHỐI phần thập phân thay vì đoán", () => {
    for (const s of ["12.5", "12,50", "1.234,56"]) {
      const r = parseAmount(s)
      expect(r.ok, `"${s}" lẽ ra phải bị từ chối`).toBe(false)
      expect(r.ok === false && "reason" in r && r.reason).toContain("lẻ")
    }
    const n = parseAmount(12.5)
    expect(n.ok).toBe(false)
  })

  /** Bỏ trống KHÁC số 0 — một cái là "không đụng", cái kia là "xoá". */
  it("phân biệt bỏ trống với số 0", () => {
    for (const blank of [null, undefined, "", "   "]) {
      const r = parseAmount(blank)
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.blank).toBe(true)
    }
    expect(parseAmount(0)).toEqual({ ok: true, value: 0 })
    expect(parseAmount("0")).toEqual({ ok: true, value: 0 })
  })

  it("từ chối số âm và chuỗi rác", () => {
    expect(parseAmount(-5).ok).toBe(false)
    expect(parseAmount("abc").ok).toBe(false)
    expect(parseAmount("12tr").ok).toBe(false)
  })
})

// =====================================================================
describe("Đọc ngày", () => {
  /**
   * ⚠ Excel trả Date lúc 00:00 giờ địa phương. Dùng toISOString() thì
   * mọi múi giờ dương bị lùi một ngày — Việt Nam là UTC+7, hạn 01/03
   * thành 28/02.
   */
  it("Date của Excel giữ đúng ngày, không lùi vì múi giờ", () => {
    expect(parseDueDate(new Date(2026, 2, 1))).toEqual({ ok: true, value: "2026-03-01" })
    expect(parseDueDate(new Date(2026, 0, 1))).toEqual({ ok: true, value: "2026-01-01" })
  })

  it("nhận dd/mm/yyyy và yyyy-mm-dd", () => {
    expect(parseDueDate("15/01/2026")).toEqual({ ok: true, value: "2026-01-15" })
    expect(parseDueDate("5/1/2026")).toEqual({ ok: true, value: "2026-01-05" })
    expect(parseDueDate("2026-01-15")).toEqual({ ok: true, value: "2026-01-15" })
  })

  /** ⚠ JS tự đẩy 31/02 sang 03/03 mà không báo gì. */
  it("bắt ngày không có thật thay vì để JS đẩy sang tháng sau", () => {
    const r = parseDueDate("31/02/2026")
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain("không có thật")
    expect(parseDueDate("32/01/2026").ok).toBe(false)
    expect(parseDueDate("15/13/2026").ok).toBe(false)
  })

  it("trống là hợp lệ — hạn thanh toán không bắt buộc", () => {
    expect(parseDueDate("")).toEqual({ ok: true, value: null })
    expect(parseDueDate(null)).toEqual({ ok: true, value: null })
  })
})

// =====================================================================
describe("Dò cột theo tiêu đề", () => {
  /** Người dùng đổi thứ tự cột trong Excel là chuyện thường. */
  it("dò theo TÊN, không theo vị trí", () => {
    const idx = mapHeaderRow(["Ghi chú", "Công nợ đầu kỳ", "ID (không sửa)"], "customer")
    expect(idx.note).toBe(0)
    expect(idx.amount).toBe(1)
    expect(idx.id).toBe(2)
  })

  it("bỏ dấu, không phân biệt hoa thường", () => {
    expect(normalizeHeader("Công nợ đầu kỳ")).toBe(normalizeHeader("cong no dau ky"))
    expect(normalizeHeader("ID (không sửa)")).toBe("id")
    // Giữ CHỮ sau khi bỏ dấu. Thiếu NFD thì "Công" thành "cng" và cột
    // không dò ra; thiếu bước thay "đ" thì "đầu kỳ" thành "auky".
    expect(normalizeHeader("Công nợ đầu kỳ")).toBe("congnodauky")
  })

  /**
   * ⚠ File có hai cột trùng tên thì lấy cột SAU sẽ âm thầm bỏ qua số
   * người ta đã điền ở cột trước.
   */
  it("hai cột trùng tên thì giữ cột ĐẦU TIÊN", () => {
    const idx = mapHeaderRow(["Công nợ đầu kỳ", "Ghi chú", "Công nợ đầu kỳ"], "customer")
    expect(idx.amount).toBe(0)
  })

  it("thiếu cột thì không có khoá đó, không ném", () => {
    const idx = mapHeaderRow(["Tên cửa hàng"], "customer")
    expect("amount" in idx).toBe(false)
    expect(idx.name).toBe(0)
  })
})

// =====================================================================
const ENTITIES: Entity[] = [
  { id: "c1", label: "Tạp hoá Cô Ba", altKey: "0901000001" },
  { id: "c2", label: "Cửa hàng Minh Anh", altKey: "0901000002" },
  { id: "c3", label: "Tạp hoá Cô Ba", altKey: "0901000003" }, // trùng TÊN với c1
]
const row = (o: Partial<SourceRow> & { rowNo: number }): SourceRow => o as SourceRow

describe("Lập kế hoạch — khớp đối tượng", () => {
  it("khớp theo ID trước tiên", () => {
    const p = buildPlan([row({ rowNo: 2, id: "c2", amount: 1000 })], ENTITIES, [])
    expect(p.rows[0].action).toBe("create")
    expect(p.rows[0].entityId).toBe("c2")
  })

  it("thiếu ID thì dò theo khoá dự phòng, bỏ qua khác biệt định dạng", () => {
    const p = buildPlan([row({ rowNo: 2, altKey: "090 100 0002", amount: 1000 })], ENTITIES, [])
    expect(p.rows[0].entityId).toBe("c2")
  })

  /**
   * ⚠ DB chỉ chặn TRÙNG NGUYÊN VĂN số điện thoại. "090-100-0003" và
   * "0901000003" là hai bản ghi hợp lệ khác nhau trong bảng, nhưng
   * normalizeKey gộp chúng làm một — nên va chạm này CÓ THẬT, và ghi nợ
   * cho nhầm khách là hậu quả.
   */
  it("khoá dự phòng gộp về cùng một chuỗi thì báo LỖI, không lấy đại", () => {
    const dupKey: Entity[] = [
      { id: "d1", label: "Quán A", altKey: "0901000009" },
      { id: "d2", label: "Quán B", altKey: "090-100-0009" },
    ]
    const p = buildPlan([row({ rowNo: 2, altKey: "0901000009", amount: 1000 })], dupKey, [])
    expect(p.rows[0].action).toBe("error")
    expect(p.rows[0].message).toContain("trùng")
  })

  /** ⚠ Hai khách trùng tên: lấy đại cái đầu là ghi nợ cho nhầm người. */
  it("tên trùng thì báo LỖI, không lấy đại", () => {
    const p = buildPlan([row({ rowNo: 2, name: "Tạp hoá Cô Ba", amount: 1000 })], ENTITIES, [])
    expect(p.rows[0].action).toBe("error")
    expect(p.rows[0].message).toContain("trùng")
  })

  it("ID không có trong hệ thống thì báo lỗi, không tạo mới khách", () => {
    const p = buildPlan([row({ rowNo: 2, id: "khong-co", amount: 1000 })], ENTITIES, [])
    expect(p.rows[0].action).toBe("error")
    expect(p.rows[0].message).toContain("không có trong hệ thống")
  })

  /**
   * ⚠ Hai dòng cùng trỏ về một khách: dòng sau đè dòng trước và người
   * dùng không biết con số nào đã thắng.
   */
  it("hai dòng trùng đối tượng thì dòng sau thành lỗi", () => {
    const p = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 1000 }), row({ rowNo: 5, id: "c1", amount: 2000 })],
      ENTITIES,
      []
    )
    expect(p.rows[0].action).toBe("create")
    expect(p.rows[1].action).toBe("error")
    expect(p.rows[1].message).toContain("dòng 2")
  })
})

describe("Lập kế hoạch — tạo / sửa / xoá", () => {
  const existing: ExistingOpening[] = [
    { id: "r1", entityId: "c1", amount: 5000000, paid: 0, dueDate: "2026-01-15", note: "cũ" },
  ]

  it("chưa có thì TẠO, đã có và khác thì SỬA", () => {
    const p = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 7000000 }), row({ rowNo: 3, id: "c2", amount: 100 })],
      ENTITIES,
      existing
    )
    expect(p.rows[0].action).toBe("update")
    expect(p.rows[0].before).toEqual({ amount: 5000000, dueDate: "2026-01-15" })
    expect(p.rows[1].action).toBe("create")
  })

  /** Nhập lại đúng file vừa xuất ra thì không được sinh ra việc gì. */
  it("y hệt số cũ thì KHÔNG ĐỔI, không ghi lại", () => {
    const p = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 5000000, dueDate: "15/01/2026", note: "cũ" })],
      ENTITIES,
      existing
    )
    expect(p.rows[0].action).toBe("unchanged")
    expect(p.counts.update).toBe(0)
  })

  /** ⚠ Xuất 500 khách, điền 40. 460 dòng còn lại KHÔNG được đụng tới. */
  it("bỏ trống là BỎ QUA, không phải xoá", () => {
    const p = buildPlan([row({ rowNo: 2, id: "c1" }), row({ rowNo: 3, id: "c2", amount: "" })], ENTITIES, existing)
    expect(p.rows.map((r) => r.action)).toEqual(["skip", "skip"])
    expect(p.counts.delete).toBe(0)
  })

  it("số 0 là XOÁ dòng đầu kỳ đang có", () => {
    const p = buildPlan([row({ rowNo: 2, id: "c1", amount: 0 })], ENTITIES, existing)
    expect(p.rows[0].action).toBe("delete")
    expect(p.rows[0].existingId).toBe("r1")
  })

  it("số 0 mà chưa có gì thì bỏ qua, không tạo dòng 0 đồng", () => {
    const p = buildPlan([row({ rowNo: 2, id: "c2", amount: 0 })], ENTITIES, existing)
    expect(p.rows[0].action).toBe("skip")
  })

  /**
   * ⚠ Xoá / hạ số một khoản ĐÃ THU một phần là làm sổ thành "trả thừa"
   * và mất dấu tiền đã nhận.
   */
  it("không xoá và không hạ dưới số đã thu", () => {
    const paid: ExistingOpening[] = [
      { id: "r1", entityId: "c1", amount: 5000000, paid: 2000000, dueDate: null, note: null },
    ]
    const del = buildPlan([row({ rowNo: 2, id: "c1", amount: 0 })], ENTITIES, paid)
    expect(del.rows[0].action).toBe("error")
    expect(del.rows[0].message).toContain("đã thu")

    const down = buildPlan([row({ rowNo: 2, id: "c1", amount: 1000000 })], ENTITIES, paid)
    expect(down.rows[0].action).toBe("error")
    expect(down.rows[0].message).toContain("nhỏ hơn số đã thu")

    const up = buildPlan([row({ rowNo: 2, id: "c1", amount: 6000000 })], ENTITIES, paid)
    expect(up.rows[0].action).toBe("update")
  })

  it("ngày hỏng làm hỏng ĐÚNG dòng đó, không kéo cả file", () => {
    const p = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 100, dueDate: "31/02/2026" }), row({ rowNo: 3, id: "c2", amount: 200 })],
      ENTITIES,
      []
    )
    expect(p.rows[0].action).toBe("error")
    expect(p.rows[1].action).toBe("create")
  })
})

describe("Vân tay kế hoạch", () => {
  /** ⚠ Xem một bảng rồi ghi một bảng khác là cách mất tiền êm nhất. */
  it("chỉ tính trên dòng SẼ GHI — thêm dòng bỏ qua không đổi vân tay", () => {
    const a = buildPlan([row({ rowNo: 2, id: "c1", amount: 100 })], ENTITIES, [])
    const b = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 100 }), row({ rowNo: 3, id: "c2" })],
      ENTITIES,
      []
    )
    expect(b.fingerprint).toBe(a.fingerprint)
  })

  it("đổi số tiền thì đổi vân tay", () => {
    const a = buildPlan([row({ rowNo: 2, id: "c1", amount: 100 })], ENTITIES, [])
    const b = buildPlan([row({ rowNo: 2, id: "c1", amount: 101 })], ENTITIES, [])
    expect(b.fingerprint).not.toBe(a.fingerprint)
  })

  /** Đổi thứ tự dòng trong file không phải là đổi kế hoạch. */
  it("không phụ thuộc thứ tự dòng", () => {
    const a = buildPlan(
      [row({ rowNo: 2, id: "c1", amount: 100 }), row({ rowNo: 3, id: "c2", amount: 200 })],
      ENTITIES, []
    )
    const b = buildPlan(
      [row({ rowNo: 2, id: "c2", amount: 200 }), row({ rowNo: 3, id: "c1", amount: 100 })],
      ENTITIES, []
    )
    expect(b.fingerprint).toBe(a.fingerprint)
  })

  it("kế hoạch rỗng vẫn ra chuỗi 8 ký tự", () => {
    expect(planFingerprint([])).toMatch(/^[0-9a-f]{8}$/)
  })
})

// =====================================================================
describe("Vòng tròn xuất → nhập", () => {
  const existing: ExistingOpening[] = [
    { id: "r1", entityId: "c1", amount: 5000000, paid: 0, dueDate: "2026-01-15", note: "chốt sổ" },
  ]

  /** Cột xuất ra phải ĐÚNG bộ cột bên nhập đọc vào. */
  it("tiêu đề file xuất khớp bộ cột bên nhập", () => {
    const rows = buildExportRows("customer", ENTITIES, existing)
    expect(rows[0]).toEqual(columnsFor("customer").map((c) => c.header))
  })

  /**
   * ⚠ Xuất ra rồi nhập lại NGAY mà sinh ra việc là hỏng: người dùng sẽ
   * ghi đè cả sổ bằng một thao tác họ tưởng là vô hại.
   */
  it("xuất ra rồi nhập lại nguyên vẹn = không có gì để ghi", () => {
    const rows = buildExportRows("customer", ENTITIES, existing)
    const idx = mapHeaderRow(rows[0] as string[], "customer")
    const src: SourceRow[] = rows.slice(1).map((r, i) => ({
      rowNo: i + 2,
      id: r[idx.id], name: r[idx.name], altKey: r[idx.altKey],
      amount: r[idx.amount], dueDate: r[idx.dueDate], note: r[idx.note],
    }))
    const p = buildPlan(src, ENTITIES, existing)
    expect(p.counts.create).toBe(0)
    expect(p.counts.update).toBe(0)
    expect(p.counts.delete).toBe(0)
    expect(p.counts.error).toBe(0)
    expect(p.counts.unchanged).toBe(1)
    expect(p.counts.skip).toBe(2)
  })

  /**
   * ⚠ Nếu ô trống được xuất thành số 0 thì nhập lại chính file đó sẽ ra
   * một kế hoạch XOÁ SẠCH.
   */
  it("khách chưa có đầu kỳ thì ô tiền để TRỐNG, không phải 0", () => {
    const rows = buildExportRows("customer", ENTITIES, existing)
    const idx = mapHeaderRow(rows[0] as string[], "customer")
    const c2 = rows.slice(1).find((r) => r[idx.id] === "c2")!
    expect(c2[idx.amount]).toBe("")
  })

  it("số tiền xuất ra là SỐ, để Excel cộng được", () => {
    const rows = buildExportRows("customer", ENTITIES, existing)
    const idx = mapHeaderRow(rows[0] as string[], "customer")
    const c1 = rows.slice(1).find((r) => r[idx.id] === "c1")!
    expect(typeof c1[idx.amount]).toBe("number")
  })

  it("ngày xuất theo dd/mm/yyyy — đúng quy ước bên nhập", () => {
    expect(formatVnDate("2026-01-15")).toBe("15/01/2026")
    expect(parseDueDate(formatVnDate("2026-01-15"))).toEqual({ ok: true, value: "2026-01-15" })
  })
})

// =====================================================================
describe("Chuẩn hoá", () => {
  /** Chuẩn hoá khi SO, giữ nguyên khi LƯU. */
  it("khoá dự phòng bỏ khoảng trắng và dấu nối", () => {
    expect(normalizeKey("090-100 0001")).toBe(normalizeKey("0901000001"))
    expect(normalizeKey(" NCC01 ")).toBe("ncc01")
  })
  it("tên bỏ dấu và gộp khoảng trắng", () => {
    expect(normalizeName("Tạp   hoá  Cô Ba")).toBe(normalizeName("tap hoa co ba"))
  })
})

// =====================================================================
describe("Migration 102", () => {
  const MIG = migration("102_opening_balances")

  /**
   * ⚠ Không có ràng buộc này thì nhập file hai lần là mỗi khách có hai
   * dòng đầu kỳ và nợ bị nhân đôi.
   */
  it("mỗi đối tượng đúng MỘT dòng đầu kỳ", () => {
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_opening")
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_opening")
  })

  /**
   * ⚠ Chỉ mục phải là BỘ PHẬN. Bỏ mệnh đề WHERE là mỗi khách chỉ còn
   * được có một công nợ duy nhất — mọi đơn hàng thứ hai sẽ bị chặn.
   */
  it("chỉ mục chỉ áp lên dòng đầu kỳ, không đụng công nợ thường", () => {
    // Cắt tới hết CÂU LỆNH đó, không lấy cửa sổ 200 ký tự: cửa sổ rộng
    // sẽ với sang câu lệnh kế bên và bắt được `WHERE opening_balance`
    // của nó, nên bỏ mệnh đề WHERE ở câu trước mà test vẫn xanh (đã đo).
    const stmt = (marker: string) => {
      const i = MIG.indexOf(marker)
      expect(i, `không thấy ${marker}`).toBeGreaterThan(0)
      return MIG.slice(i, MIG.indexOf(";", i))
    }
    expect(stmt("uq_receivables_opening")).toContain("WHERE opening_balance")
    expect(stmt("uq_payables_opening")).toContain("WHERE opening_balance")
  })

  /** ⚠ NVBH tự ghi nợ đầu kỳ cho khách của mình là lỗ hổng chốt sổ. */
  it("NVBH không tạo được dòng đầu kỳ, nhưng vẫn tạo được công nợ từ đơn", () => {
    expect(MIG).toContain("public.user_role() = 'sales' AND opening_balance = false")
    expect(MIG).toContain("public.user_role() IN ('owner', 'accountant')")
  })

  /** ⚠ Mở DELETE rộng là cho xoá luôn công nợ sinh từ đơn hàng. */
  it("chỉ xoá được dòng ĐẦU KỲ", () => {
    const i = MIG.indexOf("Accountant can delete opening receivables")
    expect(i).toBeGreaterThan(0)
    const policy = MIG.slice(i, MIG.indexOf(";", MIG.indexOf("USING", i)))
    expect(policy).toContain("AND opening_balance")
  })

  it("không tạo bảng mới — đầu kỳ vẫn là công nợ", () => {
    expect(MIG).not.toMatch(/CREATE TABLE/i)
  })
})

// =====================================================================
describe("Ghi xuống DB", () => {
  const IO = strip(read("src/lib/opening-balance/io.ts"))

  /**
   * ⚠ Policy "Sales see own receivables" lọc theo sales_user_id. Để
   * trống thì khoản nợ VÔ HÌNH với chính người đi thu nó.
   */
  it("gán NVBH phụ trách khi tạo công nợ đầu kỳ cho khách", () => {
    expect(IO).toContain("payload.sales_user_id = primaryRep[r.entityId]")
    expect(IO).toContain('supabase\n        .from("customer_assignments")')
  })

  /** Phân công đã ngừng thì không gán — nợ sẽ rơi vào màn của người đã nghỉ. */
  it("bỏ qua phân công không còn hiệu lực", () => {
    expect(IO).toContain('if (a.status && a.status !== "active") continue')
  })

  /** ⚠ Một dòng hỏng không được kéo theo 499 dòng còn lại. */
  it("ghi từng dòng, lỗi thì gom lại kèm số dòng Excel", () => {
    expect(IO).toContain("res.failures.push({")
    expect(IO).toContain("rowNo: r.rowNo")
    const i = IO.indexOf("for (const r of rows)")
    expect(i).toBeGreaterThan(0)
    expect(IO.slice(i, i + 2000)).toContain("try {")
  })

  it("chỉ ghi dòng đầu kỳ — luôn đặt cờ opening_balance", () => {
    expect(IO).toContain("opening_balance: true")
  })

  /** Chạm trần nạp mà im lặng thì file xuất ra thiếu khách mà không ai biết. */
  it("nói ra khi chạm trần nạp", () => {
    expect(IO).toContain("truncated:")
    expect(IO).toMatch(/FETCH_CAP = \d+/)
  })
})

// =====================================================================
describe("Sổ chi tiết công nợ theo khách", () => {
  const LEDGER = strip(read("src/app/(dashboard)/receivables/by-customer/[customerId]/page.tsx"))

  /**
   * ⚠ Trước đây dòng thời gian chỉ dựng khi `r.order` tồn tại, nên khoản
   * đầu kỳ biến mất khỏi sổ dù vẫn cộng vào tổng nợ.
   */
  it("khoản đầu kỳ hiện trong dòng thời gian", () => {
    expect(LEDGER).toContain("if (r.opening_balance) {")
    expect(LEDGER).toContain('type: "opening"')
    expect(LEDGER).toContain("opening_balance, note, order:sales_orders")
  })

  /**
   * ⚠ Phép tính cũ là "order thì cộng, CÒN LẠI thì trừ". Thêm loại thứ
   * ba vào mà không sửa là đầu kỳ bị TRỪ khỏi nợ.
   */
  it("đầu kỳ LÀM TĂNG nợ, không bị trừ như một khoản thu", () => {
    expect(LEDGER).toContain('t === "order" || t === "opening"')
    expect(LEDGER).not.toMatch(/if \(e\.type === "order"\) \{\s*running \+= e\.amount\s*\} else \{/)
  })

  it("hiển thị dấu cộng cho đầu kỳ, dấu trừ chỉ cho khoản thu", () => {
    expect(LEDGER).toContain('entry.type === "payment" ? "-" : "+"')
  })
})
