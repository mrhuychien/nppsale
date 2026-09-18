import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

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

describe("Đơn của tôi: ba tab, và chỉ ba", () => {
  it("danh sách tab của NVBH đúng bằng ba trạng thái sau khi gửi", () => {
    const i = LIST.indexOf("const SALES_TABS = ")
    expect(i, "không tìm thấy danh sách tab của NVBH").toBeGreaterThan(0)
    const decl = LIST.slice(i, LIST.indexOf("\n", i))
    for (const s of ["submitted", "completed", "cancelled"]) {
      expect(decl, `thiếu tab ${s}`).toContain(`"${s}"`)
    }
    // ⚠ "Nháp" KHÔNG ở đây: màn này không có nút nào làm được gì với một
    // bản nháp. Cho nó hiện là người dùng mở đúng chỗ không có nút.
    expect(decl).not.toContain('"draft"')
    expect(decl).not.toContain('"all"')
  })

  /**
   * ⚠ NVBH KHÔNG CÓ TAB "TẤT CẢ", nên giá trị mặc định của bộ lọc ("all")
   * không trỏ tới tab nào. Không quy nó về một tab có thật thì màn mở ra
   * với mọi tab xám và một danh sách trộn cả nháp lẫn đơn đã huỷ.
   */
  it("giá trị lọc ngoài ba tab được quy về Phiếu tạm", () => {
    const i = LIST.indexOf("const effectiveStatus =")
    expect(i).toBeGreaterThan(0)
    const expr = LIST.slice(i, LIST.indexOf("\n\n", i))
    expect(expr).toContain("isSales")
    expect(expr).toContain("SALES_TABS")
    expect(expr).toContain('"submitted"')
    // Và truy vấn phải dùng giá trị đã quy, không phải giá trị thô.
    expect(LIST).toContain("applyStatusFilter(applyCommonFilters(q), effectiveStatus)")
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
  it("huỷ hàng loạt đếm đúng số dòng ghi được, không tin vào danh sách id", () => {
    const i = LIST.indexOf('.update({ status: "cancelled" })')
    expect(i, "không tìm thấy lệnh huỷ hàng loạt").toBeGreaterThan(0)
    const block = LIST.slice(i, i + 700)
    expect(block, "huỷ hàng loạt không lấy lại dòng đã ghi").toContain('.select("id")')
    expect(block).toContain("const done = new Set(")
    expect(block).toContain("done.size === 0")
    // Vá state và đếm trong toast đều phải theo `done`, không theo `ids`.
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
   * bước theo vai trò rồi mới vẽ; thẻ "Thao tác" của bản máy tính thì vẽ
   * cả bảng rồi lọc bên trong — nên nó không biết cờ `backward`, và
   * "Rút về nháp" ngồi vào nút xanh đậm to nhất thẻ.
   */
  it("thẻ Thao tác máy tính dùng cùng danh sách đã lọc vai trò, và không tô nút bước lùi", () => {
    const i = DETAIL.indexOf('<CardTitle>Thao tác</CardTitle>')
    expect(i).toBeGreaterThan(0)
    const card = DETAIL.slice(i - 400, i + 1200)
    expect(card, "thẻ Thao tác vẫn vẽ từ danh sách chưa lọc vai trò").not.toContain(
      "availableTransitions.map"
    )
    expect(card).toContain("roleTransitions.map")
    expect(card, "bước lùi vẫn được tô như hành động chính").not.toContain('"default"')
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
