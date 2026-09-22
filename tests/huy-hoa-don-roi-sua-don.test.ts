import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * HUỶ HÓA ĐƠN RỒI THÌ SỬA ĐƠN ĐƯỢC.
 *
 * Chủ nhà báo 22/09/2026, kèm ảnh chụp:
 *   "Không bỏ được mặt hàng … khỏi đơn: nó đã từng nằm trên một tờ hóa
 *    đơn của đơn này, và tờ ấy vẫn còn trong sổ (kể cả khi đã huỷ)."
 * kèm câu hỏi: "ko hiểu đưa logic này vào làm gì?"
 *
 * ⚠ KHÔNG AI ĐƯA LOGIC ẤY VÀO. Câu tiếng Việt trên là bản DỊCH của một
 *   lời từ chối thật từ cơ sở dữ liệu — khoá ngoại
 *   `sales_invoice_lines_order_line_id_fkey`, mã 23503. Chỗ sai nằm ở
 *   chính cái khoá, không ở câu dịch.
 *
 * Đã dựng lại trên Postgres 16 thật (đơn 2 dòng → `post_invoice` →
 * `cancel_invoice` → xoá 1 dòng đơn):
 *   · không có 162 → `invoiced_qty` = 0/0, nhưng 2 dòng hóa đơn VẪN trỏ
 *     vào dòng đơn, và lệnh xoá bị ném 23503;
 *   · có 162      → 0 dòng còn trỏ, xoá được;
 *   · hóa đơn POSTED thì VẪN chặn (hàng đã rời kho);
 *   · xuất lại hóa đơn vẫn gắn đúng dòng đơn, tờ cũ đã huỷ vẫn đọc đủ
 *     dòng lẫn tiền;
 *   · phiếu trả kèm đơn vẫn chỉ bị GỠ liên kết chứ không bị huỷ — tức
 *     miếng vá của mig 131 còn sống.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chốt không được khớp phải chính câu giải thích. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

const TEP = "supabase/migrations/162_huy_hoa_don_roi_sua_don_duoc.sql"
const MIG = boChuThich(read(TEP))

