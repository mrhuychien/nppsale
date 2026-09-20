import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  lineNetOf, lineVatOf, lineTotalOf, receiptTotals, unitCostOf, lineDiscountAmountOf,
  validReceiptLines, friendlyReceiptError,
  type ReceiptLine,
} from "../src/lib/purchasing/receipt-form"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Bỏ dòng chú thích SQL — tệp 142 nhắc lại mọi cái bẫy trong phần đầu. */
const stripSql = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

const MIG_RAW = read("supabase/migrations/142_purchase_receipt.sql")
const MIG = stripSql(MIG_RAW)

/** Thân một hàm trong migration. */
const fnBody = (name: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(-1)
  return MIG.slice(i, MIG.indexOf("$$;", i))
}

const COMPLETE = fnBody("complete_purchase_invoice")
const CANCEL = fnBody("cancel_purchase_invoice")

const line = (o: Partial<ReceiptLine> = {}): ReceiptLine => ({
  id: "l1",
  product_id: "p1",
  product_name: "Bánh hình kẹo 160g",
  sku: "SKU1",
  note: "",
  unit_name: "thùng",
  quantity: "10",
  unit_price: "240000",
  line_discount: "40000",
  discount_mode: "amount",
  vat_percent: "10",
  conversion_factor: "12",
  available_units: [],
  base_unit: "hộp",
  ...o,
})

// =====================================================================

/**
 * QUY ƯỚC TIỀN CỦA PHIẾU NHẬP.
 *
 * ⚠ KHÁC HẲN PHIẾU BÁN. Bên bán `line_discount` chỉ GHI NHỚ (chiết khấu
 * đã nằm trong `unit_price`); bên mua nó TRỪ THẬT. Lẫn hai quy ước là
 * công nợ NCC lệch đúng bằng tổng giảm giá của cả phiếu.
 */
