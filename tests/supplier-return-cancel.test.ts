import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const stripSql = (s: string) =>
  s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const MIG_RAW = read("supabase/migrations/143_cancel_supplier_return.sql")
const MIG = stripSql(MIG_RAW)
const FN = MIG.slice(
  MIG.indexOf("CREATE OR REPLACE FUNCTION public.cancel_supplier_return("),
  MIG.indexOf("$$;")
)
const DETAIL = strip(read("src/app/(dashboard)/purchase-returns/[id]/page.tsx"))
const EDIT = strip(read("src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx"))

// =====================================================================

/**
 * HUỶ PHIẾU TRẢ NCC — ĐẢO NGƯỢC ĐÚNG NHỮNG GÌ ĐÃ LÀM.
 *
 * ⚠ TRƯỚC MIGRATION 143, TRẠNG THÁI `cancelled` TỒN TẠI MÀ KHÔNG AI ĐẶT
 * ĐƯỢC. Nó nằm trong CHECK constraint từ migration 068, nhưng không hàm
 * nào chuyển sang được và giao diện cũng không có nút. Một phiếu gửi
 * nhầm là hàng đã ra khỏi kho, công nợ đã giảm, và không có cách nào
 * sửa ngoài việc sửa tay trong cơ sở dữ liệu.
 */
