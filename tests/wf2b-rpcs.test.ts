import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { paymentTermsToDays } from "../src/lib/returns"

/**
 * WORKFLOW V2B — P2: các RPC của hóa đơn bán (migration 125).
 *
 * Cấu trúc ở 124, chốt riêng trong `wf2b-schema.test.ts`.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const RAW125 = read("supabase/migrations/125_wf2b_invoice_rpcs.sql")

/**
 * ⚠ HAI BẢN CỦA CÙNG MỘT TỆP, VÀ CHÚNG KHÔNG THAY NHAU ĐƯỢC.
 *
 * `M125` đã lược hết chú thích: chốt nào khẳng định một câu lệnh KHÔNG
 * có mặt phải đọc bản này, nếu không thì chỉ cần nhắc tên câu lệnh đó
 * trong một dòng `--` là chốt đỏ oan. `RAW125` giữ nguyên: chốt nào đòi
 * một lời GIẢI THÍCH phải đọc bản này — đọc bản đã lược thì chú thích
 * hoá lệnh cần kiểm tra vẫn xanh. Thử phá đã bắt được đúng lỗi này ở P1.
 */
const M125 = RAW125.replace(/^\s*--.*$/gm, "")

/** Cắt đúng thân một hàm trong bản đã lược chú thích. */
function fn(name: string): string {
  const i = M125.indexOf(`FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const j = M125.indexOf("\n$$;", i)
  return M125.slice(i, j > 0 ? j : undefined)
}

/**
 * Cắt thân một hàm KÈM khối chú thích ngay phía trên nó.
 *
 * ⚠ Lùi ngược qua những dòng `--` liền mạch. Cắt từ chữ `FUNCTION` trở
 * xuống là bỏ mất đúng phần lời giải thích mà các chốt dưới đây đang
 * kiểm — chốt sẽ đỏ oan, rồi ai đó "sửa" bằng cách nới lỏng nó.
 */
function rawFn(name: string): string {
  const i = RAW125.indexOf(`FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const before = RAW125.slice(0, i).split("\n")
  // `before` kết thúc bằng mảnh dở của chính dòng CREATE, nên lùi từ
  // dòng TRƯỚC nó. Chỉ lùi qua dòng `--`, không lùi qua dòng trống — lùi
  // qua dòng trống là trèo sang thân hàm phía trên.
  let k = before.length - 1
  while (k > 0 && before[k - 1].trimStart().startsWith("--")) k--
  const start = before.slice(0, k).join("\n").length
  const j = RAW125.indexOf("\n$$;", i)
  return RAW125.slice(start, j > 0 ? j : undefined)
}

// =====================================================================

describe("Bộ RPC có đủ mặt và được cấp quyền đúng", () => {
  const PUBLIC_RPCS = [
    "get_invoiceable_lines",
    "post_invoice",
    "cancel_invoice",
    "reissue_invoice",
    "close_order",
    "cancel_order",
  ]

  it.each(PUBLIC_RPCS)("%s được dựng", (name) => {
    expect(M125).toContain(`FUNCTION public.${name}(`)
  })

  it.each(PUBLIC_RPCS)("%s được GRANT cho authenticated", (name) => {
    expect(M125).toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO authenticated`)
    )
  })

  /**
   * ⚠ HELPER GHI THẲNG VÀO CÔNG NỢ MÀ KHÔNG KIỂM QUYỀN — nó tin hàm gọi
   * nó đã kiểm. Cấp `authenticated` là cho bất cứ ai gọi thẳng qua
   * PostgREST và đặt lại số nợ của khách. PostgREST phơi mọi hàm trong
   * schema `public` mà vai trò đó gọi được, nên REVOKE là thứ duy nhất
   * chặn.
   */
  const HELPERS: Array<[string, string]> = [
    ["_wf2b_recompute_receivable", "uuid"],
    ["_wf2_recompute_receivable", "uuid"],
    ["_wf2b_sync_order_status", "uuid"],
    ["_wf2b_next_invoice_code", "uuid, date"],
  ]

  it.each(HELPERS)("%s bị REVOKE khỏi PUBLIC", (name, args) => {
    // Khoảng trắng giữa `)` và `FROM` chỉ để gióng cột — đừng bắt nó.
    expect(M125).toMatch(
      new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${name}\\(${args}\\)\\s+FROM PUBLIC`
      )
    )
  })

  it.each(HELPERS)("%s KHÔNG được GRANT cho authenticated", (name) => {
    expect(M125).not.toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO authenticated`)
    )
  })
})

// =====================================================================

/**
 * ⚠ CÙNG MỘT PHÉP TÍNH VIẾT HAI LẦN, MỘT TRONG TYPESCRIPT MỘT TRONG SQL.
 * Không so hai bản thì chúng trôi xa nhau lặng lẽ, và hậu quả là hạn nợ
 * trên màn hình khác hạn nợ trong sổ.
 */
describe("Hạn thanh toán: bản SQL khớp bản TypeScript", () => {
  const CASES: Array<[string | null, number]> = [
    ["NET30", 30],
    ["net7", 7],
    ["NET0", 0],
    ["COD", 0],
    ["", 0],
    [null, 0],
    ["NET45 (cuối tháng)", 45],
  ]

  /** Bản SQL, viết lại bằng JS đúng từng bước của biểu thức trong mig 125. */
  function sqlDays(terms: string | null): number {
    const m = (terms ?? "").toUpperCase().match(/NET([0-9]+)/)
    return m ? parseInt(m[1], 10) : 0
  }

  it.each(CASES)("%s → %i ngày, cả hai bản", (terms, want) => {
    expect(paymentTermsToDays(terms)).toBe(want)
    expect(sqlDays(terms)).toBe(want)
  })

  it("biểu thức SQL đúng là biểu thức đang được so", () => {
    /**
     * ⚠ NEO VÀO NGUYÊN VĂN. Không neo thì `sqlDays` ở trên chỉ là một
     * hàm JS tự nói chuyện với chính nó: sửa regex trong migration thành
     * `NET([0-9])` mà bộ chốt vẫn xanh trơn. Thử phá đã bắt.
     */
    expect(M125).toContain(
      "(substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)'))::int"
    )
  })

  it("hàm TypeScript được export để so được", () => {
    expect(typeof paymentTermsToDays).toBe("function")
    expect(read("src/lib/returns.ts")).toContain(
      "export function paymentTermsToDays("
    )
  })
})

// =====================================================================

describe("post_invoice — tiền", () => {
  const F = fn("post_invoice")

  /**
   * ⚠ LÀM TRÒN Ở TỔNG, KHÔNG Ở DÒNG. `cartTotals` cộng hết rồi mới
   * `Math.round`, và `grandTotal` làm tròn tổng `subtotal + vat` CHƯA
   * làm tròn. Viết `round(v_sub_raw) + round(v_vat_raw)` là lệch vài
   * đồng mỗi hóa đơn — lệch bé tới mức không ai báo, và không ai lần ra.
   */
  it("tổng làm tròn MỘT lần, trên tổng chưa làm tròn", () => {
    expect(F).toContain("GREATEST(0, round(v_sub_raw + v_vat_raw))")
    expect(F).not.toContain("round(v_sub_raw) + round(v_vat_raw)")
  })

  it("subtotal và vat mỗi cái làm tròn từ số chưa làm tròn của chính nó", () => {
    expect(F).toContain("subtotal = round(v_sub_raw)")
    expect(F).toContain("vat      = round(v_vat_raw)")
  })

  /**
   * ⚠ VAT TRÊN GIÁ ĐANG ÁP, không trên giá bảng — tính trên giá bảng là
   * bắt khách trả thuế cho phần đã được giảm.
   */
  it("VAT nhân với line_total, không nhân với giá bảng", () => {
    expect(F).toContain("sum(sil.line_total * COALESCE(sil.vat_rate, 0))")
    expect(F).not.toContain("sell_price")
  })

  /**
   * ⚠ CỘNG TRÊN CỘT CỦA BẢNG, không cộng lại từ jsonb. Thuế suất đã
   * snapshot vào dòng hóa đơn; đọc lại `products` lần nữa là mở đường
   * cho hai con số khác nhau trong cùng một giao dịch.
   */
  it("cộng tiền đọc từ sales_invoice_lines vừa ghi", () => {
    expect(F).toContain("FROM sales_invoice_lines sil")
    expect(F).toContain("WHERE sil.invoice_id = v_inv")
  })

  /**
   * ⚠ HAI QUY ƯỚC ĐANG ĐÁ NHAU TRONG KHO MÃ (đã báo chủ nhà):
   * `create-order.ts:52-53` ghi `line_total = round(qty × giá)` và coi
   * `line_discount` là số GHI NHỚ; `orders/[id]/page.tsx:620,700` đọc
   * `max(0, qty × unit_price − line_discount)` — trừ thêm lần nữa.
   * Hàm này theo bản GHI. Nếu ai đó "sửa cho khớp trang đọc" thì mọi hóa
   * đơn có giảm giá bị trừ hai lần.
   */
  it("line_total KHÔNG trừ line_discount lần nữa", () => {
    expect(F).toContain(
      "(l->>'quantity')::numeric * COALESCE((l->>'unit_price')::numeric, 0)"
    )
    expect(F).not.toMatch(/line_total[^;]*-\s*COALESCE\(\(l->>'line_discount'/)
  })

  it("mâu thuẫn hai quy ước được ghi lại tại chỗ, kèm số dòng", () => {
    const R = rawFn("post_invoice")
    expect(R).toContain("src/lib/sell/create-order.ts:52-53")
    expect(R).toContain("orders/[id]/page.tsx:620,700")
  })
})

// =====================================================================

describe("post_invoice — điều kiện vào", () => {
  const F = fn("post_invoice")

  it("khoá đơn trước khi đọc", () => {
    expect(F).toContain("FROM sales_orders so WHERE so.id = v_order FOR UPDATE")
  })

  it("kiểm tổ chức và quyền trước khi đụng kho", () => {
    const org = F.indexOf("ORG_MISMATCH")
    const perm = F.indexOf("'FORBIDDEN: bạn không có quyền xuất hàng'")
    const stock = F.indexOf("_wf2_export_order")
    expect(org).toBeGreaterThan(0)
    expect(perm).toBeGreaterThan(0)
    expect(stock).toBeGreaterThan(perm)
    expect(perm).toBeGreaterThan(org)
  })

  /**
   * ⚠ CHỈ ĐƠN CHƯA XUẤT ĐỦ MỚI XUẤT TIẾP ĐƯỢC. Thiếu chốt này thì đơn đã
   * 'completed' vẫn lập thêm hóa đơn — trừ kho lần hai cho hàng đã giao.
   */
  it("chỉ nhận đơn submitted hoặc partially_invoiced", () => {
    expect(F).toContain(
      "IF o.status NOT IN ('submitted', 'partially_invoiced') THEN"
    )
    expect(F).toContain("ORDER_NOT_INVOICEABLE")
  })

  /**
   * ⚠ HÓA ĐƠN RỖNG LÀ CHỨNG TỪ KHÔNG CÓ THẬT, và tệ hơn: nó đẩy đơn
   * sang 'completed' vì không dòng nào còn thiếu — không có dòng nào cả.
   */
  it("từ chối hóa đơn không có dòng nào số lượng dương", () => {
    expect(F).toContain(
      "WHERE COALESCE((l->>'quantity')::numeric, 0) > 0"
    )
    expect(F).toContain("'NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0'")
  })

  it("mọi RAISE của hàm dùng ERRCODE P0001", () => {
    const raises = F.match(/RAISE EXCEPTION/g) ?? []
    const codes = F.match(/USING ERRCODE = 'P0001'/g) ?? []
    expect(raises.length).toBeGreaterThan(3)
    expect(codes.length).toBe(raises.length)
  })

  /**
   * ⚠ Trạng thái đơn KHÔNG được đặt tay ở đây. Đặt tay là mở đường cho
   * một đơn hiện Hoàn thành mà chưa hóa đơn nào trừ kho.
   */
  it("trạng thái đơn do _wf2b_sync_order_status suy ra", () => {
    expect(F).toContain("v_status := public._wf2b_sync_order_status(v_order)")
    expect(F).not.toMatch(/UPDATE sales_orders\s+SET status =/)
  })
})

// =====================================================================

describe("_wf2b_sync_order_status — đơn kể lại chuyện của hóa đơn", () => {
  const F = fn("_wf2b_sync_order_status")

  /**
   * ⚠ SO `<`, tức "đã xuất đủ" là `invoiced_qty >= quantity`. Dùng `=`
   * thì đơn xuất DƯ (PATCH 1 cho phép) kẹt vĩnh viễn ở
   * 'partially_invoiced' và không nút nào đưa nó ra được.
   */
  it("đếm dòng còn thiếu bằng phép so nhỏ hơn, không phải khác", () => {
    expect(F).toContain("COALESCE(invoiced_qty, 0) < quantity")
    expect(F).not.toContain("COALESCE(invoiced_qty, 0) <> quantity")
  })

  it("không hóa đơn nào đã ghi sổ thì đơn về submitted", () => {
    expect(F).toContain("IF v_inv = 0 THEN")
    expect(F).toContain("v_new := 'submitted'")
  })

  /**
   * ⚠ 'closed' LÀ QUYẾT ĐỊNH CỦA CON NGƯỜI. Tự kéo đơn đã đóng về
   * 'partially_invoiced' là xoá quyết định đó mà không ai biết.
   */
  it("giữ nguyên đơn đã đóng khi vẫn còn hóa đơn", () => {
    expect(F).toContain("ELSIF v_cur = 'closed' THEN")
    expect(F).toContain("v_new := 'closed'")
  })

  /**
   * ⚠ RỜI KHỎI 'closed' PHẢI XOÁ DẤU ĐÓNG ĐƠN. Để lại `closed_at` là
   * đơn đang mở nhưng mang ngày đóng, và mọi báo cáo đếm theo cột đó đều
   * sai — sai im lặng.
   */
  it("xoá closed_at/closed_by khi trạng thái đổi", () => {
    expect(F).toContain("closed_at    = NULL")
    expect(F).toContain("closed_by    = NULL")
  })

  it("chỉ ghi khi trạng thái thật sự đổi", () => {
    expect(F).toContain("IF v_new IS DISTINCT FROM v_cur THEN")
  })

  it("bật cờ via_rpc trước khi đổi trạng thái", () => {
    const flag = F.indexOf("set_config('npp.via_rpc', 'on', true)")
    const upd = F.indexOf("UPDATE sales_orders")
    expect(flag).toBeGreaterThan(0)
    expect(upd).toBeGreaterThan(flag)
  })

  it("không đụng đơn nháp hay đơn đã huỷ", () => {
    expect(F).toContain("v_cur IN ('draft', 'cancelled')")
  })
})

// =====================================================================

describe("cancel_invoice — bốn khoá và đường hoàn kho", () => {
  const F = fn("cancel_invoice")

  it("khoá hóa đơn trước khi đọc", () => {
    expect(F).toContain("FROM sales_invoices si WHERE si.id = p_invoice_id FOR UPDATE")
  })

  it.each([
    ["INVOICE_NOT_POSTED", "chỉ huỷ hóa đơn đang hiệu lực"],
    ["LOCKED_HAS_PAYMENT", "đã có tiền thu"],
    ["LOCKED_EINVOICE", "đã phát hành hóa đơn điện tử"],
    ["LOCKED_RETURN_DONE", "đã có phiếu trả hoàn thành"],
    ["REASON_REQUIRED", "phải ghi lý do"],
  ])("có khoá %s (%s)", (code) => {
    expect(F).toContain(`'${code}:`)
  })

  /**
   * ⚠ NHÁNH PHIẾU THU CŨ. `create_cash_receipt` (mig 120) còn ghi
   * `order_id`, chưa ghi `invoice_id` — P6 mới đổi. Chỉ so theo
   * `invoice_id` thì hóa đơn đã thu tiền bằng phiếu cũ vẫn huỷ được, và
   * tiền khách đã trả treo vào một chứng từ không còn.
   */
  it("khoá tiền thu bắt cả phiếu thu chưa gắn hóa đơn", () => {
    expect(F).toContain(
      "OR (crl.invoice_id IS NULL AND crl.order_id = v.order_id)"
    )
  })

  it("điều kiện hóa đơn điện tử y nguyên bản v2, chỉ đổi cột nối", () => {
    expect(F).toContain("i.sales_invoice_id = p_invoice_id")
    expect(F).toContain("i.misa_status IN ('signed', 'replaced')")
  })

  /**
   * ⚠ HOÀN VỀ ĐÚNG LÔ ĐÃ LẤY. `_wf2_restock` đi theo dấu vết
   * `stock_line_consumptions` và TRỪ DẦN dấu vết đó, nên huỷ hai lần
   * không hoàn hai lần. Cộng thẳng vào `batches` ở đây là bỏ qua cả hai
   * tính chất.
   */
  it("hoàn kho qua _wf2_restock, không tự cộng vào batches", () => {
    expect(F).toContain("PERFORM public._wf2_restock(s.id, v_take,")
    expect(F).not.toMatch(/UPDATE batches\s+SET qty_on_hand/)
  })

  /**
   * ⚠ HOÀN THEO DÒNG HÓA ĐƠN, KHÔNG THEO DÒNG ĐƠN. Một đơn nay có nhiều
   * hóa đơn; hoàn theo dòng đơn là trả về kho cả hàng của hóa đơn khác
   * vẫn đang có hiệu lực — tồn dôi ra mà không ai giải thích nổi.
   */
  it("gom số cần hoàn từ sales_invoice_lines của đúng hóa đơn này", () => {
    expect(F).toContain("FROM sales_invoice_lines sil")
    expect(F).toContain("WHERE sil.invoice_id = p_invoice_id")
    expect(F).not.toContain("FROM sales_order_lines sol WHERE sol.order_id")
  })

  it("ưu tiên phiếu xuất của chính hóa đơn này", () => {
    expect(F).toContain("se.id = v.stock_entry_id")
    expect(F).toContain("v.stock_entry_id IS NULL")
  })

  /**
   * ⚠ Phiếu thu ĐÃ HUỶ vẫn để lại dòng trỏ vào công nợ (void chỉ đổi
   * trạng thái phiếu). Không gỡ trước thì DELETE nổ 23503 và phần hoàn
   * kho vừa làm cũng rollback.
   */
  it("gỡ trỏ của dòng phiếu thu trước khi xoá công nợ", () => {
    const unlink = F.indexOf("SET receivable_id = NULL, payment_id = NULL")
    const del = F.indexOf("DELETE FROM receivables WHERE invoice_id = p_invoice_id")
    expect(unlink).toBeGreaterThan(0)
    expect(del).toBeGreaterThan(unlink)
  })

  it("trạng thái đơn tính lại sau khi hóa đơn đổi sang cancelled", () => {
    const upd = F.indexOf("SET status = 'cancelled', cancelled_at = now()")
    const sync = F.indexOf("_wf2b_sync_order_status(v.order_id)")
    expect(upd).toBeGreaterThan(0)
    expect(sync).toBeGreaterThan(upd)
  })
})

