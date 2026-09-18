import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  outstandingOf, searchOrderDebts,
  type OrderDebtRow,
} from "../src/lib/finance/receipt-orders"

/**
 * PHIẾU THU TỪ NHIỀU ĐƠN (chủ nhà yêu cầu).
 *
 * ⚠ PHIẾU THU KHÔNG THU THEO ĐƠN, NÓ THU THEO CÔNG NỢ. Từ v2b mỗi hóa
 * đơn sinh một dòng `receivables` giữ cả `order_id` lẫn `invoice_id`.
 * "Chọn đơn" thực chất là chọn DÒNG CÔNG NỢ của đơn ấy — một đơn xuất
 * hai đợt có HAI dòng nợ, và người thu tiền phải thấy cả hai.
 */
const row = (o: Partial<OrderDebtRow> = {}): OrderDebtRow => ({
  receivableId: "r1",
  orderId: "o1",
  orderCode: "DH-0042",
  invoiceCode: "HD-0042",
  customerId: "c1",
  customerName: "Tạp hoá Bà Năm",
  salesUserName: "Trần Minh",
  orderDate: "2026-09-17",
  dueDate: null,
  amount: 1000,
  paid: 0,
  ...o,
})

describe("còn phải thu", () => {
  it("cộng trừ bình thường", () => {
    expect(outstandingOf(row({ amount: 1000, paid: 300 }))).toBe(700)
  })

  /**
   * ⚠ KẸP VỀ 0. Dòng trả dư có `paid > amount`; để số âm chạy tiếp là
   * tổng phiếu thu bị trừ đi một khoản không ai chọn.
   */
  it("trả dư thì ra 0, không ra số âm", () => {
    expect(outstandingOf(row({ amount: 1000, paid: 1500 }))).toBe(0)
  })
})

describe("ô tìm đơn", () => {
  const rows = [
    row(),
    row({ receivableId: "r2", orderCode: "DH-0043", invoiceCode: "HD-0043", customerId: "c2", customerName: "Cửa hàng Minh Anh", salesUserName: "Lê Hoa" }),
    row({ receivableId: "r3", orderCode: "DH-0044", invoiceCode: "HD-0044", amount: 500, paid: 500 }),
  ]

  /** ⚠ Bỏ dấu trước khi so — kế toán gõ "tap hoa" để tìm "Tạp hoá". */
  it("tìm được khi gõ không dấu", () => {
    expect(searchOrderDebts(rows, "tap hoa").map((r) => r.receivableId)).toEqual(["r1"])
  })

  it("tìm được theo mã đơn, mã hóa đơn, tên người bán", () => {
    expect(searchOrderDebts(rows, "DH-0043").map((r) => r.receivableId)).toEqual(["r2"])
    expect(searchOrderDebts(rows, "hd-0042").map((r) => r.receivableId)).toEqual(["r1"])
    expect(searchOrderDebts(rows, "le hoa").map((r) => r.receivableId)).toEqual(["r2"])
  })

  /** ⚠ Nợ đã trả đủ mà vẫn gợi ý là kế toán chọn vào rồi thu thêm lần nữa. */
  it("bỏ dòng không còn phải thu", () => {
    expect(searchOrderDebts(rows, "").map((r) => r.receivableId)).not.toContain("r3")
  })

  /**
   * ⚠ MỘT PHIẾU THU CHỈ CỦA MỘT KHÁCH. RPC nhận đúng một `customer_id`;
   * hiện đơn của khách khác là mời người dùng đi vào một phiếu sẽ bị từ
   * chối — sau khi họ đã gõ xong cả phiếu.
   */
  it("đã chọn đơn thì khoá theo khách đó", () => {
    expect(
      searchOrderDebts(rows, "", { lockedCustomerId: "c1" }).map((r) => r.receivableId)
    ).toEqual(["r1"])
  })

  /** ⚠ Chọn lại lần hai thành hai dòng cùng một khoản nợ, tổng cộng đôi. */
  it("bỏ dòng đã chọn khỏi gợi ý", () => {
    expect(searchOrderDebts(rows, "", { alreadyPicked: new Set(["r1"]) }).map((r) => r.receivableId))
      .toEqual(["r2"])
  })

  it("cắt bớt khi quá nhiều kết quả", () => {
    const many = Array.from({ length: 50 }, (_, i) => row({ receivableId: `x${i}` }))
    expect(searchOrderDebts(many, "")).toHaveLength(20)
  })
})