describe("143 — huỷ phiếu trả NCC", () => {
  /**
   * ⚠ CỘNG TRẢ VỀ ĐÚNG LÔ ĐÃ LẤY, không đi tìm lô mới.
   * `complete_supplier_return` ghi lại đúng lô nào bị trừ và trừ bao
   * nhiêu, qua `stock_entry_lines.batch_id`. Đi tìm lô theo FIFO lần
   * nữa là cộng hàng vào một lô KHÁC với hạn khác: tồn thì đúng mà hạn
   * thì sai.
   */
  it("cộng trả theo batch_id của phiếu kho, không tìm lại lô theo FIFO", () => {
    expect(FN).toContain("FROM stock_entry_lines sel")
    expect(FN).toContain("b.id = sel.batch_id")
    expect(FN).toContain("SET qty_on_hand = b.qty_on_hand + sel.qty_in_base_uom")
    expect(FN, "đang đi tìm lô theo FIFO thay vì cộng về lô cũ").not.toContain("ORDER BY expires_at")
  })

  /**
   * ⚠ DÙNG `qty_in_base_uom`, KHÔNG DÙNG `quantity`. Cột `quantity` là
   * `integer` đã bị làm tròn; `qty_in_base_uom` là `numeric(18,6)`.
   * Cộng lại bằng cột đã làm tròn là mỗi lần huỷ kho lệch một chút.
   */
  it("cộng lại bằng số chưa làm tròn", () => {
    expect(FN).toContain("sel.qty_in_base_uom")
    expect(FN, "đang cộng lại bằng cột integer đã làm tròn")
      .not.toMatch(/qty_on_hand \+ sel\.quantity/)
  })

  /** ⚠ Dòng công nợ của phiếu trả là số ÂM; "đã trả" trên nó nghĩa là đã cấn trừ. */
  it("từ chối khi NCC đã cấn trừ tiền", () => {
    expect(FN).toContain("DA_CAN_TRU")
    // ⚠ `<> 0`, KHÔNG `> 0`. Số cấn trừ trên một dòng nợ ÂM là số âm;
    //   so `> 0` là để mọi lần cấn trừ lọt qua.
    expect(FN).toContain("COALESCE(v_paid, 0) <> 0")
  })

  /**
   * ⚠ LÔ ĐÃ CHẾT THÌ KHÔNG CỘNG VỀ ĐƯỢC — cộng vào một lô đã đóng là
   * cộng vào chỗ không ai bán ra được, và tồn báo có mà thực tế không.
   */
  it("từ chối khi lô đã đóng, và gọi tên mặt hàng", () => {
    expect(FN).toContain("LO_DA_DONG")
    expect(FN).toContain("b.id IS NULL OR COALESCE(b.status, 'available') <> 'available'")
    expect(FN).toContain("string_agg")
    expect(FN).toContain("p.name")
  })

  /**
   * ⚠ HAI PHÉP HUỶ KHÁC NHAU, CỐ Ý. Huỷ phiếu NHẬP là TRỪ đi số đã
   * cộng — hàng bán bớt rồi thì trừ đủ là đẩy tồn xuống âm, phải từ
   * chối. Huỷ phiếu TRẢ là CỘNG lại số đã trừ — cộng luôn an toàn.
   * Chốt này giữ cho người sau không "cho đồng bộ" bằng cách bê phép
   * kiểm của bên nhập sang đây và chặn oan.
   */
  it("KHÔNG kiểm 'hàng đã động' như bên phiếu nhập", () => {
    expect(FN, "đang bê phép kiểm của phiếu nhập sang — sẽ chặn oan")
      .not.toContain("qty_on_hand <> b.qty_initial")
    expect(FN).not.toContain("HANG_DA_XUAT")
  })

  /** ⚠ Bấm hai lần không được cộng hàng về kho hai lần. */
  it("idempotent: phiếu đã huỷ thì trả về ngay", () => {
    const guard = FN.slice(FN.indexOf("IF v_status = 'cancelled'"))
    expect(guard.slice(0, 120)).toContain("RETURN p_return_id")
  })

  it("phiếu còn nháp thì huỷ không đụng kho hay công nợ", () => {
    const draft = FN.slice(FN.indexOf("IF v_status = 'draft'"))
    const upto = draft.slice(0, draft.indexOf("END IF;"))
    expect(upto).toContain("status = 'cancelled'")
    expect(upto, "nhánh nháp đang đụng vào kho").not.toContain("batches")
    expect(upto, "nhánh nháp đang đụng vào công nợ").not.toContain("payables")
  })

  /**
   * ⚠ GỠ CON TRỎ TRƯỚC, XOÁ DÒNG NỢ SAU.
   * `supplier_returns.payable_credit_id` có khoá ngoại trỏ tới
   * `payables`; xoá dòng nợ khi phiếu còn trỏ vào nó là Postgres từ
   * chối. Đã gặp đúng lỗi này khi chạy migration 142.
   */
  it("đặt payable_credit_id về NULL trước khi xoá dòng nợ", () => {
    const setNull = FN.indexOf("payable_credit_id = NULL")
    const del = FN.indexOf("DELETE FROM payables")
    expect(setNull, "không còn gỡ con trỏ công nợ").toBeGreaterThan(0)
    expect(del, "không còn xoá dòng nợ").toBeGreaterThan(0)
    expect(setNull, "xoá dòng nợ TRƯỚC khi gỡ con trỏ — khoá ngoại sẽ chặn").toBeLessThan(del)
  })

  it("đóng luôn phiếu kho đi kèm", () => {
    expect(FN).toContain("UPDATE stock_entries SET status = 'cancelled'")
  })

  /** ⚠ SECURITY DEFINER mà quên thu quyền là mở cho PUBLIC. */
  it("SECURITY DEFINER, khoá search_path, REVOKE rồi mới GRANT", () => {
    expect(FN).toContain("SECURITY DEFINER")
    expect(FN).toContain("SET search_path = public")
    const rev = MIG.indexOf("REVOKE EXECUTE ON FUNCTION public.cancel_supplier_return(")
    const grant = MIG.indexOf("GRANT EXECUTE ON FUNCTION public.cancel_supplier_return(")
    expect(rev).toBeGreaterThan(0)
    expect(rev).toBeLessThan(grant)
    expect(MIG).not.toMatch(/GRANT EXECUTE[^\n]*\bTO\b[^\n]*\banon\b/)
  })

  it("kiểm org của người gọi", () => {
    expect(FN).toContain("public.user_org_id()")
    expect(FN).toContain("SAI_DON_VI")
  })

  /** Quy ước kho mã: P0001, tiếng Việt, mở đầu bằng mã. */
  it("mọi RAISE đều P0001 và mở đầu bằng mã", () => {
    const raises = Array.from(MIG.matchAll(/RAISE EXCEPTION\s*\n?\s*'([^']+)'/g)).map((m) => m[1])
    expect(raises.length).toBeGreaterThan(3)
    for (const r of raises) expect(r, `câu lỗi không mở đầu bằng mã: ${r}`).toMatch(/^[A-Z_]+: /)
    expect(MIG.match(/RAISE EXCEPTION/g)?.length).toBe(MIG.match(/ERRCODE = 'P0001'/g)?.length)
  })

  it("thêm cột lý do huỷ và nạp lại lược đồ", () => {
    expect(MIG).toContain("ADD COLUMN IF NOT EXISTS cancel_reason text")
    expect(MIG_RAW.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

// =====================================================================

describe("giao diện phiếu trả NCC", () => {
  /**
   * ⚠ MÀN HÌNH KHÔNG TỰ CỘNG HÀNG VỀ KHO. Cộng ở trình duyệt là đi tìm
   * lô theo FIFO lần nữa, và hàng về một lô KHÁC với hạn khác.
   */
  it("màn chi tiết huỷ qua RPC, không tự đụng kho hay công nợ", () => {
    expect(DETAIL).toContain('supabase.rpc("cancel_supplier_return"')
    for (const t of ["batches", "payables", "stock_entries", "stock_entry_lines"]) {
      expect(DETAIL, `màn chi tiết đang ghi thẳng bảng ${t}`).not.toContain(`.from("${t}")`)
    }
  })

  /** ⚠ Nút huỷ phải còn cho CẢ phiếu nháp lẫn phiếu đã gửi. */
  it("có nút Huỷ phiếu cho mọi phiếu chưa huỷ", () => {
    const flat = DETAIL.replace(/\s+/g, " ")
    expect(flat).toMatch(/data\.status !== "cancelled"[\s\S]{0,200}onClick=\{handleCancel\}/)
    expect(flat, "mất nhãn trên nút huỷ").toMatch(/onClick=\{handleCancel\}[\s\S]{0,160}Huỷ phiếu </)
  })

  /** ⚠ Lý do huỷ phải hiện ra, nếu không phiếu chết mà không ai biết vì sao. */
  it("hiện lý do huỷ", () => {
    expect(DETAIL).toContain("data.cancel_reason")
    expect(DETAIL).toContain("cancel_reason, created_at, supplier:suppliers")
  })

  /** Phiếu đã gửi vẫn có đường vào màn sửa (chủ nhà chốt). */
  it("phiếu đã gửi vẫn sửa được", () => {
    const flat = DETAIL.replace(/\s+/g, " ")
    expect(flat).toMatch(/data\.status === "completed"[\s\S]{0,220}\/edit/)
  })
})

describe("sửa phiếu trả đã gửi", () => {
  const SUBMIT = EDIT.slice(
    EDIT.indexOf("const handleSubmit = async"),
    EDIT.indexOf("if (authLoading || loading)")
  )

  /**
   * ⚠ HUỶ TRƯỚC RỒI LẬP LẠI, không sửa đè. Sửa đè lên một chứng từ đã
   * trừ kho và giảm công nợ là chứng từ nói một đằng, kho nói một nẻo.
   */
  it("huỷ bản cũ trước khi ghi đè", () => {
    const cancelAt = SUBMIT.indexOf('rpc("cancel_supplier_return"')
    const updateAt = SUBMIT.indexOf('.from("supplier_returns")')
    const sendAt = SUBMIT.indexOf('rpc("complete_supplier_return"')
    expect(cancelAt, "không huỷ bản cũ trước khi sửa").toBeGreaterThan(0)
    expect(updateAt, "ghi đè TRƯỚC khi huỷ — kho vẫn giữ số đã trừ").toBeGreaterThan(cancelAt)
    expect(sendAt).toBeGreaterThan(updateAt)
    expect(SUBMIT).toContain("wasCompleted")
  })

  /** ⚠ Huỷ hỏng thì DỪNG HẲN. */
  it("huỷ hỏng thì ném lỗi, không đi tiếp", () => {
    const blk = SUBMIT.slice(
      SUBMIT.indexOf("if (wasCompleted)"),
      SUBMIT.indexOf('.from("supplier_returns")')
    )
    expect(blk).toContain("throw new Error")
  })

  /** Phiếu vừa huỷ phải về nháp thì RPC gửi mới nhận. */
  it("đưa phiếu về nháp và xoá lý do huỷ cũ", () => {
    expect(SUBMIT).toContain('status: "draft"')
    expect(SUBMIT).toContain("cancel_reason: null")
  })

  /**
   * ⚠ BỎ `.eq("status","draft")` LÀ CÓ LÝ DO, không phải quên. Phiếu
   * vừa bị `cancel_supplier_return` chuyển sang `cancelled`; giữ điều
   * kiện cũ là phép ghi đè khớp 0 dòng — mà RLS/điều kiện không khớp
   * trả về 0 dòng kèm `error` null, nên nó sẽ IM LẶNG không lưu gì.
   * Thay bằng `.select("id")` để còn biết có ghi được hay không.
   */
  it("không còn lọc status khi ghi đè, và có select để biết kết quả", () => {
    expect(SUBMIT, "còn lọc status draft — sẽ khớp 0 dòng sau khi huỷ")
      .not.toContain('.eq("status", "draft")')
    expect(SUBMIT).toContain('.select("id")')
  })

  /** ⚠ Hỏng ở bước cuối thì kho đã hoàn về đúng — phải nói ra. */
  it("gửi lại hỏng thì nói rõ kho đã hoàn về đúng", () => {
    expect(SUBMIT).toContain("NHÁP")
    expect(SUBMIT).toContain("kho đã hoàn về đúng")
  })

  /** ⚠ Phiếu đã huỷ là chứng từ đã đóng — không sửa lại. */
  it("chỉ chặn phiếu đã huỷ, không chặn phiếu đã gửi", () => {
    expect(EDIT).toContain('hdr.status === "cancelled"')
    expect(EDIT, "vẫn chặn mọi phiếu khác nháp").not.toContain('hdr.status !== "draft"')
  })
})
