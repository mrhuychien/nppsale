import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canEditOrder,
  canFullEditOrder,
  whyCannotEdit,
  SALES_EDITABLE_STATUSES,
  type OrderEditContext,
} from "../src/lib/orders/edit-permission"
import { needsReapprovalAfterEdit, reapprovalReason } from "../src/lib/orders/reapproval"
import { DEFAULT_PERMISSION_MAP } from "../src/lib/permissions"
import type { ApprovalDecision } from "../src/lib/approval"
import type { OrderStatus } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const PAGE = read("src/app/(dashboard)/orders/[id]/page.tsx")
const MIG115 = read("supabase/migrations/115_sales_edit_after_approval.sql")
const MIG116 = read("supabase/migrations/116_grant_sales_order_update.sql")

/**
 * SQL đã bỏ chú thích.
 *
 * ⚠ Phần giải thích trong migration nhắc nguyên văn "WITH CHECK" và tên
 * các trạng thái — nhắc để người sau hiểu vì sao có chúng. Soi cả chú
 * thích thì phép kiểm đếm nhầm lời giải thích thành mệnh đề thật: thử phá
 * cho thấy xoá hẳn `WITH CHECK` của phần đầu đơn mà phép kiểm vẫn XANH.
 */
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, "")
const MIG115_CODE = sqlCode(MIG115)

const ME = "u-sales-1"
const ctx = (over: Partial<OrderEditContext> = {}): OrderEditContext => ({
  role: "sales",
  userId: ME,
  status: "confirmed",
  salesUserId: ME,
  hasUpdatePermission: true,
  ...over,
})

describe("NVBH sửa được đơn của mình sau khi duyệt", () => {
  it("đơn đã duyệt của chính mình: sửa được đầy đủ", () => {
    expect(canEditOrder(ctx())).toBe(true)
    expect(canFullEditOrder(ctx())).toBe(true)
    expect(whyCannotEdit(ctx())).toBeNull()
  })

  it("đơn nháp của chính mình: vẫn sửa được như cũ", () => {
    expect(canFullEditOrder(ctx({ status: "draft" }))).toBe(true)
  })

  /**
   * ⚠ Từ lúc thủ kho bắt đầu lấy hàng, đơn trên giấy và hàng trên xe đẩy
   * phải là một. Sửa lúc đó là hai người làm hai việc khác nhau trên cùng
   * một đơn.
   */
  it("đơn đang lấy hàng: NVBH không sửa được nữa", () => {
    expect(canEditOrder(ctx({ status: "picking" }))).toBe(false)
    expect(whyCannotEdit(ctx({ status: "picking" }))).toContain("lấy hàng")
  })

  /** ⚠ Đúng người phụ trách. Màn hình phải khớp RLS, không thì bấm Lưu rơi vào 0 dòng. */
  it("đơn của nhân viên khác: không sửa được", () => {
    expect(canEditOrder(ctx({ salesUserId: "u-sales-2" }))).toBe(false)
    expect(whyCannotEdit(ctx({ salesUserId: "u-sales-2" }))).toContain("nhân viên khác")
  })

  it("đơn cũ chưa ghi ai phụ trách: không đoán bừa là của mình", () => {
    expect(canEditOrder(ctx({ salesUserId: null }))).toBe(false)
  })

  it.each(["delivered", "cancelled"] as OrderStatus[])(
    "đơn %s thì không ai sửa được, kể cả chủ",
    (status) => {
      expect(canEditOrder(ctx({ status }))).toBe(false)
      expect(canEditOrder(ctx({ role: "owner", status }))).toBe(false)
    }
  )

  it("chưa được cấp quyền thì không sửa, và nói rõ vì sao", () => {
    const c = ctx({ hasUpdatePermission: false })
    expect(canEditOrder(c)).toBe(false)
    expect(whyCannotEdit(c)).toContain("chưa được cấp quyền")
  })

  /** Vai trò khác giữ nguyên hành vi cũ — không siết nhầm ai. */
  it("thủ kho vẫn sửa được đơn đang lấy hàng", () => {
    expect(canFullEditOrder(ctx({ role: "warehouse", status: "picking" }))).toBe(true)
  })

  it("chủ và quản lý không bị ràng buộc 'đơn của mình'", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canEditOrder(ctx({ role, salesUserId: "ai-do-khac" }))).toBe(true)
    }
  })

  it("ma trận phân quyền đã bật orders.update cho NVBH", () => {
    expect(DEFAULT_PERMISSION_MAP.sales.orders).toContain("update")
    // Không mở rộng sang xoá đơn — đó là việc khác.
    expect(DEFAULT_PERMISSION_MAP.sales.orders).not.toContain("delete")
  })
})

