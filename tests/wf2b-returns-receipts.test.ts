import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * WORKFLOW V2B — P6: đơn trả và phiếu thu bám hóa đơn (migration 127).
 *
 * ⚠ BA CHỖ V2B LÀM VỠ MÀ 124–126 CHƯA CHẠM TỚI, và cả ba đều IM LẶNG
 * theo cách riêng của chúng:
 *   1. `complete_return` từ chối mọi đơn không ở đúng `'completed'` —
 *      đơn giao một phần bị chặn với câu "đơn gốc chưa xuất hàng", sai và
 *      người dùng không cãi lại được;
 *   2. trần số lượng trả trong RPC vẫn đếm dòng ĐƠN trong khi trigger đã
 *      đếm dòng HÓA ĐƠN — hai chỗ nói hai đằng;
 *   3. `cash_receipt_lines.invoice_id` chưa ai ghi.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const RAW127 = read("supabase/migrations/127_wf2b_returns_and_receipts.sql")
const M127 = RAW127.replace(/^\s*--.*$/gm, "")
const MIG120 = read("supabase/migrations/120_workflow_v2_rpcs.sql")
const MIG124 = read("supabase/migrations/124_wf2b_sales_invoices.sql")

function fn(name: string): string {
  const i = M127.indexOf(`FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const j = M127.indexOf("\n$$;", i)
  return M127.slice(i, j > 0 ? j : undefined)
}

// =====================================================================

describe("Dòng phiếu thu tự gắn hóa đơn", () => {
  const F = fn("fill_crl_invoice_id")

  /**
   * ⚠ TRIGGER, KHÔNG SỬA `create_cash_receipt`. Hàm đó dài 300 dòng và
   * chèn `cash_receipt_lines` ở BỐN chỗ khác nhau; vá bốn chỗ là bốn chỗ
   * để quên một chỗ, và chỗ quên ấy sẽ là chỗ không ai thử.
   */
  it("có đúng bốn chỗ chèn trong create_cash_receipt — lý do dùng trigger", () => {
    const i = MIG120.indexOf("FUNCTION public.create_cash_receipt(")
    const body = MIG120.slice(i, MIG120.indexOf("\n$$;", i))
    const n = (body.match(/INSERT INTO cash_receipt_lines/g) ?? []).length
    expect(n).toBe(4)
  })

  it("trigger chạy trước khi ghi, trên cả INSERT lẫn đổi receivable_id", () => {
    expect(M127).toContain(
      "BEFORE INSERT OR UPDATE OF receivable_id ON cash_receipt_lines"
    )
  })

  /**
   * ⚠ CHỈ ĐIỀN KHI ĐANG RỖNG. Đè lên giá trị đã có là xoá một liên kết ai
   * đó đặt có chủ ý.
   */
  it("không đè lên giá trị đã có", () => {
    expect(F).toContain("IF NEW.invoice_id IS NULL AND NEW.receivable_id IS NOT NULL THEN")
  })

  it("lấy từ khoản nợ đang trả, không đoán theo đơn", () => {
    expect(F).toContain("FROM receivables rc WHERE rc.id = NEW.receivable_id")
    expect(F).not.toContain("order_id")
  })

  it("backfill dòng cũ và đếm số dòng đã gắn", () => {
    expect(M127).toContain("UPDATE cash_receipt_lines crl")
    expect(M127).toContain("RAISE NOTICE '--- 127: gắn hóa đơn cho % dòng phiếu thu cũ ---'")
  })
})

// =====================================================================

describe("complete_return — ba chỗ đổi, phần còn lại giữ nguyên", () => {
  const F = fn("complete_return")

  /**
   * ⚠ Ý ĐỊNH CỦA CHỐT NÀY LÀ "hàng đã từng rời kho chưa". Sau v2b, so với
   * một giá trị `'completed'` là trả lời SAI hai trong ba ca: đơn giao
   * một phần (`partially_invoiced`) và đơn chốt không giao nốt
   * (`closed`) đều đã xuất hàng thật.
   */
  it("đơn gốc kiểm bằng is_revenue_status, không so với một giá trị", () => {
    expect(F).toContain("public.is_revenue_status(o2.status)")
    expect(F).not.toContain("o2.status = 'completed'")
  })

  /**
   * ⚠ HÓA ĐƠN ĐÃ HUỶ ĐÃ HOÀN HÀNG VỀ KHO. Nhập trả theo nó là nhập kho
   * lần thứ hai cho cùng một lô hàng.
   */
  it("từ chối phiếu trả gắn hóa đơn đã huỷ", () => {
    expect(F).toContain("INVOICE_NOT_POSTED")
    expect(F).toContain("WHERE si.id = r.invoice_id AND si.status = 'posted'")
  })

  /**
   * ⚠ TRẦN TRẢ ĐẾM DÒNG HÓA ĐƠN, khớp với trigger ở mig 124. Hai chỗ nói
   * hai đằng thì phiếu lọt trigger rồi vấp ở RPC, và thông báo lỗi nói về
   * một con số người dùng không thấy ở đâu.
   */
  it("trần trả đếm sales_invoice_lines của đúng hóa đơn", () => {
    expect(F).toContain("FROM sales_invoice_lines sil")
    expect(F).toContain("WHERE sil.invoice_id = r.invoice_id")
    expect(F).toContain("WHERE r2.invoice_id = r.invoice_id")
  })

  it("trigger ở mig 124 đếm cùng một nguồn", () => {
    const i = MIG124.indexOf("FUNCTION public.enforce_return_line_cap(")
    const body = MIG124.slice(i, MIG124.indexOf("\n$$;", i))
    expect(body).toContain("FROM sales_invoice_lines sil")
  })

  /**
   * ⚠ NHÁNH CŨ GIỮ LẠI cho phiếu trả chưa gắn hóa đơn. Bỏ đi là mọi phiếu
   * trả của dữ liệu cũ mất trần — hoặc tệ hơn, thấy "đã xuất 0" rồi chặn
   * sạch.
   */
  it("phiếu chưa gắn hóa đơn vẫn đếm theo dòng đơn như cũ", () => {
    expect(F).toContain("FROM sales_order_lines sol")
    expect(F).toContain("WHERE r2.order_id = r.order_id")
  })

  /**
   * ⚠ GIÁ VỐN ƯU TIÊN PHIẾU XUẤT CỦA CHÍNH HÓA ĐƠN. Đơn xuất hai đợt có
   * thể lấy từ hai lô giá vốn khác nhau; tra theo đơn là lấy phải giá của
   * đợt kia, và lãi gộp lệch đúng bằng chênh lệch giá vốn.
   */
  it("giá vốn tra theo phiếu xuất của hóa đơn trước, rồi mới tới đơn", () => {
    const a = F.indexOf("sel.entry_id = (SELECT si.stock_entry_id FROM sales_invoices si")
    const b = F.indexOf("se.ref_order_ids @> jsonb_build_array(r.order_id::text)")
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  /** ⚠ Giá vốn 0 thì lần bán sau FIFO ăn vào lô này với giá vốn 0. */
  it("giá vốn vẫn còn đủ ba mức dự phòng", () => {
    const i = F.indexOf("v_cost := COALESCE(")
    const body = F.slice(i, F.indexOf(");", i))
    expect((body.match(/SELECT/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it("tính lại công nợ theo hóa đơn khi có, theo đơn khi chưa gắn", () => {
    expect(F).toContain("IF r.invoice_id IS NOT NULL THEN\n    PERFORM public._wf2b_recompute_receivable(r.invoice_id);")
    expect(F).toContain("ELSIF r.order_id IS NOT NULL THEN\n    PERFORM public._wf2_recompute_receivable(r.order_id);")
  })

  /**
   * ⚠ PHẦN NHẬP KHO GIỮ TỪNG CHỮ. Đây là chỗ hàng thật vào kho; sửa kèm
   * trong một migration đang lo chuyện khác là mở một mặt trận thứ hai.
   */
  it("phần nhập kho không đổi: ép lại kho sau trigger tự xếp", () => {
    expect(F).toContain("UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;")
    expect(F).toContain("'RESTOCK-' || v_code")
  })
})

// =====================================================================

describe("cancel_return — khoá tiền thu đổi mốc sang hóa đơn", () => {
  const F = fn("cancel_return")

  /**
   * ⚠ BẢN CŨ HỎI CẢ ĐƠN CÓ ĐỒNG NÀO CHƯA. Từ v2b một đơn có nhiều hóa
   * đơn, nên đợt một đã thu tiền sẽ khoá luôn việc huỷ một phiếu trả của
   * đợt hai — hai chứng từ chẳng liên quan gì tới nhau.
   */
  it("hỏi tiền thu của đúng hóa đơn khi phiếu có gắn", () => {
    expect(F).toContain("WHERE rc.invoice_id = r.invoice_id AND COALESCE(rc.paid, 0) > 0")
  })

  it("phiếu chưa gắn hóa đơn vẫn hỏi theo đơn", () => {
    expect(F).toContain("WHERE rc.order_id = r.order_id AND COALESCE(rc.paid, 0) > 0")
  })

  it("khoản có đã cấn vào phiếu thu thì vẫn khoá", () => {
    expect(F).toContain("LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu")
  })

  /**
   * ⚠ Phiếu trả hoàn thành TRƯỚC mig 120 do trigger cũ nhập kho, ghi chú
   * khác hẳn nên không khớp được. Im lặng đi tiếp là ghi nợ lại cho khách
   * trong khi hàng vẫn nằm trong kho.
   */
  it("không tìm được phiếu nhập thì DỪNG, không đi tiếp", () => {
    expect(F).toContain("IF v_rows = 0 THEN")
    expect(F).toContain("NO_IMPORT_TO_REVERSE")
  })

  it("tính lại công nợ theo hóa đơn khi có", () => {
    expect(F).toContain("PERFORM public._wf2b_recompute_receivable(r.invoice_id);")
  })
})

// =====================================================================

describe("Hàm theo-đơn đổi vai, không bị gỡ", () => {
  /**
   * ⚠ PACK ĐỊNH GỠ Ở PHASE NÀY, VÀ GỠ THÌ HỎNG. Phiếu trả CHƯA gắn hóa
   * đơn vẫn cần nó: tiền giảm trừ của chúng không thuộc hóa đơn nào, nên
   * bản theo hóa đơn không thấy. Gỡ đi là khách trả hàng mà nợ không
   * giảm — im lặng, đúng kiểu hỏng cả hai pack đang chống.
   */
  it("_wf2_recompute_receivable vẫn còn, và được ghi lại vai mới", () => {
    expect(RAW127).toContain("COMMENT ON FUNCTION public._wf2_recompute_receivable(uuid) IS")
    expect(M127).toContain("Chỉ dùng cho phiếu trả chưa gắn hóa đơn")
    expect(M127).not.toContain("DROP FUNCTION IF EXISTS public._wf2_recompute_receivable")
  })

  /** Nhãn "cầu tạm chờ P6" phải biến mất — nó đã không còn đúng. */
  it("không còn tự gọi mình là cầu tạm", () => {
    expect(M127).not.toContain("CẦU TẠM")
  })
})

// =====================================================================

describe("Nền nếp chung của migration", () => {
  it("dừng hẳn nếu 124 chưa chạy", () => {
    expect(M127).toContain("'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 → 126 trước.'")
  })

  it("kết thúc bằng reload schema", () => {
    expect(M127).toContain("NOTIFY pgrst, 'reload schema'")
  })

  /**
   * ⚠ ĐẾM VÀ NÊU TÊN PHIẾU TRẢ SẼ KẸT. Phiếu chưa gắn hóa đơn thuộc một
   * đơn có NHIỀU hóa đơn sẽ dừng với `RETURN_NEEDS_INVOICE` khi ai đó
   * hoàn thành nó — báo trước lúc cài còn hơn để họ gặp giữa ca.
   */
  it("cảnh báo phiếu trả thuộc đơn có nhiều hóa đơn", () => {
    expect(M127).toContain("RETURN_NEEDS_INVOICE")
    expect(M127).toContain("IF v_multi > 0 THEN")
  })

  it("mọi hàm đặt search_path cố định", () => {
    const defs = (M127.match(/FUNCTION public\.\w+\(/g) ?? []).length
    const paths = (M127.match(/SET search_path = public/g) ?? []).length
    expect(defs).toBeGreaterThanOrEqual(3)
    expect(paths).toBeGreaterThanOrEqual(3)
  })

  it("mọi RAISE dùng ERRCODE P0001", () => {
    const raises = (M127.match(/RAISE EXCEPTION/g) ?? []).length
    const codes = (M127.match(/USING ERRCODE = 'P0001'/g) ?? []).length
    expect(raises).toBeGreaterThan(5)
    expect(codes).toBe(raises)
  })
})
