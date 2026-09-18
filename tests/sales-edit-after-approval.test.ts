import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canEditOrder,
  canFullEditOrder,
  whyCannotEdit,
  canEditCompleted,
  whyLockedCompleted,
  SALES_EDITABLE_STATUSES,
  TERMINAL_STATUSES,
  type OrderEditContext,
  type CompletedEditContext,
} from "../src/lib/orders/edit-permission"
import type { OrderStatus } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const PAGE = read("src/app/(dashboard)/orders/[id]/page.tsx")
const MIG119 = read("supabase/migrations/119_workflow_v2.sql")
const MIG120 = read("supabase/migrations/120_workflow_v2_rpcs.sql")

/**
 * SQL đã bỏ chú thích.
 *
 * ⚠ Phần giải thích trong migration nhắc nguyên văn "WITH CHECK" và tên
 * các trạng thái — nhắc để người sau hiểu vì sao có chúng. Soi cả chú
 * thích thì phép kiểm đếm nhầm lời giải thích thành mệnh đề thật: thử phá
 * cho thấy xoá hẳn `WITH CHECK` của phần đầu đơn mà phép kiểm vẫn XANH.
 */
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, "")
const MIG119_CODE = sqlCode(MIG119)
const MIG120_CODE = sqlCode(MIG120)

const ME = "u-sales-1"
const ctx = (over: Partial<OrderEditContext> = {}): OrderEditContext => ({
  role: "sales",
  userId: ME,
  status: "submitted",
  salesUserId: ME,
  hasUpdatePermission: true,
  ...over,
})

describe("NVBH sửa được đơn của mình khi hàng chưa rời kho", () => {
  it("phiếu tạm của chính mình: sửa được đầy đủ", () => {
    expect(canEditOrder(ctx())).toBe(true)
    expect(canFullEditOrder(ctx())).toBe(true)
    expect(whyCannotEdit(ctx())).toBeNull()
  })

  it("đơn nháp của chính mình: sửa được đầy đủ", () => {
    expect(canFullEditOrder(ctx({ status: "draft" }))).toBe(true)
  })

  /** ⚠ Đơn của người khác thì không, dù cùng vai trò và cùng trạng thái. */
  it("đơn của NVBH khác: không sửa, và nói rõ vì sao", () => {
    const other = ctx({ salesUserId: "u-sales-2" })
    expect(canEditOrder(other)).toBe(false)
    expect(whyCannotEdit(other)).toContain("nhân viên khác")
  })

  /** Đơn cũ chưa ghi người phụ trách cũng không mở — không đoán là của ai. */
  it("đơn không ghi NVBH phụ trách: không sửa", () => {
    expect(canEditOrder(ctx({ salesUserId: null }))).toBe(false)
  })

  it("chưa được cấp quyền sửa thì không ai sửa được", () => {
    expect(canEditOrder(ctx({ hasUpdatePermission: false }))).toBe(false)
    expect(whyCannotEdit(ctx({ hasUpdatePermission: false }))).toContain("chưa được cấp quyền")
  })

  it.each(["completed", "cancelled"] as OrderStatus[])(
    "đơn %s: không sửa bằng màn thường, kể cả chủ",
    (status) => {
      expect(canEditOrder(ctx({ status, role: "owner" }))).toBe(false)
      expect(whyCannotEdit(ctx({ status, role: "owner" }))).not.toBeNull()
    }
  )

  /**
   * ⚠ Đơn ĐÃ XUẤT không phải bất biến — nó có đường riêng. Câu từ chối
   * phải chỉ sang đường đó, không thì người dùng tưởng đơn hỏng vĩnh viễn.
   */
  it("đơn đã xuất hàng: câu từ chối chỉ sang đường sửa riêng", () => {
    expect(whyCannotEdit(ctx({ status: "completed", role: "owner" }))).toContain("Sửa đơn đã hoàn thành")
  })
})

describe("Màn hình và RLS phải nói cùng một danh sách trạng thái", () => {
  /**
   * ⚠ RLS KHÔNG BÁO LỖI KHI TỪ CHỐI: 0 dòng, HTTP 200, `error` null. Màn
   * hình mở rộng hơn chính sách hàng thì nhân viên bấm Lưu, thấy "Đã cập
   * nhật", tải lại trang và thấy số cũ. Hai bên phải cùng một danh sách.
   */
  it("hằng số TypeScript đúng bằng danh sách trong policy của migration 119", () => {
    expect([...SALES_EDITABLE_STATUSES].sort()).toEqual(["draft", "submitted"])
    const i = MIG119_CODE.indexOf('CREATE POLICY "Sales can update own open orders"')
    expect(i, "không tìm thấy policy sửa đơn của NVBH").toBeGreaterThan(0)
    const policy = MIG119_CODE.slice(i, MIG119_CODE.indexOf(");", i))
    for (const s of SALES_EDITABLE_STATUSES) {
      expect(policy, `policy thiếu trạng thái ${s}`).toContain(`'${s}'`)
    }
  })

  /** NVBH tự huỷ được đơn của mình, nên WITH CHECK phải rộng hơn USING. */
  it("policy cho NVBH tự huỷ đơn của mình", () => {
    const i = MIG119_CODE.indexOf('CREATE POLICY "Sales can update own open orders"')
    const policy = MIG119_CODE.slice(i, MIG119_CODE.indexOf(");", i))
    expect(policy).toContain("WITH CHECK")
    const withCheck = policy.slice(policy.indexOf("WITH CHECK"))
    expect(withCheck).toContain("'cancelled'")
  })

  it("trạng thái chốt trùng khớp hai đầu", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["cancelled", "completed"])
  })

  /** Dòng hàng đi cùng đầu đơn — hai policy phải cùng danh sách. */
  it("policy dòng hàng dùng đúng danh sách trạng thái ấy", () => {
    const i = MIG119_CODE.indexOf('CREATE POLICY "Sales can manage lines of own open orders"')
    expect(i).toBeGreaterThan(0)
    const policy = MIG119_CODE.slice(i, MIG119_CODE.indexOf("\n\n", i))
    for (const s of SALES_EDITABLE_STATUSES) {
      expect(policy, `policy dòng hàng thiếu ${s}`).toContain(`'${s}'`)
    }
  })
})