// =====================================================================

describe("reissue_invoice — sửa = huỷ + lập lại, một giao dịch", () => {
  const F = fn("reissue_invoice")

  it("gọi cancel_invoice rồi post_invoice, đúng thứ tự", () => {
    const cancel = F.indexOf("PERFORM public.cancel_invoice(")
    const post = F.indexOf("FROM public.post_invoice(v_payload)")
    expect(cancel).toBeGreaterThan(0)
    expect(post).toBeGreaterThan(cancel)
  })

  /**
   * ⚠ KHÔNG NỐI THÌ BẢN CŨ NẰM ĐÓ NHƯ MỘT HÓA ĐƠN BỊ HUỶ KHÔNG RÕ VÌ SAO,
   * và người tra sổ sáu tháng sau không có đường nào đi từ nó sang bản
   * đang có hiệu lực.
   */
  it("nối hai bản bằng replaced_by và replaced_from", () => {
    expect(F).toContain("SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id")
    expect(F).toContain("SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id")
  })

  /**
   * ⚠ Q4 — CHẶN SỚM Ở CHỖ NGƯỜI DÙNG ĐANG ĐỨNG. Hóa đơn mới có thể đã bỏ
   * mất món đang được trả; khi đó phiếu trả trỏ vào một hóa đơn không hề
   * bán món đó, và người dùng vấp lỗi ở màn Đơn trả — một chỗ chẳng liên
   * quan gì tới việc họ vừa làm.
   */
  it("chặn khi hóa đơn mới bỏ mất món đang có phiếu trả chờ xử lý", () => {
    expect(F).toContain("REISSUE_BREAKS_RETURN")
    expect(F).toContain("string_agg(DISTINCT pr.name, ', ')")
  })

  it("kiểm TRƯỚC khi huỷ, không kiểm sau", () => {
    const check = F.indexOf("REISSUE_BREAKS_RETURN")
    const cancel = F.indexOf("PERFORM public.cancel_invoice(")
    expect(check).toBeGreaterThan(0)
    expect(cancel).toBeGreaterThan(check)
  })

  /**
   * ⚠ NỐI LẠI ĐÍCH DANH TỪNG PHIẾU. Nối bằng điều kiện "cùng đơn và
   * invoice_id rỗng" sẽ vơ luôn những phiếu trả vốn dĩ đã rỗng từ trước
   * — phiếu trả độc lập bỗng dưng bị gắn vào một hóa đơn nó không liên
   * quan, và trần số lượng trả tính theo hóa đơn đó.
   */
  it("ghi nhớ id phiếu trả rồi nối lại theo id", () => {
    expect(F).toContain("SELECT COALESCE(array_agg(id), '{}') INTO v_rets")
    expect(F).toContain("UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets)")
    expect(F).not.toMatch(
      /UPDATE returns SET invoice_id = v_new\.invoice_id\s+WHERE order_id/
    )
  })

  it("gỡ phiếu trả khỏi hóa đơn cũ TRƯỚC khi huỷ, để cancel_invoice không huỷ chúng", () => {
    const detach = F.indexOf("UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets)")
    const cancel = F.indexOf("PERFORM public.cancel_invoice(")
    expect(detach).toBeGreaterThan(0)
    expect(cancel).toBeGreaterThan(detach)
  })
})

