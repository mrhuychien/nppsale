import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  previewOrderStock,
  totalShortBase,
  splitWarnings,
} from "../src/lib/orders/order-stock-preview"

/**
 * Luồng NVBH của workflow v2 (Coder Pack mục 4).
 *
 * Nháp nằm ở /sell/drafts với ba nút Sửa · Gửi đơn · Xoá. "Đơn của tôi"
 * có đúng ba tab Phiếu tạm / Hoàn thành / Đã huỷ. Không một nút nào trên
 * đường của NVBH được ghi tồn kho hay công nợ — hai thứ đó chỉ đổi bên
 * trong `complete_order`.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích: lời giải thích nhắc lại tên cũ, soi cả nó là đếm nhầm. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const LIST = code(read("src/app/(dashboard)/orders/page.tsx"))
const DETAIL = code(read("src/app/(dashboard)/orders/[id]/page.tsx"))
const DRAFTS = code(read("src/app/(dashboard)/sell/drafts/page.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const CREATE = code(read("src/lib/orders/create.ts"))
const TYPES = read("src/types/index.ts")
const BELL = read("src/components/layout/notification-bell.tsx")
const NOTIF_PAGE = read("src/app/(dashboard)/notifications/page.tsx")
const MIG119 = read("supabase/migrations/119_workflow_v2.sql")
const MIG120 = read("supabase/migrations/120_workflow_v2_rpcs.sql")

describe("Màn đơn hàng: một viên cho mỗi trạng thái", () => {
  /**
   * ⚠ GHI LẠI CẢ HAI PHÍA — ĐỪNG LẬT MÙ THÊM LẦN NỮA.
   *
   * Bản đầu CỐ Ý không có "Tất cả": gộp mọi trạng thái vào một danh sách
   * thì người dùng phải tự đọc huy hiệu từng dòng mới biết đơn nào còn
   * chờ xuất hàng. Chốt cũ ở đây khoá bằng `expect(decl).not.toContain('"all"')`.
   *
   * Chủ nhà chốt NGƯỢC ngày 19/09/2026: "Thêm phần hiển thị tất cả đơn
   * hàng nữa (3 ô thống kê thành 4 ô)". Trên sổ thật, "tổng cộng có bao
   * nhiêu đơn" là câu hỏi hằng ngày và trước đó không có đường nào hỏi.
   *
   * Lo ngại cũ được giữ bằng CHỖ ĐỨNG chứ không bằng việc vắng mặt, và
   * hai điều dưới đây là phần còn lại của nó, đừng bỏ:
   *   · "Tất cả" đứng CUỐI (giống màn hóa đơn), không đứng đầu;
   *   · màn vẫn MỞ RA ở "Phiếu tạm" — xem chốt `DEFAULT_ORDER_TAB` dưới.
   */
  it("đủ viên cho mọi trạng thái làm việc, Tất cả đứng đầu", () => {
    const i = LIST.indexOf("const ORDER_TABS = ")
    expect(i, "không tìm thấy danh sách tab").toBeGreaterThan(0)
    const decl = LIST.slice(i, LIST.indexOf("] as const", i))
    /**
     * ⚠ `partially_invoiced` LÀ VIÊN THỨ NĂM, thêm 20/09/2026. Thiếu nó
     * thì đơn xuất một phần không nằm trong viên nào và biến mất khỏi
     * màn hình — đúng chuyện chủ nhà báo. Xem `tests/order-tabs-cover-all`.
     */
    for (const s of ["all", "submitted", "completed", "cancelled"]) {
      expect(decl, `thiếu tab ${s}`).toContain(`"${s}"`)
    }
    // ⚠ LẬT 25/09/2026 — chủ nhà: "bỏ trạng thái Xuất một phần" (gộp vào Hoàn thành).
    expect(decl).not.toContain('"partially_invoiced"')
    // ⚠ "Nháp" KHÔNG có tab riêng: màn này không có nút nào làm được gì
    // với một bản nháp. Cho nó một tab là người dùng mở đúng chỗ không có
    // nút. (Nháp vẫn nằm trong "Tất cả" — đó là chuyện khác.)
    expect(decl).not.toContain('"draft"')
    /**
     * ⚠ "TẤT CẢ" NAY ĐỨNG ĐẦU — LẬT SO VỚI BẢN TRƯỚC, GHI LẠI CẢ HAI.
     * Bản trước bắt nó đứng CUỐI, lý do: ô đầu tiên mắt chạm tới phải là
     * hàng đợi việc trong ngày. Chủ nhà chốt lại 20/09/2026: "cho mặc
     * định hiển thị là tất cả, sau đó bấm vào trạng thái nào thì lọc đơn
     * trạng thái đó" — viên đang chọn phải là viên đầu tiên, nếu không
     * dải mở ra với viên thứ tư được tô đậm.
     */
    expect(decl.indexOf('"all"')).toBeLessThan(decl.indexOf('"submitted"'))
    // ⚠ LẬT 25/09/2026 — chủ nhà: "Trạng thái Đã huỷ -> Ẩn với nhân viên bán hàng":
    //   NVBH bỏ viên Đã huỷ, còn lại cùng bộ tab với nhà phân phối.
    expect(LIST).toContain('const tabKeys: readonly string[] = isSales ? ORDER_TABS.filter((k) => k !== "cancelled") : ORDER_TABS')
  })

  /**
   * ⚠ CÓ TAB "TẤT CẢ" RỒI THÌ "all" LÀ MỘT LỰA CHỌN, KHÔNG CÒN LÀ "chưa
   * chọn gì". Trộn hai nghĩa vào một giá trị là không phân biệt được hai
   * tình huống khác hẳn nhau, và màn mở ra ở tab Tất cả thay vì hàng đợi
   * việc. Ô trống "" mới là "chưa chạm tab nào".
   */
  /**
   * ⚠ MẶC ĐỊNH ĐÃ LẬT: "Phiếu tạm" → "Tất cả" (chủ nhà chốt 20/09/2026).
   * Lý do cũ: mở ra ở hàng đợi việc trong ngày. Lý do mới nặng hơn — mở
   * ra ở một tab đã lọc là mọi đơn ngoài tab ấy trông như không tồn tại,
   * và đó chính là cách `partially_invoiced` biến mất mà không ai ngờ.
   *
   * ⚠ Ô TRỐNG "" VẪN GIỮ NGHĨA "CHƯA CHẠM TAB NÀO" dù nay nó quy về
   * "all": hai thứ vẫn khác nhau ở chỗ `statusIsFiltered`, và trộn lại
   * là nút "Xoá lọc" mọc ra cho một thứ không ai đặt.
   */
  it("chưa chạm tab nào thì mở ra ở Tất cả", () => {
    expect(LIST, 'trị "chưa chọn" phải là ô trống').toContain(
      'const [statusFilter, setStatusFilter] = useLuuTrangThai("orders", "")'
    )
    expect(LIST).toContain('const DEFAULT_ORDER_TAB = "all"')
    // Và huy hiệu "đang lọc" phải so với chính mặc định ấy, không so
    // với một chuỗi viết tay đứng yên khi mặc định đổi.
    expect(LIST).toContain("const statusIsFiltered = effectiveStatus !== DEFAULT_ORDER_TAB")
    const i = LIST.indexOf("const effectiveStatus =")
    expect(i).toBeGreaterThan(0)
    const expr = LIST.slice(i, LIST.indexOf("\n\n", i))
    expect(expr).toContain('statusFilter === ""')
    expect(expr).toContain("DEFAULT_ORDER_TAB")
    // Và truy vấn phải dùng giá trị đã quy, không phải giá trị thô.
    expect(LIST).toContain("applyStatusFilter(applyCommonFilters(q), effectiveStatus)")
  })

  /**
   * ⚠ CHỌN MỘT BƯỚC XỬ LÝ THÌ BUÔNG TAB VỀ "", KHÔNG VỀ "all". Đặt "all"
   * ở đây là bỏ bước xử lý xong người dùng bị bỏ lại ở tab Tất cả — một
   * tab họ chưa từng chạm.
   */
  it("bỏ bước xử lý thì trả về tab mặc định, không kẹt ở Tất cả", () => {
    expect(LIST).not.toContain('setStatusFilter("all")')
    /* Bộ lọc bước xử lý đã bỏ (chủ nhà 23/09/2026) — không còn chỗ nào buông tab. */
    expect(LIST).not.toMatch(/setPipelineStep/)
  })

  /**
   * ⚠ TÌM KIẾM VÀ TRẠNG THÁI NỐI `AND` TRONG CÙNG MỘT TRUY VẤN. Ép trạng
   * thái khi người dùng đang tìm là ô tìm trên thanh tiêu đề — vốn đẩy
   * sang `/orders?q=…` KHÔNG kèm trạng thái — đáp xuống tab Phiếu tạm và
   * trả RỖNG cho mọi đơn đã hoàn thành hoặc đã huỷ. Người dùng gõ đúng mã
   * đơn mà máy bảo không có.
   */
  it("đang tìm kiếm thì KHÔNG ép trạng thái", () => {
    const i = LIST.indexOf("const effectiveStatus =")
    const expr = LIST.slice(i, LIST.indexOf("\n\n", i))
    expect(expr, "tìm kiếm vẫn bị ép về một tab").toContain("searching")
    expect(expr, "tìm kiếm phải buông về all").toContain('"all"')
    expect(LIST).toContain("const searching = debouncedSearch.trim().length > 0")
  })

  /**
   * ⚠ LỌC TRƯỢT ≠ CHƯA CÓ ĐƠN NÀO. Cả hai đều làm danh sách rỗng vì
   * trạng thái và ô tìm đều lọc phía máy chủ — bảo người dùng "Tạo đơn
   * hàng đầu tiên" khi họ chỉ gõ nhầm một mã đơn là nói sai sự thật.
   */
  it("màn rỗng phân biệt lọc trượt với chưa có đơn nào", () => {
    expect(LIST).toContain("const narrowed = searching || activeFilterCount > 0")
    expect(LIST).toContain("narrowed")
    const i = LIST.indexOf("Chưa có đơn hàng")
    expect(i).toBeGreaterThan(0)
    expect(LIST.slice(i - 300, i + 600)).toContain("Không có đơn hàng phù hợp")
  })

  /** Không tab nào là tab Nháp, nên phải có đường sang chỗ chứa nháp. */
  it("có đường từ màn đơn hàng sang màn đơn nháp", () => {
    expect(LIST).toContain('router.push("/sell/drafts")')
    expect(LIST).toContain("(statusCounts.draft ?? 0) > 0")
  })

  /** Nháp vẫn phải tới được — màn danh sách không phải ngõ cụt của nó. */
  it("nháp có màn riêng, với đủ ba việc làm được với một bản nháp", () => {
    expect(DRAFTS).toContain('.eq("status", "draft")')
    expect(DRAFTS).toContain("Gửi đơn")
    expect(DRAFTS).toContain("Sửa đơn")
    expect(DRAFTS).toContain("router.push(`/sell/edit/${o.id}`)")
    expect(DRAFTS).toContain("deleteOrder(")
  })
})

