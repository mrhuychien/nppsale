import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Ghim lại nhóm lỗi mobile trong sổ bàn giao (MOB-08 → MOB-14).
 *
 * Đây là test đọc mã nguồn, không chạy giao diện — dự án chưa có hạ tầng
 * test component. Chúng chỉ chặn được việc lỗi cũ QUAY LẠI, không thay
 * được việc mở điện thoại thật ra nhìn.
 */

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8")
}

const ORDER_FORM = read("src/components/orders/order-form.tsx")
const HOME = read("src/app/(dashboard)/home/page.tsx")
const CUSTOMERS = read("src/app/(dashboard)/customers/page.tsx")
const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
const BY_REP = read("src/app/(dashboard)/receivables/by-rep/page.tsx")
const PROD_TABLE = read("src/components/products/product-table.tsx")

describe("màn tạo đơn — tồn kho phải lấy đủ, không để server cắt 1.000 dòng", () => {
  /**
   * Nặng nhất trong nhóm này. `stockByProduct` dựng từ truy vấn `batches`
   * là thứ dùng để CHẶN LƯU ĐƠN (isSaleLineOverstock / hasOverstock). Truy
   * vấn không phân trang → nhà phân phối có hơn 1.000 lô còn hàng thì sản
   * phẩm có lô nằm sau dòng 1.000 hiện tồn = 0 → nhân viên đứng ở quầy
   * khách bị báo "vượt tồn" và KHÔNG lưu được đơn hợp lệ, không có lỗi nào
   * hiện ra.
   *
   * Trang /reports đã phân trang từ trước nên hai màn đếm tồn khác nhau
   * thật — không phải chỉ là rủi ro trên lý thuyết.
   */
  it("truy vấn batches có phân trang", () => {
    const i = ORDER_FORM.indexOf('.from("batches")')
    expect(i).toBeGreaterThan(0)
    // Khối bao quanh truy vấn phải là fetchAllForAggregate.
    const before = ORDER_FORM.slice(Math.max(0, i - 400), i)
    expect(before).toContain("fetchAllForAggregate")
    const after = ORDER_FORM.slice(i, i + 300)
    expect(after).toContain('count: "exact"')
    expect(after).toContain(".range(from, to)")
  })

  it("truy vấn khách hàng và sản phẩm cũng phân trang", () => {
    // Hơn 1.000 khách là chuyện thường với nhà phân phối; khách nằm sau
    // dòng 1.000 không tìm thấy trong ô chọn khách → không tạo được đơn.
    expect(ORDER_FORM).toContain("const pageAll =")
    expect(ORDER_FORM).toContain('pageAll<Customer>(CUST_COLS, "customers", "store_name")')
    expect(ORDER_FORM).toMatch(/pageAll<[^>]*>\(PROD_COLS, "products", "name"\)/)
  })

  it("đường dự phòng khi thiếu cột cũng phân trang", () => {
    // Nhánh này chạy khi migration chưa đủ cột. Nếu nó không phân trang thì
    // ở chế độ suy biến lại tái hiện đúng lỗi vừa sửa.
    const i = ORDER_FORM.indexOf("if (prodRes.error)")
    expect(i).toBeGreaterThan(0)
    const block = ORDER_FORM.slice(i, i + 600)
    expect(block).toContain("pageAll")
    expect(block).not.toMatch(/await supabase\.from\("products"\)/)
  })
})

