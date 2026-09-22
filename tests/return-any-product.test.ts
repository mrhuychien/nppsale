import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * KHÁCH TRẢ ĐƯỢC MỌI MẶT HÀNG, KỂ CẢ MÓN CHƯA TỪNG XUẤT.
 *
 * ⚠ BỘ CHỐT NÀY THAY BỘ CHỐT CỦA `returnsBrokenBy`, và nó canh chiều
 * NGƯỢC LẠI. Trước 22/09/2026 luật là "khách chỉ trả được thứ đã thực
 * xuất, hóa đơn là trần"; chủ nhà bỏ luật ấy, nguyên văn:
 *
 *     "Bỏ logic này đi, khách hàng được trả mọi loại mặt hàng dù chưa
 *      từng xuất. Vì phần mềm triển khai ngang xương, hàng người ta
 *      nhập từ trước đấy rồi có vào phần mềm đâu."
 *
 * Lý do rất cụ thể: nhà phân phối bật phần mềm giữa chừng, nên hàng
 * khách mua từ trước không có dòng nào trong `sales_invoice_lines`.
 * Với những món ấy `v_sold` luôn bằng 0 và MỌI phiếu trả đều bị từ
 * chối — luật đúng trên một sổ đầy đủ, sai trên sổ thật của họ.
 *
 * ⚠ BỐN CHỖ CHẶN, VÀ BỎ THIẾU MỘT CHỖ LÀ DỜI TƯỜNG CHỨ KHÔNG PHÁ. Đó
 * là điều bộ chốt này canh: người dùng lưu được hóa đơn rồi vấp đúng
 * câu từ chối ấy ở bước sau thì tệ hơn là bị chặn ngay từ đầu.
 *
 * Đã kiểm trên Postgres 16 thật, đổi đúng MỘT biến (có/không có
 * migration 158):
 *   · không có 158 → chèn dòng trả mã chưa từng bán bị ném
 *     `RETURN_QTY_EXCEEDS: … đã giao 0`; sửa hóa đơn bỏ món đang có
 *     phiếu trả bị ném `REISSUE_BREAKS_RETURN`;
 *   · có 158 → cả hai đi qua, tồn mã ấy +3 (hàm tự tạo lô vì mã chưa
 *     từng có lô nào), công nợ giảm đúng 120.000.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")
const doc = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

/** Bản MỚI NHẤT của một hàm SQL — `CREATE OR REPLACE` sau đè trước. */
function banMoiNhat(fn: string): { ten: string; sql: string } {
  let ten = ""
  let sql = ""
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const s = readFileSync(resolve(DIR, f), "utf-8")
    const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
    if (i < 0) continue
    ten = f
    sql = s.slice(i, s.indexOf("\n$$;", i))
  }
  return { ten, sql }
}

describe("chỗ chặn 1 — trigger lúc chèn dòng phiếu trả", () => {
  /**
   * ⚠ TRIGGER PHẢI BỊ GỠ HẲN, KHÔNG PHẢI ĐƯỢC NỚI. Một trigger còn sống
   * mà "tạm thời cho qua" là chỗ để ai đó siết lại bằng một dòng.
   */
  it("migration gỡ cả trigger lẫn hàm của nó", () => {
    const sql = doc("supabase/migrations/158_return_any_product.sql")
    expect(sql, "không gỡ trigger chèn dòng")
      .toMatch(/DROP TRIGGER IF EXISTS trg_return_lines_cap ON return_lines/)
    expect(sql, "gỡ trigger nhưng để lại hàm")
      .toMatch(/DROP FUNCTION IF EXISTS public\.enforce_return_line_cap\(\)/)
  })

  /**
   * ⚠ VÀ KHÔNG MIGRATION NÀO SAU ĐÓ DỰNG LẠI NÓ. Chốt đọc TOÀN BỘ thư
   * mục theo thứ tự: tệp cuối cùng nhắc tới trigger này phải là tệp gỡ
   * nó đi, không phải một tệp tạo lại.
   */
  it("không migration nào sau 158 dựng lại trigger", () => {
    let cuoi = ""
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
      if (/CREATE TRIGGER trg_return_lines_cap/.test(readFileSync(resolve(DIR, f), "utf-8"))) {
        cuoi = f
      }
    }
    expect(
      Number(cuoi.slice(0, 3) || 0),
      `trigger trần trả hàng được dựng lại ở ${cuoi}`
    ).toBeLessThan(158)
  })
})

