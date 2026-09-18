import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  explainReturnError,
  RETURN_ZONES,
} from "../src/lib/returns/complete-return"
import {
  explainReceiptError,
  cashToCollect,
} from "../src/lib/finance/cash-receipt"
import { RETURN_STATUS_MAP } from "../src/lib/constants"

/**
 * P6 — Đơn trả và Phiếu thu là HAI CHỨNG TỪ ĐỘC LẬP, mỗi cái tự khép kín
 * với công nợ (Coder Pack mục 6).
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích: lời giải thích nhắc lại tên cũ, soi cả nó là đếm nhầm. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const RET_NEW = code(read("src/app/(dashboard)/returns/new/page.tsx"))
const RET_DETAIL = code(read("src/app/(dashboard)/returns/[id]/page.tsx"))
const RECEIPT_NEW = code(read("src/app/(dashboard)/finance/cash-receipts/new/page.tsx"))
const RECEIPT_DETAIL = code(read("src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx"))
const RETURNS_LIB = code(read("src/lib/returns.ts"))
const MIG120 = read("supabase/migrations/120_workflow_v2_rpcs.sql")

describe("Phiếu trả ra đời ở Phiếu tạm, không phải Hoàn thành", () => {
  /**
   * ⚠ ĐÂY LÀ CHỖ HÀNG TRẢ TỪNG BỐC HƠI. Migration 120 gỡ trigger tự nhập
   * kho, nên một phiếu đặt thẳng vào 'completed' không nhập kho, không
   * giảm công nợ — nhưng `credited_at` vẫn đóng dấu nên BÁO CÁO thì đổi.
   * Sổ báo cáo và sổ công nợ nói hai đằng, và phiếu kẹt vĩnh viễn:
   * `complete_return` đòi 'submitted', `cancel_return` ném
   * NO_IMPORT_TO_REVERSE.
   */
  it("màn lập phiếu tay ghi 'submitted', không ghi thẳng 'completed'", () => {
    const i = RET_NEW.indexOf('.from("returns")')
    expect(i).toBeGreaterThan(0)
    const block = RET_NEW.slice(i, i + 900)
    expect(block).toContain('status: "submitted"')
    expect(block, "lại lập thẳng vào hoàn thành").not.toContain('status: "completed"')
  })

  /** Và đừng hứa đã trừ công nợ cho một việc chưa xảy ra. */
  it("thông báo sau khi lập không hứa đã trừ công nợ", () => {
    expect(RET_NEW).not.toContain("Trừ công nợ ${formatCurrency(credit)}")
    expect(RET_NEW).toContain("chờ bấm Hoàn thành")
  })

  /** Trigger tự nhập kho đã bị gỡ — RPC là đường duy nhất còn lại. */
  it("migration 120 thật sự gỡ trigger nhập kho tự động", () => {
    expect(MIG120).toContain("trg_auto_restock_return")
    expect(MIG120).toContain("auto_restock_on_return")
    expect(MIG120).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_auto_restock_return/)
  })
})

