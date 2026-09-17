import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  grossFromSavedLines,
  isSentForApproval,
  sendDraftForApproval,
} from "../src/lib/sell/send-approval"
import { DRAFT_APPROVAL_REASON } from "../src/lib/orders/save-gate"
import { DEFAULT_APPROVAL_RULES } from "../src/lib/approval"
import type { ApprovalRules } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SEND = code(read("src/lib/sell/send-approval.ts"))
const ORDERS = code(read("src/app/(dashboard)/orders/page.tsx"))
const DETAIL = code(read("src/app/(dashboard)/orders/[id]/page.tsx"))
const DRAFTS = code(read("src/app/(dashboard)/sell/drafts/page.tsx"))

const rules = { ...DEFAULT_APPROVAL_RULES } as unknown as ApprovalRules

describe("Phân biệt bản nháp tự lưu với đơn đã gửi chờ duyệt", () => {
  /**
   * ⚠ HAI LOẠI ĐƠN NHÁP KHÁC HẲN NHAU và trước nay bị gộp làm một: bản NVBH
   * tự lưu để soạn tiếp, và đơn đã gửi mà quy tắc không cho tự duyệt. Cả hai
   * đều `status = 'draft'`, nên danh sách đơn gắn nhãn "Cần duyệt" cho cả
   * loại đầu — quản lý mở ra thấy đơn người ta còn đang soạn dở.
   */
  it("bản tự lưu KHÔNG phải đơn chờ duyệt", () => {
    expect(isSentForApproval("draft", DRAFT_APPROVAL_REASON)).toBe(false)
  })

  it("đơn gửi rồi mà quy tắc chặn thì LÀ đơn chờ duyệt", () => {
    expect(isSentForApproval("draft", "Đơn 90.000.000 vượt ngưỡng tự động duyệt")).toBe(true)
  })

  it("chưa có lý do thì chưa gửi", () => {
    expect(isSentForApproval("draft", null)).toBe(false)
    expect(isSentForApproval("draft", "   ")).toBe(false)
  })

  it("đơn đã rời khỏi nháp thì không còn chờ duyệt", () => {
    expect(isSentForApproval("confirmed", "vượt ngưỡng")).toBe(false)
    expect(isSentForApproval("cancelled", "vượt ngưỡng")).toBe(false)
  })

  /** Màn danh sách phải dùng CHUNG phép này, không tự viết lại biểu thức. */
  it("danh sách đơn dùng chung phép phân biệt, cả mobile lẫn desktop", () => {
    // Desktop gọi thẳng; hàng mobile đi qua `orderTone`, và `orderTone`
    // phải gọi đúng hàm này chứ không tự chế phép phân biệt.
    // Cột trạng thái desktop nay ở DesktopOrderTable; cả hai bảng đi qua
    // `orderTone` + `isSentForApproval`, không tự chế.
    const DTABLE = read("src/components/orders/desktop-order-table.tsx")
    expect(DTABLE).toContain("isSentForApproval(o.status, o.approval_reason)")
    expect(DTABLE).toContain("orderTone(o.status, o.approval_reason)")
    expect(ORDERS).not.toContain('order.status === "draft" && !!order.approval_reason')
    const TONE = read("src/lib/orders/status-tone.ts")
    expect(TONE).toContain("if (isSentForApproval(status, approvalReason)) {")
    expect(TONE).not.toContain('=== "draft" && !!')
    expect(ORDERS).not.toContain('order.status === "draft" && !!order.approval_reason')
    expect(ORDERS).not.toContain('order.status === "draft" && order.approval_reason &&')
  })

  /**
   * ⚠ Phép ĐẾM và phép LỌC chạy dưới database, không đi qua hàm trên. Quên
   * một trong hai thì tab "Chờ duyệt" hiện con số khác với danh sách bên
   * dưới nó.
   */
  it("cả phép đếm lẫn phép lọc đều trừ bản tự lưu ra", () => {
    // Hai phép nay dùng CHUNG một hàm, nên chỉ còn một chỗ khai — và đó
    // chính là điều phải giữ: một nơi khai thì không có chỗ để lệch.
    expect(ORDERS).toContain('.neq("approval_reason", DRAFT_APPROVAL_REASON)')
    const helper = ORDERS.slice(
      ORDERS.indexOf("const applyStatusFilter ="),
      ORDERS.indexOf("const applyStatusFilter =") + 700
    )
    expect(helper, "phép lọc trạng thái không còn trừ bản tự lưu").toContain(
      '.neq("approval_reason", DRAFT_APPROVAL_REASON)'
    )
    // Danh sách VÀ phép đếm đều đi qua hàm đó — đúng hai nơi GỌI.
    const uses = ORDERS.match(/applyStatusFilter\(/g) ?? []
    expect(uses.length, "phải gọi ở cả danh sách lẫn phép đếm").toBe(2)
    expect(ORDERS).toContain("return applyStatusFilter(applyCommonFilters(q), statusFilter)")
    expect(ORDERS).toContain("COUNTED_STATUSES.map((st) => applyStatusFilter(base(), st))")
  })

  it("màn chi tiết đơn nói rõ nháp chưa gửi, không gọi là chờ duyệt", () => {
    expect(DETAIL).toContain("Bản nháp — chưa gửi duyệt")
    expect(DETAIL).toContain("isSentForApproval(order.status, order.approval_reason)")
    expect(DETAIL).toContain("Quản lý chưa nhìn thấy đơn này")
  })

  it("màn đơn tạm gắn nhãn cho từng loại", () => {
    expect(DRAFTS).toContain('isSentForApproval("draft", o.approval_reason)')
    expect(DRAFTS).toContain("Đã gửi · chờ duyệt")
    expect(DRAFTS).toContain("Chưa gửi")
    // Đơn đã gửi thì không còn nút gửi lần nữa.
    expect(DRAFTS).toContain("{!sent && (")
  })
})

describe("Giá trị hàng trước chiết khấu tính từ dòng đã lưu", () => {
  /**
   * ⚠ Số này KHÔNG có trên đầu đơn. `subtotal` là số SAU chiết khấu, mà mọi
   * ngưỡng duyệt đều xét số sau chiết khấu — nên đơn sửa giá về 0 tụt xuống
   * dưới mọi ngưỡng rồi TỰ ĐỘNG DUYỆT.
   */
  it("cộng lại phần đã chiết khấu của từng dòng", () => {
    expect(grossFromSavedLines(0, [{ line_discount: 720_000 }, { line_discount: 80_000 }])).toBe(
      800_000
    )
    expect(grossFromSavedLines(1_000_000, [{ line_discount: 200_000 }])).toBe(1_200_000)
  })

  it("chiết khấu âm hoặc thiếu thì coi như không có, không trừ ngược", () => {
    expect(grossFromSavedLines(500_000, [{ line_discount: -900_000 }, {}])).toBe(500_000)
    expect(grossFromSavedLines(500_000, [{ line_discount: null }])).toBe(500_000)
  })
})

/** Khách hàng giả lập của PostgREST, đủ để đo điều kiện lọc và số lần gọi. */
function fakeClient(opts: { updatedRows?: number; approvers?: string[] }) {
  const filters: Array<[string, unknown]> = []
  const notifications: unknown[] = []
  const rows = opts.updatedRows ?? 1
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        update() {
          return q
        },
        insert(v: unknown) {
          if (table === "notifications") notifications.push(v)
          return Promise.resolve({ data: null, error: null })
        },
        select() {
          if (table === "users") return q
          return Promise.resolve({
            data: Array.from({ length: rows }, (_, i) => ({ id: `o${i}` })),
            error: null,
          })
        },
        eq(c: string, v: unknown) {
          filters.push([`${table}.${c}`, v])
          if (table === "users" && c === "is_active") {
            return Promise.resolve({
              data: (opts.approvers ?? ["u-owner"]).map((id) => ({ id, role: "owner" })),
              error: null,
            })
          }
          return q
        },
        in() {
          return q
        },
      })
      return q
    },
  }
  return { client: client as unknown as SupabaseClient, filters, notifications }
}

