import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
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

/**
 * SOI BẢN ĐANG CHẠY, KHÔNG SOI TỆP CŨ NHẤT TÌM THẤY.
 *
 * ⚠ ĐÂY LÀ BÀI HỌC CỦA MIG 151, viết thành công cụ. Migration sau ghi
 * đè migration trước; đọc tệp cũ nhất là chốt vẫn xanh trong khi thứ
 * đang chạy trên máy thật đã mất miếng vá từ lâu. Hàm này trả về nội
 * dung của migration SỐ CAO NHẤT có chứa `neo` — đúng bản sẽ nằm lại
 * trong cơ sở dữ liệu sau khi chạy hết.
 */
function migrationMoiNhatCo(neo: string): { ten: string; sql: string } {
  const dir = resolve(ROOT, "supabase/migrations")
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ ten: f, sql: readFileSync(resolve(dir, f), "utf-8") }))
    .filter((m) => m.sql.includes(neo))
  // ⚠ CHỐT MÙ LÀ CHỐT NÓI DỐI. Không tìm thấy gì thì phải ĐỎ, không
  //   được trả một chuỗi rỗng rồi để mọi phép kiểm dưới đi qua.
  expect(found.length, `không migration nào chứa "${neo}" — chốt đang soi vào chỗ trống`)
    .toBeGreaterThan(0)
  return found[found.length - 1]
}

const TRIGGER = migrationMoiNhatCo("CREATE TRIGGER trg_orders_guard_sales_user")
/* ⚠ NEO PHẢI LÀ CÂU ĐỊNH NGHĨA. `FUNCTION public.guard_…()` trần còn
   khớp cả dòng `EXECUTE FUNCTION …` của câu dựng trigger — chốt sẽ
   soi nhầm sang một tệp chỉ GỌI hàm chứ không định nghĩa nó. */