describe("Màn hình và RLS phải nói cùng một danh sách trạng thái", () => {
  /**
   * ⚠ RLS KHÔNG BÁO LỖI KHI TỪ CHỐI: 0 dòng, HTTP 200, `error` null. Nới ở
   * màn hình mà quên nới dưới database thì nhân viên bấm Lưu, thấy "Đã cập
   * nhật", rồi tải lại trang và thấy số cũ. Siết ở database mà quên siết
   * màn hình cũng ra đúng cảnh đó.
   */
  it("mọi trạng thái NVBH sửa được đều có trong chính sách RLS", () => {
    expect(SALES_EDITABLE_STATUSES.length).toBeGreaterThan(0)
    // Chính sách phải liệt kê ĐÚNG bấy nhiêu trạng thái — không thiếu (mất
    // tính năng) và không thừa (mở quá tay).
    const lists = MIG115_CODE.match(/status IN \(([^)]*)\)/g) ?? []
    expect(lists.length, "không tìm thấy mệnh đề status IN nào").toBeGreaterThanOrEqual(4)
    for (const l of lists) {
      const inList = l.match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1))
      expect(inList.sort()).toEqual([...SALES_EDITABLE_STATUSES].sort())
    }
  })

  /**
   * ⚠ WITH CHECK chặn chiều NGƯỢC LẠI. Thiếu nó thì một lệnh UPDATE vừa
   * sửa vừa tự đẩy đơn sang `picking` — tự bỏ qua bước thủ kho. Đã đo trên
   * Postgres 16: có WITH CHECK thì lệnh đó bị chặn hẳn.
   */
  it("CẢ HAI chính sách của NVBH đều có WITH CHECK, không chỉ USING", () => {
    for (const name of [
      "Sales can update own open orders",
      "Sales can manage lines of own open orders",
    ]) {
      const i = MIG115_CODE.indexOf(`CREATE POLICY "${name}"`)
      expect(i, `không thấy chính sách ${name}`).toBeGreaterThanOrEqual(0)
      const body = MIG115_CODE.slice(i, MIG115_CODE.indexOf(";", i))
      expect(body, `${name} thiếu USING`).toContain("USING")
      expect(body, `${name} thiếu WITH CHECK`).toContain("WITH CHECK")
    }
  })

  /**
   * ⚠ LỖ HỔNG CÓ SẴN. Chính sách cũ của `sales_order_lines` là FOR ALL cho
   * cả 'sales', không ràng buộc trạng thái lẫn người phụ trách — dòng hàng
   * sửa được ở MỌI đơn trong tổ chức, chỉ phần đầu đơn bị chặn. Đã đo:
   * trước migration, NVBH sửa được dòng hàng của đơn NGƯỜI KHÁC.
   */
  it("dòng hàng: ràng buộc người phụ trách ở CẢ USING lẫn WITH CHECK", () => {
    expect(MIG115_CODE).toContain(
      'DROP POLICY IF EXISTS "Owner/Manager/Sales can manage order lines"'
    )
    const i = MIG115_CODE.indexOf('CREATE POLICY "Sales can manage lines of own open orders"')
    const body = MIG115_CODE.slice(i, MIG115_CODE.indexOf(";", i))
    const using = body.slice(body.indexOf("USING"), body.indexOf("WITH CHECK"))
    const check = body.slice(body.indexOf("WITH CHECK"))
    for (const [label, part] of [["USING", using], ["WITH CHECK", check]] as const) {
      expect(part, `${label} thiếu ràng buộc người phụ trách`).toContain(
        "so.sales_user_id = auth.uid()"
      )
      expect(part, `${label} thiếu ràng buộc trạng thái`).toContain("so.status IN")
    }
  })

  /** Sửa mặc định trong mã thôi thì tổ chức đã lưu ô `false` sẽ không đổi gì. */
  it("có migration bật ô quyền cho tổ chức đã lưu sẵn", () => {
    const code = sqlCode(MIG116)
    // Ô đã lưu sẵn → bật lên.
    expect(code).toMatch(/UPDATE role_permissions[\s\S]*?SET allowed = true/)
    expect(code).toMatch(/role = 'sales' AND module = 'orders' AND action = 'update'/)
    // Chưa từng lưu → chèn mới.
    expect(code).toMatch(/INSERT INTO role_permissions[\s\S]*?'sales', 'orders', 'update', true/)
    // Và phải đếm được là đã đổi bao nhiêu — chạy xong mà không biết gì
    // thì không khác gì không chạy.
    expect((code.match(/GET DIAGNOSTICS/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(code).toContain("RAISE NOTICE")
  })

  /** ⚠ Không được động tới ô quyền nào khác — ai tự siết gì thì giữ nguyên. */
  it("migration chỉ động đúng một ô quyền", () => {
    const code = sqlCode(MIG116)
    const actions = code.match(/action = '(\w+)'|'sales', 'orders', '(\w+)'/g) ?? []
    for (const a of actions) expect(a).toContain("update")
  })
})

describe("Sửa xong đơn đã duyệt thì phải duyệt lại khi cần", () => {
  const decision = (over: Partial<ApprovalDecision> = {}): ApprovalDecision => ({
    autoApprove: false,
    reason: "Vượt ngưỡng tự duyệt",
    reasons: ["Vượt ngưỡng tự duyệt"],
    expectedApprover: "manager",
    ...over,
  })

  /**
   * ⚠ LỖ HỔNG PHẢI BỊT. Không kiểm lại thì bước duyệt thành vô nghĩa: gửi
   * một đơn nhỏ cho quản lý bấm duyệt, xong sửa lên gấp mười.
   */
  it("NVBH sửa đơn đã duyệt lên quá ngưỡng → trả về chờ duyệt lại", () => {
    expect(
      needsReapprovalAfterEdit({ status: "confirmed", decision: decision(), editorRole: "sales" })
    ).toBe(true)
  })

  it("vẫn trong ngưỡng tự duyệt → không làm phiền ai", () => {
    expect(
      needsReapprovalAfterEdit({
        status: "confirmed",
        decision: decision({ autoApprove: true, reason: "", reasons: [], expectedApprover: null }),
        editorRole: "sales",
      })
    ).toBe(false)
  })

  /** Bắt quản lý duyệt lại đơn do chính quản lý sửa là thêm bước, không thêm chốt. */
  it("người sửa đủ thẩm quyền duyệt mức đó → không trả về", () => {
    expect(
      needsReapprovalAfterEdit({ status: "confirmed", decision: decision(), editorRole: "manager" })
    ).toBe(false)
    expect(
      needsReapprovalAfterEdit({ status: "confirmed", decision: decision(), editorRole: "owner" })
    ).toBe(false)
  })

  /** Cần CHỦ duyệt mà quản lý sửa → vẫn phải trả về. */
  it("quản lý sửa nhưng mức đó cần chủ duyệt → vẫn trả về", () => {
    expect(
      needsReapprovalAfterEdit({
        status: "confirmed",
        decision: decision({ expectedApprover: "owner" }),
        editorRole: "manager",
      })
    ).toBe(true)
  })

  it("đơn chưa duyệt thì không có gì để duyệt lại", () => {
    expect(
      needsReapprovalAfterEdit({ status: "draft", decision: decision(), editorRole: "sales" })
    ).toBe(false)
  })

  it("lý do trả về có nêu quy tắc nào chặn", () => {
    expect(reapprovalReason(decision())).toContain("Vượt ngưỡng tự duyệt")
    expect(reapprovalReason(decision({ reason: "" }))).toContain("cần duyệt lại")
  })
})

describe("Lưu hỏng thì phải BÁO, không được báo thành công", () => {
  /**
   * ⚠ ĐÂY LÀ CHỖ NGUY HIỂM NHẤT CỦA CẢ THAY ĐỔI NÀY. Dòng hàng và phần đầu
   * đơn nằm ở hai bảng với hai chính sách khác nhau. Sửa dòng hàng xong mà
   * lệnh cập nhật tổng tiền bị RLS từ chối thì đơn còn lại: dòng hàng mới,
   * tổng tiền cũ — và màn hình vẫn báo "Đã cập nhật".
   */
  it("MỌI lệnh sửa đơn đều lấy về dòng để đếm, không chỉ kiểm error", () => {
    // Cắt trang thành từng đoạn bắt đầu bằng `.from("sales_orders")`, giữ
    // lại đoạn nào là lệnh UPDATE, rồi soi 400 ký tự đầu của nó.
    const chunks = PAGE.split('.from("sales_orders")').slice(1)
    const updateChunks = chunks.filter((c) => /^[\s\S]{0,80}?\.update\(/.test(c))
    expect(updateChunks.length, "không tìm thấy lệnh UPDATE nào").toBeGreaterThanOrEqual(3)
    for (const c of updateChunks) {
      expect(c.slice(0, 400), `thiếu .select("id"): ${c.slice(0, 120)}`).toContain('.select("id")')
    }
  })

  /**
   * ⚠ Lấy về rồi mà không đếm thì cũng như không lấy. Phép kiểm bản đầu
   * chỉ ĐẾM số chốt trong cả trang, nên gỡ một chốt vẫn còn đủ số và vẫn
   * XANH. Nay soi TỪNG lệnh UPDATE: chốt phải nằm ngay sau chính nó.
   */
  it("mỗi lệnh sửa đơn có chốt kiểm mảng rỗng của riêng nó", () => {
    const chunks = PAGE.split('.from("sales_orders")').slice(1)
    const updateChunks = chunks.filter((c) => /^[\s\S]{0,80}?\.update\(/.test(c))
    expect(updateChunks.length).toBeGreaterThanOrEqual(3)
    for (const c of updateChunks) {
      const near = c.slice(0, 700)
      expect(near, `thiếu chốt đếm dòng: ${c.slice(0, 120)}`).toMatch(
        /if \(!\w+ \|\| \w+\.length === 0\) \{/
      )
    }
  })

  /**
   * ⚠ Bước chạy lại quy tắc duyệt phải được GỌI THẬT từ chỗ lưu dòng hàng.
   * Thử phá cho thấy tắt hẳn điều kiện đó mà mọi phép kiểm ở lib vẫn XANH —
   * vì lib đúng, chỉ là không ai gọi nó.
   */
  it("chỗ lưu dòng hàng có gọi lại bộ quy tắc duyệt", () => {
    expect(PAGE).toMatch(/if \(order\.status === "confirmed" && user\) \{/)
    expect(PAGE).toContain("needsReapprovalAfterEdit({")
    expect(PAGE).toContain("headerUpdate.status = \"draft\"")
    // Trả về chờ duyệt thì phải xoá dấu vết đã duyệt, không để đơn mang
    // tên người duyệt cũ trên một bộ số liệu họ chưa từng thấy.
    expect(PAGE).toContain("headerUpdate.approved_by = null")
    expect(PAGE).toContain("headerUpdate.approved_at = null")
  })

  it("báo đúng nguyên nhân cho người dùng", () => {
    expect(PAGE).toContain("KHÔNG cập nhật được tổng đơn")
    expect(PAGE).toContain("bạn không còn quyền sửa đơn này")
  })

  /** Không sửa được thì nói vì sao, đừng chỉ giấu nút đi. */
  it("ẩn nút Sửa thì kèm lý do", () => {
    expect(PAGE).toContain("{!canEdit && cannotEditReason && (")
  })

  /** Luật nằm ở lib dùng chung, không viết lại giữa trang. */
  it("trang không tự chế lại luật sửa đơn", () => {
    expect(PAGE).toContain("canEditOrder(editCtx)")
    expect(PAGE).toContain("canFullEditOrder(editCtx)")
    expect(PAGE).not.toContain('["draft", "confirmed"].includes(order.status)')
  })
})
