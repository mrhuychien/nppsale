import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { canDeleteOrder, deleteOrder, DELETE_REFUSED_MSG } from "../src/lib/orders/delete"
import { errorMessage } from "../src/lib/errors"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const sql = (s: string) => s.replace(/^\s*--.*$/gm, "")

const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const EDIT = code(read("src/app/(dashboard)/sell/edit/[id]/page.tsx"))
const HOOK = code(read("src/hooks/use-sell-cart.tsx"))
const MIG118 = sql(read("supabase/migrations/118_delete_order_cleans_returns.sql"))

const owner = { id: "u-owner", role: "owner" }
const manager = { id: "u-mgr", role: "manager" }
const sales = { id: "u-sales", role: "sales" }

/**
 * ⚠ HAI LỖI NGƯỜI DÙNG BÁO CÙNG LÚC:
 *   1. Chủ NPP xoá đơn huỷ → "violates foreign key constraint
 *      returns_order_id_fkey" (23503).
 *   2. "NV bán hàng chưa xoá được đơn nháp. Phải có nút xoá trong màn sửa
 *      đơn chứ?"
 * Gốc chung: ba màn, ba phép gài, ba phép xoá — và không phép nào chép
 * đúng chính sách dưới database.
 */
describe("Ai xoá được đơn nào — chép đúng mig 113 + 117", () => {
  it("chủ / quản lý: nháp hoặc đã huỷ, khi bảng phân quyền còn cho", () => {
    for (const u of [owner, manager]) {
      expect(canDeleteOrder(u, { status: "draft" }, true)).toBe(true)
      expect(canDeleteOrder(u, { status: "cancelled" }, true)).toBe(true)
      expect(canDeleteOrder(u, { status: "confirmed" }, true)).toBe(false)
      expect(canDeleteOrder(u, { status: "delivered" }, true)).toBe(false)
      // Đơn vị thu hồi orders.delete của vai trò đó thì nút phải biến.
      expect(canDeleteOrder(u, { status: "draft" }, false)).toBe(false)
    }
  })

  /**
   * ⚠ NVBH xoá được nháp CỦA MÌNH dù bảng phân quyền không cấp
   * orders.delete — vì mig 117 cho họ, và bảng phân quyền chưa bao giờ
   * cấp quyền đó cho vai trò sales. Gài theo bảng là nút không bao giờ
   * hiện, đúng lỗi người dùng báo.
   */
  it("NVBH: chỉ nháp của chính mình, không cần bảng phân quyền", () => {
    expect(canDeleteOrder(sales, { status: "draft", sales_user_id: "u-sales" }, false)).toBe(true)
    expect(canDeleteOrder(sales, { status: "draft", sales_user_id: "u-other" }, true)).toBe(false)
    expect(canDeleteOrder(sales, { status: "cancelled", sales_user_id: "u-sales" }, true)).toBe(false)
    expect(canDeleteOrder(sales, { status: "confirmed", sales_user_id: "u-sales" }, true)).toBe(false)
    // Không biết đơn của ai thì KHÔNG đoán là của mình.
    expect(canDeleteOrder(sales, { status: "draft" }, true)).toBe(false)
    expect(canDeleteOrder(sales, { status: "draft", sales_user_id: null }, true)).toBe(false)
  })

  it("vai trò khác và chưa đăng nhập: không", () => {
    expect(canDeleteOrder({ id: "w", role: "warehouse" }, { status: "draft" }, true)).toBe(false)
    expect(canDeleteOrder(null, { status: "draft" }, true)).toBe(false)
  })
})

describe("Phép xoá dùng chung đếm dòng, không tin `error === null`", () => {
  const client = (data: unknown, error: { message: string } | null = null) => ({
    from: () => ({
      delete: () => ({ eq: () => ({ select: async () => ({ data, error }) }) }),
    }),
  })

  /** ⚠ RLS từ chối = 0 dòng + 200 + không lỗi. Đã dính hai lần. */
  it("0 dòng thì ném lỗi có lời giải thích", async () => {
    await expect(deleteOrder(client([]), "o1")).rejects.toThrow(DELETE_REFUSED_MSG)
    await expect(deleteOrder(client(null), "o1")).rejects.toThrow(DELETE_REFUSED_MSG)
  })

  it("có lỗi thì ném NGUYÊN lỗi — để câu khoá ngoại / trigger hiện đúng", async () => {
    const err = { message: "boom", code: "P0001" }
    await expect(deleteOrder(client(null, err), "o1")).rejects.toBe(err)
  })

  it("xoá được 1 dòng thì xong", async () => {
    await expect(deleteOrder(client([{ id: "o1" }]), "o1")).resolves.toBeUndefined()
  })
})

