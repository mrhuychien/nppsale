import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AMOUNT_TOLERANCE,
  checkAmounts,
  carriesDifferenceOnly,
  deriveState,
  isPublished,
  readCancelled,
  readRelation,
  readSnapshot,
  relationVoidsInvoice,
} from "@/lib/misa/status"
import { applyMisaSnapshot, isoDateOnly, type BookInvoice } from "@/lib/misa/apply"

/**
 * §2 — hai trục trạng thái, §3.3 — so tiền.
 *
 * Đây là test HÀNH VI THẬT: `status.ts` / `apply.ts` thuần nên gọi thẳng
 * được, không phải test đọc mã nguồn. Chỗ nào không dựng được (route, cron)
 * mới soi mã.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const NOW = "2026-09-04T10:00:00.000Z"

/** Bản ghi MISA tối thiểu — ghi đè từng field trong mỗi ca. */
function misa(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    InvNo: "0000123",
    InvSeries: "1C25MHG",
    InvDate: "2026-09-01T00:00:00",
    PublishStatus: 3,
    EInvoiceStatus: 1,
    TransactionID: "TXN-1",
    TotalAmount: 1_100_000,
    ...over,
  }
}

function book(over: Partial<BookInvoice> = {}): BookInvoice {
  return {
    id: "inv-1",
    misa_ref_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    misa_inv_no: null,
    misa_status: "sent",
    misa_no_locked: false,
    subtotal: 1_000_000,
    vat: 100_000,
    total: 1_100_000,
    ...over,
  }
}

const apply = (raw: Record<string, unknown>, b = book(), withCode = true) =>
  applyMisaSnapshot(raw, b, { orgUsesInvoiceCode: withCode, now: NOW })

// =====================================================================
describe("⚠ PublishStatus >= 1 KHÔNG phải 'đã ký'", () => {
  /**
   * Chỉ 3 là đã cấp mã. Các giá trị giữa là *đang phát hành · phát hành
   * lỗi · chờ cấp mã · từ chối cấp mã* — mã cũ dán nhãn "signed" cho tất
   * cả, nghĩa là hoá đơn BỊ TỪ CHỐI CẤP MÃ cũng thành "đã ký". Và
   * order-pipeline.tsx đọc đúng cờ đó để quyết còn phải xuất hoá đơn nữa
   * không, nên hoá đơn hỏng BIẾN KHỎI việc cần làm.
   */
  it("chỉ PublishStatus = 3 mới là đã phát hành", () => {
    expect(isPublished(3)).toBe(true)
    for (const s of [0, 1, 2, 4, 5, 9]) {
      expect(isPublished(s), `PublishStatus=${s} không được coi là đã ký`).toBe(false)
    }
  })

  it("PublishStatus 3 → signed", () => {
    expect(apply(misa({ PublishStatus: 3 })).updates.misa_status).toBe("signed")
  })

  it("PublishStatus 0 → sent, không phải signed", () => {
    expect(apply(misa({ PublishStatus: 0 })).updates.misa_status).toBe("sent")
  })

  /** Giá trị 1 và 2 là chỗ nguy hiểm nhất: mã cũ gọi chúng là "đã ký". */
  it("PublishStatus 1/2 KHÔNG ra signed", () => {
    for (const s of [1, 2]) {
      const r = apply(misa({ PublishStatus: s, InvoiceCode: null }))
      expect(r.updates.misa_status, `PublishStatus=${s}`).not.toBe("signed")
    }
  })
})