const input = (over: Record<string, unknown> = {}) => ({
  orderId: "o1",
  orderCode: "DH-1",
  orgId: "org1",
  userId: "u1",
  orderTotal: 1_000_000,
  subtotal: 1_000_000,
  grossBeforeDiscount: 1_000_000,
  customer: { id: "c1", credit_limit: 0 },
  rules,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  role: "sales" as const,
  ...over,
})

describe("Gửi đơn nháp đi duyệt", () => {
  it("đơn nhỏ trong ngưỡng thì duyệt luôn", async () => {
    const { client } = fakeClient({})
    const out = await sendDraftForApproval(client, input())
    expect(out.status).toBe("confirmed")
  })

  /**
   * ⚠ CHỐT CHỐNG ĐUA. Quản lý vừa duyệt xong trên máy tính trong lúc NVBH
   * bấm Gửi trên điện thoại — thiếu điều kiện `status = 'draft'` thì cú bấm
   * chậm hơn kéo một đơn đã duyệt ngược về nháp, và kho đang lấy hàng thì
   * không hiểu chuyện gì.
   */
  it("chỉ đụng tới đơn còn đang ở nháp", async () => {
    const { client, filters } = fakeClient({})
    await sendDraftForApproval(client, input())
    expect(filters).toContainEqual(["sales_orders.id", "o1"])
    expect(filters).toContainEqual(["sales_orders.status", "draft"])
  })

  /** ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. Cũng 0 dòng khi đơn đã
   *  rời khỏi nháp. Cả hai đều KHÔNG được báo "đã gửi". */
  it("không sửa được dòng nào thì báo lỗi, không im lặng", async () => {
    const { client, notifications } = fakeClient({ updatedRows: 0 })
    await expect(sendDraftForApproval(client, input())).rejects.toThrow(/Không gửi được đơn DH-1/)
    // Và KHÔNG báo cho ai — thông báo về một đơn chưa gửi là báo tin sai.
    expect(notifications).toHaveLength(0)
  })

  /**
   * ⚠ ĐƠN NẰM CHỜ MÀ KHÔNG AI BIẾT THÌ BẰNG NHƯ CHƯA GỬI. Đây là nửa sau
   * của việc "gửi duyệt" — nửa đầu chỉ đổi một chữ trong cột `status`.
   */
  it("đơn phải duyệt tay thì báo cho quản lý", async () => {
    const { client, notifications } = fakeClient({ approvers: ["u-a", "u-b"] })
    const out = await sendDraftForApproval(client, input({ orderTotal: 100_000_000 }))
    expect(out.status).toBe("draft")
    expect(notifications).toHaveLength(1)
    const rows = notifications[0] as Array<Record<string, unknown>>
    expect(rows.map((r) => r.user_id)).toEqual(["u-a", "u-b"])
    expect(rows[0].type).toBe("order_pending_approval")
    expect(String(rows[0].title)).toContain("DH-1")
  })

  it("đơn tự duyệt được thì không làm phiền ai", async () => {
    const { client, notifications } = fakeClient({})
    await sendDraftForApproval(client, input())
    expect(notifications).toHaveLength(0)
  })

  /**
   * ⚠ LÝ DO RỖNG LÀ KHÔNG ĐƯỢC. Chính nó phân biệt "đã gửi, chờ duyệt" với
   * "bản nháp tự lưu"; rỗng thì đơn gửi đi xong lại hiện như chưa gửi và
   * không ai ngó tới.
   */
  it("đơn chờ duyệt luôn có lý do khác câu của bản tự lưu", async () => {
    const { client } = fakeClient({})
    const out = await sendDraftForApproval(client, input({ contextFailed: true }))
    expect(out.status).toBe("draft")
    expect(isSentForApproval("draft", out.reason)).toBe(true)
    expect(SEND).toContain('{ approval_reason: reason || "Chờ duyệt tay." }')
  })

  /** ⚠ Cho không hàng bằng cách sửa giá về 0 thì KHÔNG được tự duyệt. */
  it("chiết khấu sâu không lọt qua được", async () => {
    const { client } = fakeClient({})
    const out = await sendDraftForApproval(
      client,
      input({ orderTotal: 0, subtotal: 0, grossBeforeDiscount: 100_000_000 })
    )
    expect(out.status).toBe("draft")
  })
})

