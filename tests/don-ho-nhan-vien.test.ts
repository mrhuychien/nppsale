import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * NPP LẬP ĐƠN GIÚP NHÂN VIÊN.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Thêm phần tạo đơn hàng giúp nhân viên cho
 * NPP. NPP tạo đơn xong chọn nhân viên -> thành đơn hàng của nhân
 * viên".
 *
 * ⚠ CỘT NÀY ĐỤNG TIỀN. `sales_orders.sales_user_id` là thứ hoa hồng,
 * doanh số và bảng lương đếm theo. Mở một ô chọn ra mà không canh là
 * mở đường ghi doanh số của người này sang tên người khác.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const MIG153 = read("supabase/migrations/153_order_sales_user_guard.sql")
const CREATE = code(read("src/lib/orders/create.ts"))
const BUILD = code(read("src/lib/sell/create-order.ts"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))

describe("chỉ NPP mới lập được đơn đứng tên người khác", () => {
  /**
   * ⚠ CHẶN Ở TRIGGER, KHÔNG CHỈ Ở GIAO DIỆN. `sales_orders` ghi TRỰC
   * TIẾP từ trình duyệt và chính sách RLS (mig 002) không hề nhắc tới
   * `sales_user_id` — nó chỉ đòi đúng `org_id` và vai trò thuộc
   * (owner, manager, sales). Ẩn ô chọn đi là chặn được người dùng
   * thường, không chặn được ai gọi thẳng PostgREST.
   */
  it("có trigger canh cột sales_user_id", () => {
    expect(MIG153).toContain("BEFORE INSERT ON sales_orders")
    expect(MIG153).toContain("trg_orders_guard_sales_user")
  })

  it("nhân viên bán hàng không đặt được tên người khác", () => {
    expect(MIG153).toContain("v_role NOT IN ('owner', 'manager')")
    expect(MIG153).toContain("DON_HO_KHONG_DUOC_PHEP")
  })

  /** ⚠ Người được gán phải cùng đơn vị VÀ có vai trò bán hàng. */
  it("chặn gán cho người ngoài đơn vị hoặc không bán hàng", () => {
    expect(MIG153).toContain("u.org_id <> NEW.org_id")
    expect(MIG153).toContain("NHAN_VIEN_KHONG_BAN_HANG")
    expect(MIG153).toContain("u.role NOT IN ('sales', 'manager', 'owner')")
  })

  /** ⚠ Để trống thì là chính mình — giữ nguyên hành vi cũ. */
  it("để trống thì tự gán người đang lập", () => {
    expect(MIG153).toContain("NEW.sales_user_id := v_me")
  })

  /**
   * ⚠ MÀN HÌNH CHỈ HIỆN ĐÚNG BỘ VAI TRÒ TRIGGER CHO PHÉP. Hiện ra một
   * cái tên mà máy chủ sẽ từ chối là bẫy người dùng: họ chọn, bấm lưu,
   * rồi nhận một câu lỗi cho một việc màn hình vừa mời họ làm.
   */
  it("ô chọn chỉ liệt kê vai trò máy chủ chấp nhận", () => {
    expect(CART).toContain('.in("role", ["sales", "manager", "owner"])')
  })

  /** ⚠ Và chỉ chủ nhà / quản lý mới thấy ô ấy. */
  it("nhân viên bán hàng không thấy ô chọn", () => {
    expect(CART).toContain('const canPickSeller = user?.role === "owner" || user?.role === "manager"')
    expect(CART).toContain("{canPickSeller && (")
    expect(CART).toContain("canPickSeller ? sellerId || null : null")
  })
})

describe("lựa chọn nhân viên sống sót qua hàng đợi ngoại tuyến", () => {
  /**
   * ⚠ ĐI TRONG TẢI TRỌNG, KHÔNG ĐI TRONG `ctx`. Đơn lập lúc mất mạng
   * nằm trong hàng đợi rồi mới ghi khi có mạng, và `ctx` lúc ấy dựng
   * lại từ người ĐANG đăng nhập. Để lựa chọn ở `ctx` là NPP chọn nhân
   * viên A, mạng về, đơn ghi tên chính NPP — sai âm thầm, và chỉ lộ ra
   * ở kỳ tính hoa hồng.
   */
  it("mã nhân viên nằm trong tải trọng của đơn", () => {
    expect(CREATE).toContain("sales_user_id?: string | null")
    expect(BUILD).toContain("sales_user_id: i.salesUserId || null")
    expect(CART).toContain("salesUserId: canPickSeller ? sellerId || null : null")
  })

  /** ⚠ Tải trọng THẮNG `ctx`, và rỗng mới rơi về người đang lập. */
  it("tải trọng thắng ctx khi ghi xuống", () => {
    expect(CREATE).toContain("sales_user_id: payload.order.sales_user_id || ctx.userId")
    expect(
      /sales_user_id: ctx\.userId\b/.test(CREATE),
      "vẫn còn chỗ gán cứng ctx.userId — lựa chọn của NPP sẽ bị bỏ qua"
    ).toBe(false)
  })
})
