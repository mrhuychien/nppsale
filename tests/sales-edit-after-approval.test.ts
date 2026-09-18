import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  canEditOrder,
  canFullEditOrder,
  whyCannotEdit,
  SALES_EDITABLE_STATUSES,
  TERMINAL_STATUSES,
  type OrderEditContext,
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
   *
   * ⚠ ĐƯỜNG ẤY ĐỔI Ở V2B. Trước là nút "Sửa đơn đã hoàn thành"; nay cơ
   * chế đó bị gỡ hẳn và cách chữa là huỷ hóa đơn rồi lập lại. Chốt này
   * canh đúng một điều: câu từ chối phải chỉ tới một thứ CÒN TỒN TẠI.
   */
  it.each(["completed", "partially_invoiced"] as const)(
    "đơn đã xuất hàng (%s): câu từ chối chỉ sang huỷ hóa đơn",
    (status) => {
      const msg = whyCannotEdit(ctx({ status, role: "owner" }))
      expect(msg).toContain("huỷ hóa đơn")
      expect(msg, "còn chỉ tới nút đã bị gỡ").not.toContain("Sửa đơn đã hoàn thành")
    }
  )

  it("đơn đã đóng: nói rõ phải huỷ hóa đơn mới mở lại được", () => {
    expect(whyCannotEdit(ctx({ status: "closed", role: "owner" }))).toContain("huỷ hóa đơn")
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

  /**
   * ⚠ BA TRẠNG THÁI ĐÃ XUẤT HÀNG PHẢI ĐỀU CÓ MẶT. Trigger
   * `guard_order_lines_locked` (mig 124) ném `ORDER_LOCKED` cho
   * `partially_invoiced`, `completed` và `closed`. Sót một cái là màn
   * hình mở nút Sửa rồi cơ sở dữ liệu từ chối — người dùng gõ xong mới
   * nhận lỗi, và không hiểu vì sao nút lại mở.
   */
  it("trạng thái chốt trùng khớp hai đầu", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual([
      "cancelled", "closed", "completed", "partially_invoiced",
    ])
    const MIG124 = readFileSync(
      resolve(__dirname, "../supabase/migrations/124_wf2b_sales_invoices.sql"),
      "utf-8"
    )
    const i = MIG124.indexOf("FUNCTION public.guard_order_lines_locked(")
    expect(i, "không tìm thấy trigger khoá dòng đơn").toBeGreaterThan(0)
    const body = MIG124.slice(i, MIG124.indexOf("\n$$;", i))
    for (const st of TERMINAL_STATUSES) {
      if (st === "cancelled") continue // đơn huỷ khoá bằng RLS, không bằng trigger này
      expect(body, `trigger thiếu trạng thái ${st}`).toContain(`'${st}'`)
    }
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

/**
 * ⚠ KHỐI "BỐN KHOÁ CỦA ĐƠN ĐÃ XUẤT HÀNG" ĐÃ ĐƯỢC GỠ CÙNG MÃ CỦA NÓ.
 *
 * Nó kiểm `canEditCompleted` / `whyLockedCompleted` — bốn khoá của cơ
 * chế "sửa đơn đã hoàn thành", soi theo `_wf2_assert_order_unlocked` mà
 * migration 124 đã DROP. Giữ lại là để một bộ chốt XANH mô tả một cơ chế
 * không còn tồn tại; đó đúng là kiểu chốt nói dối mà cả hai pack đang
 * chống — nó không sai một phép tính nào, nó chỉ nói về quá khứ bằng thì
 * hiện tại.
 *
 * Khoá tương đương của v2b bám vào HÓA ĐƠN và nằm trong `cancel_invoice`;
 * chốt của chúng ở `tests/wf2b-rpcs.test.ts` (mã lỗi) và
 * `tests/wf2b-sales-invoices.test.ts` (giao diện mờ nút).
 */
describe("Cơ chế sửa đơn đã hoàn thành đã bị gỡ", () => {
  const LIB = read("src/lib/orders/edit-permission.ts")

  it.each(["canEditCompleted", "whyLockedCompleted", "CompletedEditContext"])(
    "%s không còn được export",
    (name) => {
      expect(LIB).not.toContain(`export function ${name}`)
      expect(LIB).not.toContain(`export interface ${name}`)
    }
  )

  /**
   * ⚠ CHỐT NGƯỢC CÓ Ý NGHĨA: nếu ai đó dựng lại một hàm cùng nghĩa dưới
   * tên khác, `completed_edit_days` sẽ xuất hiện trở lại trong mã — đó là
   * cột duy nhất cơ chế cũ đọc.
   */
  it("không mã TypeScript nào còn đọc completed_edit_days", () => {
    // ⚠ ĐỌC BẢN ĐÃ LƯỢC CHÚ THÍCH. Chính lời giải thích "cột này ngưng
    //   dùng" có nhắc tên cột; đọc tệp thô là chốt đỏ vì đúng câu nói nó
    //   đã biến mất.
    const strip = (x: string) => x.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")
    for (const rel of [
      "src/lib/orders/edit-permission.ts",
      "src/app/(dashboard)/orders/[id]/page.tsx",
    ]) {
      expect(strip(read(rel)), `${rel} còn đọc completed_edit_days`).not.toContain(
        "completed_edit_days"
      )
    }
  })

  /** Migration 124 đã gỡ hàm SQL mà cơ chế ấy soi theo. */
  it("migration 124 DROP _wf2_assert_order_unlocked", () => {
    const MIG124 = read("supabase/migrations/124_wf2b_sales_invoices.sql")
    expect(MIG124).toContain(
      "DROP FUNCTION IF EXISTS public._wf2_assert_order_unlocked(uuid, date, boolean);"
    )
  })
})
