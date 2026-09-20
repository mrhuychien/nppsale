import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { explainCancelEntryError, cancelEntryMessage } from "@/lib/inventory/cancel-entry"

/**
 * HUỶ PHIẾU KHO — chủ nhà báo 20/09/2026: "phiếu nhập kho không có nút
 * Huỷ bên trong chi tiết" và "khi huỷ phiếu nhập kho → kho không thay
 * đổi".
 *
 * ⚠ CÁI THỨ HAI LÀ LỖ THỦNG SỔ SÁCH. Bản cũ huỷ bằng một lệnh
 * `UPDATE stock_entries SET status='cancelled'` chạy thẳng từ trình
 * duyệt: không đụng `batches`, không kiểm trạng thái, không kiểm RLS.
 * Huỷ phiếu NHẬP đã ghi sổ thì kho giữ lại hàng chưa từng có thật; huỷ
 * phiếu XUẤT thì kho thiếu hàng vĩnh viễn.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích SQL — chốt "có chạy" không được bắt nhầm chữ trong chú thích. */
const sql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

const LIST = read("src/app/(dashboard)/inventory/entries/page.tsx")
const DETAIL = read("src/app/(dashboard)/inventory/entries/[id]/page.tsx")
const M139 = sql(read("supabase/migrations/139_cancel_stock_entry.sql"))

describe("không còn lệnh ghi trạng thái thẳng từ trình duyệt", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT CHÍNH. Còn một lệnh `update({ status: "cancelled" })`
   * nào là lỗ thủng còn nguyên ở đúng chỗ đó.
   */
  it.each([
    ["danh sách phiếu", "src/app/(dashboard)/inventory/entries/page.tsx"],
    ["chi tiết phiếu", "src/app/(dashboard)/inventory/entries/[id]/page.tsx"],
  ])("%s: huỷ đi qua RPC", (_l, rel) => {
    const src = read(rel)
    expect(src, "còn lệnh ghi trạng thái thẳng").not.toContain('update({ status: "cancelled" })')
    expect(src).toContain("cancelStockEntry(")
  })

  /** Cả huỷ một phiếu lẫn huỷ hàng loạt. */
  it("huỷ hàng loạt đi từng phiếu, không một lệnh UPDATE IN", () => {
    expect(LIST).not.toContain('.in("id", ids)')
    expect(LIST).toContain("for (const id of ids)")
    // ⚠ Hỏng một phiếu thì vẫn làm nốt phần còn lại, rồi BÁO RA.
    expect(LIST).toContain("failed.push(")
    expect(LIST).toContain("KHÔNG huỷ được")
  })

  /** ⚠ Nút Huỷ phải có TRONG chi tiết — đó là chuyện chủ nhà báo. */
  it("chi tiết phiếu có nút Huỷ", () => {
    expect(DETAIL).toContain("Huỷ phiếu")
    expect(DETAIL).toContain("setCancelOpen(true)")
    expect(DETAIL).toContain('entry.status !== "cancelled"')
  })
})

describe("câu báo sau khi huỷ nói đúng kho có đổi hay không", () => {
  /**
   * ⚠ "Đã huỷ phiếu" MỘT MÌNH LÀ CÂU MƠ HỒ — nó đúng cả khi kho vừa
   * được hoàn lẫn khi kho không đụng gì. Đó chính là chỗ chủ nhà mất
   * lòng tin: máy báo đã huỷ mà kho y nguyên.
   */
  it("phiếu nháp: nói rõ kho không đổi", () => {
    expect(cancelEntryMessage("PN-1", { cancelled: true, reversed: false, linesReversed: 0 }))
      .toContain("kho không đổi")
  })

  it("phiếu đã ghi sổ: nói rõ đã hoàn mấy lô", () => {
    expect(cancelEntryMessage("PN-1", { cancelled: true, reversed: true, linesReversed: 3 }))
      .toContain("hoàn kho 3 lô")
  })
})

