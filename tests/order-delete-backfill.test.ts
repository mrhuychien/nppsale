import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) => s.replace(/^\s*--.*$/gm, "")

const ORDER = read("src/app/(dashboard)/orders/[id]/page.tsx")
const MIG113 = read("supabase/migrations/113_delete_cancelled_orders.sql")
const MIG112 = read("supabase/migrations/112_backfill_customer_creator.sql")
const IMPORT = read("src/components/customers/customer-import-dialog.tsx")

/**
 * Hành vi thật đã dựng lại và đo trên PostgreSQL 16:
 *
 *   TRƯỚC mig 113 — chủ NPP xoá đơn ĐÃ HUỶ → xoá được 0 dòng, KHÔNG lỗi
 *   SAU  mig 113 — đơn đã huỷ, chủ NPP     → xoá 1 dòng
 *                  đơn đã giao, chủ NPP    → 0 dòng
 *                  đơn đã huỷ, vai trò sales → 0 dòng
 *                  đơn đã huỷ CÒN CÔNG NỢ  → lỗi khoá ngoại, đơn còn nguyên
 */
describe("Xoá đơn hàng đã huỷ", () => {
  /**
   * ⚠ NGUYÊN NHÂN GỐC. `sales_orders` bật RLS nhưng không có policy
   * DELETE nào trong suốt 112 migration. RLS bật mà thiếu policy cho một
   * thao tác thì thao tác đó khớp KHÔNG dòng nào — PostgREST trả 200,
   * mảng rỗng, KHÔNG lỗi.
   */
  it("có policy DELETE cho sales_orders", () => {
    expect(strip(MIG113)).toContain("ON sales_orders FOR DELETE")
  })

  /**
   * ⚠ Phạm vi phải hẹp. Đơn đã giao gắn với công nợ, phiếu xuất kho, hoá
   * đơn điện tử — xoá là thủng sổ. Khớp đúng điều kiện nút trên màn hình
   * vẫn đang gài (`["draft","cancelled"].includes(order.status)`).
   */
  it("chỉ xoá được đơn nháp hoặc đã huỷ", () => {
    expect(strip(MIG113)).toContain("status IN ('draft', 'cancelled')")
    // Phép gài nay là MỘT hàm cho ba màn, chép đúng chính sách DB —
    // xem tests/order-delete.test.ts cho bảng chân trị.
    expect(ORDER).toContain('canDeleteOrder(user, order, hasPermission(user.role, "orders", "delete"))')
  })

  it("chỉ chủ NPP và quản lý", () => {
    expect(strip(MIG113)).toContain("public.user_role() IN ('owner', 'manager')")
    expect(strip(MIG113)).toContain("org_id = public.user_org_id()")
  })

  /**
   * ⚠ ĐÂY MỚI LÀ LỖI LÀM NGƯỜI DÙNG MẤT LÒNG TIN. Không phải "xoá rồi báo
   * lỗi", mà "không xoá gì và báo ĐÃ XOÁ" — rồi quay về danh sách thấy
   * đơn vẫn nằm đó. Chỉ kiểm `error` là không đủ: RLS chặn thì không có
   * lỗi nào cả. Phải đếm dòng thật sự bị xoá.
   */
  /**
   * ⚠ Phép xoá nay nằm ở MỘT chỗ (`deleteOrder`) cho ba màn; màn đơn hàng
   * chỉ gọi nó. Phép đếm dòng đã xoá và câu báo lỗi được chốt ở
   * tests/order-delete.test.ts.
   */
  it("màn đơn hàng xoá qua hàm dùng chung, không tự viết lại", () => {
    const i = ORDER.indexOf("const handleDelete = async () => {")
    const fn = ORDER.slice(i, ORDER.indexOf("\n  }", i))
    expect(fn).toContain("await deleteOrder(supabase, order.id)")
    expect(fn, "tự viết lại phép xoá là mất chốt đếm dòng").not.toContain('.from("sales_orders")')
  })

  it("không đụng tới khoá ngoại", () => {
    expect(strip(MIG113)).not.toMatch(/ON DELETE CASCADE/i)
    expect(strip(MIG113)).not.toMatch(/DROP CONSTRAINT/i)
  })
})