describe("⚠ giá trị lạ thì KHÔNG ĐOÁN — lùi về mã CQT", () => {
  it("đơn vị có mã + đã có mã CQT ⇒ signed", () => {
    const r = apply(misa({ PublishStatus: 5, InvoiceCode: "M1-22-ABC" }), book(), true)
    expect(r.updates.misa_status).toBe("signed")
    expect(r.updates.misa_invoice_code).toBe("M1-22-ABC")
  })

  it("đơn vị có mã + chưa có mã CQT ⇒ waiting_code, có ghi chú", () => {
    const r = apply(misa({ PublishStatus: 5, InvoiceCode: null }), book(), true)
    expect(r.updates.misa_status).toBe("waiting_code")
    expect(String(r.updates.misa_note)).toContain("PublishStatus=5")
  })

  /**
   * ⚠ Đơn vị dùng hoá đơn KHÔNG MÃ sẽ không bao giờ có InvoiceCode. Trả
   * 'waiting_code' cho họ là để MỌI hoá đơn của họ đứng vĩnh viễn ở "chờ
   * cấp mã".
   */
  it("đơn vị KHÔNG mã: không bao giờ bị kẹt ở waiting_code", () => {
    const r = apply(misa({ PublishStatus: 5, InvoiceCode: null }), book(), false)
    expect(r.updates.misa_status).not.toBe("waiting_code")
  })

  /** Không kết luận được thì giữ nguyên trạng thái đang có, nhưng ghi chú. */
  it("đơn vị KHÔNG mã + PublishStatus lạ ⇒ giữ nguyên + ghi chú", () => {
    const r = apply(misa({ PublishStatus: 5 }), book({ misa_status: "sent" }), false)
    expect(r.updates.misa_status).toBeUndefined()
    expect(String(r.updates.misa_note)).toContain("KHÔNG MÃ")
  })
})

// =====================================================================
describe("⚠ trục QUAN HỆ nằm ở EInvoiceStatus, không phải PublishStatus", () => {
  it("đọc đủ 5 giá trị đã đo", () => {
    expect(readRelation(1)).toBe("new")
    expect(readRelation(3)).toBe("replacement")
    expect(readRelation(4)).toBe("adjustment")
    expect(readRelation(7)).toBe("replaced")
    expect(readRelation(8)).toBe("adjusted")
  })

  it("giá trị lạ → unknown, không đoán", () => {
    expect(readRelation(99)).toBe("unknown")
    expect(readRelation(null)).toBeNull()
  })

  /**
   * Đã đo 5 hoá đơn thật: PublishStatus giữ nguyên 3 ở cả 5 trong khi
   * EInvoiceStatus chạy 1/3/4/7/8. Chỉ đọc PublishStatus là mù trục quan hệ.
   */
  it("PublishStatus=3 không đổi mà quan hệ vẫn đọc ra khác nhau", () => {
    const rels = [1, 3, 4, 7, 8].map(
      (e) => apply(misa({ PublishStatus: 3, EInvoiceStatus: e })).updates.misa_relation
    )
    expect(rels).toEqual(["new", "replacement", "adjustment", "replaced", "adjusted"])
  })

  /**
   * ⚠ "BỊ thay thế" ⇒ hết hiệu lực, BẤT KỂ đã cấp mã. "BỊ điều chỉnh" thì
   * KHÔNG — hoá đơn điều chỉnh chỉ cộng phần chênh, bản gốc vẫn còn hiệu
   * lực và vẫn phải kê khai. Gộp hai loại là KHAI THIẾU doanh thu bản gốc.
   */
  it("bị thay thế ⇒ replaced, kể cả khi PublishStatus = 3", () => {
    const r = apply(misa({ PublishStatus: 3, EInvoiceStatus: 7 }))
    expect(r.updates.misa_status).toBe("replaced")
    expect(relationVoidsInvoice("replaced")).toBe(true)
  })

  it("bị ĐIỀU CHỈNH thì VẪN còn hiệu lực — không được thành replaced", () => {
    const r = apply(misa({ PublishStatus: 3, EInvoiceStatus: 8 }))
    expect(r.updates.misa_status).toBe("signed")
    expect(r.updates.misa_status).not.toBe("replaced")
    expect(relationVoidsInvoice("adjusted")).toBe(false)
    expect(String(r.updates.misa_note)).toContain("VẪN còn hiệu lực")
  })
})