describe("Nơi bấm Gửi duyệt", () => {
  /**
   * ⚠ TRƯỚC ĐÂY KHÔNG CÓ ĐƯỜNG NÀY. `STATUS_FLOW.draft` chỉ cho owner/manager
   * bấm "Duyệt đơn", còn NVBH chỉ có "Huỷ đơn" — lưu nháp xong là đơn nằm im
   * và người duy nhất biết nó tồn tại là người soạn nó.
   */
  it("màn chi tiết đơn có nút cho người phụ trách đơn", () => {
    expect(DETAIL).toContain("handleSendForApproval")
    expect(DETAIL).toContain("onClick={handleSendForApproval}")
    // Đơn rỗng thì không gửi được — gửi một đơn 0 dòng cho quản lý duyệt là
    // bắt họ duyệt một tờ giấy trắng.
    expect(DETAIL).toContain("disabled={actionLoading || lines.length === 0}")
  })

  it("màn đơn tạm có nút gửi nhanh", () => {
    expect(DRAFTS).toContain("const doSend = async (o: DraftOrder)")
    expect(DRAFTS).toContain("await sendDraftForApproval(supabase, {")
    expect(DRAFTS).toContain("Gửi duyệt")
  })

  /** ⚠ Đọc hỏng dòng hàng thì DỪNG: coi như không có dòng nào là chiết khấu
   *  bằng 0, và khi đó quy tắc chiết khấu sâu không chạy. */
  it("đọc hỏng dòng hàng thì dừng, không gửi liều", () => {
    expect(DRAFTS).toContain(
      "if (error) throw new Error(`Không đọc được dòng hàng của đơn: ${error.message}`)"
    )
    expect(DRAFTS).toContain("Đơn chưa có mặt hàng nào")
  })

  /** ⚠ Bấm hai lần liên tiếp là hai lần gửi nếu không khoá nút. */
  it("khoá nút trong lúc đang gửi", () => {
    expect(DRAFTS).toContain("if (sendingId || !user?.id || !user.org_id) return")
    expect(DRAFTS).toContain("disabled={sendingId === o.id}")
  })

  /**
   * ⚠ Đơn MỚI rơi về chờ duyệt cũng phải báo. Thiếu bước này thì đơn nằm im
   * tới khi có ai tình cờ mở danh sách ra xem.
   */
  it("đơn mới chờ duyệt cũng báo cho quản lý", () => {
    const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
    expect(CART).toContain('if (out.kind === "created" && out.status === "draft" && !asDraft) {')
    expect(CART).toContain("await notifyApprovers(supabase, {")
  })

  /** "Sửa đơn" mở lại ĐÚNG màn bán hàng đã dùng lúc tạo. */
  it("nút Sửa đơn đưa về màn bán hàng", () => {
    // Danh sách không còn nút Sửa trên từng hàng (mẫu "Đơn của tôi");
    // việc sửa nằm ở màn chi tiết và ở Đơn tạm.
    expect(DRAFTS).toContain('router.push(`/sell/edit/${o.id}`)')
    expect(DETAIL).toContain("router.push(`/sell/edit/${order.id}`)")
    expect(DETAIL).toContain("const sellEdit = canEdit && isSellEditable(order.status)")
  })
})