describe("chỗ chặn 2 — complete_return", () => {
  const BAN = banMoiNhat("complete_return")
  const CODE = boChuThich(BAN.sql)

  /** ⚠ Chốt mù là chốt nói dối — không đọc được hàm thì mọi phép dưới xanh. */
  it("đọc được bản đang chạy, và nó mới hơn 127", () => {
    expect(BAN.sql.length, "không đọc được thân hàm").toBeGreaterThan(1000)
    expect(Number(BAN.ten.slice(0, 3)), "bản mới nhất vẫn là bản cũ").toBeGreaterThan(127)
  })

  /**
   * ⚠ KHÔNG CÒN PHÉP SO VỚI SỐ ĐÃ XUẤT. Đây là chỗ chặn thứ hai: gỡ
   * trigger mà quên chỗ này thì người dùng thêm được dòng trả nhưng
   * không hoàn thành nổi phiếu — bức tường chỉ lùi lại một bước.
   */
  it("không còn ném RETURN_QTY_EXCEEDS", () => {
    expect(/RETURN_QTY_EXCEEDS/.test(CODE), "trần trả hàng quay lại lúc hoàn thành phiếu")
      .toBe(false)
  })

  /**
   * ⚠ NHƯNG PHẦN NHẬP KHO VÀ TRỪ CÔNG NỢ PHẢI CÒN NGUYÊN. Bản vá chép
   * nguyên văn hàm 256 dòng rồi cắt đúng một khối; lấy nhầm một bản cũ
   * hơn là mất những thứ này mà không có gì báo.
   */
  it("vẫn nhập kho và vẫn trừ công nợ", () => {
    expect(CODE, "mất phép cộng tồn kho").toMatch(/qty_on_hand\s*=\s*qty_on_hand\s*\+/)
    expect(CODE, "mất nhánh tự tạo lô cho mã chưa từng có lô").toMatch(/INSERT INTO batches/)
    expect(CODE, "mất phép ghi phiếu nhập").toMatch(/INSERT INTO stock_entries/)
    /* ⚠ CÔNG NỢ TÍNH LẠI QUA HAI HÀM PHỤ, không `UPDATE receivables`
       thẳng ở đây — và phải còn ĐỦ HAI NHÁNH: phiếu gắn hóa đơn đi
       đường `_wf2b_`, phiếu chỉ gắn đơn đi đường `_wf2_`. Mất một
       nhánh là một loại phiếu trả không trừ nợ cho khách. */
    expect(CODE, "mất nhánh trừ nợ theo hóa đơn")
      .toMatch(/_wf2b_recompute_receivable\(r\.invoice_id\)/)
    expect(CODE, "mất nhánh trừ nợ theo đơn")
      .toMatch(/_wf2_recompute_receivable\(r\.order_id\)/)
  })

  /**
   * ⚠ HAI PHÉP KIỂM KHÁC PHẢI Ở LẠI. Chúng không phải luật vừa bỏ:
   * chúng nói "chứng từ gốc chưa ghi sổ", không nói "món này chưa từng
   * xuất". Gỡ luôn là cho phép nhập trả từ một hóa đơn còn nháp.
   */
  it("vẫn chặn phiếu trả gắn vào chứng từ chưa ghi sổ", () => {
    expect(CODE, "mất phép chặn hóa đơn chưa ghi sổ").toMatch(/INVOICE_NOT_POSTED/)
    expect(CODE, "mất phép chặn đơn chưa xuất hàng").toMatch(/ORDER_NOT_COMPLETED/)
  })
})

describe("chỗ chặn 3 — reissue_invoice", () => {
  const BAN = banMoiNhat("reissue_invoice")
  const CODE = boChuThich(BAN.sql)

  it("đọc được bản đang chạy, và nó mới hơn 152", () => {
    expect(BAN.sql.length, "không đọc được thân hàm").toBeGreaterThan(1000)
    expect(Number(BAN.ten.slice(0, 3)), "bản mới nhất vẫn là bản cũ").toBeGreaterThan(152)
  })

  /** ⚠ Chính câu lỗi chủ nhà gặp trên màn sửa hóa đơn. */
  it("không còn ném REISSUE_BREAKS_RETURN", () => {
    expect(/REISSUE_BREAKS_RETURN/.test(CODE), "phép chặn sửa hóa đơn quay lại").toBe(false)
  })

  /**
   * ⚠ VÀ PHẦN CÒN LẠI CỦA HÀM PHẢI NGUYÊN: nó giữ số hóa đơn, gỡ phiếu
   * trả khỏi tờ cũ, rồi lập lại tờ mới. Chép nhầm bản cũ hơn là mất
   * những thứ ấy.
   */
  it("vẫn giữ phần lập lại hóa đơn", () => {
    expect(CODE, "mất phép gỡ phiếu trả khỏi tờ cũ").toMatch(/UPDATE returns SET invoice_id/)
    expect(CODE, "mất phép dựng lại tờ hóa đơn").toMatch(/post_invoice|INSERT INTO sales_invoices/)
  })
})