describe("⚠ đọc được OrgRefID ⇒ phải đánh dấu hoá đơn GỐC", () => {
  /**
   * Không làm thì HAI hoá đơn cùng hiện "đã ký" cho MỘT lần bán ⇒ doanh
   * thu và thuế đầu ra khai GẤP ĐÔI.
   */
  it("bản THAY THẾ yêu cầu đánh dấu tờ gốc", () => {
    const r = apply(misa({ EInvoiceStatus: 3, OrgRefID: "GUID-GOC" }))
    expect(r.markOriginalReplaced).toBe("GUID-GOC")
    expect(r.updates.misa_org_ref_id).toBe("GUID-GOC")
  })

  /**
   * ⚠ Hoá đơn ĐIỀU CHỈNH cũng mang OrgRefID, mà bản gốc của nó VẪN CÒN
   * hiệu lực. Suy từ mỗi sự có mặt của OrgRefID là khai thiếu doanh thu
   * bản gốc.
   */
  it("bản ĐIỀU CHỈNH KHÔNG được đánh dấu tờ gốc là đã thay thế", () => {
    const r = apply(misa({ EInvoiceStatus: 4, OrgRefID: "GUID-GOC" }))
    expect(r.markOriginalReplaced).toBeNull()
    // Vẫn lưu lại quan hệ để tra ngược được.
    expect(r.updates.misa_org_ref_id).toBe("GUID-GOC")
  })

  it("hoá đơn mới không có gì để đánh dấu", () => {
    expect(apply(misa({ EInvoiceStatus: 1 })).markOriginalReplaced).toBeNull()
  })

  /**
   * ⚠ Bản BỊ thay thế KHÔNG mang Org* (đã đo — trống sạch). Nên phải đọc
   * quan hệ từ EInvoiceStatus; chỉ suy ngược từ OrgRefID thì hoá đơn hết
   * hiệu lực nào chưa thấy bản thay thế sẽ VĨNH VIỄN không lộ.
   */
  it("bản BỊ thay thế lộ ra dù không có OrgRefID", () => {
    const r = apply(misa({ EInvoiceStatus: 7, OrgRefID: null }))
    expect(r.updates.misa_status).toBe("replaced")
  })
})

// =====================================================================
describe("⚠ chỉ so vế nào MISA THẬT SỰ trả số", () => {
  /**
   * Endpoint danh sách của MISA trả TotalAmountWithoutVAT / TotalVATAmount
   * = 0.0 cho mọi bản ghi (đo 30/30 ở hệ thống dùng cùng cơ chế). So số 0
   * đó với subtotal thì MỌI hoá đơn khớp đều bị gắn lệch — rổ cảnh báo đầy
   * báo động giả, rồi không ai nhìn cả cảnh báo thật.
   */
  it("MISA trả 0.0 cho tiền hàng/thuế ⇒ KHÔNG so hai vế đó", () => {
    const r = checkAmounts({
      snap: readSnapshot(misa({ TotalAmountWithoutVAT: 0.0, TotalVATAmount: 0.0 })),
      relation: "new",
      book: { subtotal: 1_000_000, vat: 100_000, total: 1_100_000 },
    })
    expect(r.mismatch).toBe(false)
    expect(r.compared).toEqual(["Tổng tiền"])
  })

  it("có số thật thì vẫn so đủ ba vế", () => {
    const r = checkAmounts({
      snap: readSnapshot(misa({ TotalAmountWithoutVAT: 1_000_000, TotalVATAmount: 100_000 })),
      relation: "new",
      book: { subtotal: 1_000_000, vat: 100_000, total: 1_100_000 },
    })
    expect(r.compared).toEqual(["Tổng tiền", "Tiền hàng", "Thuế GTGT"])
    expect(r.mismatch).toBe(false)
  })

  /** Tổng tiền luôn có, và một mình nó đã đủ bắt lệch. */
  it("lệch tổng tiền ⇒ amount_mismatch, ghi rõ hai bên", () => {
    const r = apply(misa({ TotalAmount: 2_000_000 }))
    expect(r.updates.misa_status).toBe("amount_mismatch")
    expect(String(r.updates.misa_note)).toContain("sổ 1100000, MISA 2000000")
  })

  it("dung sai 1đ: lệch đúng 1đ thì bỏ qua, 2đ thì báo", () => {
    expect(AMOUNT_TOLERANCE).toBe(1)
    const ok = apply(misa({ TotalAmount: 1_100_001 }))
    expect(ok.updates.misa_status).not.toBe("amount_mismatch")
    const bad = apply(misa({ TotalAmount: 1_100_002 }))
    expect(bad.updates.misa_status).toBe("amount_mismatch")
  })

  /**
   * ⚠ TÁCH VẤN ĐỀ KHỎI THÔNG TIN. Hoá đơn ĐIỀU CHỈNH mang số CHÊNH, không
   * phải tổng — đem so với invoices.total là chắc chắn lệch, mọi tờ, mãi
   * mãi. Đếm nó vào ô "lệch" là sinh cảnh báo giả cho một nghiệp vụ đúng.
   */
  it("hoá đơn ĐIỀU CHỈNH không bị đem so tiền", () => {
    expect(carriesDifferenceOnly("adjustment")).toBe(true)
    const r = apply(misa({ EInvoiceStatus: 4, TotalAmount: 50_000 }))
    expect(r.updates.misa_status).not.toBe("amount_mismatch")
    expect(String(r.updates.misa_note)).toContain("mang số chênh")
  })

  /** Lệch tiền không được ghi đè một trạng thái CUỐI, quan trọng hơn. */
  it("hoá đơn đã bị thay thế: giữ 'replaced', không hạ thành lệch tiền", () => {
    const r = apply(misa({ EInvoiceStatus: 7, TotalAmount: 999 }))
    expect(r.updates.misa_status).toBe("replaced")
  })
})

