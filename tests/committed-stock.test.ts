import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Chốt cho "hàng đã đặt nhưng chưa rời kho" (mig 136 + màn bán hàng).
 *
 * Đây là phép trừ quyết định có cho ghi thêm một dòng hàng hay không.
 * Sai theo chiều lỏng là ba nhân viên cùng bán một lô; sai theo chiều
 * chặt là người đứng ở quầy không lưu nổi đơn hợp lệ.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/**
 * Bỏ chú thích TRƯỚC khi soi SQL. File 136 có nguyên một khối giải thích
 * nhắc lại mọi cái bẫy — không lọc thì chốt xanh nhờ chính lời cảnh báo.
 */
function stripSql(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
}

const MIG = read("supabase/migrations/136_committed_stock.sql")
const SQL = stripSql(MIG)
/** Chỉ thân hàm — phần kiểm cuối file cũng nhắc lại các điều kiện này. */
const FN = SQL.slice(
  SQL.indexOf("CREATE FUNCTION public.committed_stock_by_product"),
  SQL.indexOf("COMMENT ON FUNCTION")
)

describe("136 — hàm cộng số đã đặt", () => {
  /**
   * ⚠ LÝ DO DUY NHẤT DÙNG SECURITY DEFINER. RLS cho vai trò `sales` chỉ
   * thấy đơn của CHÍNH MÌNH (002_rls_policies.sql "Sales see own
   * orders"), nên cộng bằng quyền người gọi là mỗi người chỉ trừ phần
   * mình đã hứa — tức là lỗ hổng vẫn còn nguyên mà màn hình trông như
   * đã bịt.
   */
  it("là SECURITY DEFINER và tự lọc theo org của người gọi", () => {
    expect(FN).toContain("SECURITY DEFINER")
    expect(FN).toContain("SET search_path = public")
    expect(FN).toContain("v_org := public.user_org_id()")
    expect(FN).toContain("so.org_id = v_org")
  })

  /** ⚠ SECURITY DEFINER mà quên thu quyền là mở cho PUBLIC. */
  it("thu quyền PUBLIC rồi mới cấp cho authenticated", () => {
    const revokeAt = SQL.indexOf("REVOKE ALL ON FUNCTION public.committed_stock_by_product")
    const grantAt = SQL.indexOf("GRANT EXECUTE ON FUNCTION public.committed_stock_by_product")
    expect(revokeAt, "thiếu REVOKE").toBeGreaterThan(0)
    expect(grantAt, "thiếu GRANT").toBeGreaterThan(0)
    expect(revokeAt).toBeLessThan(grantAt)
    expect(SQL).toContain("TO authenticated")
  })

  /**
   * ⚠ CHỈ ĐƠN ĐÃ GỬI. `draft` là giỏ riêng của một nhân viên, chưa hứa
   * với ai — đếm cả nháp là một cái nháp bỏ quên khoá hàng của cả đơn
   * vị, và người bị chặn không có cách nào nhìn thấy nó để mà xoá.
   */
  it("đếm phiếu tạm và đơn xuất một phần, KHÔNG đếm nháp", () => {
    expect(FN).toContain("so.status IN ('submitted', 'partially_invoiced')")
    expect(FN).not.toContain("'draft', 'submitted', 'partially_invoiced'")
  })

  /**
   * ⚠ Phần đã xuất đã trừ kho thật rồi; đếm lại là trừ hai lần trên
   * cùng một số hàng.
   */
  it("đơn xuất một phần chỉ tính phần CÒN LẠI", () => {
    expect(FN).toContain("GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0))")
  })

  /** ⚠ Quy về đơn vị cơ sở, nếu không 5 thùng bị tính là 5 gói. */
  it("quy đổi về đơn vị cơ sở ở CẢ dòng bán lẫn dòng đổi", () => {
    expect(FN).toContain("COALESCE(sol.conversion_factor, 1)")
    // ⚠ `return_lines` không có cột hệ số; phải tra `product_units`, và
    //   cột ở bảng đó tên là `conversion`, KHÔNG phải `conversion_factor`.
    expect(FN).toContain("COALESCE(pu.conversion, 1)")
    expect(FN).toContain("pu.unit_name  = rl.unit_name")
  })

  /**
   * ⚠ Hàng đổi rời kho theo đúng chuyến ấy — `get_invoiceable_lines`
   * (mig 125) đã coi chúng là hàng xuất. Không đếm là phần đổi biến mất
   * khỏi phép trừ.
   */
  it("đếm dòng ĐỔI chưa xuất, và chỉ khi chưa gắn hóa đơn", () => {
    expect(FN).toContain("rl.is_exchange = true")
    // `post_invoice` gắn `invoice_id`; dấu đó nghĩa là hàng đã đi.
    expect(FN).toContain("r.invoice_id IS NULL")
    expect(FN).toContain("r.status IN ('draft', 'submitted')")
  })

  /**
   * ⚠ Thiếu vế này thì sửa một Phiếu tạm là đơn tự chặn chính nó: 100
   * thùng đã đặt của nó bị trừ khỏi tồn, rồi 100 thùng trong giỏ so với
   * phần còn lại → luôn vượt, không ai sửa nổi đơn của mình.
   */
  it("loại được ĐƠN ĐANG SỬA, và loại ở CHỖ DÙNG CHUNG cho cả hai nguồn", () => {
    expect(FN).toContain("p_exclude_order IS NULL OR so.id <> p_exclude_order")
    // Nằm trong `live_orders` nên cả dòng bán lẫn dòng đổi đều theo.
    const liveAt = FN.indexOf("live_orders AS (")
    const excludeAt = FN.indexOf("p_exclude_order IS NULL")
    expect(liveAt).toBeGreaterThan(0)
    expect(excludeAt).toBeGreaterThan(liveAt)
    expect(excludeAt).toBeLessThan(FN.indexOf("from_lines AS ("))
    expect(FN.match(/JOIN live_orders lo/g)?.length, "cả hai nguồn phải nối vào live_orders").toBe(2)
  })

  /** ⚠ Không có org thì DỪNG, đừng trả 0 dòng như thể chẳng ai đặt gì. */
  it("thiếu org thì RAISE theo đúng quy ước P0001", () => {
    expect(FN).toContain("ERRCODE = 'P0001'")
    expect(FN).toContain("NO_ORG:")
  })

  it("kết thúc bằng NOTIFY để PostgREST nạp lại lược đồ", () => {
    expect(MIG.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })
})

describe("màn bán hàng đọc và dùng số đã đặt", () => {
  const HOOK = read("src/hooks/use-committed-stock.tsx")
  const LAYOUT = read("src/app/(dashboard)/sell/layout.tsx")
  const LIST = read("src/app/(dashboard)/sell/page.tsx")
  const CARD = read("src/components/sell/product-card.tsx")
  const SCAN = read("src/app/(dashboard)/sell/scan/page.tsx")

  /**
   * ⚠ PROVIDER PHẢI NẰM TRONG GIỎ. Chỉ giỏ mới biết đơn nào đang được
   * mở ra sửa, mà không loại đơn đó ra thì nó tự chặn chính nó.
   */
  it("provider nằm trong SellCartProvider và loại đơn đang sửa", () => {
    const cartAt = LAYOUT.indexOf("<SellCartProvider>")
    const comAt = LAYOUT.indexOf("<CommittedStockProvider>")
    expect(cartAt).toBeGreaterThan(0)
    expect(comAt).toBeGreaterThan(cartAt)
    expect(HOOK).toContain("cart.editing?.orderId ?? null")
    expect(HOOK).toContain("p_exclude_order: excludeOrderId")
  })

  /**
   * ⚠ RPC TRẢ NHIỀU DÒNG THÌ CŨNG BỊ CẮT Ở 1.000. Cắt ở đây là TRỪ
   * THIẾU, tức là cho bán quá tay — nên phải kéo đủ, và chạm trần thì
   * thà nói không biết.
   */
  it("kéo đủ qua fetchAllForAggregate, chạm trần thì báo chứ không trừ thiếu", () => {
    expect(HOOK).toContain("fetchAllForAggregate")
    expect(HOOK).toContain('count: "exact"')
    expect(HOOK).toContain(".range(from, to)")
    const truncAt = HOOK.indexOf("res.truncated")
    expect(truncAt).toBeGreaterThan(0)
    expect(HOOK.slice(truncAt, truncAt + 400)).toContain("setCommitted(null)")
  })

  /**
   * ⚠ ĐỌC HỎNG KHÔNG ĐƯỢC BIẾN THÀNH "0 ĐÃ ĐẶT" TRONG IM LẶNG. Và khi
   * nguyên nhân là chưa chạy bản vá thì phải gọi đúng tên việc phải làm.
   */
  it("đọc hỏng thì để null VÀ nói ra, kể cả khi thiếu migration", () => {
    expect(HOOK).toContain('const MISSING_RPC = "PGRST202"')
    expect(HOOK).toContain("chưa có bản vá 136")
    expect(LIST).toContain("{committedWarning && (")
  })

  /** Thêm hàng phải so với phần CÒN ĐẶT ĐƯỢC, không so với tồn. */
  it("chạm thẻ để thêm hàng so với khả dụng", () => {
    expect(LIST).toContain("availableMapFrom(stockByProduct, committedByProduct)")
    const at = LIST.indexOf("const available = availableByProduct[p.id] ?? 0")
    expect(at, "màn danh sách không tính khả dụng").toBeGreaterThan(0)
    expect(LIST.slice(at, at + 200)).toContain("if (available <= 0)")
    // Quét mã cũng là một đường thêm hàng — không được bỏ sót.
    expect(SCAN).toContain("availableByProduct[p.id] ?? 0")
  })

  /**
   * ⚠ "HẾT HÀNG" VÀ "ĐÃ CÓ NGƯỜI ĐẶT HẾT" LÀ HAI VIỆC KHÁC NHAU: gọi
   * nhập hàng, hay đi hỏi đơn nào đang giữ. Gộp hai câu là để người bán
   * làm sai việc — kho vẫn đầy mà bảo nhau đi nhập thêm.
   */
  it("thẻ hàng nói rõ tồn / đã đặt / còn, và phân biệt hai loại hết", () => {
    /**
     * ⚠ GỘP KHOẢNG TRẮNG RỒI SOI CẢ BIỂU THỨC, đừng soi từng mảnh rời.
     * Chốt bản đầu chỉ đòi có chuỗi `sd.reservedOut` và chuỗi "Đã đặt
     * hết" ở đâu đó trong file — sửa thành `{false && sd.reservedOut`
     * thì cả hai chuỗi vẫn còn và chốt vẫn xanh trong khi nhánh đã chết.
     * Đã thử phá đúng như vậy và nó lọt.
     */
    const FLAT = CARD.replace(/\s+/g, " ")
    expect(FLAT).toContain("stockDisplayFor(stock, committedUnit)")
    expect(FLAT).toContain("{sd.reservedOut ? `Đã đặt hết (tồn ${formatInt(stock)} ${unit})`")
    expect(FLAT).toContain(": outOfStock ? \"Hết hàng\"")
    expect(FLAT).toContain(
      "{!sd.reservedOut && sd.committed !== null && sd.committed > 0 && ("
    )
    expect(FLAT).toContain("đã đặt {formatInt(sd.committed)} · còn {formatInt(sd.available)}")
    // ⚠ Quy đổi số đã đặt bằng ĐÚNG phép quy đổi của tồn.
    expect(FLAT).toContain(
      "baseCommitted === null ? null : stockInUnit(product, unit, baseCommitted)"
    )
    // Chưa đọc được thì nói ra ngay trên thẻ.
    expect(FLAT).toContain("{sd.committed === null && (")
    expect(FLAT).toContain("chưa rõ hàng đã đặt")
  })
})