describe("Hoàn thành / huỷ phiếu trả đi qua RPC", () => {
  it("màn chi tiết gọi RPC, không ghi thẳng trạng thái", () => {
    expect(RET_DETAIL).toContain("completeReturn(supabase, ret.id, zone)")
    expect(RET_DETAIL).toContain("cancelReturn(supabase, ret.id, reason)")
    expect(RET_DETAIL, "còn ghi thẳng trạng thái phiếu trả").not.toMatch(
      /\.update\(\{\s*status:/
    )
  })

  /**
   * ⚠ KHO NHẬN LÀ QUYẾT ĐỊNH CỦA NGƯỜI DUYỆT. `complete_return` bắt buộc
   * `p_zone IN ('sale','date')` và ghi vào `returns.destination_zone`.
   * Mặc định thầm một bên là hoặc đem hàng cận hạn bán tiếp, hoặc chôn
   * hàng còn tốt vào kho chờ xử lý.
   */
  it("người duyệt chọn kho nhận, hai lựa chọn khớp ràng buộc của RPC", () => {
    expect(RETURN_ZONES.map((z) => z.value).sort()).toEqual(["date", "sale"])
    expect(RET_DETAIL).toContain("RETURN_ZONES.map(")
    expect(RET_DETAIL).toContain("setZone(")
    const i = MIG120.indexOf("BAD_ZONE")
    expect(i).toBeGreaterThan(0)
    expect(MIG120.slice(i - 200, i)).toContain("'sale'")
  })

  /**
   * ⚠ GÀI NÚT BẰNG ĐÚNG TÊN QUYỀN RPC KIỂM. Hai RPC đều hỏi
   * `returns.approve`; gài bằng quyền khác là nút hiện ra rồi RPC ném
   * FORBIDDEN sau khi người dùng đã bấm.
   */
  it("gài nút bằng returns.approve, đúng tên quyền RPC kiểm", () => {
    expect(RET_DETAIL).toContain('hasPermission(user.role, "returns", "approve")')
    expect(MIG120).toContain("'returns.approve'")
  })

  /** Huỷ bắt buộc có lý do — RPC ném REASON_REQUIRED khi để trống. */
  it("hỏi lý do huỷ trước khi gọi, không để RPC từ chối sau", () => {
    expect(RET_DETAIL).toContain("cancelReason.trim()")
    expect(RET_DETAIL).toContain("disabled={actionLoading || !cancelReason.trim()}")
  })

  /**
   * ⚠ RPC RAISE với ERRCODE P0001 mà `errorMessage` dùng chung không biết
   * mã đó — nó in nguyên văn kỹ thuật kèm "(mã P0001)".
   */
  it("dịch đủ mã lỗi của hai RPC đơn trả", () => {
    expect(explainReturnError("… RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm")).toContain(
      "không còn ở Phiếu tạm"
    )
    /**
     * ⚠ SO BẰNG `toBe`, KHÔNG PHẢI `toContain`. Bản đầu của hai chốt này
     * dùng `toContain` với một cụm chữ CÓ SẴN trong thông điệp gốc của
     * RPC — thử phá bằng cách xoá hẳn nhánh dịch mà chúng VẪN XANH, vì
     * nhánh cuối `return m` trả nguyên văn và nguyên văn thì chứa đúng
     * cụm ấy. Chốt nói dối thì phải sửa chốt.
     */
    expect(explainReturnError("… BAD_ZONE: kho nhận phải là sale hoặc date")).toBe(
      "Phải chọn kho nhận: kho bán hoặc kho cận date."
    )
    expect(explainReturnError("… ORDER_NOT_COMPLETED: đơn gốc chưa xuất hàng")).toBe(
      "Đơn gốc chưa xuất hàng nên chưa nhập trả được. Xuất hàng cho đơn đó trước."
    )
    expect(explainReturnError("… LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ")).toContain(
      "huỷ phiếu thu trước"
    )
    expect(explainReturnError("… FORBIDDEN: bạn không có quyền hoàn thành đơn trả")).toBe(
      "bạn không có quyền hoàn thành đơn trả"
    )
    // ⚠ Lỗi lạ trả NGUYÊN VĂN — đoán sai rồi họ đi sửa nhầm chỗ còn tệ hơn.
    expect(explainReturnError("một lỗi chưa ai gặp")).toBe("một lỗi chưa ai gặp")
  })
})

describe("Phiếu thu: lập, cấn trừ, và huỷ trả công nợ về", () => {
  /**
   * ⚠ CON SỐ KHÁCH ĐƯA = khoản nợ đã chọn − khoản có cấn trừ. Đây đúng là
   * con số RPC ghi vào phiếu; hiện tổng khoản nợ thay cho nó là bảo kế
   * toán thu nhiều hơn số khách phải trả.
   */
  it("số tiền khách đưa trừ đi phần cấn trừ", () => {
    expect(cashToCollect(1_000_000, 300_000)).toBe(700_000)
    // Cấn trừ vượt thì không ra số ÂM — RPC chặn bằng CREDIT_EXCEEDS_SELECTED.
    expect(cashToCollect(300_000, 1_000_000)).toBe(0)
    // Q11 thêm nguồn thứ ba: phần rút từ số dư có của khách. Ô "Khách
    // đưa" phải trừ cả ba, không phải hai — chi tiết ở
    // `workflow-v2-q11-credit.test.ts`.
    expect(RECEIPT_NEW).toContain("cashToCollect(linesTotal, creditsTotal, useCredit)")
    expect(RECEIPT_NEW).toContain("Khách đưa")
  })

  /**
   * ⚠ CHỈ PHIẾU TRẢ ĐỘC LẬP MỚI ĐEM CẤN TRỪ ĐƯỢC. Phiếu gắn đơn đã giảm
   * nợ ngay lúc `complete_return` chạy (`_wf2_recompute_receivable`);
   * đem vào đây nữa là trừ HAI LẦN. RPC từ chối bằng `BAD_CREDIT`, nên
   * màn hình phải lọc y hệt — rộng hơn thì người dùng tick được thứ RPC
   * sẽ từ chối, hẹp hơn thì khoản có nằm chờ mãi không ai thấy.
   */
  it("danh sách cấn trừ lọc đúng ba điều kiện RPC kiểm", () => {
    expect(RECEIPT_NEW).toContain('.eq("status", "completed")')
    expect(RECEIPT_NEW).toContain('.is("order_id", null)')
    expect(RECEIPT_NEW).toContain('.is("applied_receipt_id", null)')
    // Và RPC kiểm đúng ba điều đó.
    /**
     * ⚠ NEO VÀO CHÍNH PHÉP KIỂM, không cắt một cửa sổ ký tự quanh chỗ
     * RAISE — chú thích dài ngắn thay đổi là cửa sổ hụt hoặc thừa, và
     * chốt đỏ vì lý do chẳng liên quan gì tới điều nó canh.
     */
    const i = MIG120.indexOf("FROM returns r\n      WHERE r.id = c.id")
    expect(i, "không tìm thấy vòng kiểm khoản có").toBeGreaterThan(0)
    const guard = MIG120.slice(i, MIG120.indexOf("BAD_CREDIT", i))
    expect(guard).toContain("r.status = 'completed'")
    expect(guard).toContain("r.order_id IS NULL")
    expect(guard).toContain("r.applied_receipt_id IS NULL")
  })

  /**
   * ⚠ HUỶ PHIẾU THU LÀ ĐẢO CÔNG NỢ. Bản cũ chỉ `update({ status:
   * "voided" })` rồi dừng — để nguyên `payments` đã ghi và
   * `receivables.paid` đã cộng, nên khách hiện ra đã trả tiền trong khi
   * phiếu thu đã huỷ, và khoản có của phiếu trả vẫn mang dấu đã cấn trừ
   * nên không dùng lại được.
   */
  it("huỷ phiếu thu đi qua RPC, không đổi mỗi một cột", () => {
    expect(RECEIPT_DETAIL).toContain("voidCashReceipt(supabase, receipt.id, reason)")
    expect(RECEIPT_DETAIL, "lại đổi thẳng trạng thái phiếu thu").not.toContain(
      '.update({ status: "voided" })'
    )
    expect(RECEIPT_DETAIL).toContain("voidReason.trim()")
    // RPC phải thật sự đảo: xoá payments và trừ lại paid.
    /**
     * ⚠ NEO VÀO ĐỊNH NGHĨA HÀM, không vào lần nhắc tên đầu tiên. Q11 thêm
     * một khối chú thích nhắc `void_cash_receipt` ở TRÊN nó, nên
     * `indexOf` bắt trúng chú thích và cửa sổ 3000 ký tự trượt khỏi thân
     * hàm — chốt đỏ vì lý do chẳng liên quan gì tới điều nó canh.
     */
    const i = MIG120.indexOf("CREATE OR REPLACE FUNCTION public.void_cash_receipt")
    expect(i).toBeGreaterThan(0)
    const fn = MIG120.slice(i, MIG120.indexOf("\n$$;", i))
    expect(fn).toContain("DELETE FROM payments")
    expect(fn).toContain("applied_receipt_id = NULL")
  })

  it("dịch đủ mã lỗi của hai RPC phiếu thu", () => {
    expect(explainReceiptError("… CUSTOMER_REQUIRED")).toContain("khách hàng")
    expect(explainReceiptError("… EMPTY_RECEIPT")).toContain("Chưa chọn khoản nợ")
    expect(explainReceiptError("… CREDIT_EXCEEDS_SELECTED")).toContain("lớn hơn số nợ đã chọn")
    expect(explainReceiptError("… BAD_RECEIVABLE_LINE")).toContain("vượt số còn nợ")
    expect(explainReceiptError("… BAD_CREDIT")).toContain("KHÔNG gắn đơn nào")
    expect(explainReceiptError("… REASON_REQUIRED")).toContain("lý do")
    expect(explainReceiptError("một lỗi chưa ai gặp")).toBe("một lỗi chưa ai gặp")
  })

  /** Gài nút lập phiếu bằng đúng tên quyền RPC kiểm. */
  it("quyền lập phiếu thu khớp hai đầu", () => {
    expect(RECEIPT_NEW).toContain('hasPermission(user.role, "receivables", "create")')
    expect(MIG120).toContain("'receivables.create'")
    expect(MIG120).toContain("'receivables.update'")
  })
})

describe("Công nợ chỉ trừ phiếu trả ĐÃ hoàn thành", () => {
  /**
   * ⚠ Bộ lọc cũ hỏi `["approved", "completed"]`. Migration 119 backfill
   * 'approved' đi và `chk_returns_status_v2` cấm nó, nên phép cộng đếm
   * THIẾU — công nợ tính ra CAO hơn số khách thật sự nợ, và không lỗi nào
   * bắn ra.
   */
  it("bản TypeScript của phép tính công nợ lọc đúng một trạng thái", () => {
    const i = RETURNS_LIB.indexOf("recomputeReceivableForOrder")
    expect(i).toBeGreaterThan(0)
    const fn = RETURNS_LIB.slice(i, i + 1600)
    expect(fn).toContain('.eq("status", "completed")')
    expect(fn, "còn lọc trạng thái đã bị bỏ").not.toContain('"approved"')
  })

  /** Nhãn phải phân biệt được phiếu chờ xử lý với phiếu đã nhập kho. */
  it("nhãn trạng thái phiếu trả nói đúng hàng đã vào kho chưa", () => {
    expect(RETURN_STATUS_MAP.submitted.label).toBe("Chờ xử lý")
    expect(RETURN_STATUS_MAP.completed.label).toBe("Đã nhập kho")
    expect(RETURN_STATUS_MAP.cancelled.label).toBe("Đã huỷ")
    // Bốn trạng thái v2 không được dùng chung một nhãn.
    const v2 = ["draft", "submitted", "completed", "cancelled"].map(
      (k) => RETURN_STATUS_MAP[k].label
    )
    expect(new Set(v2).size).toBe(4)
  })
})

/**
 * Những gì lượt đo P6 bắt được sau khi tôi đã commit vòng đầu. Chúng có
 * chung một hình dạng: lệnh ghi im lặng, và câu hướng dẫn nói về luồng
 * đã chết.
 */
describe("lỗi lượt đo bắt được ở màn đơn trả", () => {
  const RET_LIST = code(read("src/app/(dashboard)/returns/page.tsx"))

  /**
   * ⚠ BẢNG `returns` KHÔNG CÓ MỘT POLICY DELETE NÀO, và policy UPDATE chỉ
   * mở cho owner/manager trong khi nút Sửa bật theo `returns.update` —
   * quyền mà bảng phân quyền cấp cho cả thủ kho. Cả hai lệnh vì thế trả
   * 0 dòng + HTTP 200 + error null, và màn báo thành công: chủ bấm Xoá
   * thấy "Đã xoá" rồi bị đẩy về danh sách nơi phiếu vẫn nằm đó.
   */
  it("hai lệnh ghi ở màn chi tiết đều đếm số dòng trả về", () => {
    const del = RET_DETAIL.slice(RET_DETAIL.indexOf("const handleDelete"), RET_DETAIL.indexOf("const handleComplete"))
    expect(del).toContain('.select("id")')
    expect(del).toContain("data.length === 0")

    const edit = RET_DETAIL.slice(RET_DETAIL.indexOf("const handleSaveEdit"), RET_DETAIL.indexOf("if (authLoading"))
    expect(edit).toContain('.select("id")')
    expect(edit).toContain("data.length === 0")
  })

  /**
   * ⚠ CÔNG NỢ CHỈ ĐƯỢC TÍNH LẠI BÊN TRONG RPC. Sửa tay số tiền của một
   * phiếu ĐÃ hoàn thành là `receivables` và `returns` lệch nhau vĩnh
   * viễn — không lệnh nào kéo về được. Khoá ở CẢ ô nhập lẫn hàm lưu:
   * khoá một chỗ là còn đường vòng.
   */
  it("phiếu đã hoàn thành thì khoá số tiền, khoá ở cả hai chỗ", () => {
    const edit = RET_DETAIL.slice(RET_DETAIL.indexOf("const handleSaveEdit"), RET_DETAIL.indexOf("if (authLoading"))
    expect(edit).toContain('if (ret.status !== "completed") {')
    expect(RET_DETAIL).toContain('ret.status === "completed" ? (')
  })

  /**
   * ⚠ `OVERPAID_AFTER_CREDIT` BẮN GIÁN TIẾP từ `_wf2_recompute_receivable`
   * chứ không nằm trong thân `complete_return`, nên rất dễ quên dịch. Nó
   * rollback CẢ lần hoàn thành, kể cả phần nhập kho.
   * ⚠ Và thông điệp gốc bảo "huỷ phiếu thu trước" — việc người dùng
   * thường KHÔNG làm được, vì tiền có thể vào qua màn thu theo công nợ
   * và khi đó không có phiếu thu nào để huỷ.
   */
  it("dịch được mã lỗi bắn gián tiếp, và không lặp lại lời khuyên bế tắc", () => {
    const out = explainReturnError(
      "… OVERPAID_AFTER_CREDIT: khách đã trả 10000000 nhưng nợ còn 7000000, huỷ phiếu thu trước khi ghi có"
    )
    expect(out).toContain("đảo bớt tiền đã thu")
    expect(out).toContain("không qua phiếu thu")
    expect(out).not.toBe(
      "… OVERPAID_AFTER_CREDIT: khách đã trả 10000000 nhưng nợ còn 7000000, huỷ phiếu thu trước khi ghi có"
    )
  })

  /**
   * ⚠ `cancel_return` chặn khi đơn gốc đã thu tiền — DÙ CHỈ MỘT ĐỒNG, và
   * chặn cho mọi khoản thu chứ không riêng khoản liên quan phiếu trả.
   * Nói trước, đừng để người dùng gõ xong lý do rồi mới nhận lỗi.
   */
  it("nói trước hai khoá của việc huỷ phiếu đã hoàn thành", () => {
    expect(RET_DETAIL).toContain("đơn gốc đã thu")
    expect(RET_DETAIL).toContain("dù chỉ một phần")
  })

  /**
   * ⚠ CÂU HƯỚNG DẪN CŨ LÀ NGUYÊN NHÂN CỦA CẢ MỘT LỚP LỖI: nó bảo người
   * dùng "chỉ để tra cứu, không cần thao tác duyệt". Ai đọc rồi bỏ đi là
   * hàng trả nằm ngoài sổ.
   */
  it("màn danh sách không còn bảo người dùng bỏ qua phiếu trả", () => {
    expect(RET_LIST).not.toContain("không cần thao tác duyệt")
    expect(RET_LIST).not.toContain("Bàn giao lại")
    expect(RET_LIST).toContain("cần có người bấm Hoàn thành")
  })

  /** Hàng đợi việc thì mở ra ở việc phải làm, không phải ở sổ tra cứu. */
  it("danh sách mở ra ở tab Chờ xử lý và lọc theo trạng thái ở máy chủ", () => {
    expect(RET_LIST).toContain('useState<string>("submitted")')
    expect(RET_LIST).toContain('q = q.eq("status", statusFilter)')
    expect(RET_LIST).toContain("RETURN_TABS.map(")
  })
})

/**
 * Bốn quyết định của chủ nhà sau lượt báo cáo P6 (sổ câu hỏi Q8, Q10,
 * Q11, Q12). Ba cái sửa migration TẠI CHỖ vì 118/119/120 chưa chạy ở đâu.
 */
describe("Q8 — trần số lượng trả kiểm lại lúc hàng vào kho", () => {
  const MIG118 = read("supabase/migrations/118_delete_order_cleans_returns.sql")

  /**
   * ⚠ LỖ CŨ, DỰNG LẠI ĐƯỢC BẰNG BA BƯỚC: trigger `enforce_return_line_cap`
   * chạy lúc CHÈN DÒNG và phần "đã trả rồi" của nó chỉ đếm phiếu
   * 'completed'. Đơn bán 10 → phiếu A 10 lọt (đã trả = 0) → phiếu B 10
   * cũng lọt (vẫn = 0, vì A còn ở 'submitted') → hoàn thành cả hai →
   * nhập kho 20 và trừ công nợ gấp đôi.
   */
  it("complete_return tự kiểm trần, không tin mỗi trigger lúc chèn dòng", () => {
    const i = MIG120.indexOf("CREATE OR REPLACE FUNCTION public.complete_return")
    const fn = MIG120.slice(i, MIG120.indexOf("\n$$;", i))
    expect(fn).toContain("RETURN_QTY_EXCEEDS")
    /**
     * ⚠ NEO VÀO CHÍNH BIỂU THỨC SO SÁNH, không chỉ vào cái tên mã lỗi.
     * Thử phá lần đầu: đổi `IF cap.need + v_returned > v_sold THEN` thành
     * `IF false THEN` — phép kiểm chết hẳn mà chốt VẪN XANH, vì mọi chuỗi
     * nó soi đều còn nguyên bên trong nhánh đã chết.
     */
    expect(fn, "phép kiểm trần không còn sống").toContain(
      "IF cap.need + v_returned > v_sold THEN"
    )
    // Đếm phần "đã trả" từ phiếu ĐÃ hoàn thành của cùng đơn.
    expect(fn).toContain("r2.status = 'completed'")
    expect(fn).toContain("r2.order_id = r.order_id")
    // Và phải kiểm TRƯỚC khi dựng phiếu nhập — chặn sau là đã cộng tồn rồi.
    expect(fn.indexOf("RETURN_QTY_EXCEEDS")).toBeLessThan(fn.indexOf("INSERT INTO stock_entries"))
  })

  /**
   * ⚠ DÒNG ĐỔI KHÔNG TÍNH VÀO TRẦN — hàng đổi không trừ công nợ và không
   * bị chặn bởi số đã bán. Nhưng nó VẪN phải được nhập kho.
   */
  it("trần bỏ qua dòng đổi, còn vòng nhập kho thì không", () => {
    const i = MIG120.indexOf("CREATE OR REPLACE FUNCTION public.complete_return")
    const fn = MIG120.slice(i, MIG120.indexOf("\n$$;", i))
    /**
     * ⚠ NEO VÀO ĐÚNG DÒNG NGUỒN CỦA PHÉP TÍNH TRẦN. Thử phá lần đầu: bỏ
     * `AND rl.is_exchange = false` khỏi vòng gom nhu cầu — chốt VẪN XANH,
     * vì cửa sổ 2000 ký tự còn chứa một `is_exchange = false` KHÁC (của
     * truy vấn đếm phần đã trả). Cùng một chuỗi, hai chỗ, hai ý nghĩa.
     */
    expect(fn, "phép tính trần đang tính cả dòng đổi").toContain(
      "WHERE rl.return_id = p_return_id AND rl.is_exchange = false"
    )
    const loop = fn.slice(fn.indexOf("FOR l IN"), fn.indexOf("UPDATE returns"))
    expect(loop).not.toContain("is_exchange = false")
  })

  it("dịch mã lỗi mới sang tiếng Việt", () => {
    expect(
      explainReturnError('… RETURN_QTY_EXCEEDS: "Sữa X" — đã bán 10, đã hoàn thành trả 10, phiếu này thêm 10 là vượt')
    ).toBe('Trả quá số đã bán: "Sữa X" — đã bán 10, đã hoàn thành trả 10, phiếu này thêm 10 là vượt')
  })
})

describe("Q10 — khoá hàng khi kiểm khoản có", () => {
  /**
   * ⚠ Không có `FOR UPDATE` thì hai kế toán cùng lập phiếu thu cấn trừ
   * CÙNG một phiếu trả độc lập sẽ cùng đọc `applied_receipt_id IS NULL`,
   * cùng qua, và khoản có bị cấn trừ hai lần — lệnh UPDATE ở cuối chỉ
   * ghi đè chứ không chặn.
   */
  it("vòng kiểm khoản có khoá dòng như vòng kiểm khoản nợ", () => {
    const i = MIG120.indexOf("FROM returns r\n      WHERE r.id = c.id")
    expect(i).toBeGreaterThan(0)
    expect(MIG120.slice(i, MIG120.indexOf("BAD_CREDIT", i))).toContain("FOR UPDATE")
  })
})

describe("Q12 — migration 118 hỏi giá trị trạng thái còn tồn tại", () => {
  const MIG118 = read("supabase/migrations/118_delete_order_cleans_returns.sql")

  /**
   * ⚠ Hỏng ÂM THẦM cả hai đầu nếu để nguyên: phiếu 'submitted' hết chặn
   * xoá đơn, còn nhánh dọn khớp 0 dòng nên khoá ngoại 23503 chặn xoá đơn
   * kèm một câu tiếng Anh — đúng thứ migration này sinh ra để sửa.
   */
  it("không còn một giá trị nào của bước duyệt cũ, kể cả trong chú thích", () => {
    for (const dead of ["'approved'", "'pending'", "'rejected'"]) {
      expect(MIG118, `còn nhắc ${dead}`).not.toContain(dead)
    }
    expect(MIG118).toContain("WHERE order_id = OLD.id AND status = 'completed'")
    expect(MIG118).toContain("status IN ('draft', 'submitted', 'cancelled')")
  })

  /** Phép đếm cảnh báo ở cuối migration cũng phải hỏi đúng giá trị. */
  it("phép đếm cuối migration đếm được số thật", () => {
    const i = MIG118.indexOf("RAISE NOTICE '--- Hiện có")
    expect(i).toBeGreaterThan(0)
    expect(MIG118.slice(i - 400, i)).toContain("r.status IN ('draft', 'submitted', 'cancelled')")
  })
})