// =====================================================================
describe("⚠ đừng gán null đè lên cột đang có giá trị tốt", () => {
  /**
   * MISA có lúc trả thiếu TransactionID (hoá đơn "chờ cấp mã"); ghi null
   * đè lên là XOÁ TRẮNG mã tra cứu đang đúng ở lượt quét sau.
   */
  it("MISA thiếu TransactionID ⇒ không có khoá đó trong updates", () => {
    const r = apply(misa({ TransactionID: null }))
    expect("misa_lookup_code" in r.updates).toBe(false)
  })

  it("MISA thiếu ký hiệu / mã CQT ⇒ cũng không ghi null", () => {
    const r = apply(misa({ InvSeries: null, InvoiceCode: null, OrgRefID: null }))
    expect("misa_inv_series" in r.updates).toBe(false)
    expect("misa_invoice_code" in r.updates).toBe(false)
    expect("misa_org_ref_id" in r.updates).toBe(false)
  })

  it("luôn ghi misa_last_checked_at", () => {
    expect(apply(misa()).updates.misa_last_checked_at).toBe(NOW)
    expect(apply(misa({ InvNo: "<Chưa cấp số>" })).updates.misa_last_checked_at).toBe(NOW)
  })
})

describe("⚠ '<Chưa cấp số>' là chỗ giữ chỗ", () => {
  it("không ghi nó vào misa_inv_no", () => {
    const r = apply(misa({ InvNo: "<Chưa cấp số>" }))
    expect("misa_inv_no" in r.updates).toBe(false)
    expect(r.summary.invNo).toBeNull()
  })

  it("chưa cấp số thì không thành 'signed' dù PublishStatus = 3", () => {
    const r = apply(misa({ InvNo: "<Chưa cấp số>", PublishStatus: 3 }), book({ misa_status: "pending" }))
    expect(r.updates.misa_status).toBe("sent")
  })
})

describe("⚠ không đè số người GÁN TAY, nhưng cũng không im lặng", () => {
  it("khoá gán tay ⇒ không ghi số MISA đè lên", () => {
    const r = apply(misa({ InvNo: "999" }), book({ misa_no_locked: true, misa_inv_no: "123" }))
    expect("misa_inv_no" in r.updates).toBe(false)
    expect(String(r.updates.misa_note)).toContain("Sổ ghi số 123, MISA cấp số 999")
    expect(r.updates.misa_status).toBe("amount_mismatch")
  })

  /** Chuẩn hoá khi so: '0000123' và '123' là cùng một số, không phải lệch. */
  it("số chỉ khác số 0 ở đầu ⇒ KHÔNG báo lệch", () => {
    const r = apply(misa({ InvNo: "0000123" }), book({ misa_no_locked: true, misa_inv_no: "123" }))
    expect(r.updates.misa_status).not.toBe("amount_mismatch")
    expect("misa_note" in r.updates).toBe(false)
  })
})

describe("cờ đã huỷ — chỉ nhận boolean true, không nhận 'truthy'", () => {
  /**
   * Nhận số/chuỗi truthy là mở đường cho `CancelStatus: 0` bị đọc thành
   * "đã huỷ" — dán nhãn huỷ lên hoá đơn còn hiệu lực là hỏng sổ.
   */
  it("chỉ true mới tính", () => {
    expect(readCancelled({ IsInvoiceCanceled: true }).cancelled).toBe(true)
    expect(readCancelled({ IsInvoiceCanceled: 1 }).cancelled).toBe(false)
    expect(readCancelled({ IsInvoiceCanceled: "true" }).cancelled).toBe(false)
    expect(readCancelled({ IsInvoiceCanceled: 0 }).cancelled).toBe(false)
    expect(readCancelled({}).cancelled).toBe(false)
  })

  it("ghi lại field nào đã kích hoạt", () => {
    const r = apply(misa({ IsCanceled: true }))
    expect(r.updates.misa_status).toBe("cancelled")
    expect(String(r.updates.misa_note)).toContain("IsCanceled")
  })

  /** Đã huỷ thắng mọi trạng thái khác. */
  it("đã huỷ thắng cả PublishStatus = 3", () => {
    expect(apply(misa({ IsCanceled: true, PublishStatus: 3 })).updates.misa_status).toBe("cancelled")
  })
})