const GUARD = migrationMoiNhatCo(
  "CREATE OR REPLACE FUNCTION public.guard_order_sales_user()"
)
const CREATE = code(read("src/lib/orders/create.ts"))
const BUILD = code(read("src/lib/sell/create-order.ts"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const EDIT = code(read("src/lib/sell/order-edit.ts"))

describe("chỉ NPP mới lập được đơn đứng tên người khác", () => {
  /**
   * ⚠ CHẶN Ở TRIGGER, KHÔNG CHỈ Ở GIAO DIỆN. `sales_orders` ghi TRỰC
   * TIẾP từ trình duyệt và chính sách RLS không hề nhắc tới
   * `sales_user_id` — `"Admin roles can update orders"` (mig 119) chỉ
   * đòi đúng `org_id` và vai trò owner/manager/warehouse. Ẩn ô chọn đi
   * là chặn được người dùng thường, không chặn được ai gọi thẳng
   * PostgREST.
   */
  it("có trigger canh cột sales_user_id", () => {
    expect(TRIGGER.sql).toContain("trg_orders_guard_sales_user")
    expect(TRIGGER.sql).toMatch(/BEFORE INSERT[\s\S]{0,80}ON sales_orders/)
  })

  /**
   * ⚠ CANH CẢ KHI SỬA ĐƠN, KHÔNG CHỈ KHI LẬP ĐƠN. Chủ nhà báo
   * 21/09/2026: "Sửa -> gán nhân viên lưu lại đơn ko hiệu lực". Sửa
   * xong thì đường SỬA cũng ghi cột này — và một tài khoản KHO sửa được
   * đơn (RLS cho phép), nên bỏ trống vế UPDATE là để nguyên cái lỗ mà
   * vế INSERT vừa bịt.
   */
  it("trigger canh cả lúc lập lẫn lúc sửa", () => {
    const dong = TRIGGER.sql
      .split("\n")
      .find((l) => /BEFORE\s+INSERT/i.test(l) && /sales_orders|OR\s+UPDATE/i.test(l))
    expect(dong, "không thấy câu dựng trigger").toBeTruthy()
    expect(
      /\bUPDATE\b/i.test(dong as string),
      `trigger chỉ chạy lúc INSERT (${TRIGGER.ten}) — sửa đơn vẫn đổi được người đứng tên mà không ai canh`
    ).toBe(true)
  })

  it("nhân viên bán hàng không đặt được tên người khác", () => {
    expect(GUARD.sql).toContain("v_role NOT IN ('owner', 'manager')")
    expect(GUARD.sql).toContain("DON_HO_KHONG_DUOC_PHEP")
  })

  /** ⚠ Người được gán phải cùng đơn vị VÀ có vai trò bán hàng. */
  it("chặn gán cho người ngoài đơn vị hoặc không bán hàng", () => {
    expect(GUARD.sql).toContain("u.org_id <> NEW.org_id")
    expect(GUARD.sql).toContain("NHAN_VIEN_KHONG_BAN_HANG")
    expect(GUARD.sql).toContain("u.role NOT IN ('sales', 'manager', 'owner')")
  })

  /** ⚠ Lập đơn mà để trống thì là chính mình — giữ nguyên hành vi cũ. */
  it("lập đơn để trống thì tự gán người đang lập", () => {
    expect(GUARD.sql).toContain("NEW.sales_user_id := v_me")
  })

  /**
   * ⚠ SỬA ĐƠN MÀ ĐỂ TRỐNG THÌ GIỮ NGUYÊN NGƯỜI CŨ, ngược hẳn lúc lập.
   * Gán người đang sửa là NPP mở đơn của nhân viên ra, bấm Lưu, đơn
   * nhảy sang tên NPP — đúng cái chủ nhà vừa báo, chỉ ngược chiều. Và
   * để `NULL` thì đơn thành một dòng doanh số không ai nhận.
   */
  it("sửa đơn để trống thì giữ nguyên người cũ", () => {
    expect(
      GUARD.sql.includes("NEW.sales_user_id := OLD.sales_user_id"),
      `${GUARD.ten} thiếu vế giữ nguyên người cũ khi sửa`
    ).toBe(true)
  })

  /**
   * ⚠ KHÔNG ĐỔI NGƯỜI THÌ KHÔNG CANH. Một đơn cũ có thể đang đứng tên
   * người nay đã chuyển sang làm kho hoặc đã nghỉ; bắt mọi lần sửa đơn
   * ấy qua phép kiểm vai trò là KHOÁ CỨNG một đơn hợp lệ vì lý do
   * không liên quan gì tới lần sửa này.
   */
  it("sửa mà không đổi người đứng tên thì đi thẳng", () => {
    expect(GUARD.sql).toMatch(/IS NOT DISTINCT FROM OLD\.sales_user_id/)
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
  })
})

describe("gán nhân viên khi SỬA đơn", () => {
  /**
   * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sửa -> gán nhân viên lưu lại đơn ko hiệu
   * lực, đơn vẫn đứng tên NPP". Ô chọn có, nhưng giá trị của nó chỉ đi
   * vào tải trọng dùng lúc TẠO đơn; đường sửa không hề gửi xuống.
   */
  it("màn giỏ gửi lựa chọn xuống cả đường sửa đơn", () => {
    const i = CART.indexOf("applyOrderEdit(supabase, {")
    expect(i, "không thấy chỗ gọi applyOrderEdit").toBeGreaterThan(-1)
    const goi = CART.slice(i, CART.indexOf("})", i))
    expect(
      /salesUserId\s*:/.test(goi),
      "đường sửa đơn không gửi người đứng tên — chọn xong lưu lại vẫn đứng tên cũ"
    ).toBe(true)
  })

  /**
   * ⚠ Ô CHỌN PHẢI SẴN TÊN NGƯỜI ĐANG ĐỨNG ĐƠN KHI MỞ RA SỬA. Ô rỗng có
   * nghĩa "đơn đứng tên bạn"; để rỗng khi đang sửa đơn của nhân viên là
   * chỉ cần bấm Lưu một cái, đơn nhảy sang tên NPP — mà người sửa không
   * hề chọn gì nên cũng không có lý do nào để nghi ngờ.
   */
  it("mở đơn ra sửa thì ô chọn sẵn người đang đứng đơn", () => {
    expect(
      /setSellerId\([^)]*editing\??\.\s*salesUserId/.test(CART),
      "ô chọn không nạp người đang đứng đơn — bấm Lưu là đơn đổi chủ"
    ).toBe(true)
  })

  /**
   * ⚠ RỖNG LÀ "KHÔNG ĐỤNG TỚI", KHÔNG PHẢI "XOÁ TÊN NGƯỜI PHỤ TRÁCH".
   * NVBH sửa đơn của chính mình thì không có ô chọn nên giá trị truyền
   * xuống là rỗng; ghi rỗng ấy vào cột là dựng ra một dòng doanh số
   * không ai nhận. Luật nằm ở `applyOrderEdit` và có chốt chạy thật
   * trong `sell-order-edit.test.ts`; đây chỉ canh cho nó đừng biến mất.
   */
  it("chỉ ghi cột khi thật sự có người", () => {
    expect(
      /typeof opts\.salesUserId === "string" && opts\.salesUserId/.test(EDIT),
      "mất phép kiểm rỗng — sửa đơn sẽ xoá tên người phụ trách"
    ).toBe(true)
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
    const i = CART.indexOf("buildOrderPayload({")
    expect(i, "không thấy chỗ dựng tải trọng").toBeGreaterThan(-1)
    expect(
      /salesUserId\s*:/.test(CART.slice(i, CART.indexOf("})", i))),
      "tải trọng không mang lựa chọn nhân viên"
    ).toBe(true)
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