describe("dịch lỗi của RPC", () => {
  it.each([
    ["ALREADY_ISSUED: \"Sữa X\" của phiếu PN-2 đã xuất bớt", "đã xuất bớt"],
    ["ENTRY_HAS_INVOICE: phiếu PX-1 thuộc hóa đơn HD-9.", "thuộc hóa đơn HD-9"],
    ["NO_CONSUMPTION_TRACE: phiếu PX-1 ghi sổ trước khi", "ghi sổ trước khi"],
    ["NO_BATCH_LINK: dòng \"Sữa X\" của phiếu PN-3 không ghi lô nào", "không ghi lô nào"],
    ["CANNOT_REVERSE_TYPE: phiếu PK-1 (transfer) đã ghi sổ", "đã ghi sổ"],
  ])("%s", (raw, want) => {
    expect(explainCancelEntryError(raw)).toContain(want)
  })

  /** ⚠ Cắt tiền tố kỹ thuật, không chỉ ghép thêm chữ. */
  it("bỏ hẳn mã lỗi khỏi câu người dùng đọc", () => {
    expect(explainCancelEntryError("ALREADY_ISSUED: hàng đã xuất bớt")).toBe("hàng đã xuất bớt")
  })

  /** Bản vá chưa chạy thì nói đúng việc phải làm. */
  it("hàm chưa có trên máy chủ thì chỉ đúng việc cần làm", () => {
    expect(
      explainCancelEntryError("function public.cancel_stock_entry(uuid, text) does not exist")
    ).toContain("supabase db push")
  })

  /** ⚠ Lỗi lạ giữ NGUYÊN VĂN — đoán sai rồi họ đi sửa nhầm chỗ còn tệ hơn. */
  it("lỗi không nhận ra thì giữ nguyên văn", () => {
    expect(explainCancelEntryError("connection reset by peer")).toBe("connection reset by peer")
  })
})

describe("bản vá 139 — hoàn kho và đổi trạng thái trong một giao dịch", () => {
  /** ⚠ Khoá phiếu TRƯỚC khi đọc trạng thái, nếu không hai lượt cùng hoàn. */
  it("khoá phiếu trước khi đọc trạng thái", () => {
    const i = M139.indexOf("FROM stock_entries WHERE id = p_entry_id FOR UPDATE")
    expect(i, "thiếu FOR UPDATE — hai lượt song song sẽ hoàn kho hai lần").toBeGreaterThan(0)
  })

  /** Bấm hai lần là chuyện thường, không phải lỗi. */
  it("đã huỷ rồi thì không làm gì thêm, và KHÔNG báo lỗi", () => {
    const i = M139.indexOf("IF v_status = 'cancelled' THEN")
    expect(i).toBeGreaterThan(0)
    const blk = M139.slice(i, i + 200)
    expect(blk).toContain("RETURN QUERY SELECT true, false, 0")
    expect(blk).not.toContain("RAISE EXCEPTION")
  })

  /**
   * ⚠ "ĐÃ XUẤT THÌ CHỈ CHO SỬA" (chủ nhà chốt). Hoàn một phần rồi để sổ
   * tự lệch là đúng cái lỗi đang sửa.
   */
  it("phiếu nhập đã xuất bớt thì TỪ CHỐI, không hoàn một phần", () => {
    expect(M139).toContain("ALREADY_ISSUED")
    expect(M139).toContain("COALESCE(v_have, 0) < l.qty")
    expect(M139).toContain("chỉ SỬA được, không huỷ được")
  })

  /** ⚠ Phiếu xuất của hóa đơn phải đi qua `cancel_invoice` — còn công nợ. */
  it("phiếu xuất thuộc hóa đơn còn hiệu lực thì từ chối", () => {
    expect(M139).toContain("ENTRY_HAS_INVOICE")
    expect(M139).toContain("si.status = 'posted'")
  })

  /** ⚠ Không có vết lấy lô thì KHÔNG đoán trả về lô nào. */
  it("phiếu xuất không có vết lấy lô thì từ chối", () => {
    expect(M139).toContain("NO_CONSUMPTION_TRACE")
    expect(M139).toContain("stock_line_consumptions")
  })

  /** Loại phiếu chưa có đường hoàn thì từ chối, không âm thầm đổi trạng thái. */
  it("chuyển kho / kiểm kê đã ghi sổ thì từ chối", () => {
    expect(M139).toContain("CANNOT_REVERSE_TYPE")
    expect(M139).toContain("v_type NOT IN ('import', 'export')")
  })

  /** Luật chung của kho này. */
  it("khoá quyền gọi và nạp lại schema", () => {
    expect(M139).toContain("REVOKE ALL ON FUNCTION public.cancel_stock_entry(uuid, text) FROM PUBLIC")
    expect(M139).toContain("GRANT EXECUTE ON FUNCTION public.cancel_stock_entry(uuid, text) TO authenticated")
    expect(M139).toContain("SECURITY DEFINER")
    expect(read("supabase/migrations/139_cancel_stock_entry.sql").trimEnd()
      .endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  /** ⚠ Mọi RAISE phải mang mã P0001 và câu tiếng Việt — luật của kho này. */
  it("mọi lỗi dùng ERRCODE P0001", () => {
    const raises = (M139.match(/RAISE EXCEPTION/g) ?? []).length
    const coded = (M139.match(/USING ERRCODE = 'P0001'/g) ?? []).length
    expect(raises).toBeGreaterThan(0)
    expect(coded, "có RAISE thiếu ERRCODE").toBe(raises)
  })
})