describe("InvDate — quyết định kỳ thuế, không được ghi rác", () => {
  it("lấy đúng phần ngày", () => {
    expect(isoDateOnly("2026-09-01T00:00:00")).toBe("2026-09-01")
    expect(isoDateOnly("2026-09-01")).toBe("2026-09-01")
    expect(apply(misa()).updates.misa_inv_date).toBe("2026-09-01")
  })

  it("chuỗi lạ ⇒ bỏ trống, không ghi rác", () => {
    expect(isoDateOnly("01/09/2026")).toBeNull()
    expect(isoDateOnly("2026-13-01")).toBeNull()
    const r = apply(misa({ InvDate: "01/09/2026" }))
    expect("misa_inv_date" in r.updates).toBe(false)
  })
})

// =====================================================================
describe("§3.2 vòng quét — hai lượt, xác thực, chịu lỗi", () => {
  const SYNC = read("src/app/api/einvoice/sync/route.ts")
  const code = SYNC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

  it("lượt 1 lọc đúng: có RefID, chưa có số", () => {
    const i = code.indexOf("const { data: pass1")
    expect(i).toBeGreaterThan(0)
    const q = code.slice(i, code.indexOf("if (e1)", i))
    expect(q).toContain('.not("misa_ref_id", "is", null)')
    expect(q).toContain('.is("misa_inv_no", null)')
    expect(q).toContain('.gte("issued_at", since)')
  })

  /**
   * ⚠ Thiếu LƯỢT 2 thì hoá đơn bị huỷ hoặc bị thay thế trên MISA *sau khi
   * đã cấp số* không bao giờ bị phát hiện — bộ lọc lượt 1 loại chúng ra
   * (đã có misa_inv_no), nên hai nhánh 'cancelled' và 'replaced' thành
   * CODE CHẾT. Sổ vẫn ghi một hoá đơn hợp lệ trong khi MISA đã huỷ nó.
   */
  it("CÓ lượt 2: đã có số nhưng chưa ở trạng thái cuối", () => {
    const i = code.indexOf("const { data: pass2")
    expect(i, "thiếu hẳn lượt 2").toBeGreaterThan(0)
    const q = code.slice(i, code.indexOf("if (e2)", i))
    expect(q).toContain('.not("misa_inv_no", "is", null)')
    expect(q).toContain('.not("misa_status", "in", "(cancelled,replaced)")')
  })

  /**
   * ⚠ misa_no_locked: hoá đơn người GÁN TAY số thì misa_ref_id trên đó trỏ
   * về tờ ĐÃ CHẾT — lượt 2 sẽ ghi số chết đè lên số vừa gán, lặng lẽ, mỗi
   * lần chạy.
   */
  it("lượt 2 bỏ qua hoá đơn đã khoá số", () => {
    const i = code.indexOf("const { data: pass2")
    const q = code.slice(i, code.indexOf("if (e2)", i))
    expect(q).toContain('.eq("misa_no_locked", false)')
  })

  it("cả hai lượt sắp theo lần quét cũ nhất trước", () => {
    const orders = code.match(/\.order\("misa_last_checked_at"[^)]*\)/g) || []
    expect(orders.length).toBe(2)
    for (const o of orders) expect(o).toContain("nullsFirst: true")
  })

  it("mỗi lượt có giới hạn số tờ", () => {
    expect(code).toContain(".limit(PASS_LIMIT)")
    expect(code.match(/\.limit\(PASS_LIMIT\)/g)?.length).toBe(2)
  })

  /** ⚠ Lỗi MỘT hoá đơn không được kéo theo cả lượt. */
  it("lỗi một tờ được gom lại, vòng lặp chạy tiếp", () => {
    const i = code.indexOf("for (const inv of queue)")
    expect(i).toBeGreaterThan(0)
    const body = code.slice(i)
    expect(body).toContain("try {")
    expect(body).toContain("report.errors.push")
    // Không ném lại lỗi ra ngoài vòng lặp.
    expect(body.slice(0, body.indexOf("return NextResponse"))).not.toMatch(/\bthrow\b/)
  })

  /**
   * MISA không trả gì mà hoá đơn ĐÃ có số: chỉ cập nhật thời điểm quét,
   * ĐỪNG hạ một trạng thái đang đúng — có thể chỉ là lỗi tạm.
   */
  it("MISA trả rỗng ⇒ chỉ ghi last_checked_at", () => {
    const i = code.indexOf("if (!raw)")
    expect(i).toBeGreaterThan(0)
    const branch = code.slice(i, code.indexOf("const applied", i))
    expect(branch).toContain("misa_last_checked_at")
    expect(branch).not.toContain("misa_status")
  })

  /** Cron chạy khi không ai đăng nhập → không được dùng phiên người dùng. */
  it("xác thực bằng CRON_SECRET, không dùng session", () => {
    expect(code).toContain("process.env.CRON_SECRET")
    expect(code).not.toContain("createServerSupabaseClient")
    expect(code).not.toContain("auth.getUser")
  })

  /**
   * Route dùng admin client (bỏ qua RLS) nên header bí mật là hàng rào
   * DUY NHẤT. Thiếu biến môi trường phải TỪ CHỐI, không được mở cửa.
   */
  it("thiếu CRON_SECRET ⇒ tắt hẳn, không chạy", () => {
    const i = code.indexOf("if (!secret)")
    expect(i).toBeGreaterThan(0)
    // Tới câu lệnh kế tiếp sau nhánh này.
    const branch = code.slice(i, code.indexOf("const auth", i))
    expect(branch).toContain("503")
    expect(branch).toContain("return")
  })

  it("so bí mật không phụ thuộc thời gian", () => {
    expect(code).toContain("timingSafeEqual(provided, secret)")
    expect(code).not.toMatch(/provided\s*===\s*secret/)
  })

  it("có lịch cron trỏ đúng route", () => {
    const vercel = JSON.parse(read("vercel.json"))
    expect(vercel.crons?.[0]?.path).toBe("/api/einvoice/sync")
    expect(vercel.crons?.[0]?.schedule).toBeTruthy()
  })

  it("CRON_SECRET có trong .env.example", () => {
    expect(read(".env.example")).toContain("CRON_SECRET=")
  })
})

