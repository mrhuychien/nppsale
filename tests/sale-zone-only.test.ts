import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * HÀNG KHO CẬN DATE KHÔNG ĐƯỢC BÁN — chủ nhà chốt 20/09/2026.
 *
 * ⚠ TRƯỚC HÔM NAY CÓ BA CÂU TRẢ LỜI cho cùng câu hỏi "hàng nào bán
 * được": màn bán hàng cộng MỌI vùng kho, `get_invoiceable_lines` chỉ
 * vùng 'sale', `post_stock_export` trừ FIFO qua MỌI vùng. Hệ quả chủ nhà
 * đã gặp: nhân viên đặt được số lượng mà màn Xuất hàng báo "Thiếu N đơn
 * vị cơ sở". Bộ chốt này giữ CẢ BA về một câu.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const REF = read("src/lib/sell/ref-data.ts")
const MIG138 = read("supabase/migrations/138_sale_zone_only.sql")
const MIG125 = read("supabase/migrations/125_wf2b_invoice_rpcs.sql")

/**
 * Bỏ chú thích SQL — cho mọi chốt khẳng định một thứ CÓ CHẠY.
 *
 * ⚠ THIẾU BƯỚC NÀY LÀ CHỐT NÓI DỐI. Chính chú thích trong file cũng viết
 * "KHO CẬN DATE" và "INSERT INTO stock_line_consumptions" để giải thích;
 * tìm trên cả file thì xoá hẳn câu lệnh, hoặc biến nó thành chú thích
 * bằng `--`, mà chốt vẫn xanh.
 *
 * Chỉ bỏ dòng chú thích TRỌN VẸN và khối `/* *\/`, không đụng chuỗi.
 */
const sql = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

const M138 = sql(MIG138)

describe("màn bán hàng chỉ đếm kho bán", () => {
  it("câu đọc lô hàng lọc đúng vùng", () => {
    expect(REF).toContain('.gt("qty_on_hand", 0).eq("warehouse_zone", "sale")')
  })

  /** Chia trang vẫn phải có mốc — thêm bộ lọc không được làm mất `.order`. */
  it("vẫn giữ mốc chia trang", () => {
    expect(REF).toContain('.eq("warehouse_zone", "sale").order("id").range(from, to)')
  })
})

describe("bản vá 138 — trừ kho chỉ lấy vùng bán", () => {
  /**
   * ⚠ HAI CÂU ĐỌC `batches`, KHÔNG PHẢI MỘT. Một câu đo lô cận hạn nhất
   * (để đếm `near_expiry_skipped`), một câu là vòng FIFO trừ kho. Lọc
   * mỗi vòng FIFO thì con số "bỏ qua lô cận hạn" đo trên một tập khác
   * với tập thật sự lấy hàng.
   */
  it("cả hai câu đọc lô đều lọc vùng bán", () => {
    const n = (M138.match(/COALESCE\(warehouse_zone, 'sale'\) = 'sale'/g) ?? []).length
    expect(n, "phải lọc ở cả câu đo hạn lẫn vòng FIFO").toBe(2)
  })

  /**
   * ⚠ BÁO THIẾU PHẢI NÓI RÕ HÀNG ĐANG Ở KHO CẬN DATE. Không có vế này
   * thì người dùng đọc "thiếu 20 đơn vị" trong khi màn tồn kho hiện
   * rành rành 200 — và họ đi đếm lại kho thay vì đi chuyển vùng lô hàng,
   * việc duy nhất gỡ được.
   */
  it("báo thiếu nói rõ lý do và cách gỡ", () => {
    expect(M138, "câu báo nằm trong chú thích chứ không phải trong hàm").toContain("KHO CẬN DATE")
    expect(M138).toContain("Chuyển vùng lô hàng nếu muốn bán")
    expect(M138).toContain("= 'date'")
  })

  /** ⚠ `COALESCE`, không so thẳng: lô cũ có thể còn `warehouse_zone` rỗng. */
  it("lô chưa gắn vùng vẫn coi là kho bán", () => {
    expect(M138).not.toMatch(/\bwarehouse_zone = 'sale'/)
  })

  /** Luật chung của kho này. */
  it("chạy lại được và nạp lại schema", () => {
    expect(M138).toContain("CREATE OR REPLACE FUNCTION post_stock_export")
    expect(M138).toContain("RAISE NOTICE")
    expect(MIG138.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /**
   * ⚠ KHÔNG ĐỔI PHẦN CÒN LẠI CỦA HÀM. Bản vá chỉ thêm bộ lọc vùng; công
   * tắc `allow_oversell`, ghi `stock_line_consumptions` và cách đếm lô
   * cận hạn phải y nguyên bản 119.
   */
  it("giữ nguyên các chốt cũ của hàm", () => {
    for (const needle of [
      "v_allow_oversell",
      "INSERT INTO stock_line_consumptions",
      "ORDER BY received_at ASC, created_at ASC, id ASC",
      "FOR UPDATE",
    ]) {
      expect(M138, `mất ${needle}`).toContain(needle)
    }
  })
})

describe("màn Xuất hàng vốn đã đúng — đừng nới ra", () => {
  /**
   * `get_invoiceable_lines` lọc vùng 'sale' từ mig 125. Đó là chỗ DUY
   * NHẤT trong ba chỗ từng đúng; nới nó ra để "cho khớp" là đi ngược
   * chốt của chủ nhà.
   */
  it("get_invoiceable_lines vẫn chỉ đếm kho bán", () => {
    const n = (sql(MIG125).match(/b\.warehouse_zone = 'sale'/g) ?? []).length
    expect(n, "cả dòng bán lẫn dòng hàng đổi").toBe(2)
  })
})
