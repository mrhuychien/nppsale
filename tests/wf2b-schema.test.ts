import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  ORDER_STATUS_MAP,
  INVOICE_STATUS_MAP,
  NON_REVENUE_ORDER_STATUSES,
} from "../src/lib/constants"

/**
 * WORKFLOW V2B — P1: tách Đơn đặt hàng (SO) khỏi Hóa đơn bán (INV).
 *
 * Chốt ở đây canh phần CẤU TRÚC (migration 124). RPC ở 125, chốt riêng.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "")

const MIG124 = read("supabase/migrations/124_wf2b_sales_invoices.sql")
const M124 = sql(MIG124)

/** Cắt đúng thân một CREATE TABLE. */
function table(name: string): string {
  const i = M124.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`)
  expect(i, `không tìm thấy bảng ${name}`).toBeGreaterThan(0)
  return M124.slice(i, M124.indexOf("\n);", i))
}

/** Cắt đúng thân một hàm. */
function fn(name: string): string {
  const i = M124.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(i, `không tìm thấy hàm ${name}`).toBeGreaterThan(0)
  const j = M124.indexOf("\n$$;", i)
  return M124.slice(i, j > 0 ? j : undefined)
}

/**
 * ⚠ CHỐT QUAN TRỌNG NHẤT CỦA MIGRATION NÀY, VÀ NÓ CANH MỘT CHỖ IM LẶNG.
 *
 * Backfill đọc `sales_orders WHERE status = 'completed'` — giá trị do
 * mig 119 sinh ra. Trên cơ sở dữ liệu chưa chạy 119, bảng còn mang sáu
 * giá trị của luồng cũ và backfill khớp 0 dòng: nó chạy ÊM RU, tạo 0 hóa
 * đơn, không lỗi nào bắn. Rồi mọi thứ sau đó xây trên một bảng rỗng.
 */
describe("Chốt chặn: v2 phải chạy trước", () => {
  it("dừng hẳn nếu còn trạng thái của luồng cũ", () => {
    expect(M124).toContain(
      "WHERE status NOT IN ('draft', 'submitted', 'completed', 'cancelled')"
    )
    /**
     * ⚠ NEO VÀO CẢ CÂU RAISE, không hỏi "tệp có chữ WF2B_NEEDS_V2
     * không". Chuỗi đó còn xuất hiện ở phép kiểm thứ hai và trong chú
     * thích — đổi mã lỗi của ĐÚNG nhánh này mà chốt vẫn xanh. Đã thử phá
     * và nó lọt.
     */
    expect(M124).toContain(
      "'WF2B_NEEDS_V2: còn % đơn mang trạng thái của luồng cũ (%)"
    )
  })

  /** Hoàn kho khi huỷ hóa đơn dựa hẳn vào bảng này (mig 119). */
  it("dừng hẳn nếu chưa có stock_line_consumptions", () => {
    expect(M124).toContain("to_regclass('public.stock_line_consumptions') IS NULL")
  })

  it("nêu đúng thứ tự migration phải chạy", () => {
    expect(MIG124).toContain("118 → 119 → 120 → 121 → 122 → 123")
  })
})

describe("Hai bảng hóa đơn", () => {
  it("sales_invoices chỉ có hai trạng thái, KHÔNG có nháp", () => {
    const t = table("sales_invoices")
    expect(t).toContain("CHECK (status IN ('posted', 'cancelled'))")
    expect(t).not.toContain("'draft'")
  })

  /** Sửa hóa đơn = huỷ + lập lại; hai cột này nối hai bản. */
  it("sales_invoices có dây nối bản cũ ↔ bản mới", () => {
    const t = table("sales_invoices")
    expect(t).toContain("replaced_from  uuid REFERENCES sales_invoices(id)")
    expect(t).toContain("replaced_by    uuid REFERENCES sales_invoices(id)")
  })

  it("mã hóa đơn duy nhất theo đơn vị", () => {
    expect(M124).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_code")
    expect(M124).toContain("ON sales_invoices(org_id, invoice_code)")
  })

  /**
   * ⚠ `order_line_id` PHẢI CHO NULL: dòng hàng đổi đến từ phiếu trả, và
   * PATCH 1 cho NPP thêm dòng ngoài đơn lúc xuất.
   */
  it("dòng hóa đơn không bắt buộc gắn dòng đơn", () => {
    const t = table("sales_invoice_lines")
    expect(t).toContain("order_line_id     uuid REFERENCES sales_order_lines(id)")
    expect(t).not.toMatch(/order_line_id[^\n]*NOT NULL/)
  })

  /** Thuế suất snapshot tại thời điểm xuất — dòng đơn không lưu nó. */
  it("dòng hóa đơn có thuế suất riêng", () => {
    expect(table("sales_invoice_lines")).toContain("vat_rate          numeric NOT NULL DEFAULT 0")
  })
})

describe("invoiced_qty — đã xuất bao nhiêu", () => {
  /**
   * ⚠ TÍNH LẠI TỪ ĐẦU, KHÔNG CỘNG DỒN. `+= NEW.quantity` sai ngay lần
   * đầu có ai UPDATE hoặc DELETE một dòng hóa đơn, và sai theo kiểu
   * không bao giờ tự sửa được.
   */
  it("trigger tính lại tổng, không cộng dồn", () => {
    const f = fn("sync_invoiced_qty")
    expect(f).toContain("SELECT sum(sil.quantity)")
    expect(f).toContain("si.status = 'posted'")
    expect(f).not.toMatch(/invoiced_qty\s*=\s*invoiced_qty\s*[+-]/)
  })

  /**
   * ⚠ HUỶ HÓA ĐƠN KHÔNG XOÁ DÒNG NÀO — nó chỉ đổi `sales_invoices.status`.
   * Trigger gắn vào `sales_invoice_lines` sẽ KHÔNG chạy, và `invoiced_qty`
   * đứng yên: đơn mãi mãi hiện "đã xuất đủ" dù hóa đơn đã huỷ. Phải có
   * trigger thứ hai gắn vào chính bảng hóa đơn.
   */
  it("có trigger thứ hai cho lúc hóa đơn đổi trạng thái", () => {
    expect(M124).toContain("CREATE TRIGGER trg_sync_invoiced_qty_status")
    expect(M124).toContain("AFTER UPDATE OF status ON sales_invoices")
    expect(fn("sync_invoiced_qty_on_status")).toContain("si.status = 'posted'")
  })

  it("trigger trên dòng bắt đủ cả ba loại thay đổi", () => {
    const i = M124.indexOf("CREATE TRIGGER trg_sync_invoiced_qty\n")
    expect(M124.slice(i, i + 200)).toContain("AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines")
  })
})

describe("Sáu trạng thái đơn", () => {
  it("ràng buộc có đủ sáu giá trị", () => {
    const i = M124.indexOf("ADD CONSTRAINT chk_sales_orders_status_v2")
    const c = M124.slice(i, i + 300)
    for (const s of [
      "'draft'", "'submitted'", "'partially_invoiced'",
      "'completed'", "'closed'", "'cancelled'",
    ]) {
      expect(c, `ràng buộc thiếu ${s}`).toContain(s)
    }
  })

  /**
   * ⚠ ĐI LÙI PHẢI ĐƯỢC — và chỉ có một đường: huỷ hóa đơn. Không có
   * nhánh này thì một hóa đơn lập nhầm là đơn kẹt ở Hoàn thành vĩnh viễn.
   */
  it("completed và closed quay lui được", () => {
    const f = fn("check_order_status_transition")
    expect(f).toContain("WHEN 'completed' THEN NEW.status IN ('partially_invoiced', 'submitted')")
    expect(f).toContain("WHEN 'closed'    THEN NEW.status IN ('partially_invoiced', 'submitted')")
  })

  it("cancelled là điểm cuối", () => {
    expect(fn("check_order_status_transition")).toContain("ELSE false")
  })

  /**
   * ⚠ BA TRẠNG THÁI DO HÓA ĐƠN ĐIỀU KHIỂN, KHÔNG PHẢI NGƯỜI DÙNG. Để
   * client tự đặt là mở đường cho một đơn hiện Hoàn thành mà chưa hóa
   * đơn nào trừ kho.
   */
  it("vào/ra ba trạng thái hóa đơn chỉ qua RPC", () => {
    const f = fn("check_order_status_transition")
    expect(f).toContain("OR NEW.status IN ('partially_invoiced', 'completed', 'closed')")
    expect(f).toContain("current_setting('npp.via_rpc', true)")
    expect(f).toContain("USE_RPC")
  })

  it("đóng dấu closed_at khi đóng đơn", () => {
    expect(fn("check_order_status_transition")).toContain("NEW.closed_at := now()")
  })
})

describe("Khoá dòng đơn sau khi đã xuất", () => {
  /**
   * ⚠ Sửa dòng của đơn đã xuất là làm lệch `invoiced_qty` so với thứ đã
   * thật sự rời kho — và lệch IM LẶNG, vì không lệnh nào báo.
   */
  it("chặn sửa dòng khi đơn đã có hóa đơn", () => {
    const f = fn("guard_order_lines_locked")
    expect(f).toContain("v_status IN ('partially_invoiced', 'completed', 'closed')")
    expect(f).toContain("ORDER_LOCKED")
    expect(M124).toContain("BEFORE INSERT OR UPDATE OR DELETE ON sales_order_lines")
  })

  /** RPC vẫn phải sửa được — nó là đường hợp lệ duy nhất. */
  it("RPC đi qua được nhờ cờ via_rpc", () => {
    expect(fn("guard_order_lines_locked")).toContain(
      "IF COALESCE(current_setting('npp.via_rpc', true), '') = 'on' THEN"
    )
  })
})

describe("Trần trả hàng đổi mốc sang hóa đơn", () => {
  /**
   * ⚠ TRẢ THEO THỨ ĐÃ XUẤT, KHÔNG THEO THỨ ĐÃ ĐẶT. Đơn đặt 100 mà mới
   * xuất 40 thì trần là 40. So với dòng ĐƠN là cho phép khách trả 100 —
   * nhập kho 60 món chưa từng rời kho.
   */
  it("đếm theo dòng hóa đơn, không theo dòng đơn", () => {
    const f = fn("enforce_return_line_cap")
    expect(f).toContain("FROM sales_invoice_lines sil")
    expect(f).toContain("SELECT r.invoice_id INTO v_invoice")
    expect(f).not.toContain("FROM sales_order_lines sol")
  })

  it("chỉ đếm hóa đơn đã xuất, bỏ dòng đổi", () => {
    const f = fn("enforce_return_line_cap")
    expect(f).toContain("si.status = 'posted'")
    expect(f).toContain("sil.is_exchange = false")
  })

  /** Phiếu trả không gắn hóa đơn thì bỏ qua — không có mốc để so. */
  it("phiếu trả không gắn hóa đơn vẫn lập được", () => {
    expect(fn("enforce_return_line_cap")).toContain("IF v_invoice IS NULL THEN")
  })
})

describe("Khoá ngoại sang hóa đơn", () => {
  it("bốn bảng đều có đường sang hóa đơn", () => {
    for (const [t, c] of [
      ["receivables", "invoice_id"],
      ["cash_receipt_lines", "invoice_id"],
      ["returns", "invoice_id"],
      ["invoices", "sales_invoice_id"],
    ]) {
      expect(M124, `${t} thiếu ${c}`).toContain(
        `ALTER TABLE ${t}\n  ADD COLUMN IF NOT EXISTS ${c} uuid REFERENCES sales_invoices(id)`
      )
    }
  })

  /**
   * ⚠ GIỮ `order_id` Ở CẢ BỐN BẢNG. Dữ liệu cũ chỉ có nó; bỏ đi là mọi
   * báo cáo lịch sử đứt.
   */
  it("không bỏ cột order_id nào", () => {
    expect(M124).not.toMatch(/ALTER TABLE \w+[\s\S]{0,60}DROP COLUMN[^\n]*order_id/)
  })

  /** Hai dòng công nợ cho một hóa đơn là khách bị đòi hai lần. */
  it("một hóa đơn chỉ một dòng công nợ", () => {
    expect(M124).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_invoice_unique")
    expect(M124).toContain("WHERE invoice_id IS NOT NULL")
  })
})

describe("Phân quyền", () => {
  /**
   * ⚠ KHÔNG POLICY GHI NÀO CHO CLIENT. Mở một INSERT ở đây là mở luôn
   * đường lập hóa đơn mà không trừ kho.
   */
  it("hai bảng hóa đơn chỉ cho ĐỌC", () => {
    for (const t of ["sales_invoices", "sales_invoice_lines"]) {
      expect(M124).toContain(`ALTER TABLE ${t}`)
      expect(M124, `${t} có policy ghi`).not.toMatch(
        new RegExp(`CREATE POLICY[^\\n]*ON ${t}\\s*\\n\\s*FOR (INSERT|UPDATE|DELETE|ALL)`)
      )
    }
    expect(M124).toContain("CREATE POLICY sales_invoices_select ON sales_invoices")
  })

  it("NVBH chỉ thấy hóa đơn của đơn mình", () => {
    const i = M124.indexOf("CREATE POLICY sales_invoices_select")
    const p = M124.slice(i, i + 700)
    /**
     * ⚠ HAI NHÁNH, VÀ CHUỖI CỦA CHÚNG LỒNG NHAU: `so.sales_user_id =
     * auth.uid()` CHỨA `sales_user_id = auth.uid()`. Hỏi chuỗi ngắn là
     * chốt vẫn xanh sau khi nhánh thứ nhất bị thay bằng `OR true` — đã
     * thử phá và nó lọt. Neo có cả dấu `OR` và khoảng thụt.
     */
    expect(p).toContain("\n      OR sales_user_id = auth.uid()")
    expect(p).toContain("so.sales_user_id = auth.uid()")
    // Và không có nhánh nào mở toang.
    expect(p, "policy có nhánh cho qua vô điều kiện").not.toMatch(/\bOR true\b/)
  })
})

describe("Backfill", () => {
  it("đọc đúng tập đơn cần chuyển", () => {
    expect(M124).toContain("WHERE so.status = 'completed'")
    // Đơn huỷ SAU khi đã xuất cũng phải có hóa đơn, để lịch sử khớp.
    expect(M124).toContain("OR (so.status = 'cancelled' AND so.completed_at IS NOT NULL)")
  })

  /**
   * ⚠ KHÔNG ĐOÁN. Đơn `completed` mà không có phiếu xuất nào đã ghi sổ
   * vẫn tạo hóa đơn (để công nợ có chỗ bám) nhưng `stock_entry_id` để
   * TRỐNG và liệt kê ra. Gán bừa một phiếu xuất là dựng chứng từ không
   * có thật.
   */
  it("đơn không có phiếu xuất thì để trống và NÓI RA", () => {
    expect(M124).toContain("KHÔNG có phiếu xuất đã ghi sổ")
    expect(M124).toContain("v_no_entry := v_no_entry + 1")
  })

  it("đơn có nhiều phiếu xuất được ghi chú lại", () => {
    expect(MIG124).toContain("phiếu xuất (do sửa ở v2); stock_entry_id lấy phiếu đầu")
  })

  it("gắn cả bốn loại chứng từ con sang hóa đơn", () => {
    expect(M124).toContain("UPDATE receivables SET invoice_id = v_inv")
    expect(M124).toContain("UPDATE cash_receipt_lines SET invoice_id = v_inv")
    expect(M124).toContain("UPDATE returns SET invoice_id = v_inv")
    expect(M124).toContain("UPDATE invoices SET sales_invoice_id = v_inv")
  })

  /** Phiếu trả còn nháp chưa thuộc hóa đơn nào. */
  it("không gắn phiếu trả còn nháp", () => {
    const i = M124.indexOf("UPDATE returns SET invoice_id = v_inv")
    expect(M124.slice(i, i + 200)).toContain("status <> 'draft'")
  })

  it("đếm và đối chiếu số đơn với số hóa đơn", () => {
    expect(MIG124).toContain("hai con số trên LỆCH NHAU")
  })
})

/**
 * ⚠ M7 — BỘ CHỐT CỦA V2 ĐANG MÔ TẢ BA HÀM MÀ 124 GỠ BỎ.
 *
 * `tests/workflow-v2-rpcs.test.ts` đọc THÂN HÀM trong tệp migration 120,
 * nên nó vẫn xanh sau khi 124 chạy — mã nguồn 120 không đổi, chỉ có cơ
 * sở dữ liệu là không còn hàm. Đó là chốt XANH MÀ SAI: nó khẳng định
 * `cancel_order` có nhánh này nhánh kia, trong khi `cancel_order` của
 * 120 đã bị xoá.
 *
 * Không xoá bộ chốt đó (nó là trí nhớ vì sao 120 viết như vậy), nhưng
 * phải có chốt ở đây khẳng định ba hàm ĐÃ ĐƯỢC GỠ — để ai đọc cũng thấy
 * ngay hai tệp đang nói về hai thời điểm khác nhau.
 */
describe("Gỡ cơ chế sửa đơn đã hoàn thành", () => {
  it("bốn hàm của v2 đều bị DROP", () => {
    for (const f of [
      "public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text)",
      "public.complete_order(uuid)",
      "public.cancel_order(uuid, text)",
      "public._wf2_assert_order_unlocked(uuid, date, boolean)",
      "public._wf2_recompute_receivable(uuid)",
    ]) {
      expect(M124, `chưa DROP ${f}`).toContain(`DROP FUNCTION IF EXISTS ${f}`)
    }
  })

  /**
   * ⚠ `_wf2_assert_order_unlocked` PACK KHÔNG NHẮC. Nó là chỗ DUY NHẤT
   * còn đọc `completed_edit_days`; để lại là mã chết đọc một cột đã
   * ngưng dùng, và người sau đọc nó rồi tưởng cơ chế còn sống.
   */
  it("cột completed_edit_days được đánh dấu ngưng dùng", () => {
    // ⚠ Đọc bản ĐÃ BỎ CHÚ THÍCH: `-- COMMENT ON COLUMN …` vẫn chứa đủ
    //   chuỗi, nên hỏi trên bản thô thì bình luận hoá cả lệnh mà chốt
    //   vẫn xanh.
    expect(M124).toContain("COMMENT ON COLUMN organizations.completed_edit_days")
    expect(M124).toContain("NGƯNG DÙNG")
  })

  /** Hai file phải đi cùng nhau — nói to ngay đầu file. */
  it("cảnh báo 124 và 125 không tách rời", () => {
    expect(MIG124).toContain("124 VÀ 125 PHẢI CHẠY CÙNG NHAU")
  })
})

describe("Nhãn trạng thái không được để trống ô nào", () => {
  /**
   * ⚠ Migration cho phép sáu giá trị tồn tại; bảng nhãn thiếu một khoá
   * là một ô trống trên màn, và người dùng không biết đang nhìn gì.
   */
  it("đủ nhãn cho sáu trạng thái đơn", () => {
    for (const s of [
      "draft", "submitted", "partially_invoiced", "completed", "closed", "cancelled",
    ]) {
      expect(ORDER_STATUS_MAP[s], `thiếu nhãn ${s}`).toBeTruthy()
    }
  })

  it("đủ nhãn cho hai trạng thái hóa đơn, và KHÔNG có nháp", () => {
    expect(INVOICE_STATUS_MAP.posted?.label).toBe("Đã xuất")
    expect(INVOICE_STATUS_MAP.cancelled?.label).toBe("Đã hủy")
    expect(INVOICE_STATUS_MAP.draft).toBeUndefined()
  })

  /**
   * ⚠ CHỐT NÀY TỪNG KHẲNG ĐỊNH ĐIỀU NGƯỢC LẠI, VÀ NÓ ĐÃ SAI.
   *
   * Bản P1 bắt `partially_invoiced` và `closed` phải NẰM NGOÀI doanh
   * thu, với lý do "phần đã xuất đã được hóa đơn con tính rồi". Lý do đó
   * không đúng ở thời điểm ấy: P1 chưa có hàm nào cộng tiền từ hóa đơn,
   * nên doanh thu của một đơn xuất một phần không được tính Ở ĐÂU CẢ —
   * hàng ra khỏi kho, công nợ đã ghi, mà sổ doanh thu im lặng. Chốt xanh
   * chỉ vì nó khớp với `is_revenue_status` của v2 (`= 'completed'`) chứ
   * không vì nó đúng.
   *
   * Mig 126 tách hai câu hỏi ra: `is_revenue_status` nay trả lời "đơn
   * này đã xuất hàng chưa" (ĐẾM ĐƠN), còn SỐ TIỀN cộng từ
   * `sales_invoices`. Cộng hai lần không xảy ra vì không ai cộng
   * `sales_orders.total` nữa.
   */
  it("đơn xuất một phần và đơn đã đóng ĐỀU đã sinh doanh thu", () => {
    expect(NON_REVENUE_ORDER_STATUSES).not.toContain("partially_invoiced")
    expect(NON_REVENUE_ORDER_STATUSES).not.toContain("closed")
    expect(NON_REVENUE_ORDER_STATUSES).not.toContain("completed")
    // Ba trạng thái chưa từng đụng kho thì vẫn ngoài doanh thu.
    expect([...NON_REVENUE_ORDER_STATUSES].sort()).toEqual(
      ["cancelled", "draft", "submitted"]
    )
  })
})