describe("refresh-status và vòng quét dùng CHUNG một bộ luật", () => {
  /**
   * Hai đường kết luận khác nhau về cùng một hoá đơn là chuyện chỉ lộ ra
   * khi số liệu đã sai. Cả hai phải gọi applyMisaSnapshot.
   */
  it("cả hai route đều đi qua applyMisaSnapshot", () => {
    expect(read("src/app/api/einvoice/refresh-status/route.ts")).toContain("applyMisaSnapshot")
    expect(read("src/app/api/einvoice/sync/route.ts")).toContain("applyMisaSnapshot")
  })

  it("refresh-status không còn tự suy trạng thái", () => {
    const c = read("src/app/api/einvoice/refresh-status/route.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
    expect(c).not.toContain("publishStatus >= 1")
    expect(c).not.toMatch(/nextStatus\s*=\s*"signed"/)
  })

  it("cả hai đều đánh dấu được hoá đơn gốc", () => {
    expect(read("src/app/api/einvoice/refresh-status/route.ts")).toContain("markOriginalReplaced")
    expect(read("src/app/api/einvoice/sync/route.ts")).toContain("markOriginalReplaced")
  })
})

describe("deriveState — không đoán khi thiếu dữ liệu", () => {
  it("EInvoiceStatus lạ ⇒ unknown + ghi chú, không tự gán quan hệ", () => {
    const r = deriveState({
      snap: readSnapshot(misa({ EInvoiceStatus: 42 })),
      orgUsesInvoiceCode: true,
      currentStatus: "sent",
    })
    expect(r.relation).toBe("unknown")
    expect(r.note).toContain("EInvoiceStatus=42")
  })

  it("không có EInvoiceStatus ⇒ quan hệ null, không mặc định 'new'", () => {
    const r = deriveState({
      snap: readSnapshot(misa({ EInvoiceStatus: null })),
      orgUsesInvoiceCode: true,
      currentStatus: "sent",
    })
    expect(r.relation).toBeNull()
  })
})