describe("Bù người tạo cho điểm bán cũ", () => {
  /**
   * ⚠ Màn nhập KH hàng loạt KHÔNG đóng dấu `created_by` — mà đó lại là
   * đường vào của phần lớn dữ liệu, nên gần như mọi điểm bán nhập từ
   * Excel đều "không rõ ai tạo". Cột có từ mig 032; chỉ là chỗ này quên
   * điền.
   */
  it("nhập hàng loạt đóng dấu người tạo", () => {
    expect(IMPORT).toContain("created_by: user.id")
  })

  /** Chiều 1: có người phụ trách → suy ra người tạo. */
  it("bù người tạo từ người phụ trách đầu tiên", () => {
    expect(strip(MIG112)).toContain("SET created_by = fa.user_id")
    expect(strip(MIG112)).toContain("DISTINCT ON (customer_id)")
  })

  /**
   * ⚠ Chỉ điền vào ô đang TRỐNG. Đè lên `created_by` đang có giá trị là
   * xoá một sự thật để thay bằng một phép suy đoán.
   */
  it("không đè lên người tạo đã có", () => {
    expect(strip(MIG112)).toContain("AND c.created_by IS NULL")
  })

  /**
   * Chiều 2: người tạo là NVBH → phân công cho họ. CHỈ `sales`, đúng như
   * quy tắc ở màn tạo mới — chủ NPP nhập liệu hành chính không phải người
   * đi tuyến.
   */
  it("chỉ phân công khi người tạo là NVBH", () => {
    expect(strip(MIG112)).toContain("u.role = 'sales'")
    expect(read("src/lib/customers/assign-creator.ts")).toContain('return role === "sales"')
  })

  /** ⚠ Chen thêm người vào điểm bán đã có chủ là đổi phân công không ai yêu cầu. */
  it("chỉ phân công điểm bán CHƯA có ai phụ trách", () => {
    expect(strip(MIG112)).toContain("NOT EXISTS (")
    expect(strip(MIG112)).toContain("a.customer_id = c.id AND a.status = 'active'")
  })

  /**
   * ⚠ Điểm bán vừa không có người tạo vừa không có ai phụ trách thì KHÔNG
   * còn dấu vết nào để lần ra. Gán bừa cho chủ NPP là dựng ra một sự thật
   * chưa từng có — phải đếm và nói ra thay vì đoán.
   */
  it("đếm và nói ra phần KHÔNG bù được, không đoán", () => {
    expect(MIG112).toContain("CÒN % điểm bán chưa có ai phụ trách")
    expect(MIG112).toContain("CÒN % điểm bán không rõ ai tạo")
  })

  /** Ràng buộc trùng đã có; không được để một dòng cũ làm đổ cả lệnh. */
  it("chịu được dòng phân công cũ trùng khoá", () => {
    expect(strip(MIG112)).toContain("ON CONFLICT (customer_id, user_id) DO NOTHING")
  })
})

describe("Trigger nhật ký không được làm đổ lệnh xoá đơn", () => {
  const MIG114 = read("supabase/migrations/114_fix_activity_log_on_order_delete.sql")
  const CODE114 = strip(MIG114)

  /**
   * ⚠ Đã dựng lại trên PostgreSQL 16 và gặp ĐÚNG lỗi người dùng báo:
   *   null value in column "org_id" of relation "order_activity_log"
   *
   * Xoá `sales_orders` → `sales_order_lines` cascade xoá → trigger chạy
   * cho từng dòng → nó `SELECT org_id FROM sales_orders WHERE id =
   * OLD.order_id`, nhưng đơn CHA đã biến mất trong cùng câu lệnh. `v_org`
   * NULL, và INSERT ngay sau đổ vì cột NOT NULL.
   *
   * Trước mig 113 không ai gặp: RLS chặn từ vòng ngoài nên lệnh xoá chưa
   * bao giờ chạm tới trigger. Sửa lỗi thứ nhất thì lỗi thứ hai lộ ra.
   */
  it("đơn cha không còn thì thôi ghi, cả nhánh DELETE lẫn INSERT/UPDATE", () => {
    expect((CODE114.match(/IF v_org IS NULL THEN/g) ?? []).length).toBe(2)
    expect(CODE114).toContain("RETURN OLD;")
    expect(CODE114).toContain("RETURN NEW;")
  })

  /**
   * Không phải vá cho qua chuyện: `order_activity_log.order_id` có khoá
   * ngoại ON DELETE CASCADE, nên dòng nhật ký vừa ghi cũng bị xoá ngay
   * trong cùng câu lệnh. Ghi để rồi xoá là việc vô nghĩa — mà lại đang
   * làm hỏng cả thao tác xoá.
   */
  it("giữ nguyên khoá ngoại cascade, không nới NOT NULL", () => {
    expect(CODE114).not.toMatch(/ALTER\s+TABLE\s+order_activity_log/i)
    expect(CODE114).not.toMatch(/DROP\s+NOT\s+NULL/i)
  })

  /**
   * ⚠ Chép lại cả một hàm thì dễ đánh rơi một nhánh. Đối chiếu với mig
   * 052 cho thấy đúng MỘT khác biệt ngoài hai chốt NULL — và nó phải được
   * nói ra trong phần chú thích, không lẫn vào bản vá.
   */
  it("thay đổi hành vi thêm vào được ghi rõ trong migration", () => {
    expect(CODE114).toContain("'line_discount', CASE WHEN NEW.line_discount IS DISTINCT FROM OLD.line_discount")
    expect(MIG114).toContain("SỬA THÊM MỘT CHỖ, NÓI RÕ RA ĐÂY")
  })

  /** Nhánh UPDATE vẫn phải bỏ qua khi không có gì đổi. */
  it("giữ phép bỏ qua khi không có gì thay đổi", () => {
    expect(CODE114).toContain("NEW.line_total IS NOT DISTINCT FROM OLD.line_total THEN")
  })
})