describe("Không một nút nào của NVBH ghi tồn kho hay công nợ", () => {
  /**
   * ⚠ MÀN CHI TIẾT KHÔNG ĐƯỢC GHI THẲNG những thứ này. Tồn và công nợ đổi
   * bên trong `complete_order` — cùng một giao dịch với lệnh khoá kho.
   * Một lệnh ghi thẳng từ trình duyệt hoặc bị trigger 119 chặn (lỗi khó
   * hiểu), hoặc lọt qua và để lại công nợ mồ côi.
   */
  it("màn chi tiết không chạm tới batches / receivables / stock_entries", () => {
    for (const t of ["batches", "receivables", "stock_entries", "stock_entry_lines"]) {
      expect(DETAIL, `màn chi tiết đang ghi vào ${t}`).not.toContain(`.from("${t}").insert`)
      expect(DETAIL, `màn chi tiết đang sửa ${t}`).not.toContain(`.from("${t}").update`)
    }
    expect(DETAIL).not.toContain("ensureReceivableForOrder")
  })

  it("màn giỏ hàng và màn nháp cũng vậy", () => {
    for (const src of [CART, DRAFTS]) {
      expect(src).not.toContain("ensureReceivableForOrder")
      expect(src).not.toContain('.from("batches")')
    }
  })

  /** Phiếu trả do NVBH tạo ra là NHÁP — nhập kho là việc của complete_return. */
  it("đơn trả tạo kèm đơn bán ra đời ở trạng thái nháp", () => {
    const i = CREATE.indexOf('.from("returns")')
    expect(i, "không tìm thấy chỗ tạo phiếu trả").toBeGreaterThan(0)
    expect(CREATE.slice(i, i + 800)).toContain('status: "draft"')
    // Và chỉ complete_return mới nhập kho.
    expect(MIG120).toContain("CREATE OR REPLACE FUNCTION public.complete_return")
  })
})