describe("tiền của phiếu nhập hàng", () => {
  it("tiền dòng trừ giảm giá dòng, chưa gồm thuế", () => {
    expect(lineNetOf(line())).toBe(10 * 240000 - 40000)
  })

  it("thuế tính TRÊN tiền đã trừ giảm giá dòng", () => {
    expect(lineVatOf(line())).toBeCloseTo(2360000 * 0.1, 6)
    expect(lineTotalOf(line())).toBeCloseTo(2360000 * 1.1, 6)
  })

  /**
   * ⚠ KHÔNG ĐỂ ÂM. Gõ nhầm giảm giá lớn hơn tiền hàng là cả phiếu ra số
   * âm, và công nợ NCC thành một khoản NCC nợ lại mình.
   */
  it("giảm giá dòng lớn hơn tiền hàng thì về 0, không ra số âm", () => {
    expect(lineNetOf(line({ quantity: "1", unit_price: "1000", line_discount: "9999" }))).toBe(0)
  })

  it("giảm giá đầu phiếu trừ SAU thuế", () => {
    const t = receiptTotals([line()], 100000)
    expect(t.subtotal).toBe(2360000)
    expect(t.vat).toBeCloseTo(236000, 6)
    expect(t.discount).toBe(100000)
    expect(t.total).toBeCloseTo(2360000 + 236000 - 100000, 6)
  })

  it("giảm giá đầu phiếu lớn hơn cả phiếu thì tổng về 0", () => {
    expect(receiptTotals([line()], 99999999).total).toBe(0)
  })

  /**
   * ⚠ Ô TRỐNG LÀ 0, KHÔNG PHẢI `NaN`. Một dòng vừa thêm chưa gõ gì mà
   * làm cả phiếu thành "NaN đ" là màn hình nói dối về một phiếu hoàn
   * toàn bình thường đang soạn dở.
   */
  it("ô trống không làm hỏng tổng", () => {
    const t = receiptTotals(
      [line(), line({ id: "l2", quantity: "", unit_price: "", line_discount: "", vat_percent: "" })],
      ""
    )
    expect(Number.isNaN(t.total)).toBe(false)
    expect(t.total).toBeCloseTo(2596000, 6)
  })

  /**
   * ⚠ CHỐT TRÊN KHÔNG ĐỦ, VÀ BẢN ĐẦU CỦA NÓ NÓI DỐI. `Number("")` bằng
   * 0 chứ không phải `NaN`, nên một phiếu toàn ô trống KHÔNG BAO GIỜ đi
   * qua nhánh chặn NaN — bỏ hẳn nhánh đó ra thì chốt trên vẫn xanh. Đã
   * thử phá đúng như vậy và nó lọt.
   *
   * Thứ thật sự sinh `NaN` là giá trị KHÔNG PHẢI SỐ: `undefined` khi
   * dựng dòng thiếu trường, hay một chuỗi rác dán vào ô. `NaN` lọt qua
   * đây là "NaN đ" trên màn và một `NaN` gửi thẳng lên cột `numeric`.
   */
  it("giá trị không phải số cũng ra 0, không ra NaN", () => {
    for (const bad of ["abc", "--", "1e", undefined as unknown as string]) {
      expect(
        Number.isNaN(lineNetOf(line({ quantity: bad }))),
        `quantity = ${String(bad)} lọt ra NaN`
      ).toBe(false)
      expect(Number.isNaN(lineVatOf(line({ vat_percent: bad })))).toBe(false)
      expect(Number.isNaN(unitCostOf(line({ conversion_factor: bad })))).toBe(false)
    }
    expect(Number.isNaN(receiptTotals([line()], "abc").total)).toBe(false)
    expect(receiptTotals([line()], "abc").discount).toBe(0)
  })

  it("phiếu rỗng ra 0", () => {
    expect(receiptTotals([], "")).toEqual({
      subtotal: 0, vat: 0, vatComputed: 0, vatOverridden: false, discount: 0, total: 0,
    })
  })

  /**
   * ⚠ GIÁ VỐN THEO ĐƠN VỊ CƠ SỞ VÀ ĐÃ TRỪ GIẢM GIÁ. Lấy thẳng
   * `unit_price` là ghi giá một thùng thành giá một hộp — mọi báo cáo
   * lãi lỗ sau đó sai gấp bằng hệ số quy đổi.
   */
  it("giá vốn quy về đơn vị cơ sở và đã trừ giảm giá dòng", () => {
    expect(unitCostOf(line())).toBeCloseTo(2360000 / 120, 9)
    expect(unitCostOf(line({ quantity: "0" }))).toBe(0)
  })

  it("bỏ dòng chưa chọn hàng và dòng số lượng 0", () => {
    const out = validReceiptLines([
      line({ id: "ok" }),
      line({ id: "chưa chọn", product_id: "" }),
      line({ id: "không số", quantity: "0" }),
    ])
    expect(out.map((l) => l.id)).toEqual(["ok"])
  })

  /** ⚠ Cắt mã đi cho người dùng đọc, nhưng GIỮ NGUYÊN câu của RPC. */
  it("lỗi của RPC cắt mã, giữ nguyên phần liệt kê", () => {
    expect(friendlyReceiptError("HANG_DA_XUAT: Không huỷ được vì Bánh (nhập 120, còn 100).")).toBe(
      "Không huỷ được vì Bánh (nhập 120, còn 100)."
    )
    expect(friendlyReceiptError("lỗi mạng")).toBe("lỗi mạng")
  })
})

// =====================================================================

/**
 * HAI BẢN CỦA CÙNG MỘT PHÉP TÍNH PHẢI KHỚP NHAU.
 *
 * ⚠ SQL LÀ BẢN QUYẾT ĐỊNH. `complete_purchase_invoice` tính lại từ dòng
 * hàng và ghi số của NÓ vào `payables.amount`; bản TypeScript chỉ để
 * người dùng xem trước. Lệch nhau là màn hình đọc cho người ta một con
 * số rồi ghi xuống sổ một con số khác, và không có gì kêu lên.
 */