describe("Nhóm hàng(3 Cấp) là nhà cung cấp", () => {
  const PARSE = read("src/lib/products/import-parse.ts")
  const DLG = read("src/components/products/product-import-dialog.tsx")

  /**
   * ⚠ Đo trên file thật của NPP: cột "Nhóm hàng(3 Cấp)" chứa TÊN CÔNG TY
   * ("Cty Tân Việt", "Cty lào cái"), không phải nhóm hàng. 56/57 dòng bị
   * bỏ vì thiếu NCC đều có sẵn giá trị ở đó.
   */
  it("Nhóm hàng map sang nhà cung cấp, không còn là danh mục", () => {
    expect(PARSE).toContain('"nhom hang": "supplier_group"')
    expect(PARSE).not.toContain('"nhom hang": "category"')
  })

  /**
   * ⚠ Ưu tiên theo NGUỒN, không theo vị trí cột. Trước đây hai tiêu đề
   * cùng map vào một trường thì cột nào đứng trước trong file sẽ thắng —
   * đổi thứ tự cột là đổi luôn dữ liệu, không gì báo ra.
   *
   * Đo trên 679 dòng có cả hai mà khác nhau: "Nhóm hàng" là tên sạch hơn
   * ("Cty phương huyền" thay vì "Cty phương huyền ăn vặt").
   */
  it("ba tầng ưu tiên: NCC → Nhóm hàng → Thương hiệu", () => {
    expect(PARSE).toContain('"nha cung cap": "supplier_name"')
    expect(PARSE).toContain('"thuong hieu": "supplier_brand"')
    const resolve = PARSE.slice(PARSE.indexOf("const supplier_name ="))
    expect(resolve.slice(0, 220)).toContain('get(raw, "supplier_name")')
    expect(resolve.slice(0, 220)).toContain('get(raw, "supplier_group")')
    expect(resolve.slice(0, 220)).toContain('get(raw, "supplier_brand")')
  })

  /**
   * ⚠ ĐÃ MẮC ĐÚNG LỖI NÀY MỘT LẦN. Phần ghi ra dòng đọc THẲNG cột
   * `supplier_name` trong khi phép kiểm ở trên dùng biến đã giải ba tầng.
   * Hai bên đọc khác nhau → đo trên file thật ra 0 nhà cung cấp.
   */
  it("dòng xuất ra dùng BIẾN đã giải, không đọc lại cột", () => {
    expect(PARSE).not.toContain('supplier_name: str(get(raw, "supplier_name")) || null')
  })

  /**
   * ⚠ `.select("sku")` trần: Supabase chặn 1.000 dòng và trả 200 KHÔNG
   * kèm lỗi. Với 1.740 sản phẩm thì ~740 mã không lọt vào danh sách "đã
   * có", nên nhập lại file cũ là TẠO TRÙNG chứ không bỏ qua.
   */
  it("đối chiếu mã trùng đọc ĐỦ danh mục, có phân trang", () => {
    expect(DLG).toContain("fetchAllForAggregate<{ sku: string }>")
    expect(DLG).not.toContain('supabase.from("products").select("sku").eq("org_id", user.org_id)')
  })

  /**
   * ⚠ Đọc thiếu danh sách này thì KHÔNG được nhập tiếp. Bỏ qua lỗi là đẩy
   * vào cơ sở dữ liệu một mớ sản phẩm trùng mã, mà gỡ ra phải dò tay.
   */
  it("đọc hỏng hoặc chạm trần thì DỪNG, không nhập một phần", () => {
    expect(DLG).toContain("vì nhập tiếp sẽ tạo ra sản phẩm trùng mã")
    expect(DLG).toContain("skuRes.truncated")
  })
})