// =====================================================================

describe("close_order — đóng đơn khác hoàn thành đơn", () => {
  const F = fn("close_order")

  /**
   * ⚠ GỘP 'closed' VỚI 'completed' LÀ MẤT LUÔN CÂU TRẢ LỜI CHO "đơn này
   * có giao thiếu không" — thứ duy nhất cho biết nên gọi lại khách hay
   * không.
   */
  it("chỉ đóng được đơn đã xuất một phần", () => {
    expect(F).toContain("IF o.status <> 'partially_invoiced' THEN")
    expect(F).toContain("ORDER_NOT_PARTIAL")
  })

  it("gọi lại trên đơn đã đóng thì không làm gì, không báo lỗi", () => {
    expect(F).toContain("IF o.status = 'closed' THEN RETURN; END IF;")
  })

  it("ghi closed_at và closed_by", () => {
    expect(F).toContain("closed_at = now(), closed_by = auth.uid()")
  })

  it("cần quyền orders.approve", () => {
    expect(F).toContain("user_has_permission(auth.uid(), 'orders.approve')")
  })
})

// =====================================================================

describe("cancel_order — nửa sau của hàm cũ biến mất, có chủ ý", () => {
  const F = fn("cancel_order")

  /**
   * ⚠ HAI ĐƯỜNG CÙNG ĐỤNG TỒN KHO CHO CÙNG MỘT LÔ HÀNG THÌ SỚM MUỘN
   * CHÚNG LỆCH NHAU. Hàng đã rời kho nay thuộc về một HÓA ĐƠN, và chỉ
   * `cancel_invoice` mới biết hoàn về đúng lô nào.
   */
  it("không còn tự hoàn kho", () => {
    expect(F).not.toContain("_wf2_restock")
    expect(F).not.toContain("INSERT INTO stock_entries")
  })

  it("không còn tự xoá công nợ", () => {
    expect(F).not.toContain("DELETE FROM receivables")
  })

  /**
   * ⚠ MỘT LỜI CHỈ ĐƯỜNG, KHÔNG PHẢI MỘT LỜI TỪ CHỐI — thông báo nêu rõ
   * còn mấy hóa đơn phải huỷ trước.
   */
  it("chặn đơn đã có hóa đơn và nói rõ phải làm gì", () => {
    expect(F).toContain("HAS_INVOICE")
    expect(F).toContain("Huỷ hết hóa đơn trước, rồi mới huỷ đơn.")
  })

  it("chặn cả theo trạng thái lẫn theo số hóa đơn đã ghi sổ", () => {
    expect(F).toContain(
      "IF v_inv > 0 OR o.status IN ('partially_invoiced', 'completed', 'closed') THEN"
    )
  })

  it("NVBH chỉ huỷ được đơn của mình", () => {
    expect(F).toContain("FORBIDDEN_NOT_OWNER")
    expect(F).toContain("public.user_role() = 'sales'")
  })

  it("gọi lại trên đơn đã huỷ thì không làm gì", () => {
    expect(F).toContain("IF o.status = 'cancelled' THEN RETURN; END IF;")
  })
})