describe("Câu lỗi khoá ngoại nói ĐÚNG CHIỀU", () => {
  /**
   * ⚠ Bản đầu dịch 23503 thành "Dữ liệu liên kết không còn tồn tại" cho
   * MỌI trường hợp. Xoá đơn đang bị phiếu trả trỏ vào thì sự thật ngược
   * lại: dữ liệu liên kết CÒN ĐÓ mới là vấn đề. Chủ NPP đọc câu đó rồi
   * không biết phải làm gì.
   */
  it("xoá bị bảng khác trỏ vào → nói bảng nào đang giữ, bằng tên người dùng", () => {
    const msg = errorMessage({
      code: "23503",
      message:
        'update or delete on table "sales_orders" violates foreign key constraint "returns_order_id_fkey" on table "returns"',
      details: 'Key (id)=(abc) is still referenced from table "returns".',
    })
    expect(msg).toContain("đang được phiếu trả hàng tham chiếu")
    expect(msg).not.toContain("không còn tồn tại")
    // Nguyên văn vẫn đi kèm để người hỗ trợ lần được.
    expect(msg).toContain("returns_order_id_fkey")
    expect(msg).toContain("(mã 23503)")
  })

  it("ghi trỏ vào bản ghi không có → vẫn là 'không còn tồn tại'", () => {
    const msg = errorMessage({
      code: "23503",
      message: 'insert or update on table "sales_orders" violates foreign key constraint "sales_orders_customer_id_fkey"',
      details: 'Key (customer_id)=(x) is not present in table "customers".',
    })
    expect(msg).toContain("không còn tồn tại (khách hàng)")
  })

  /** Trigger mig 118 chặn bằng câu tiếng người — câu đó phải hiện NGUYÊN. */
  it("lỗi RAISE từ trigger hiện nguyên câu", () => {
    const msg = errorMessage({
      code: "P0001",
      message: "Đơn DH-1 có 1 phiếu trả hàng ĐÃ HOÀN THÀNH (đã trừ công nợ / nhập lại kho) nên không xoá được. Huỷ phiếu trả đó trước, hoặc giữ đơn.",
    })
    expect(msg).toContain("phiếu trả hàng ĐÃ HOÀN THÀNH")
    expect(msg).toContain("(mã P0001)")
  })
})

describe("Migration 118: phiếu trả chưa hoàn thành đi theo đơn, phiếu đã hoàn thành chặn rõ lời", () => {
  it("trigger BEFORE DELETE trên sales_orders, SECURITY DEFINER", () => {
    expect(MIG118).toContain("BEFORE DELETE ON sales_orders")
    expect(MIG118).toContain("SECURITY DEFINER")
    expect(MIG118).toContain("SET search_path = public")
    expect(MIG118).toContain("REVOKE ALL ON FUNCTION public.trg_sales_orders_before_delete() FROM PUBLIC")
  })

  /**
   * ⚠ CHỈ PHIẾU 'completed' MỚI CHẶN — nó là phiếu duy nhất đã đụng tồn
   * kho và công nợ. Ba trạng thái kia chưa ghi gì (hoặc đã được đảo lại
   * ở `cancel_return`) nên dọn đi cùng đơn được.
   *
   * ⚠ BỘ LỌC PHẢI HỎI GIÁ TRỊ CÒN TỒN TẠI. Bản cũ hỏi
   * 'pending'/'rejected'/'approved' — ba giá trị `chk_returns_status_v2`
   * (mig 119) đã cấm và backfill đổi đi. Hỏng ÂM THẦM cả hai đầu: phiếu
   * 'submitted' hết chặn xoá đơn, còn nhánh dọn khớp 0 dòng nên khoá
   * ngoại 23503 chặn xoá đơn kèm một câu tiếng Anh — đúng thứ migration
   * này sinh ra để sửa.
   */
  it("chỉ xoá phiếu trả chưa hoàn thành; phiếu đã hoàn thành thì RAISE", () => {
    expect(MIG118).toContain(
      "WHERE order_id = OLD.id AND status IN ('draft', 'submitted', 'cancelled')"
    )
    expect(MIG118).toContain("WHERE order_id = OLD.id AND status = 'completed'")
    expect(MIG118).toContain("RAISE EXCEPTION")
    expect(MIG118).toContain("ĐÃ HOÀN THÀNH")
    // Và không còn hỏi giá trị nào đã bị migration 119 cấm.
    for (const dead of ["'approved'", "'pending'", "'rejected'"]) {
      expect(MIG118, `còn lọc theo trạng thái đã bị bỏ ${dead}`).not.toContain(dead)
    }
    // Không nới khoá ngoại: công nợ, hoá đơn, phiếu thu vẫn chặn.
    expect(MIG118).not.toMatch(/ON DELETE (CASCADE|SET NULL)/i)
    expect(MIG118).not.toMatch(/DROP CONSTRAINT/i)
  })

  it("nhật ký viếng thăm giữ lại, chỉ gỡ liên kết", () => {
    expect(MIG118).toContain("UPDATE visit_logs SET order_id = NULL WHERE order_id = OLD.id")
  })
})

describe("Nút xoá nháp trong màn sửa đơn", () => {
  it("giỏ hàng có nút, gài qua canDeleteOrder, xoá qua deleteOrder", () => {
    expect(CART).toContain("Xoá nháp")
    expect(CART).toContain('editing.status === "draft"')
    expect(CART).toContain("canDeleteOrder(")
    expect(CART).toContain("await deleteOrder(createClient(), editing.orderId)")
  })

  /** ⚠ Xoá xong phải BUÔNG giỏ — còn mã đơn là cú Lưu sau ghi đè lên đơn đã mất. */
  it("xoá xong thì xoá giỏ và rời màn", () => {
    const i = CART.indexOf("const deleteDraft = async () => {")
    const fn = CART.slice(i, CART.indexOf("\n  }", i))
    expect(fn).toContain("cart.clear()")
    expect(fn).toContain('router.replace("/sell")')
  })

  it("xoá là thao tác huỷ hoại nên có hộp xác nhận", () => {
    expect(CART).toContain("<ConfirmDialog")
    expect(CART).toContain('variant="destructive"')
    expect(CART).toContain('confirmLabel="Xoá đơn nháp"')
  })

  /**
   * Muốn biết nháp "của mình" thì giỏ phải mang theo NVBH phụ trách; màn
   * mở đơn ra sửa phải đưa vào, và bản lưu localStorage đọc lại có kiểm.
   */
  it("giỏ mang theo salesUserId của đơn đang sửa", () => {
    expect(EDIT).toContain("salesUserId: head.sales_user_id ?? null,")
    expect(HOOK).toContain('salesUserId: typeof e.salesUserId === "string" ? e.salesUserId : null,')
  })
})