describe("phép tính ở SQL khớp với phép tính ở trình duyệt", () => {
  it("SQL trừ giảm giá dòng trước khi tính thuế", () => {
    expect(COMPLETE).toContain(
      "v_sub := v_sub + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount)"
    )
    expect(COMPLETE).toContain(
      "v_vat := v_vat + (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount) * r.vat_rate"
    )
  })

  it("SQL trừ giảm giá đầu phiếu SAU thuế, và kẹp về 0", () => {
    expect(COMPLETE).toContain("v_total := GREATEST(0, v_sub + v_vat - v_discount)")
  })

  /**
   * ⚠ KHÔNG NHẬN SỐ TIỀN TỪ TRÌNH DUYỆT. Bản cũ ghi thẳng `total` do
   * trình duyệt gửi lên vào `payables.amount`. Một tab mở lâu với bảng
   * giá cũ là công nợ NCC lệch mà không có chỗ nào đối chiếu.
   */
  it("công nợ NCC lấy số SQL vừa tính, không lấy cột total có sẵn", () => {
    const pay = COMPLETE.slice(COMPLETE.indexOf("INSERT INTO payables"))
    expect(pay).toContain("v_total")
    expect(pay, "đang ghi thẳng cột total của phiếu vào công nợ").not.toMatch(
      /VALUES[\s\S]{0,200}COALESCE\(v_total_from_row/
    )
    // Và phiếu cũng được ghi lại bằng chính mấy con số đó.
    expect(COMPLETE).toMatch(/SET status = 'completed',[\s\S]{0,300}subtotal = v_sub/)
    expect(COMPLETE).toMatch(/SET status = 'completed',[\s\S]{0,300}total = v_total/)
  })

  /** ⚠ Giá vốn: cùng công thức với `unitCostOf`. */
  it("SQL tính giá vốn theo đơn vị cơ sở và đã trừ giảm giá", () => {
    expect(COMPLETE).toContain(
      "v_unit_cost := (COALESCE(r.quantity, 0) * COALESCE(r.unit_price, 0) - r.line_discount)"
    )
    expect(COMPLETE).toContain("/ v_base_qty")
  })
})

// =====================================================================

describe("142 — hoàn thành phiếu nhập", () => {
  /**
   * ⚠ KHO ĐÍCH DO NGƯỜI NHẬP CHỌN. Mặc định cứng vào 'sale' là đưa một
   * lô hàng cận date vào kho bán — mà từ migration 138 thì kho bán mới
   * là kho được bán ra.
   */
  it("lô nhập vào ĐÚNG kho đích của phiếu", () => {
    expect(COMPLETE).toContain("warehouse_zone")
    const ins = COMPLETE.slice(COMPLETE.indexOf("INSERT INTO batches"))
    expect(ins).toContain("v_zone")
    expect(ins, "kho đích đang bị đóng cứng").not.toMatch(/'sale'\s*\n?\s*\)/)
  })

  /**
   * ⚠ `stock_entry_lines` ĐÃ ĐƯỢC MỞ RỘNG SAU MIGRATION 065:
   * `qty_in_base_uom` là NOT NULL. Bản RPC cũ chèn thiếu cột nên nó NGÃ
   * ngay lần chạy đầu — đó cũng là bằng chứng nó chưa từng chạy.
   */
  it("chèn đủ bộ cột đơn vị của stock_entry_lines", () => {
    const ins = COMPLETE.slice(COMPLETE.indexOf("INSERT INTO stock_entry_lines"))
    for (const c of ["qty_in_base_uom", "qty_in_transaction_uom", "transaction_uom", "conversion_factor_snapshot"]) {
      expect(ins, `thiếu cột ${c}`).toContain(c)
    }
    /* `quantity` là integer — phải làm tròn, không để Postgres tự cắt. */
    expect(ins).toContain("ROUND(v_base_qty)::integer")
  })

  /** ⚠ Bấm hai lần, hoặc bấm rồi mạng rớt rồi bấm lại, KHÔNG nhập kho hai lần. */
  it("idempotent: phiếu đã hoàn thành thì trả về ngay", () => {
    const guard = COMPLETE.slice(COMPLETE.indexOf("IF v_status = 'completed'"))
    expect(guard.slice(0, 120)).toContain("RETURN p_invoice_id")
  })

  it("chỉ phiếu tạm mới hoàn thành được, và phiếu rỗng thì từ chối", () => {
    expect(COMPLETE).toContain("PHIEU_KHONG_CON_TAM")
    expect(COMPLETE).toContain("PHIEU_KHONG_CO_HANG")
  })

  /**
   * ⚠ MÃ PHIẾU PHẢI KHOÁ THEO ORG. Hai người bấm "Hoàn thành" cùng lúc
   * mà không khoá là hai phiếu mang cùng một mã, và chỉ chỉ mục duy
   * nhất mới kêu — sau khi kho đã cộng.
   */
  it("đánh số phiếu có khoá và có chỉ mục duy nhất", () => {
    expect(MIG).toContain("pg_advisory_xact_lock")
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_pinv_receipt_code")
  })
})