// =====================================================================

describe("_wf2b_recompute_receivable — công nợ bám hóa đơn", () => {
  const F = fn("_wf2b_recompute_receivable")

  /**
   * ⚠ ĐÈ LÊN `paid` LÀ XOÁ TIỀN KHÁCH ĐÃ TRẢ. Số đã thu là sự thật do
   * phiếu thu ghi, không phải thứ tính lại được.
   */
  it("không bao giờ ghi vào cột paid", () => {
    expect(F).not.toMatch(/SET[^;]*\bpaid\s*=/)
  })

  it("giảm trừ đếm phiếu trả của ĐÚNG hóa đơn này, và chỉ phiếu đã hoàn thành", () => {
    expect(F).toContain("WHERE r.invoice_id = p_invoice_id AND r.status = 'completed'")
  })

  /**
   * ⚠ Q11 — `paid > amount` LÀ HỢP LỆ (chủ nhà chọn (a) ở v2): phần dư
   * là số dư có của khách. Nhánh `>=` bắt luôn ca này và đặt 'paid'.
   */
  it("thu dư vẫn là 'paid', không sinh trạng thái mới", () => {
    expect(F).toContain("WHEN v_paid >= v_net THEN 'paid'")
    expect(F).not.toContain("'overpaid'")
    expect(F).not.toContain("'credit'")
  })

  it("không đòi tiền một hóa đơn đã huỷ", () => {
    expect(F).toContain("IF v_id IS NULL AND v.status <> 'posted' THEN")
  })

  /**
   * ⚠ GHI CẢ `order_id` LẪN `invoice_id`. Dữ liệu cũ chỉ có `order_id`
   * và mọi báo cáo lịch sử đọc theo cột đó; bỏ nó là đứt một nửa sổ.
   */
  it("dòng công nợ mới mang cả hai khoá ngoại", () => {
    expect(F).toContain("org_id, order_id, invoice_id, customer_id, sales_user_id")
    expect(F).toContain("v.org_id, v.order_id, v.id,")
  })

  it("hạn nợ tính từ ngày hóa đơn, không từ ngày đặt hàng", () => {
    expect(F).toContain("COALESCE(v.invoice_date, current_date)")
    expect(F).toContain("public._wf2b_payment_terms_days(v.payment_terms)")
  })
})

