import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * TÊN CỘT TRÙNG TÊN THAM SỐ OUT CỦA CHÍNH HÀM ẤY.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "khi sửa hoá đơn chỉnh hàng trả về thì báo
 * lỗi column reference "invoice_id" is ambiguous".
 *
 * Mỗi tên trong `RETURNS TABLE (...)` là một BIẾN OUT của plpgsql, có
 * mặt trong TOÀN THÂN hàm. Nên một câu như
 *
 *     SELECT ... FROM returns WHERE invoice_id = p_invoice_id
 *
 * có `invoice_id` vừa là biến OUT vừa là cột — Postgres từ chối đoán và
 * ném lỗi NGAY GIỮA GIAO DỊCH, tức là sau khi người dùng đã bấm nút.
 *
 * ⚠ VÀ LỖI NÀY NGỦ ĐÔNG RẤT LÂU. Câu sai nằm trong `reissue_invoice`
 * từ migration 125, nhưng một phép kiểm đứng TRƯỚC nó luôn từ chối
 * trước khi chạy tới — mọi lần sửa hóa đơn có phiếu trả đang chờ đều
 * dừng ở câu lỗi kia. Tới khi migration 149 làm phép kiểm ấy đi qua
 * được thì cái bẫy nằm sau mới lộ ra. Một lỗi nấp sau một lỗi khác, và
 * không chốt nào nhìn thấy vì nó chỉ nổ lúc chạy thật.
 *
 * ⚠ SOI BẢN ĐANG CHẠY. Một hàm được `CREATE OR REPLACE` nhiều lần qua
 * nhiều migration; bản có hiệu lực là bản CUỐI CÙNG. Soi mọi bản là
 * báo lỗi cho những câu đã được sửa từ lâu.
 */

const MIG = resolve(__dirname, "..", "supabase/migrations")

/** Bản ĐANG CHẠY của mỗi hàm: định nghĩa cuối cùng theo thứ tự migration. */
function banDangChay(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>()
  for (const name of readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
    const src = readFileSync(join(MIG, name), "utf-8")
    const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\s*\([\s\S]*?\$\$;/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) out.set(m[1], { file: name, body: m[0] })
  }
  return out
}

/**
 * Câu SO SÁNH dùng tên tham số OUT mà không gọi đích danh bảng.
 *
 * ⚠ CHỈ BẮT VẾ SO SÁNH, KHÔNG BẮT MỌI CHỖ XUẤT HIỆN. Cùng cái tên ấy
 * nằm trong danh sách cột của `INSERT`, trong một khoá JSON
 * (`'invoice_id'`), hay ở vế trái của `:=` đều HỢP LỆ và Postgres không
 * kêu. Bắt hết là một chốt kêu oan mười lăm chỗ, và cách duy nhất để nó
 * xanh lại là nới nó ra — tức là tự tay mở lại đúng cái lỗ vừa bịt.
 */
function cauNhapNhang(body: string): Array<{ out: string; line: string }> {
  const mt = body.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/)
  if (!mt) return []
  const outs = mt[1]
    .split(",")
    .map((x) => x.trim().split(/\s+/)[0])
    .filter(Boolean)
  const than = body.slice(body.indexOf(mt[0]) + mt[0].length)
  const hit: Array<{ out: string; line: string }> = []
  for (const raw of than.split("\n")) {
    const code = raw.split("--")[0]
    for (const o of outs) {
      const re = new RegExp(`\\b(WHERE|AND|OR|ON)\\s+${o}\\s*(=|<>|!=|IS\\b|IN\\b)`, "i")
      if (re.test(code)) hit.push({ out: o, line: raw.trim().slice(0, 90) })
    }
  }
  return hit
}

describe("RPC không để tên cột đụng tên tham số OUT", () => {
  it("không hàm nào so sánh bằng một tên trần trùng tham số OUT", () => {
    const bad: string[] = []
    for (const [name, { file, body }] of Array.from(banDangChay().entries())) {
      for (const h of cauNhapNhang(body)) {
        bad.push(`${file} · ${name}() · "${h.out}" — ${h.line}`)
      }
    }
    expect(
      bad,
      'tên trần trùng tham số OUT của `RETURNS TABLE` — Postgres ném ' +
        '"column reference … is ambiguous" NGAY GIỮA GIAO DỊCH, sau khi ' +
        "người dùng đã bấm nút. Gọi đích danh bảng (`returns.invoice_id`):\n  " +
        bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ PHÉP QUÉT PHẢI NHÌN THẤY GÌ ĐÓ. Một biểu thức gõ hỏng thì `bad`
   * rỗng và chốt trên XANH vĩnh viễn — đúng kiểu chốt nói dối đã để
   * lọt vài lỗi trong tuần này. Thử trên chính câu đã gây ra sự cố.
   */
  it("phép quét nhận ra đúng câu đã gây sự cố", () => {
    const gia = `
      CREATE OR REPLACE FUNCTION public.thu(p_invoice_id uuid)
      RETURNS TABLE (
        invoice_id uuid, invoice_code text
      )
      LANGUAGE plpgsql AS $$
      BEGIN
        SELECT COALESCE(array_agg(id), '{}') INTO v_rets
        FROM returns
        WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');
      END;
      $$;`
    expect(cauNhapNhang(gia), "phép quét không còn thấy câu trần").toHaveLength(1)

    const sua = gia.replace("WHERE invoice_id =", "WHERE returns.invoice_id =")
    expect(cauNhapNhang(sua), "phép quét báo oan câu đã gọi đích danh").toHaveLength(0)
  })

  /**
   * ⚠ VÀ KHÔNG ĐƯỢC KÊU OAN. Cùng cái tên ấy trong danh sách cột của
   * `INSERT`, trong khoá JSON, hay ở vế trái `:=` đều hợp lệ — một chốt
   * kêu oan là một chốt sẽ bị nới ra.
   */
  it("không kêu oan ở danh sách cột INSERT hay khoá JSON", () => {
    const lanh = `
      CREATE OR REPLACE FUNCTION public.thu2(p uuid)
      RETURNS TABLE (
        invoice_id uuid, entry_id uuid
      )
      LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO sales_invoice_lines (
          invoice_id, order_line_id, product_id
        ) VALUES (v_inv, NULL, NULL);
        PERFORM jsonb_build_object('invoice_id', v_inv, 'entry_id', v_exp.entry_id);
        entry_id := v_exp.entry_id;
        UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);
      END;
      $$;`
    expect(cauNhapNhang(lanh), "chốt đang kêu oan những chỗ hợp lệ").toEqual([])
  })

  /** ⚠ Và bản ĐANG CHẠY của `reissue_invoice` phải là bản đã sửa. */
  it("reissue_invoice gọi đích danh returns.invoice_id", () => {
    const fn = banDangChay().get("reissue_invoice")
    expect(fn, "không tìm thấy reissue_invoice").toBeTruthy()
    expect(fn!.body).toContain("WHERE returns.invoice_id = p_invoice_id")
    expect(
      /WHERE invoice_id = p_invoice_id/.test(fn!.body),
      "bản đang chạy vẫn còn câu trần — sửa hóa đơn có phiếu trả sẽ lỗi"
    ).toBe(false)
  })
})
