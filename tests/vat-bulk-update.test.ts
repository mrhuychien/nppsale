import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) => s.replace(/^\s*--.*$/gm, "")

/**
 * Hai migration đổi hàng loạt, cùng khuôn mẫu, khác con số đích:
 *   109 → 8%  (chủ NPP chốt lần đầu)
 *   111 → 0%  (chốt lại: hàng ở đây xuất không kèm VAT)
 *
 * Giữ cả hai, không sửa 109: migration là LỊCH SỬ, và máy nào đã chạy 109
 * rồi thì sửa file cũ chỉ tạo lệch trạng thái.
 */
const BULK = [
  { ten: "109 (→ 8%)", dich: "0.08", sql: read("supabase/migrations/109_set_all_products_vat_8.sql") },
  { ten: "111 (→ 0%)", dich: "0", sql: read("supabase/migrations/111_set_all_products_vat_0.sql") },
].map((m) => ({ ...m, code: strip(m.sql) }))

/**
 * Hành vi thật đã dựng lại và đo trên PostgreSQL 16, chạy đúng thứ tự
 * 108 → 109 → 110 → 111 trên 4 dòng trồng sẵn (10%, 5%, 0%, và một dòng
 * thuế RỖNG):
 *
 *   109 → đổi 4 dòng về 0.08
 *   111 → đổi 4 dòng về 0
 *   cuối cùng: cả 4 dòng = 0, mặc định cột = 0, hàng mới tạo ra = 0
 *
 * Dòng thuế RỖNG có được bắt — đó là điểm cả hai migration dễ trượt nhất.
 * Bộ test dưới đây giữ những tính chất mà phép đo ấy dựa vào.
 */
describe("Đổi hàng loạt thuế VAT", () => {
  /**
   * ⚠ CÁI BẪY CHÍNH. `vat_rate <> <đích>` trả về NULL (không phải TRUE) cho
   * dòng có thuế RỖNG, nên dòng đó bị bỏ qua — im lặng, không lỗi, và vẫn
   * rỗng sau khi chạy. Cột này cho phép rỗng (mig 001 chỉ đặt DEFAULT,
   * không NOT NULL) nên đây là ca có thật.
   */
  it.each(BULK)("$ten dùng IS DISTINCT FROM, không dùng <>", ({ code, dich }) => {
    expect(code).toContain(`vat_rate IS DISTINCT FROM ${dich}`)
    expect(code).not.toMatch(/vat_rate\s*<>\s*[\d.]/)
    expect(code).not.toMatch(/vat_rate\s*!=\s*[\d.]/)
  })

  /**
   * ⚠ Thao tác hàng loạt phải XEM TRƯỚC. Migration không hỏi được người
   * dùng, nên tối thiểu phải IN RA bảng phân bố trước khi đổi — nhìn log
   * là biết vừa động vào bao nhiêu dòng ở mức nào, kể cả dòng 0%.
   */
  it.each(BULK)("$ten in ra phân bố thuế TRƯỚC khi đổi", ({ code }) => {
    const before = code.indexOf("Thuế VAT TRƯỚC khi đổi")
    const update = code.indexOf("UPDATE products")
    expect(before).toBeGreaterThan(0)
    expect(update).toBeGreaterThan(before)
    expect(code).toContain("GROUP BY vat_rate")
  })

  /** Và in ra đã đổi bao nhiêu dòng — không im lặng sau khi ghi. */
  it.each(BULK)("$ten nói ra số dòng đã đổi", ({ code }) => {
    expect(code).toContain("GET DIAGNOSTICS")
    expect(code).toContain("Đã đổi %")
  })

  /**
   * ⚠ Chạy xong mà vẫn còn dòng lệch nghĩa là có thứ gì đó ghi đè
   * (trigger, quy tắc). Phải nổ ngay, chứ không phải phát hiện vào lúc
   * xuất hoá đơn cho khách.
   */
  it.each(BULK)("$ten chốt chặn sau khi ghi: không còn dòng nào lệch", ({ code, dich }) => {
    expect(code).toContain("RAISE EXCEPTION")
    const guard = code.slice(code.indexOf("GET DIAGNOSTICS"))
    expect(guard).toContain(`IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM ${dich})`)
  })

  /**
   * ⚠ CHỈ đụng `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG thuế
   * suất lên từng dòng lúc lập — chứng từ cũ phải giữ con số của ngày
   * lập. Sửa chúng là sửa lại sổ sách đã chốt.
   */
  it.each(BULK)("$ten không đụng chứng từ đã lập", ({ code: CODE }) => {
    for (const t of [
      "sales_order_lines",
      "purchase_order_lines",
      "purchase_invoice_lines",
      "return_lines",
      "supplier_return_lines",
    ]) {
      expect(CODE, `không được UPDATE ${t}`).not.toContain(t)
    }
    // Đúng một câu UPDATE trong cả migration.
    expect((CODE.match(/UPDATE\s+/gi) ?? []).length).toBe(1)
  })

  /** Chạy lại lần hai phải đổi 0 dòng và không nổ. */
  it.each(BULK)("$ten chạy lại được, không đổi thêm gì", ({ code, dich }) => {
    // Điều kiện WHERE loại sẵn dòng đã đúng đích, nên lần hai không khớp dòng nào.
    expect(code).toContain(`WHERE vat_rate IS DISTINCT FROM ${dich}`)
  })

  /** Mig 108 vẫn phải giữ nguyên lập trường của nó — đây là bước RIÊNG. */
  it("mig 108 vẫn không tự đè, việc đè nằm ở 109", () => {
    const m108 = read("supabase/migrations/108_default_vat_8.sql").replace(/^\s*--.*$/gm, "")
    expect(m108).not.toMatch(/UPDATE\s+products/i)
    expect(m108).toContain("ALTER COLUMN vat_rate SET DEFAULT 0.08")
  })
})