// =====================================================================

describe("_wf2_recompute_receivable — cầu tạm cho hai RPC đơn trả", () => {
  const F = fn("_wf2_recompute_receivable")

  /**
   * ⚠ 124 ĐÃ GỠ HÀM NÀY, mà `complete_return` / `cancel_return` (mig 120)
   * còn gọi nó. Không dựng lại là hai RPC đơn trả lỗi ngay sau khi chạy
   * 125. Dựng lại NGUYÊN BẢN CŨ thì công nợ lại bám đơn, phá đúng thứ
   * v2b vừa tách ra.
   */
  it("dựng lại đúng chữ ký cũ, nhưng ủy quyền cho bản theo hóa đơn", () => {
    expect(M125).toContain("FUNCTION public._wf2_recompute_receivable(p_order_id uuid)")
    expect(F).toContain("public._wf2b_recompute_receivable(v_inv)")
  })

  it("không tự tính công nợ, không tự INSERT", () => {
    expect(F).not.toContain("INSERT INTO receivables")
    expect(F).not.toMatch(/UPDATE receivables\s+SET/)
  })

  /**
   * ⚠ PHIẾU TRẢ CHƯA GẮN HÓA ĐƠN LÀ MỘT KHOẢN GIẢM TRỪ KHÔNG THUỘC VỀ
   * AI. `_wf2b_recompute_receivable` cộng theo `invoice_id`, nên phiếu
   * `invoice_id` rỗng biến mất khỏi phép cộng: khách trả hàng mà nợ
   * không giảm, và không dòng nào báo.
   */
  it("nhận nuôi phiếu trả chưa gắn hóa đơn khi đơn chỉ có một hóa đơn", () => {
    expect(F).toContain("IF v_orphan > 0 THEN")
    expect(F).toContain("IF v_n = 1 THEN")
    expect(F).toContain("UPDATE returns SET invoice_id = v_inv")
  })

  /**
   * ⚠ ĐƠN CÓ NHIỀU HÓA ĐƠN THÌ KHÔNG ĐOÁN. Gắn bừa là ghi giảm nợ nhầm
   * hóa đơn — sai tiền thật, và sai ở một chỗ không ai nghĩ tới việc đi
   * kiểm.
   */
  it("dừng lại thay vì đoán khi đơn có nhiều hóa đơn", () => {
    expect(F).toContain("ELSIF v_n > 1 THEN")
    expect(F).toContain("RETURN_NEEDS_INVOICE")
  })

  it("được đánh dấu là cầu tạm, và nói rõ ai gỡ", () => {
    expect(RAW125).toContain(
      "'CẦU TẠM: complete_return/cancel_return còn gọi theo order_id. Gỡ ở P6 '"
    )
  })
})