describe("migration 162 — nhả móc nối khi huỷ hóa đơn", () => {
  /**
   * ⚠ VÁ CHUỖI, KHÔNG CHÉP LẠI CẢ HÀM — và đây là một lỗi TÔI ĐÃ SUÝT
   *   GÂY RA. Bản đầu của mig 162 chép nguyên thân `cancel_invoice` từ
   *   mig 125, tức bản có TRƯỚC khi mig 131 vá chuỗi chính hàm ấy. Chốt
   *   `migration-khong-de-mat-mieng-va` bắt được: chép từ 125 là âm thầm
   *   xoá miếng vá của 131, và phiếu trả kèm đơn lại bị huỷ oan.
   */
  it("vá bằng cách thay câu, KHÔNG viết lại cả hàm", () => {
    expect(MIG, "không còn đọc thân hàm đang chạy để vá")
      .toContain("pg_get_functiondef")
    expect(MIG, "lại chép nguyên cả hàm — sẽ xoá miếng vá của mig 131")
      .not.toMatch(/CREATE OR REPLACE FUNCTION public\.cancel_invoice/)
  })

  it("chèn đúng câu nhả móc nối, và chỉ cho tờ ĐANG huỷ", () => {
    const i = MIG.indexOf("v_new :=")
    expect(i, "migration không dựng câu vá nào").toBeGreaterThan(-1)
    const khoi = MIG.slice(i, MIG.indexOf("EXECUTE replace", i))
    expect(khoi, "không nhả móc nối").toContain("SET order_line_id = NULL")
    /* ⚠ Chỉ tờ vừa huỷ. Thiếu vế này là nhả móc nối của MỌI hóa đơn. */
    expect(khoi, "nhả móc nối của cả những hóa đơn khác")
      .toContain("WHERE invoice_id = p_invoice_id")
  })

  /**
   * ⚠ CHẠY LẠI ĐƯỢC MÀ KHÔNG ĐỔI GÌ, và phải DỪNG khi hình dạng lạ.
   *   Vá chuỗi vào một thân hàm không còn hình dạng cũ là thay nhầm chỗ
   *   giữa một hàm 150 dòng đụng kho và công nợ.
   */
  it("idempotent, và dừng lại khi thân hàm không còn hình dạng cũ", () => {
    expect(MIG, "chạy lần hai là vá chồng lên nhau")
      .toMatch(/IF position\('SET order_line_id = NULL' in v_src\) > 0 THEN/)
    expect(MIG, "không kiểm số câu khớp — có thể thay nhầm chỗ")
      .toMatch(/IF v_n <> 1 THEN/)
    /* ⚠ In ra thân hàm hiện tại khi hình dạng lạ — bài học mig 126. */
    expect(MIG, "báo hình dạng lạ mà không in ra hình dạng hiện tại")
      .toContain("Thân hàm hiện tại:")
  })

  /**
   * ⚠ CHỈ ĐỘNG VÀO TỜ ĐÃ HUỶ. Hóa đơn `posted` giữ nguyên con trỏ — đó
   *   là thứ nuôi `invoiced_qty`, và là thứ chặn việc bỏ một dòng ĐÃ
   *   GIAO khỏi đơn. Vá rộng ra là mở một lỗ to hơn lỗ đang sửa.
   */
  it("khối vá dữ liệu cũ chỉ chạm hóa đơn đã huỷ", () => {
    const i = MIG.indexOf("UPDATE sales_invoice_lines sil")
    expect(i, "không có khối vá cho các tờ đã huỷ từ trước").toBeGreaterThan(-1)
    const khoi = MIG.slice(i, MIG.indexOf(";", i))
    expect(khoi, "vá cả hóa đơn còn hiệu lực").toContain("si.status = 'cancelled'")
    expect(khoi, "không nói ra đã nhả bao nhiêu dòng")
    expect(MIG, "không đếm và nói ra số dòng đã nhả").toContain("ROW_COUNT")
  })

  /**
   * ⚠ KHÔNG ĐỔI KHOÁ NGOẠI. `ON DELETE SET NULL` sẽ mở luôn cả ca hóa
   *   đơn `posted` — bỏ được một dòng đã giao thật mà không ai chặn.
   */
  it("không đụng tới khoá ngoại", () => {
    expect(MIG, "đổi khoá ngoại — mở luôn cả ca hóa đơn còn hiệu lực")
      .not.toMatch(/ON DELETE SET NULL/i)
    expect(MIG).not.toMatch(/DROP CONSTRAINT[^\n]*order_line_id/i)
  })

  /**
   * ⚠ TỰ KIỂM PHẢI SOI CẢ MIẾNG VÁ CỦA MIG 131. Hai miếng vá nằm trên
   *   CÙNG một hàm và không miếng nào đọc thẳng ra từ tệp được; mất
   *   miếng của 131 thì không có gì đỏ lên, chỉ có phiếu trả bị huỷ oan.
   */
  it("tự kiểm cả hai miếng vá còn sống trong hàm đang chạy", () => {
    const i = MIG.indexOf("$kiem$")
    expect(i, "migration không tự kiểm lại sau khi vá").toBeGreaterThan(-1)
    const khoi = MIG.slice(i)
    expect(khoi, "không kiểm miếng vá của chính mình").toContain("SET order_line_id = NULL")
    expect(khoi, "không kiểm miếng vá của mig 131").toContain("SET invoice_id = NULL")
    expect(khoi, "kiểm xong không ném khi thiếu").toContain("RAISE EXCEPTION")
  })

  it("kết thúc bằng NOTIFY pgrst", () => {
    expect(read(TEP).trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

describe("câu báo lỗi ở màn sửa đơn vẫn đúng cho ca CÒN chặn", () => {
  /**
   * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI SOI. Chính tệp ấy có một khối chú thích kể
   *   lại câu CŨ để giải thích vì sao đã đổi — soi cả chú thích là chốt
   *   đọc phải lời văn của chính nó rồi báo đỏ oan. Đúng cái bẫy
   *   `migration-khong-de-mat-mieng-va` đã ghi lại một lần.
   */
  const SUA = readFileSync(resolve(ROOT, "src/lib/sell/order-edit.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  /**
   * ⚠ CÂU NÀY KHÔNG BỎ ĐI ĐƯỢC. Sau mig 162, hóa đơn `posted` VẪN chặn
   *   — và đó là đúng. Người dùng vẫn cần đọc được mình vừa vấp cái gì.
   *
   * ⚠ NHƯNG NÓ ĐANG NÓI SAI MỘT VẾ. Câu cũ ghi "kể cả khi đã huỷ", mà
   *   từ mig 162 thì huỷ rồi là bỏ được. Để nguyên là màn hình dạy người
   *   dùng một luật không còn đúng.
   */
  it("vẫn dịch mã 23503 thành câu người đọc được", () => {
    expect(SUA, "bỏ mất bản dịch — người dùng lại nhận một câu tiếng Anh")
      .toContain('"23503"')
    expect(SUA).toContain("Không bỏ được")
  })

  it("thôi nói 'kể cả khi đã huỷ' — câu ấy hết đúng từ mig 162", () => {
    expect(SUA, "màn hình vẫn dạy một luật đã đổi").not.toContain("kể cả khi đã huỷ")
    /* Và phải nói ra luật MỚI: còn hiệu lực thì mới chặn. */
    expect(SUA, "không nói ra vì sao còn bị chặn").toMatch(/còn hiệu lực|chưa huỷ/i)
  })
})
