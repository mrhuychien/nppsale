import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const MIG = read("supabase/migrations/109_set_all_products_vat_8.sql")
/** Chỉ phần lệnh, bỏ chú thích — chú thích có nhắc cả cách làm SAI. */
const CODE = MIG.replace(/^\s*--.*$/gm, "")

/**
 * Hành vi thật đã dựng lại và đo trên PostgreSQL 16 với 6 dòng trồng sẵn
 * (hai dòng 10%, một dòng 0%, một dòng 5%, một dòng đã đúng 8%, một dòng
 * thuế RỖNG):
 *
 *   lần chạy 1 → đổi 5 dòng, cả 6 dòng về 0.08
 *   lần chạy 2 → đổi 0 dòng, không nổ
 *
 * Bộ test dưới đây giữ những tính chất mà phép đo ấy dựa vào.
 */
describe("Đổi hàng loạt thuế VAT về 8%", () => {
  /**
   * ⚠ CÁI BẪY CHÍNH. `vat_rate <> 0.08` trả về NULL (không phải TRUE) cho
   * dòng có thuế RỖNG, nên dòng đó bị bỏ qua — im lặng, không lỗi, và vẫn
   * rỗng sau khi chạy. Cột này cho phép rỗng (mig 001 chỉ đặt DEFAULT,
   * không NOT NULL) nên đây là ca có thật.
   */
  it("dùng IS DISTINCT FROM, không dùng <>", () => {
    expect(CODE).toContain("vat_rate IS DISTINCT FROM 0.08")
    expect(CODE).not.toMatch(/vat_rate\s*<>\s*0\.08/)
    expect(CODE).not.toMatch(/vat_rate\s*!=\s*0\.08/)
  })

  /**
   * ⚠ Thao tác hàng loạt phải XEM TRƯỚC. Migration không hỏi được người
   * dùng, nên tối thiểu phải IN RA bảng phân bố trước khi đổi — nhìn log
   * là biết vừa động vào bao nhiêu dòng ở mức nào, kể cả dòng 0%.
   */
  it("in ra phân bố thuế TRƯỚC khi đổi", () => {
    const before = CODE.indexOf("Thuế VAT TRƯỚC khi đổi")
    const update = CODE.indexOf("UPDATE products")
    expect(before).toBeGreaterThan(0)
    expect(update).toBeGreaterThan(before)
    expect(CODE).toContain("GROUP BY vat_rate")
  })

  /** Và in ra đã đổi bao nhiêu dòng — không im lặng sau khi ghi. */
  it("nói ra số dòng đã đổi", () => {
    expect(CODE).toContain("GET DIAGNOSTICS")
    expect(CODE).toContain("Đã đổi %")
  })

  /**
   * ⚠ Chạy xong mà vẫn còn dòng khác 8% nghĩa là có thứ gì đó ghi đè
   * (trigger, quy tắc). Phải nổ ngay, chứ không phải phát hiện vào lúc
   * xuất hoá đơn cho khách.
   */
  it("chốt chặn sau khi ghi: không còn dòng nào khác 8%", () => {
    expect(CODE).toContain("RAISE EXCEPTION")
    const guard = CODE.slice(CODE.indexOf("GET DIAGNOSTICS"))
    expect(guard).toContain("IF EXISTS (SELECT 1 FROM products WHERE vat_rate IS DISTINCT FROM 0.08)")
  })

  /**
   * ⚠ CHỈ đụng `products`. Đơn hàng, hoá đơn mua, phiếu trả đều ĐÓNG thuế
   * suất lên từng dòng lúc lập — chứng từ cũ phải giữ con số của ngày
   * lập. Sửa chúng là sửa lại sổ sách đã chốt.
   */
  it("không đụng chứng từ đã lập", () => {
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
  it("chạy lại được, không đổi thêm gì", () => {
    // Điều kiện WHERE loại sẵn dòng đã đúng 8%, nên lần hai không khớp dòng nào.
    expect(CODE).toContain("WHERE vat_rate IS DISTINCT FROM 0.08")
  })

  /** Mig 108 vẫn phải giữ nguyên lập trường của nó — đây là bước RIÊNG. */
  it("mig 108 vẫn không tự đè, việc đè nằm ở 109", () => {
    const m108 = read("supabase/migrations/108_default_vat_8.sql").replace(/^\s*--.*$/gm, "")
    expect(m108).not.toMatch(/UPDATE\s+products/i)
    expect(m108).toContain("ALTER COLUMN vat_rate SET DEFAULT 0.08")
  })
})