/**
 * GHÉP VÀO MÀN LẬP PHIẾU THU.
 *
 * Những chốt dưới đọc thẳng mã nguồn màn `/finance/cash-receipts/new`.
 * Đây là loại lỗi `tsc` không thấy được: tên cột bịa, bộ lọc lệch nhau,
 * thứ tự `setState` sai — tất cả đều biên dịch xanh và chỉ hỏng lúc chạy
 * thật trên máy chủ nhà.
 */
describe("ghép ô tìm đơn vào màn lập phiếu thu", () => {
  const page = readFileSync(
    "src/app/(dashboard)/finance/cash-receipts/new/page.tsx",
    "utf8"
  )
  const ddl = readFileSync("supabase/schema_full.sql", "utf8")
  const mig124 = readFileSync(
    "supabase/migrations/124_wf2b_sales_invoices.sql",
    "utf8"
  )

  /**
   * ⚠ CHỐNG BỊA CỘT. `customers.price_group_id` và
   * `organizations.address` đều biên dịch xanh rồi hỏng lúc chạy. Mọi
   * cột trong câu `select` của ô tìm phải có thật trong DDL.
   */
  it("mọi cột của DEBT_SELECT đều có trong lược đồ thật", () => {
    const recDdl = ddl.slice(ddl.indexOf("CREATE TABLE receivables"))
    const recCols = recDdl.slice(0, recDdl.indexOf(");"))
    for (const col of ["order_id", "customer_id", "amount", "paid", "due_date", "status"]) {
      expect(recCols).toContain(col)
    }
    // Khoá ngoại của embed — tên FK sai thì PostgREST trả 400.
    expect(recDdl).toContain("sales_user_id uuid REFERENCES users(id)")
    // `invoice_id` do mig 124 thêm, không có trong schema_full.
    expect(mig124).toMatch(/ALTER TABLE receivables\s+ADD COLUMN IF NOT EXISTS invoice_id/)
    expect(page).toContain("users!receivables_sales_user_id_fkey(full_name)")
    expect(page).toContain("order:sales_orders(order_code, order_date)")
    expect(page).toContain("invoice:sales_invoices(invoice_code, invoice_date)")
  })

  /**
   * ⚠ PostgREST CẮT Ở 1000 DÒNG TRONG IM LẶNG. Nhà phân phối có hơn 1000
   * khoản nợ đang mở thì đơn cần tìm nằm ngoài lát cắt, ô tìm trả rỗng,
   * và kế toán kết luận đơn ấy đã thu rồi.
   */
  it("đọc danh sách đơn qua fetchAllForAggregate, không đọc một phát", () => {
    const load = page.slice(page.indexOf("DEBT_SELECT, { count:"))
    expect(page.slice(0, page.indexOf("DEBT_SELECT, { count:"))).toContain(
      "fetchAllForAggregate<RawDebt>"
    )
    expect(load).toContain(".range(from, to)")
  })

  /**
   * ⚠ HAI BỘ LỌC PHẢI GIỐNG NHAU. Ô tìm hiện một dòng mà danh sách dưới
   * không hiện thì số tiền điền vào một ô không tồn tại — tổng phiếu cộng
   * một con số không ai sửa được.
   */
  it("ô tìm và danh sách khoản nợ lọc cùng một bộ trạng thái", () => {
    const filters = page.match(/\.in\("status", \[[^\]]+\]\)/g) ?? []
    expect(filters.length).toBe(2)
    expect(new Set(filters).size).toBe(1)
    expect(filters[0]).toContain('"open"')
  })

  /**
   * ⚠ ĐỔI KHÁCH THÌ `loadCustomer` XOÁ `amounts`. Điền thẳng số rồi mới
   * `setCustomerId` là con số biến mất ngay sau đó — người dùng bấm chọn
   * đơn mà không thấy gì xảy ra.
   */
  it("chọn đơn của khách khác thì gửi qua pendingPick, không điền thẳng", () => {
    const fn = page.slice(page.indexOf("const pickDebt"), page.indexOf("const linesTotal"))
    const guard = fn.indexOf("r.customerId !== customerId")
    const seed = fn.indexOf("pendingPick.current = {")
    const setCust = fn.indexOf("setCustomerId(r.customerId)")
    expect(guard).toBeGreaterThan(-1)
    expect(seed).toBeGreaterThan(guard)
    expect(setCust).toBeGreaterThan(seed)
    // và nhánh ấy phải DỪNG, không rơi xuống setAmounts.
    expect(fn.indexOf("return", setCust)).toBeLessThan(fn.indexOf("setAmounts"))
  })

  /**
   * ⚠ CHỈ ĐIỀN KHI DÒNG ẤY CÓ THẬT. Ô tìm đọc một lần lúc mở màn; đến
   * lúc bấm thì khoản nợ có thể đã được người khác thu xong. Điền bừa là
   * `amounts` mang một id không hiện ở đâu, và RPC từ chối lúc bấm Lưu.
   */
  it("chỉ nạp pendingPick khi khoản nợ có trong danh sách vừa đọc", () => {
    expect(page).toMatch(
      /if \(seed && rows\.some\(\(r\) => r\.id === seed\.receivableId\)\) \{\s*setAmounts/
    )
  })

  /**
   * ⚠ MỘT PHIẾU THU CHỈ CỦA MỘT KHÁCH. Không khoá là người dùng gom nợ
   * hai người rồi mới bị RPC từ chối.
   */
  it("khoá ô tìm theo khách đã chọn", () => {
    expect(page).toContain("lockedCustomerId: customerId || null")
    expect(page).toContain("alreadyPicked: pickedIds")
  })

  /** ⚠ Cắt bớt trong im lặng đọc như "chỉ có bấy nhiêu đơn thôi". */
  it("nói ra khi danh sách bị cắt ở 20 dòng", () => {
    expect(page).toContain("debtResults.length >= 20")
    expect(page).toContain("gõ thêm để thu hẹp")
  })

  /**
   * ⚠ LỖI ĐỌC CỦA Ô TÌM PHẢI CÓ STATE RIÊNG. `loadCustomer` xoá
   * `loadError` mỗi lần đổi khách; gộp chung là lỗi biến mất ngay khi
   * người dùng chọn khách.
   */
  it("lỗi đọc danh sách đơn không dùng chung loadError", () => {
    expect(page).toContain("setDebtError(res.error)")
    const loadCustomer = page.slice(
      page.indexOf("const loadCustomer"),
      page.indexOf("useEffect(() => {\n    void loadCustomer")
    )
    expect(loadCustomer).toContain("setLoadError(null)")
    expect(loadCustomer).not.toContain("setDebtError")
  })

  /** ⚠ Một nguồn sự thật cho "đã chọn": chính `amounts`. */
  it("không có state riêng cho đơn đã chọn", () => {
    expect(page).toContain("const pickedIds = useMemo(")
    expect(page).not.toContain("setPickedDebts")
  })

  /** ⚠ Hai phép kẹp lệch nhau là hai con số cho cùng một dòng. */
  it("danh sách khoản nợ kẹp bằng đúng outstandingOf", () => {
    expect(page).toMatch(/const remainingOf = \(r: OpenReceivable\) => outstandingOf\(r\)/)
  })
})