// =====================================================================

describe("get_invoiceable_lines", () => {
  const F = fn("get_invoiceable_lines")

  /**
   * ⚠ ĐỔI KIỂU TRẢ VỀ CỦA MỘT HÀM ĐANG CÓ BẰNG `CREATE OR REPLACE` LÀ
   * LỖI 42P13. Phải DROP trước — nếu không, lần chạy lại migration trên
   * một cơ sở dữ liệu đã có hàm sẽ hỏng ngay giữa chừng.
   */
  it("DROP trước khi CREATE, vì RETURNS TABLE đổi được", () => {
    const drop = M125.indexOf("DROP FUNCTION IF EXISTS public.get_invoiceable_lines(uuid)")
    const create = M125.indexOf("CREATE FUNCTION public.get_invoiceable_lines(")
    expect(drop).toBeGreaterThan(0)
    expect(create).toBeGreaterThan(drop)
  })

  /**
   * ⚠ DÒNG ĐÃ XUẤT ĐỦ KHÔNG BỊ LOẠI, chỉ mang `remaining_qty = 0`. Loại
   * đi thì màn Xuất hàng đợt hai trông như đơn bị mất dòng, và không
   * cách nào biết dòng đó đã xuất rồi hay chưa từng có.
   */
  it("giữ cả dòng đã xuất đủ, chỉ để remaining_qty về 0", () => {
    expect(F).toContain("GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0))")
    expect(F).not.toMatch(/WHERE sol\.order_id = p_order_id\s+AND[^\n]*invoiced_qty/)
  })

  /**
   * ⚠ `available_base` LÀ THÔNG TIN, KHÔNG PHẢI VẤN ĐỀ. Chặn ở đây là
   * đặt ra một luật thứ hai mâu thuẫn với cấu hình cho-bán-âm của tổ
   * chức, và `post_stock_export` mới là chỗ quyết định điều đó.
   */
  it("báo tồn kho nhưng không chặn", () => {
    expect(F).toContain("available_base")
    expect(F).not.toContain("INSUFFICIENT_STOCK")
    expect(F).not.toContain("NOT_ENOUGH_STOCK")
  })

  /**
   * ⚠ ĐẾM SỐ LẦN, KHÔNG HỎI "CÓ HAY KHÔNG". Hàm có HAI truy vấn con đếm
   * tồn kho — một cho dòng đơn, một cho hàng đem đổi. Hỏi "tệp có chứa
   * `warehouse_zone = 'sale'` không" thì gỡ điều kiện ở MỘT truy vấn vẫn
   * xanh, vì truy vấn kia còn giữ. Thử phá đã bắt đúng lỗi này: bỏ lọc
   * khu vực ở nhánh dòng đơn là tồn kho gộp cả hàng hỏng và hàng chờ trả
   * về, và màn Xuất hàng báo đủ hàng khi kho bán đã hết.
   */
  it("cả hai truy vấn tồn kho đều lọc theo tổ chức và khu vực bán", () => {
    expect((F.match(/b\.org_id = v_org/g) ?? []).length).toBe(2)
    expect((F.match(/b\.warehouse_zone = 'sale'/g) ?? []).length).toBe(2)
  })

  it("kèm hàng đem đổi của phiếu trả, với order_line_id rỗng", () => {
    expect(F).toContain("rl.is_exchange = true")
    expect(F).toContain("r.status IN ('draft', 'submitted')")
  })

  it("kiểm tổ chức trước khi trả dữ liệu", () => {
    expect(F).toContain("ORG_MISMATCH")
  })
})