describe("Rút về nháp — đường lùi của phiếu tạm", () => {
  it("có nút, và đi bằng một lệnh ghi thường chứ không phải RPC", () => {
    expect(DETAIL).toContain("Rút về nháp")
    /**
     * ⚠ submitted → draft KHÔNG bị cổng `npp.via_rpc` chặn: nó không đụng
     * tồn kho hay công nợ. Nếu ai đó bọc nó vào RPC thì phải sửa cả
     * migration 119 — chốt này là để hai bên không trôi khỏi nhau.
     */
    const i = MIG119.indexOf("OLD.status = 'submitted'")
    expect(i).toBeGreaterThan(0)
    expect(MIG119.slice(i, i + 200)).toContain("'draft'")
  })

  /**
   * ⚠ VÀ RLS PHẢI CHO PHÉP. Chính sách từ chối thì PostgREST trả 0 dòng,
   * HTTP 200, `error` null — màn hình báo "Đã chuyển trạng thái" cho một
   * lệnh chưa chạy, và NVBH mở lại thấy đơn vẫn là phiếu tạm.
   */
  it("chính sách của NVBH cho phép ghi ngược về nháp", () => {
    const i = MIG119.indexOf('CREATE POLICY "Sales can update own open orders"')
    expect(i).toBeGreaterThan(0)
    const policy = MIG119.slice(i, MIG119.indexOf(");", i))
    const withCheck = policy.slice(policy.indexOf("WITH CHECK"))
    expect(withCheck, "WITH CHECK không cho ghi về nháp").toContain("'draft'")
  })

  it("lệnh ghi đếm số dòng trả về", () => {
    const i = DETAIL.indexOf("const handleChangeStatus")
    expect(i).toBeGreaterThan(0)
    const fn = DETAIL.slice(i, i + 900)
    expect(fn).toContain('.select("id")')
    expect(fn).toContain("statusRows.length === 0")
  })
})