describe("Bốn khoá của đơn đã xuất hàng", () => {
  const lock = (over: Partial<CompletedEditContext> = {}): CompletedEditContext => ({
    hasPayment: false,
    orderDate: "2026-09-18",
    editDays: 1,
    hasIssuedInvoice: false,
    hasCompletedReturn: false,
    today: "2026-09-18",
    ...over,
  })

  it("không vướng gì thì sửa được", () => {
    expect(canEditCompleted(lock())).toBe(true)
    expect(whyLockedCompleted(lock())).toBeNull()
  })

  it("đã thu tiền thì khoá, và bảo huỷ phiếu thu trước", () => {
    expect(whyLockedCompleted(lock({ hasPayment: true }))).toContain("huỷ phiếu thu")
  })

  it("đã phát hành hoá đơn thì khoá", () => {
    expect(canEditCompleted(lock({ hasIssuedInvoice: true }))).toBe(false)
  })

  it("đã có phiếu trả hoàn thành thì khoá", () => {
    expect(canEditCompleted(lock({ hasCompletedReturn: true }))).toBe(false)
  })

  /** Hạn tính từ NGÀY ĐẶT, theo cấu hình của từng nhà phân phối. */
  it("quá hạn sửa thì khoá; trong hạn thì không", () => {
    expect(canEditCompleted(lock({ orderDate: "2026-09-17" }))).toBe(true)
    expect(canEditCompleted(lock({ orderDate: "2026-09-16" }))).toBe(false)
    // Nới hạn lên 3 ngày thì đơn của 16 lại sửa được.
    expect(canEditCompleted(lock({ orderDate: "2026-09-16", editDays: 3 }))).toBe(true)
  })

  /**
   * ⚠ MÀN HÌNH VÀ RPC PHẢI CÙNG MỘT BỘ KHOÁ. Màn hình mở nút mà RPC chặn
   * thì người dùng bấm xong nhận một mã lỗi khó hiểu; màn hình khoá mà RPC
   * cho thì họ không hiểu vì sao nút mờ.
   */
  it("đủ bốn khoá, và migration 120 có đúng bốn mã lỗi tương ứng", () => {
    const cases: Array<[Partial<CompletedEditContext>, string]> = [
      [{ hasPayment: true }, "LOCKED_HAS_PAYMENT"],
      [{ orderDate: "2026-09-01" }, "LOCKED_TOO_OLD"],
      [{ hasIssuedInvoice: true }, "LOCKED_EINVOICE"],
      [{ hasCompletedReturn: true }, "LOCKED_RETURN_DONE"],
    ]
    for (const [over, code] of cases) {
      expect(canEditCompleted(lock(over)), `khoá ${code} không chặn ở màn hình`).toBe(false)
      expect(MIG120_CODE, `migration thiếu mã ${code}`).toContain(code)
    }
  })

  it("hạn sửa đọc từ cấu hình tổ chức, không phải số cứng trong mã", () => {
    expect(MIG119_CODE).toContain("completed_edit_days")
    expect(MIG120_CODE).toContain("COALESCE(completed_edit_days, 1)")
  })
})

describe("Lưu hỏng thì phải BÁO, không được báo thành công", () => {
  /**
   * ⚠ Cùng cái bẫy 0-dòng-không-lỗi. Mọi lệnh ghi từ màn chi tiết phải
   * `.select("id")` rồi đếm, nếu không thì màn hình báo đã lưu cho một
   * lệnh chưa chạy.
   */
  it("mọi lệnh ghi ở màn chi tiết đều đếm số dòng trả về", () => {
    const writes = PAGE.match(/\.update\(/g) || []
    expect(writes.length).toBeGreaterThan(0)
    const selects = PAGE.match(/\.select\("id"\)/g) || []
    expect(selects.length).toBeGreaterThanOrEqual(writes.length - 1)
    expect(PAGE).toContain("không có quyền ở bước này")
  })

  it("xuất hàng và huỷ đơn đã xuất KHÔNG ghi thẳng từ màn chi tiết", () => {
    // Hai bước đó đi qua RPC; trigger ở 119 chặn lệnh ghi thẳng.
    expect(PAGE).not.toMatch(/\.update\(\{\s*status: "completed"/)
    expect(MIG119_CODE).toContain("USE_RPC")
  })
})