describe("MOB-08 — hai màn không được đếm hai thứ khác nhau rồi gọi cùng một tên", () => {
  /**
   * Trước: /home đếm số DÒNG visit_logs của chính nhân viên; /customers
   * đếm số khách có ĐƠN HÀNG tạo hôm nay (không đụng visit_logs). Nhân
   * viên ghé 10 cửa hàng lấy được 3 đơn thì thấy "10" ở màn này và "3" ở
   * màn kia, cả hai đều ghi "hôm nay".
   */
  it("/customers đếm theo visit_logs, không phải theo đơn hàng", () => {
    const i = CUSTOMERS.indexOf("async function loadStats")
    expect(i).toBeGreaterThan(0)
    const block = CUSTOMERS.slice(i, i + 1600)
    expect(block).toContain('.from("visit_logs")')
    expect(block).toContain('.eq("visit_date", todayDate)')
    // Đếm bằng sales_orders là đúng cái lỗi cũ.
    expect(block).not.toContain('.from("sales_orders")')
  })

  it("cả hai màn đếm SỐ CỬA HÀNG, không phải số lượt", () => {
    // Ô ở /home ghi phụ đề "Điểm bán" nên phải là số cửa hàng: ghé lại một
    // cửa hàng lần thứ hai không thành hai điểm bán.
    const i = HOME.indexOf('.from("visit_logs")')
    expect(i).toBeGreaterThan(0)
    // Cắt đúng tới đầu truy vấn kế tiếp. Cửa sổ cố định theo số ký tự sẽ
    // tràn sang truy vấn `customers` bên dưới (vốn dùng head:true hợp lệ)
    // và làm test đỏ oan — đã bị đúng như vậy một lần.
    const nextQuery = HOME.indexOf("supabase", i)
    const block = HOME.slice(i, nextQuery > i ? nextQuery : i + 200)
    expect(block).toContain('.select("customer_id")')
    expect(block).not.toContain("head: true")
    expect(HOME).toMatch(/visitsToday: new Set\(/)
    expect(CUSTOMERS).toContain("const visitsToday = new Set<string>()")
  })

  it("huy hiệu 'Đã ghé hôm nay' dùng cùng tập dữ liệu với ô thống kê", () => {
    // Cùng một `visitsToday` nuôi cả ô thống kê lẫn huy hiệu từng dòng, nên
    // không thể lệch nhau.
    expect(CUSTOMERS).toContain("setVisitedToday(visitsToday)")
    expect(CUSTOMERS).toContain("Đã ghé hôm nay")
  })
})

describe("MOB-09/MOB-10 — nhãn phải nói đúng phạm vi người dùng đang thấy", () => {
  it("banner đơn hàng nói 'phụ trách', không nói 'do bạn tạo'", () => {
    // RLS lọc theo sales_user_id = auth.uid() (002_rls_policies.sql:292),
    // tức đơn được PHÂN CÔNG cho mình. Quản lý tạo đơn rồi giao cho nhân
    // viên thì nhân viên vẫn thấy, dù không phải họ tạo.
    expect(ORDERS).toContain("Bạn chỉ thấy đơn bạn phụ trách")
    expect(ORDERS).not.toContain("Bạn chỉ thấy đơn do bạn tạo")
  })

  it("không nói 'Tổng nợ NPP' với người chỉ thấy phần của mình", () => {
    // Vai trò sales có receivables:read nên vào được trang này, nhưng RLS
    // chỉ trả về công nợ của chính họ.
    expect(BY_REP).toContain('isSales ? "Tổng nợ bạn gánh" : "Tổng nợ NPP"')
  })

  it("ẩn hai ô so sánh giữa các nhân viên khi chỉ thấy một người", () => {
    // "Số NVBH có nợ" luôn = 1 và "nợ quá hạn nhiều nhất" luôn là chính
    // mình — hiện ra chỉ gây hiểu sai.
    expect(BY_REP).toContain("{!isSales && (")
  })
})

describe("MOB-14 — thẻ sản phẩm trên điện thoại phải hiện giá", () => {
  /**
   * Bản bảng (desktop) có dự phòng `sell_price`; thẻ mobile thì không, chỉ
   * đọc price_lists. Sản phẩm định giá thẳng ở sell_price mà chưa có bảng
   * giá thì trên điện thoại hiện "-" còn trên máy tính ra giá đúng — nhân
   * viên đứng trong cửa hàng không đọc được giá để báo khách.
   */
  it("thẻ mobile dùng cùng công thức giá với bản bảng", () => {
    const n = (
      PROD_TABLE.match(/price_lists\?\.find\(\(p\) => !p\.group_id\)\?\.price \?\?\s*\n?\s*Number\(product\.sell_price \?\? 0\)/g) || []
    ).length
    expect(n, "cả bản bảng lẫn thẻ mobile đều phải có dự phòng sell_price").toBe(2)
  })

  it("không còn đọc .price trên một object có thể là undefined", () => {
    expect(PROD_TABLE).not.toContain("formatCurrency(defaultPrice.price)")
  })
})