describe("Bốn loại thông báo của workflow v2", () => {
  const V2_TYPES = ["order_completed", "order_edited", "order_cancelled", "return_completed"]

  it("RPC sinh đủ bốn loại", () => {
    for (const t of V2_TYPES) {
      expect(MIG120, `không RPC nào gửi ${t}`).toContain(`'${t}'`)
    }
  })

  /**
   * ⚠ BA NƠI PHẢI CÙNG MỘT DANH SÁCH: ràng buộc CHECK của bảng, union
   * TypeScript, và hai bảng biểu tượng. Thiếu ở CHECK là RPC ném lỗi giữa
   * giao dịch xuất hàng — cả lần xuất rollback vì một dòng thông báo.
   * Thiếu ở bảng biểu tượng là thông báo về nhưng không phân biệt được
   * loại: `ICON_MAP[n.type] || ICON_MAP.info` nuốt hết thành chữ "i".
   */
  it("CHECK của bảng, union TypeScript và hai bảng biểu tượng khớp nhau", () => {
    const i = MIG119.indexOf("ADD CONSTRAINT notifications_type_check")
    expect(i).toBeGreaterThan(0)
    const check = MIG119.slice(i, MIG119.indexOf("));", i))
    for (const t of V2_TYPES) {
      expect(check, `CHECK thiếu ${t}`).toContain(`'${t}'`)
      expect(TYPES, `union thiếu ${t}`).toContain(`| "${t}"`)
      expect(BELL, `chuông thiếu biểu tượng cho ${t}`).toContain(`${t}: {`)
      expect(NOTIF_PAGE, `trang thông báo thiếu ${t}`).toContain(`${t}: {`)
    }
  })

  /**
   * ⚠ Hai loại của bước duyệt cũ KHÔNG được xoá khỏi union. Thông báo cũ
   * còn nằm trong bảng; bỏ chúng đi là chuông đọc phải một hàng cũ và rơi
   * vào nhánh không có biểu tượng.
   */
  it("giữ hai loại di sản của bước duyệt cũ", () => {
    for (const t of ["order_pending_approval", "order_approved"]) {
      expect(TYPES).toContain(`| "${t}"`)
      expect(BELL).toContain(`${t}: {`)
    }
  })
})

