import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * `UPDATE … FROM` CỘNG DỒN PHẢI GOM TRƯỚC.
 *
 * ⚠ CHUYỆN VỪA XẢY RA. `cancel_supplier_return` (migration 143) cộng
 * hàng về kho bằng:
 *
 *     UPDATE batches b
 *     SET qty_on_hand = b.qty_on_hand + sel.qty_in_base_uom
 *     FROM stock_entry_lines sel
 *     WHERE sel.entry_id = v_entry AND b.id = sel.batch_id;
 *
 * Postgres chỉ dùng MỘT dòng nguồn khi `UPDATE … FROM` khớp cùng một
 * dòng đích nhiều lần; những dòng còn lại bị bỏ IM LẶNG. Một phiếu trả
 * lấy 10 rồi lấy thêm 5 từ CÙNG một lô, huỷ xong kho chỉ nhận lại 10.
 * Năm đơn vị biến mất, không lỗi, không cảnh báo, không nhật ký.
 *
 * ⚠ KHÔNG CÓ GÌ TRONG KHO MÃ NÀY BẮT ĐƯỢC NÓ. `tsc` không đọc SQL, chốt
 * cấu trúc chỉ soi chuỗi của đúng migration mình đang viết, và bản thân
 * câu SQL thì hợp lệ hoàn toàn — nó chạy, chỉ là chạy sai. Tệp này là
 * bản TỔNG QUÁT: quét MỌI hàm đang chạy, không chỉ hàm vừa sửa.
 *
 * ⚠ CHỈ SOI BẢN ĐANG CHẠY CỦA TỪNG HÀM. Một hàm được `CREATE OR REPLACE`
 * nhiều lần qua nhiều migration; bản có hiệu lực là bản ở migration số
 * LỚN NHẤT. Soi cả lịch sử là chốt đỏ vĩnh viễn vì migration 143 — một
 * tệp đã chạy xong và không được sửa lại — trong khi thứ thật sự chạy
 * trên máy chủ đã đúng từ 147.
 */

const ROOT = resolve(__dirname, "..")
const DIR = resolve(ROOT, "supabase/migrations")

/** Bỏ dòng chú thích SQL — chữ trong chú thích không phải là câu lệnh. */
const stripSql = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

interface LiveFn {
  file: string
  name: string
  body: string
}

/**
 * Bản ĐANG CHẠY của mỗi hàm: lần `CREATE OR REPLACE FUNCTION` cuối cùng
 * theo thứ tự số migration.
 */
const LIVE: LiveFn[] = (() => {
  const byName = new Map<string, LiveFn>()
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql")).sort()) {
    const src = stripSql(readFileSync(join(DIR, f), "utf-8"))
    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const open = src.indexOf("$$", m.index + m[0].length)
      if (open === -1) continue
      const close = src.indexOf("$$", open + 2)
      if (close === -1) continue
      byName.set(m[1], { file: f, name: m[1], body: src.slice(open, close) })
    }
  }
  return Array.from(byName.values())
})()

/**
 * Câu `UPDATE t a SET c = a.c + b.c …` — CỘNG DỒN vào chính cột đang
 * sửa, lấy số từ một bảng khác.
 *
 * ⚠ CHỈ BẮT PHÉP CỘNG DỒN, KHÔNG BẮT PHÉP GÁN. `SET qty_on_hand = 0`
 * khớp nhiều dòng nguồn vẫn ra đúng một kết quả — `cancel_purchase_invoice`
 * (migration 142) làm đúng như vậy và hoàn toàn lành.
 */
const ACC = /SET\s+(\w+)\s*=\s*\w+\.\1\s*\+\s*(\w+)\.\w+/g

interface Acc {
  fn: LiveFn
  stmt: string
  grouped: boolean
}

const ACCUMULATORS: Acc[] = (() => {
  const out: Acc[] = []
  for (const fn of LIVE) {
    for (const m of Array.from(fn.body.matchAll(ACC))) {
      const at = m.index ?? 0
      const start = fn.body.lastIndexOf("UPDATE", at)
      const end = fn.body.indexOf(";", at)
      if (start === -1 || end === -1) continue
      const stmt = fn.body.slice(start, end)
      if (!/\bFROM\b/.test(stmt)) continue
      /**
       * Nguồn đã gom chưa? Hoặc `GROUP BY` nằm ngay trong câu (truy vấn
       * con), hoặc nằm trong khối `WITH` đứng trước nó.
       */
      const before = fn.body.slice(Math.max(0, start - 800), start)
      const w = before.lastIndexOf("WITH ")
      const grouped =
        /GROUP\s+BY/.test(stmt) || (w !== -1 && /GROUP\s+BY/.test(before.slice(w)))
      out.push({ fn, stmt, grouped })
    }
  }
  return out
})()

// =====================================================================

describe("UPDATE … FROM cộng dồn phải gom nguồn trước", () => {
  /**
   * ⚠ KHÔNG QUÉT RA GÌ THÌ CHỐT DƯỚI XANH VÌ RỖNG, KHÔNG VÌ ĐÚNG. Phép
   * cắt thân hàm bám vào `$$`; đổi kiểu đánh dấu thân hàm là cả tệp này
   * im lặng không canh gì nữa.
   */
  it("quét được thân hàm đang chạy", () => {
    expect(LIVE.length, "không cắt ra thân hàm nào — phép quét hỏng").toBeGreaterThan(50)
    expect(
      LIVE.some((f) => f.name === "cancel_supplier_return"),
      "không thấy cancel_supplier_return — đúng hàm đã hỏng"
    ).toBe(true)
  })

  /** ⚠ Bản đang chạy phải là bản ĐÃ SỬA, không phải bản của 143. */
  it("bản đang chạy của cancel_supplier_return là bản đã gom", () => {
    const fn = LIVE.find((f) => f.name === "cancel_supplier_return")!
    expect(fn.file).toBe("147_cancel_supplier_return_sum_by_batch.sql")
    expect(fn.body).toContain("SUM(sel.qty_in_base_uom)")
    expect(fn.body).toContain("GROUP BY sel.batch_id")
    expect(
      fn.body,
      "vẫn còn câu cộng trả thẳng từ stock_entry_lines — một lô bị lấy hai lần sẽ cộng trả thiếu"
    ).not.toContain("+ sel.qty_in_base_uom\n    FROM stock_entry_lines")
  })

  /**
   * ⚠ ÍT NHẤT MỘT CÂU CỘNG DỒN PHẢI ĐƯỢC TÌM THẤY. Nếu không, biểu thức
   * `ACC` đã hỏng và chốt chính bên dưới thành vô nghĩa — đúng kiểu chốt
   * xanh vì không kiểm gì cả.
   */
  it("nhận ra được câu UPDATE … FROM cộng dồn", () => {
    expect(
      ACCUMULATORS.length,
      "không nhận ra câu cộng dồn nào — biểu thức nhận dạng đã hỏng"
    ).toBeGreaterThan(0)
  })

  it("mọi câu cộng dồn đều gom nguồn trước", () => {
    const bad = ACCUMULATORS.filter((a) => !a.grouped).map(
      (a) => `${a.fn.file} · ${a.fn.name}: ${a.stmt.replace(/\s+/g, " ").slice(0, 120)}`
    )
    expect(
      bad,
      "UPDATE … FROM cộng dồn mà nguồn CHƯA gom — Postgres sẽ chỉ lấy MỘT " +
        "dòng nguồn cho mỗi dòng đích và bỏ im lặng phần còn lại:\n  " +
        bad.join("\n  ")
    ).toEqual([])
  })
})