describe("chỗ chặn 4 — phía trình duyệt", () => {
  /**
   * ⚠ PHÉP CHẶN Ở TRÌNH DUYỆT PHẢI BIẾN MẤT HẲN, cả hàm lẫn chỗ gọi.
   * Đây là chỗ in ra đúng câu chủ nhà chụp màn hình gửi sang.
   */
  it("không còn hàm returnsBrokenBy ở bất kỳ đâu", () => {
    const pham: string[] = []
    for (const rel of [
      "src/lib/orders/invoice-editor.ts",
      "src/components/orders/invoice-editor.tsx",
    ]) {
      if (/returnsBrokenBy/.test(doc(rel))) pham.push(rel)
    }
    expect(pham, "phép chặn ở trình duyệt quay lại").toEqual([])
  })

  /**
   * ⚠ VÀ NÚT LƯU KHÔNG CÒN BỊ KHOÁ VÌ PHIẾU TRẢ. Gỡ câu cảnh báo mà
   * quên mở khoá nút là màn hình im lặng còn nút thì vẫn chết — kiểu
   * hỏng tệ nhất, vì không có gì để đọc mà lần ra.
   */
  it("nút lưu không còn khoá vì xung đột phiếu trả", () => {
    const src = boChuThich(doc("src/components/orders/invoice-editor.tsx"))
    expect(/returnConflicts/.test(src), "nút lưu còn soi xung đột phiếu trả").toBe(false)
    const i = src.indexOf("disabled={saving || picked.length === 0")
    expect(i, "không tìm thấy nút lưu để kiểm").toBeGreaterThan(-1)
  })

  /**
   * ⚠ VÀ KHÔNG CÒN CÂU CHỮ NÀO NÓI LUẬT CŨ. Một đoạn hướng dẫn mô tả
   * một luật đã bỏ còn tệ hơn không có hướng dẫn: người dùng đi làm
   * theo rồi không hiểu vì sao phần mềm không cư xử như nó nói.
   */
  it("màn sửa hóa đơn không còn câu 'chỉ trả được hàng đã thực xuất'", () => {
    const src = doc("src/components/orders/invoice-editor.tsx")
    expect(src, "màn còn dạy người dùng một luật đã bỏ")
      .not.toMatch(/chỉ trả được hàng đã thực xuất/)
  })
})

describe("vệ sinh migration", () => {
  const SQL = doc("supabase/migrations/158_return_any_product.sql")

  /** ⚠ PostgREST giữ bản đồ schema trong bộ nhớ — không gọi là RPC cũ còn chạy. */
  it("kết thúc bằng NOTIFY pgrst", () => {
    expect(SQL.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /** ⚠ Chạy lại lần hai không được nổ. */
  it("idempotent — DROP … IF EXISTS và CREATE OR REPLACE", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_return/)
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.reissue_invoice/)
    expect(/DROP (TRIGGER|FUNCTION)(?! IF EXISTS)/.test(SQL), "có DROP trần — chạy lại là nổ")
      .toBe(false)
  })

  /**
   * ⚠ HEADER PHẢI NÓI MẤT GÌ, không chỉ nói bỏ gì. Bỏ trần là bỏ luôn
   * phép chặn hai phiếu trả trùng nhau của cùng một hóa đơn — người đọc
   * sổ sau này phải biết con số nào không còn ai đối chiếu.
   */
  it("header nói rõ nguyên nhân và cái giá phải trả", () => {
    const h = SQL.slice(0, SQL.indexOf("DROP TRIGGER"))
    expect(h, "header không dẫn lời chủ nhà").toContain("chưa từng xuất")
    expect(h, "header không nói mất gì khi gỡ").toMatch(/MẤT GÌ|hai lần/)
    expect(h.length, "header quá ngắn để giải thích vì sao").toBeGreaterThan(1500)
  })
})