/**
 * Những lỗi lượt soi chéo sau P4 bắt được. Mỗi cái một chốt, để không
 * quay lại. Chúng đều có chung một hình dạng: nửa việc làm ở bản máy
 * tính mà quên bản điện thoại, hoặc ngược lại.
 */
describe("lỗi soi chéo bắt được sau P4, không được quay lại", () => {
  const DONE = code(read("src/app/(dashboard)/sell/done/page.tsx"))
  const MOBILE_DETAIL = code(read("src/components/orders/mobile-order-detail.tsx"))
  const SELL_RETURNS = code(read("src/app/(dashboard)/sell/returns/page.tsx"))

  /**
   * ⚠ HUỶ HÀNG LOẠT LÀ CHỖ CÁI BẪY 0-DÒNG ĐAU NHẤT: một lệnh trên nhiều
   * đơn, RLS cho qua vài đơn và chặn phần còn lại, mà PostgREST vẫn trả
   * HTTP 200 với `error` null. Không đếm dòng thì màn báo "Đã hủy 12 đơn"
   * rồi tự vá state cho cả 12 — chín đơn hiện "Đã huỷ" cho tới khi tải
   * lại trang.
   */
  /**
   * ⚠ TỪ ĐỢT QA 22/09/2026 huỷ hàng loạt đi TỪNG ĐƠN qua RPC `cancel_order`
   *   (UPDATE thẳng để phiếu trả nháp nằm lại mãi mãi và mất người huỷ /
   *   lý do). Luật đếm vẫn y nguyên: chỉ đơn RPC NHẬN mới vào `done`, và
   *   vá state / toast theo `done`, không theo danh sách id.
   */
  it("huỷ hàng loạt đếm đúng số dòng ghi được, không tin vào danh sách id", () => {
    const i = LIST.indexOf('rpc("cancel_order"')
    expect(i, "không tìm thấy lệnh huỷ hàng loạt qua RPC").toBeGreaterThan(0)
    expect(LIST).not.toContain('.update({ status: "cancelled" })')
    const block = LIST.slice(i - 400, i + 700)
    expect(block).toContain("const done = new Set<string>()")
    expect(block).toContain("else done.add(o.id)")
    expect(block).toContain("done.size === 0")
    const after = LIST.slice(i, i + 2200)
    expect(after).toContain("done.has(o.id) ? { ...o, status: \"cancelled\" as const }")
    expect(after, "toast vẫn đếm theo danh sách id").not.toContain("Đã hủy ${ids.length} đơn")
  })

  /**
   * ⚠ MÀN BÁO THÀNH CÔNG PHẢI BIẾT TRẠNG THÁI THẬT. `submitSellOrder` trả
   * về `submitted`; bảng nhãn thiếu khoá đó thì rơi xuống nhánh mặc định
   * và nhân viên vừa gửi đơn xong đọc được chữ "chờ duyệt" — một bước
   * v2 đã bỏ.
   */
  it("màn báo gửi đơn xong có nhãn cho submitted, không còn chữ chờ duyệt", () => {
    expect(DONE).toContain("submitted: {")
    expect(DONE).toContain("draft: {")
    expect(DONE).toContain("queued: {")
    expect(DONE, "màn báo thành công còn hứa có người duyệt").not.toContain("duyệt")
    // Và màn giỏ hàng phải truyền đúng giá trị ấy sang.
    expect(CART).toContain("/sell/done?code=")
    expect(CART).toContain("&status=${status}")
  })

  /**
   * ⚠ Huy hiệu "Cần Owner duyệt" chấm theo NGƯỠNG TIỀN và chỉ hiện với
   * đơn `draft` — mà v2 thì đơn nào cũng đi qua draft. Để lại là gần như
   * đơn nào cũng đeo một cái nhãn bảo người dùng đi chờ.
   */
  it("màn chi tiết đơn không còn đeo huy hiệu duyệt", () => {
    expect(DETAIL).not.toContain("<ApprovalBadge")
    expect(DETAIL).not.toContain("approval-badge")
  })

  /**
   * ⚠ GHI PHIẾU TRẢ HỎNG PHẢI NÉM LỖI. Khối ghi từng bọc trong
   * `if (!retErr && retRow)` không có nhánh else: hỏng thì hàm im lặng
   * trả về thành công, nhân viên thấy "Đã gửi đơn", còn hàng trả của
   * khách không tồn tại ở đâu cả.
   */
  it("tạo đơn: phiếu trả ghi hỏng thì ném lỗi, không nuốt", () => {
    const i = CREATE.indexOf('.from("returns")')
    const block = CREATE.slice(i, i + 1400)
    expect(block).toContain("if (retErr || !retRow) {")
    expect(block).toContain("throw new Error(")
    expect(block, "lại bọc im lặng như cũ").not.toContain("if (!retErr && retRow) {")
  })

  /**
   * ⚠ HAI BẢN CỦA CÙNG MỘT MÀN PHẢI THEO CÙNG MỘT LUẬT. Bản mobile lọc
   * bước theo vai trò rồi mới vẽ; bản máy tính từng vẽ cả bảng rồi lọc
   * bên trong thẻ "Thao tác" — nên nó không biết cờ `backward`, và "Rút
   * về nháp" ngồi vào nút xanh đậm to nhất thẻ.
   *
   * Thẻ ấy nay đã bỏ (chủ nhà chốt đưa nút lên hàng đầu trang), nhưng
   * ĐÚNG HAI ĐIỀU TRÊN VẪN PHẢI GIỮ ở chỗ mới.
   */
  it("hàng nút máy tính dùng danh sách đã lọc vai trò, và không tô nút bước lùi", () => {
    expect(DETAIL).not.toContain("<CardTitle>Thao tác</CardTitle>")
    const hero = DETAIL.slice(
      DETAIL.indexOf("const heroActions = ("),
      DETAIL.indexOf("const creditLimit =")
    )
    expect(hero, "vẽ từ danh sách chưa lọc vai trò").not.toContain("availableTransitions")
    expect(hero).toContain("backTransitions.map")
    // `backTransitions` phải suy ra từ `roleTransitions` (đã lọc vai trò).
    expect(DETAIL).toContain("const backTransitions = roleTransitions.filter(")
    const back = hero.slice(
      hero.indexOf("{backTransitions.map((trans) => {"),
      hero.indexOf("{cancelTransition && (")
    )
    expect(back, "bước lùi vẫn được tô như hành động chính").not.toContain('"default"')
  })

  /**
   * ⚠ Nhãn trạng thái phiếu trả: bản máy tính đã đổi sang bốn giá trị v2
   * ở P4, bản điện thoại thì chưa — nên trên điện thoại phiếu trả nào
   * cũng không nhãn, không màu, và người đọc tưởng đã xong.
   */
  it("bản điện thoại của màn chi tiết đọc trạng thái phiếu trả theo v2", () => {
    expect(MOBILE_DETAIL, "còn so với trạng thái phiếu trả đã bị bỏ").not.toContain(
      'r.status === "pending"'
    )
    expect(MOBILE_DETAIL).toContain('r.status === "submitted"')
  })

  /**
   * ⚠ Migration 119 đã `DROP VIEW v_sales_order_line_picked`. Truy vấn nó
   * chỉ trả về rỗng kèm một dòng đỏ ra console, nhưng nó nằm trước
   * `setLoading(false)` nên mỗi lần mở đơn là một vòng gọi mạng thừa.
   */
  it("màn chi tiết không còn hỏi view đã bị xoá", () => {
    expect(DETAIL).not.toContain("v_sales_order_line_picked")
    expect(MIG119).toMatch(/DROP VIEW\s+IF EXISTS v_sales_order_line_picked;/)
  })

  /** Màn hàng trả của NVBH không được hứa có người duyệt. */
  it("màn hàng trả nói đúng ai làm gì", () => {
    expect(SELL_RETURNS).toContain("hoàn thành phiếu trả")
    expect(SELL_RETURNS, "còn hứa quản lý duyệt").not.toContain("quản lý duyệt")
  })
})