// =====================================================================

describe("Mã hóa đơn", () => {
  const F = fn("_wf2b_next_invoice_code")

  /**
   * ⚠ KHOÁ TRƯỚC KHI ĐẾM. Hai người bấm Xuất hàng cùng lúc thì cả hai
   * đọc ra cùng một số, một giao dịch vỡ vì unique index. Không sai sổ,
   * nhưng người dùng thứ hai thấy một lỗi chẳng liên quan gì.
   */
  it("khoá theo tổ chức + ngày trước khi đếm", () => {
    const lock = F.indexOf("pg_advisory_xact_lock")
    const count = F.indexOf("SELECT count(*) + 1 INTO v_n")
    expect(lock).toBeGreaterThan(0)
    expect(count).toBeGreaterThan(lock)
  })

  it("dạng HD-YYMMDD-NNNN", () => {
    expect(F).toContain("'HD-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_n::text, 4, '0')")
  })
})

// =====================================================================

describe("Nền nếp chung của migration", () => {
  it("kết thúc bằng reload schema", () => {
    expect(M125).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it("seed quyền không đè lên cấu hình tổ chức đã đặt", () => {
    expect(M125).toContain("ON CONFLICT (org_id, role, module, action) DO NOTHING")
  })

  /**
   * ⚠ KHÔNG SEED THÌ SAU KHI CHẠY 125 MỌI VAI TRÒ TRỪ CHỦ SỞ HỮU ĐỀU BỊ
   * TỪ CHỐI, trong khi giao diện vẫn hiện nút: `user_has_permission` trả
   * FALSE khi `role_permissions` chưa có dòng, và ma trận mặc định chỉ
   * nằm trong TypeScript.
   */
  it("mở quyền xuất hàng cho quản lý", () => {
    expect(M125).toContain("('manager', 'orders', 'approve')")
  })

  it("mọi hàm đặt search_path cố định", () => {
    const bodies = M125.match(/FUNCTION public\.\w+\([^)]*\)\s*\n?RETURNS/g) ?? []
    const paths = M125.match(/SET search_path = public/g) ?? []
    expect(bodies.length).toBeGreaterThan(8)
    expect(paths.length).toBeGreaterThanOrEqual(bodies.length - 1)
  })

  it("nói rõ 124 và 125 phải chạy cùng nhau", () => {
    expect(RAW125).toContain("⚠ 124 VÀ 125 PHẢI CHẠY CÙNG NHAU")
  })

  it("đếm lại số RPC đã dựng ở cuối, thay vì tin là xong", () => {
    expect(M125).toContain("RAISE NOTICE '--- 125: %/7 RPC đã dựng")
  })
})