describe("142 — huỷ phiếu nhập", () => {
  /**
   * ⚠ TIỀN ĐÃ TRẢ THÌ KHÔNG HUỶ. Huỷ phiếu là xoá dòng công nợ, mà xoá
   * một dòng nợ đã trả một phần là mất luôn vết của khoản đã trả.
   */
  it("từ chối khi đã trả tiền NCC", () => {
    expect(CANCEL).toContain("DA_TRA_TIEN")
    expect(CANCEL).toContain("COALESCE(v_paid, 0) > 0")
  })

  /**
   * ⚠ HÀNG ĐÃ ĐỘNG THÌ KHÔNG HUỶ, và phải NÓI RÕ MẶT HÀNG NÀO. Trừ
   * ngược một lô đã bán mất một phần là đẩy tồn xuống âm và xoá mất vết
   * của chính lần bán đó.
   */
  it("từ chối khi hàng đã xuất bớt, và gọi tên mặt hàng", () => {
    expect(CANCEL).toContain("HANG_DA_XUAT")
    expect(CANCEL).toContain("b.qty_on_hand <> b.qty_initial")
    expect(CANCEL).toContain("string_agg")
    expect(CANCEL).toContain("p.name")
  })

  /**
   * ⚠ GỠ CON TRỎ TRƯỚC, XOÁ DÒNG NỢ SAU.
   * `purchase_invoices.payable_id` có khoá ngoại trỏ tới `payables`, nên
   * xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ chối. Đã gặp
   * thật khi chạy migration.
   */
  it("đặt payable_id về NULL trước khi xoá dòng nợ", () => {
    const setNull = CANCEL.indexOf("payable_id = NULL")
    const del = CANCEL.indexOf("DELETE FROM payables")
    expect(setNull, "không còn gỡ con trỏ công nợ").toBeGreaterThan(0)
    expect(del, "không còn xoá dòng nợ").toBeGreaterThan(0)
    expect(setNull, "xoá dòng nợ TRƯỚC khi gỡ con trỏ — khoá ngoại sẽ chặn").toBeLessThan(del)
  })

  it("phiếu còn tạm thì huỷ không đụng kho hay nợ", () => {
    const draft = CANCEL.slice(CANCEL.indexOf("IF v_status = 'draft'"))
    const upto = draft.slice(0, draft.indexOf("END IF;"))
    expect(upto).toContain("status = 'cancelled'")
    expect(upto, "nhánh phiếu tạm đang đụng vào kho").not.toContain("batches")
    expect(upto, "nhánh phiếu tạm đang đụng vào công nợ").not.toContain("payables")
  })

  it("idempotent: phiếu đã huỷ thì trả về ngay", () => {
    const guard = CANCEL.slice(CANCEL.indexOf("IF v_status = 'cancelled'"))
    expect(guard.slice(0, 120)).toContain("RETURN p_invoice_id")
  })

  it("trừ sạch lô và đóng phiếu kho", () => {
    expect(CANCEL).toContain("SET qty_on_hand = 0, status = 'cancelled'")
    expect(CANCEL).toContain("UPDATE stock_entries SET status = 'cancelled'")
  })
})