/**
 * Nút Xuất hàng của nhà phân phối (Coder Pack mục 5). Một hành động, một
 * chữ, một chỗ đọc kết quả.
 */
describe("Nút Xuất hàng nói đúng chuyện đã xảy ra", () => {
  const TABLE = code(read("src/components/orders/desktop-order-table.tsx"))
  const DRAWER = code(read("src/components/orders/order-drawer.tsx"))

  /**
   * ⚠ MỘT HÀNH ĐỘNG THÌ MỘT CHỮ. Ba lối vào cùng gọi `approveOrders`
   * nhưng từng viết ba chữ khác nhau — "Xuất hàng" ở dải chọn nhiều,
   * "Duyệt" ở dòng bảng, "Duyệt đơn" ở ngăn Xem nhanh. Người dùng đọc ra
   * ba việc, và hai trong ba chữ nói về một bước v2 đã bỏ.
   */
  it("cả ba lối vào đều gọi là Xuất hàng, không còn chữ duyệt", () => {
    for (const [name, src] of [["bảng", TABLE], ["ngăn Xem nhanh", DRAWER]] as const) {
      expect(src, `${name} còn chữ duyệt`).not.toMatch(/duyệt/i)
      expect(src, `${name} không có nút Xuất hàng`).toContain("Xuất hàng")
    }
    expect(LIST).toContain("Xuất hàng")
  })

  /**
   * ⚠ ĐƠN SẠCH CÓ `approval_reason` LÀ CHUỖI RỖNG, không phải null (xem
   * `decideStatus`). Gác cảnh báo bằng mỗi trạng thái thì mọi phiếu tạm
   * đều đeo nhãn đỏ và ngăn Xem nhanh vẽ ra một hộp hổ phách TRỐNG — nhãn
   * đỏ ở khắp nơi thì không còn là cảnh báo nữa.
   */
  it("cảnh báo chỉ hiện khi thật sự có nội dung", () => {
    expect(TABLE).toContain("pending && !!o.approval_reason?.trim()")
    expect(DRAWER).toContain("pending && warnings.length > 0")
    // Và phép tách phải tự loại chuỗi rỗng — kiểm bằng cách GỌI nó.
    expect(splitWarnings("")).toEqual([])
    expect(splitWarnings("   ")).toEqual([])
    expect(splitWarnings(null)).toEqual([])
    expect(splitWarnings("Đơn 60.000.000 vượt ngưỡng • Khách quá hạn 3 ngày")).toEqual([
      "Đơn 60.000.000 vượt ngưỡng",
      "Khách quá hạn 3 ngày",
    ])
    // Câu cố định không chứa dấu tách thì ra ĐÚNG MỘT mảnh, không cắt nhỏ.
    expect(splitWarnings("Tạo offline — NPP kiểm tồn/công nợ trước khi xuất hàng")).toHaveLength(1)
  })

  /**
   * ⚠ CỘT TỒN PHẢI NÓI ĐÚNG THỨ RPC SẮP TRỪ, nếu không nó còn tệ hơn
   * không có: màn báo đủ rồi RPC ném lỗi, hoặc màn báo thiếu cho một đơn
   * xuất được ngon lành — và nhà phân phối mất niềm tin sau đúng hai lần.
   */
  it("đối chiếu tồn quy về đơn vị cơ sở bằng ảnh chụp hệ số của dòng đơn", () => {
    // 4 thùng × 12 = 48 cơ sở, tồn 40 → thiếu 8. So thẳng 4 ≤ 40 sẽ ra "đủ".
    const [r] = previewOrderStock(
      [{ productId: "p1", quantity: 4, conversionFactor: 12 }],
      [],
      { p1: 40 }
    )
    expect(r.needBase).toBe(48)
    expect(r.shortBase).toBe(8)
    // Thiếu hệ số thì coi như 1 — y như RPC (COALESCE … , 1).
    expect(previewOrderStock([{ productId: "p1", quantity: 3, conversionFactor: null }], [], { p1: 10 })[0].needBase).toBe(3)
  })

  /** ⚠ Nhiều dòng cùng một mặt hàng phải CỘNG rồi mới so. */
  it("gộp nhu cầu theo sản phẩm, không xét từng dòng", () => {
    const rows = previewOrderStock(
      [
        { productId: "p1", quantity: 6, conversionFactor: 1 },
        { productId: "p1", quantity: 6, conversionFactor: 1 },
      ],
      [],
      { p1: 10 }
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].shortBase).toBe(2)
  })

  /**
   * ⚠ HÀNG ĐỔI CỦA PHIẾU TRẢ NHÁP CŨNG RỜI KHO trong chính chuyến này —
   * `complete_order` gộp chúng vào cùng lệnh xuất. Bỏ qua là đơn 8 bán +
   * 2 đổi trên tồn 9 hiện màu xanh rồi RPC ném lỗi.
   */
  it("cộng cả hàng đổi của phiếu trả nháp", () => {
    const rows = previewOrderStock(
      [{ productId: "p1", quantity: 8, conversionFactor: 1 }],
      [{ productId: "p1", quantity: 2, conversionFactor: 1 }],
      { p1: 9 }
    )
    expect(totalShortBase(rows)).toBe(1)
    // Và ngăn Xem nhanh phải lấy ĐÚNG phiếu trả còn nháp, không lấy cả
    // phiếu đã sang phiếu tạm — chính complete_order đẩy chúng sang đó
    // ngay sau khi xuất, nên đếm cả hai là trừ hai lần.
    expect(DRAWER).toContain('.eq("returns.status", "draft")')
    expect(DRAWER).toContain('.eq("is_exchange", true)')
  })

  /**
   * ⚠ LỌC ĐÚNG NHỮNG GÌ RPC LỌC. `post_stock_export` chỉ lọc org, sản
   * phẩm và `qty_on_hand > 0` — không lọc khu vực kho, không lọc hạn
   * dùng. Thêm điều kiện nào cũng làm cột Tồn nói khác thứ sẽ bị trừ.
   */
  it("đọc lô đúng phép lọc của RPC, và có phân trang", () => {
    expect(DRAWER).toContain('.gt("qty_on_hand", 0)')
    expect(DRAWER).not.toContain("warehouse_zone")
    expect(DRAWER).not.toContain("expires_at")
    // PostgREST cắt ở db.max_rows và trả 200 KHÔNG kèm lỗi — lô nằm sau
    // ngưỡng đó biến mất và sản phẩm của chúng hiện tồn 0.
    expect(DRAWER).toContain("fetchAllForAggregate<")
  })

  /**
   * ⚠ THIẾU TỒN KHÔNG PHẢI LÚC NÀO CŨNG LÀ CHẶN. Đơn vị bật cho phép bán
   * âm thì RPC vẫn xuất và chỉ trả `short_qty` — tô đỏ ở đó là làm nhà
   * phân phối không dám bấm một nút vốn bấm được.
   */
  it("phân biệt cảnh báo vàng với vạch đỏ theo cấu hình cho phép bán âm", () => {
    expect(DRAWER).toContain("org?.allow_oversell === true")
    expect(DRAWER).toContain("oversellAllowed ?")
  })
})
