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
    expect(ORDER).toContain('["draft", "cancelled"].includes(order.status)')
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
  it("màn đơn hàng đếm dòng đã xoá, không chỉ kiểm lỗi", () => {
    const fn = ORDER.slice(ORDER.indexOf("const handleDelete"), ORDER.indexOf("const startLinesEdit"))
    expect(fn).toContain('.select("id")')
    expect(fn).toContain("if (!data || data.length === 0)")
    expect(fn).toContain("Không xoá được đơn này")
  })

  /** Không xoá được thì phải nói VÌ SAO và làm gì tiếp. */
  it("báo lỗi nêu rõ điều kiện và nhắc migration", () => {
    const fn = ORDER.slice(ORDER.indexOf("const handleDelete"), ORDER.indexOf("const startLinesEdit"))
    expect(fn).toContain("chủ NPP hoặc quản lý")
    expect(fn).toContain("migration 113")
  })

  /**
   * KHÔNG nới khoá ngoại. Đơn còn dính công nợ hay phiếu thu thì Postgres
   * chặn — và chặn ở đó là đúng. Lỗi khoá ngoại có nội dung thật, hiện
   * thẳng lên màn hình.
   */
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