describe("142 — bất biến chung", () => {
  const FNS = ["complete_purchase_invoice", "cancel_purchase_invoice", "next_purchase_receipt_code"]

  /**
   * ⚠ SECURITY DEFINER MÀ QUÊN THU QUYỀN LÀ MỞ CHO PUBLIC. Ba hàm này
   * đụng thẳng vào kho và công nợ.
   */
  it("mọi hàm đều REVOKE PUBLIC rồi mới GRANT authenticated", () => {
    for (const f of FNS) {
      const rev = MIG.indexOf(`REVOKE EXECUTE ON FUNCTION public.${f}(`)
      const grant = MIG.indexOf(`GRANT EXECUTE ON FUNCTION public.${f}(`)
      expect(rev, `${f} thiếu REVOKE`).toBeGreaterThan(0)
      expect(grant, `${f} thiếu GRANT`).toBeGreaterThan(0)
      expect(rev, `${f}: GRANT đứng trước REVOKE`).toBeLessThan(grant)
    }
    expect(MIG).not.toMatch(/GRANT EXECUTE[^\n]*\bTO\b[^\n]*\banon\b/)
  })

  it("mọi hàm đụng kho / nợ đều SECURITY DEFINER và khoá search_path", () => {
    for (const body of [COMPLETE, CANCEL, fnBody("next_purchase_receipt_code")]) {
      expect(body).toContain("SECURITY DEFINER")
      expect(body).toContain("SET search_path = public")
    }
  })

  /** ⚠ Đơn vị của người gọi — phòng vệ chiều sâu, không chỉ dựa vào RLS. */
  it("hai RPC đều kiểm org của người gọi", () => {
    for (const body of [COMPLETE, CANCEL]) {
      expect(body).toContain("public.user_org_id()")
      expect(body).toContain("SAI_DON_VI")
    }
  })

  /**
   * ⚠ QUY ƯỚC CỦA KHO MÃ: mọi RAISE dùng ERRCODE P0001, câu tiếng Việt,
   * MỞ ĐẦU BẰNG MÃ để giao diện cắt ra được.
   */
  it("mọi RAISE đều P0001 và mở đầu bằng mã", () => {
    const raises = Array.from(MIG.matchAll(/RAISE EXCEPTION '([^']+)'/g)).map((m) => m[1])
    expect(raises.length).toBeGreaterThan(5)
    for (const r of raises) {
      expect(r, `câu lỗi không mở đầu bằng mã: ${r}`).toMatch(/^[A-Z_]+: /)
    }
    expect(
      MIG.match(/RAISE EXCEPTION/g)?.length,
      "số lần RAISE và số lần khai ERRCODE không khớp"
    ).toBe(MIG.match(/ERRCODE = 'P0001'/g)?.length)
  })

  /**
   * ⚠ NGÀY THEO GIỜ VIỆT NAM. Hạn dùng của lô tính bằng `CURRENT_DATE`
   * là suốt 00:00-07:00 giờ Việt Nam nó lùi một ngày (xem migration 140).
   */
  it("hạn lô tính theo vn_today, không theo CURRENT_DATE", () => {
    expect(COMPLETE).toContain("public.vn_today()")
    expect(COMPLETE, "còn dùng CURRENT_DATE trong hàm nhập kho").not.toContain("CURRENT_DATE")
  })

  it("kết thúc bằng NOTIFY để PostgREST nạp lại lược đồ", () => {
    expect(MIG_RAW.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /**
   * ⚠ KHÔNG TỰ CHÉP LỊCH SỬ CŨ SANG. Phiếu nhập cũ nằm ở `stock_entries`;
   * chép sang là đoán lại giá, thuế và giảm giá của những chứng từ không
   * ghi mấy con số đó, rồi dựng ra công nợ THỨ HAI cho cùng một lần nhập.
   */
  it("không backfill từ stock_entries sang purchase_invoices", () => {
    expect(MIG).not.toMatch(/INSERT INTO purchase_invoices/i)
    expect(MIG).toContain("RAISE NOTICE")
  })
})

// =====================================================================

/**
 * GIẢM GIÁ THEO TIỀN HAY THEO PHẦN TRĂM (chủ nhà chốt 20/09/2026).
 *
 * ⚠ CỘT `purchase_invoice_lines.line_discount` LUÔN LÀ TIỀN. Chế độ chỉ
 * sống trong biểu mẫu; lưu phần trăm xuống là cột ấy mang hai nghĩa tuỳ
 * dòng — đúng cái bẫy đã làm thuế phiếu trả NCC hụt 100 lần (mig 141).
 */
describe("giảm giá theo tiền hoặc theo phần trăm", () => {
  it("chế độ tiền: gõ bao nhiêu trừ bấy nhiêu", () => {
    const l = line({ quantity: "10", unit_price: "1000", line_discount: "2000", discount_mode: "amount" })
    expect(lineDiscountAmountOf(l)).toBe(2000)
    expect(lineNetOf(l)).toBe(8000)
  })

  it("chế độ phần trăm: tính trên tiền hàng của CHÍNH dòng đó", () => {
    const l = line({ quantity: "10", unit_price: "1000", line_discount: "5", discount_mode: "percent" })
    expect(lineDiscountAmountOf(l)).toBe(500)
    expect(lineNetOf(l)).toBe(9500)
  })

  /**
   * ⚠ CÙNG MỘT CON SỐ, HAI CHẾ ĐỘ, HAI KẾT QUẢ KHÁC HẲN. Đọc "5" như
   * tiền trong khi người dùng đang ở chế độ phần trăm là giảm 5 đồng
   * thay vì 500 — và ngược lại.
   */
  it("cùng con số ở hai chế độ ra hai kết quả khác nhau", () => {
    const base = { quantity: "10", unit_price: "1000", line_discount: "5" }
    expect(lineDiscountAmountOf(line({ ...base, discount_mode: "amount" }))).toBe(5)
    expect(lineDiscountAmountOf(line({ ...base, discount_mode: "percent" }))).toBe(500)
  })

  /** ⚠ Kẹp trần 100% — gõ 500% là số tiền giảm lớn hơn tiền hàng. */
  it("phần trăm kẹp trần 100", () => {
    const l = line({ quantity: "10", unit_price: "1000", line_discount: "500", discount_mode: "percent" })
    expect(lineDiscountAmountOf(l)).toBe(10000)
    expect(lineNetOf(l)).toBe(0)
  })

  /** ⚠ Số âm ở chế độ tiền là CỘNG thêm qua đường giảm giá. */
  it("số âm về 0 ở cả hai chế độ", () => {
    expect(lineDiscountAmountOf(line({ line_discount: "-500", discount_mode: "amount" }))).toBe(0)
    expect(lineDiscountAmountOf(line({ line_discount: "-5", discount_mode: "percent" }))).toBe(0)
  })

  it("ô trống hoặc rác ra 0, không ra NaN", () => {
    for (const bad of ["", "abc", undefined as unknown as string]) {
      for (const m of ["amount", "percent"] as const) {
        expect(Number.isNaN(lineDiscountAmountOf(line({ line_discount: bad, discount_mode: m })))).toBe(false)
      }
    }
  })

  /** Giá vốn cũng phải theo số tiền đã quy đổi, không theo số gõ. */
  it("giá vốn dùng số tiền giảm đã quy đổi", () => {
    const l = line({
      quantity: "10", unit_price: "1000", line_discount: "10",
      discount_mode: "percent", conversion_factor: "2",
    })
    // tiền hàng 10.000, giảm 10% = 1.000 → còn 9.000, chia 20 đv cơ sở.
    expect(unitCostOf(l)).toBeCloseTo(450, 9)
  })
})

/**
 * TIỀN THUẾ GTGT GÕ TAY (chủ nhà báo: "Tiền thuế GTGT chưa nhập được?").
 *
 * ⚠ Ô TRỐNG KHÁC SỐ 0. Trống = "để máy tự cộng từ thuế suất từng dòng";
 * 0 = "hoá đơn này KHÔNG có thuế". Gộp hai thứ làm một là người dùng
 * không có cách nào khai một hoá đơn thuế 0.
 */
describe("tiền thuế GTGT gõ tay", () => {
  const l = () => line({ quantity: "10", unit_price: "1000", line_discount: "0", vat_percent: "10" })

  it("không gõ gì thì tự cộng từ dòng", () => {
    const t = receiptTotals([l()], "")
    expect(t.vatComputed).toBeCloseTo(1000, 6)
    expect(t.vat).toBeCloseTo(1000, 6)
    expect(t.vatOverridden).toBe(false)
    expect(t.total).toBeCloseTo(11000, 6)
  })

  it("gõ tay thì số gõ tay thắng", () => {
    const t = receiptTotals([l()], "", "1234")
    expect(t.vatComputed).toBeCloseTo(1000, 6)
    expect(t.vat).toBe(1234)
    expect(t.vatOverridden).toBe(true)
    expect(t.total).toBeCloseTo(10000 + 1234, 6)
  })

  it("gõ số 0 nghĩa là hoá đơn KHÔNG có thuế, không phải để trống", () => {
    const t = receiptTotals([l()], "", "0")
    expect(t.vatOverridden, 'gõ "0" đang bị hiểu thành để trống').toBe(true)
    expect(t.vat).toBe(0)
    expect(t.total).toBeCloseTo(10000, 6)
  })

  it("ô trống, null, undefined đều là để máy tự cộng", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(receiptTotals([l()], "", v).vatOverridden, `giá trị ${String(v)}`).toBe(false)
      expect(receiptTotals([l()], "", v).vat).toBeCloseTo(1000, 6)
    }
  })

  /** ⚠ Gõ nhầm số âm là công nợ NCC nhỏ hơn tiền hàng. */
  it("số âm kẹp về 0", () => {
    expect(receiptTotals([l()], "", "-500").vat).toBe(0)
  })

  /** Giảm giá đầu phiếu vẫn trừ SAU thuế, kể cả khi thuế là số gõ tay. */
  it("giảm giá đầu phiếu vẫn trừ sau thuế gõ tay", () => {
    const t = receiptTotals([l()], "2000", "1234")
    expect(t.total).toBeCloseTo(10000 + 1234 - 2000, 6)
  })
})

/**
 * SQL PHẢI TÔN TRỌNG SỐ GÕ TAY.
 *
 * ⚠ SQL LÀ BẢN QUYẾT ĐỊNH — nó ghi vào `payables.amount`. Màn hình hiện
 * số gõ tay mà máy chủ vẫn tự cộng là công nợ lệch đúng bằng phần chênh,
 * và không có chỗ nào kêu.
 */
describe("migration 145 — SQL dùng tiền thuế gõ tay", () => {
  const M145 = stripSql(read("supabase/migrations/145_purchase_receipt_vat_override.sql"))
  const C145 = M145.slice(
    M145.indexOf("CREATE OR REPLACE FUNCTION public.complete_purchase_invoice("),
    M145.indexOf("$$;", M145.indexOf("CREATE OR REPLACE FUNCTION public.complete_purchase_invoice("))
  )

  it("thêm cột vat_override và đọc nó ra", () => {
    expect(M145).toContain("ADD COLUMN IF NOT EXISTS vat_override numeric")
    expect(C145).toContain("vat_override")
  })

  /** ⚠ `IS NOT NULL` chứ không `> 0` — gõ 0 phải đè được về 0. */
  it("NULL thì tự cộng, có giá trị thì đè — kể cả giá trị 0", () => {
    expect(C145).toContain("IF v_vat_ovr IS NOT NULL THEN")
    expect(C145).toContain("v_vat := GREATEST(0, v_vat_ovr)")
    expect(C145, 'đang dùng `> 0` nên gõ 0 không đè được').not.toContain("v_vat_ovr > 0")
  })

  /**
   * ⚠ CHỈ ĐÈ TIỀN THUẾ, KHÔNG ĐÈ TIỀN HÀNG. Cho gõ tay cả `subtotal` là
   * mở đường cho một phiếu mà tổng không bằng tổng các dòng của chính
   * nó — không ai đối chiếu nổi.
   */
  it("tiền hàng vẫn tính từ dòng, không có đường gõ tay", () => {
    expect(C145).toContain("v_sub := v_sub +")
    expect(C145).not.toContain("subtotal_override")
  })

  /** Phép đè phải đứng TRƯỚC khi cộng tổng, nếu không nó vô nghĩa. */
  it("đè thuế xong mới cộng tổng", () => {
    const ovr = C145.indexOf("v_vat := GREATEST(0, v_vat_ovr)")
    const tot = C145.indexOf("v_total := GREATEST(0, v_sub + v_vat - v_discount)")
    expect(ovr).toBeGreaterThan(0)
    expect(tot, "cộng tổng TRƯỚC khi đè thuế — số gõ tay không có tác dụng").toBeGreaterThan(ovr)
  })

  /** ⚠ Thuế suất từng dòng vẫn phải ghi xuống — báo cáo thuế cần nó. */
  it("vẫn ghi thuế suất từng dòng, không xoá đi cho gọn", () => {
    expect(C145).toContain("COALESCE(l.vat_rate, 0)")
  })
})
