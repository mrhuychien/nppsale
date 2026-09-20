import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildReorder, groupBySupplier, remainingOf,
  REORDER_ORDER_STATUSES, NO_SUPPLIER_LABEL,
} from "../src/lib/purchasing/reorder"

/**
 * ĐỀ XUẤT ĐẶT HÀNG — cần đặt gì, của NCC nào.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "So sánh giữa số lượng trên đơn hàng và
 * Tồn kho xem cần đặt những mặt hàng gì. Theo tổng, theo NCC."
 *
 * ⚠ MÀN NÀY ĐẺ RA QUYẾT ĐỊNH TIÊU TIỀN THẬT. Sai một chỗ là hoặc ôm
 * tồn, hoặc hết hàng giữa đợt giao — và cả hai đều KHÔNG kêu lên.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = strip(read("src/app/(dashboard)/purchasing/reorder/page.tsx"))
const SCHEMA = read("supabase/schema_full.sql")

const prods = [
  { id: "p1", name: "Bánh 160g", sku: "S1", base_unit: "hộp", primary_supplier_id: "n1" },
  { id: "p2", name: "Sữa 180ml", sku: "S2", base_unit: "lon", primary_supplier_id: "n2" },
  { id: "p3", name: "Kẹo", sku: "S3", base_unit: "gói", primary_supplier_id: null },
]
const sups = { n1: "NCC Một", n2: "NCC Hai" }

describe("còn phải giao của một dòng đơn", () => {
  /**
   * ⚠ TRỪ PHẦN ĐÃ XUẤT. `sales_order_lines.invoiced_qty` (mig 124) đếm
   * phần đã ra hoá đơn. Lấy `quantity` không trừ đi là đề xuất đặt lại
   * hàng vừa giao xong.
   */
  it("trừ phần đã xuất hoá đơn", () => {
    expect(remainingOf({ product_id: "p1", quantity: 10, invoiced_qty: 4 })).toBe(6)
    expect(remainingOf({ product_id: "p1", quantity: 10, invoiced_qty: 10 })).toBe(0)
  })

  /**
   * ⚠ QUY VỀ ĐƠN VỊ CƠ SỞ. Dòng đơn ghi theo đơn vị bán (thùng), tồn
   * kho đếm theo đơn vị cơ sở (hộp). Trừ thẳng là so "5 thùng" với "40
   * hộp" rồi kết luận thừa hàng.
   */
  it("quy về đơn vị cơ sở bằng hệ số", () => {
    expect(remainingOf({ product_id: "p1", quantity: 5, invoiced_qty: 0, conversion_factor: 12 })).toBe(60)
    expect(remainingOf({ product_id: "p1", quantity: 2, invoiced_qty: 1, conversion_factor: 12 })).toBe(12)
  })

  /**
   * ⚠ KHÔNG ĐỂ ÂM. Xuất quá số đặt là chuyện có thật (khách lấy thêm
   * tại chỗ). Một dòng âm sẽ TRỪ vào nhu cầu của mặt hàng khác khi cộng
   * dồn, và đề xuất thiếu đi đúng chừng ấy.
   */
  it("xuất quá số đặt không làm nhu cầu âm", () => {
    expect(remainingOf({ product_id: "p1", quantity: 5, invoiced_qty: 8 })).toBe(0)
  })

  it("giá trị rỗng hoặc hỏng ra 0, không ra NaN", () => {
    expect(remainingOf({ product_id: "p1", quantity: null })).toBe(0)
    expect(remainingOf({ product_id: "p1", quantity: "abc" })).toBe(0)
    expect(Number.isNaN(remainingOf({ product_id: "p1", quantity: 5, conversion_factor: "" }))).toBe(false)
    expect(remainingOf({ product_id: "p1", quantity: 5, conversion_factor: "" })).toBe(5)
  })
})

describe("bảng đề xuất", () => {
  it("cần đặt = còn phải giao − tồn", () => {
    const rows = buildReorder(
      [{ product_id: "p1", quantity: 100, invoiced_qty: 0 }],
      { p1: 30 },
      prods,
      sups
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].demand).toBe(100)
    expect(rows[0].onHand).toBe(30)
    expect(rows[0].need).toBe(70)
  })

  /** ⚠ Đủ tồn thì không hiện — màn này trả lời đúng một câu. */
  it("mặt hàng đủ tồn không lọt vào bảng", () => {
    expect(buildReorder([{ product_id: "p1", quantity: 10 }], { p1: 50 }, prods, sups)).toHaveLength(0)
    expect(buildReorder([{ product_id: "p1", quantity: 10 }], { p1: 10 }, prods, sups)).toHaveLength(0)
  })

  /** ⚠ Nhiều dòng cùng một mã phải CỘNG DỒN, không lấy dòng cuối. */
  it("cộng dồn nhiều dòng cùng một mặt hàng", () => {
    const rows = buildReorder(
      [
        { product_id: "p1", quantity: 40 },
        { product_id: "p1", quantity: 30, invoiced_qty: 10 },
      ],
      { p1: 0 },
      prods,
      sups
    )
    expect(rows[0].demand).toBe(60)
    expect(rows[0].need).toBe(60)
  })

  /** ⚠ Chưa có tồn thì coi là 0, không bỏ qua mặt hàng. */
  it("mặt hàng chưa từng có tồn vẫn hiện", () => {
    const rows = buildReorder([{ product_id: "p2", quantity: 5 }], {}, prods, sups)
    expect(rows.map((r) => r.product_id)).toEqual(["p2"])
    expect(rows[0].onHand).toBe(0)
  })

  /**
   * ⚠ MÃ ĐÃ XOÁ KHỎI DANH MỤC VẪN PHẢI HIỆN. Nhu cầu là có thật — giấu
   * dòng đi là giấu mất một mặt hàng sắp thiếu.
   */
  it("mã đã xoá khỏi danh mục vẫn hiện, có nhãn", () => {
    const rows = buildReorder([{ product_id: "xx", quantity: 5 }], {}, prods, sups)
    expect(rows[0].product_name).toBe("Sản phẩm đã xoá")
  })

  /** ⚠ Thiếu nhiều nhất lên đầu — đó là thứ phải đặt trước. */
  it("xếp theo lượng cần đặt giảm dần", () => {
    const rows = buildReorder(
      [{ product_id: "p1", quantity: 10 }, { product_id: "p2", quantity: 90 }],
      {},
      prods,
      sups
    )
    expect(rows.map((r) => r.product_id)).toEqual(["p2", "p1"])
  })
})

describe("gom theo NCC", () => {
  const rows = buildReorder(
    [
      { product_id: "p1", quantity: 10 },
      { product_id: "p2", quantity: 50 },
      { product_id: "p3", quantity: 5 },
    ],
    {},
    prods,
    sups
  )

  it("mỗi NCC một nhóm, cộng đúng tổng cần đặt", () => {
    const g = groupBySupplier(rows)
    const n2 = g.find((x) => x.supplier_id === "n2")!
    expect(n2.supplier_name).toBe("NCC Hai")
    expect(n2.need).toBe(50)
  })

  /**
   * ⚠ NHÓM "CHƯA GÁN NCC" ĐỨNG CUỐI NHƯNG KHÔNG BỊ BỎ. Cột
   * `primary_supplier_id` được backfill từ phiếu nhập gần nhất (mig
   * 030), nên mã chưa từng nhập về thì nó trống. Bỏ nhóm ấy là đề xuất
   * im lặng thiếu đúng những mã MỚI — thứ dễ hết hàng nhất.
   */
  it("nhóm chưa gán NCC vẫn có, và đứng cuối", () => {
    const g = groupBySupplier(rows)
    const last = g[g.length - 1]
    expect(last.supplier_id).toBeNull()
    expect(last.supplier_name).toBe(NO_SUPPLIER_LABEL)
    expect(last.rows.map((r) => r.product_id)).toEqual(["p3"])
  })
})

describe("chỉ tính đơn còn hiệu lực", () => {
  /**
   * ⚠ ĐỐI CHIẾU VỚI CHECK CONSTRAINT THẬT của `sales_orders.status`.
   * Bỏ sót `partially_invoiced` là bỏ sót đúng nhóm đơn ĐANG giao dở —
   * nhóm cần đặt hàng nhất. Đó cũng là trạng thái từng biến mất khỏi
   * màn đơn hàng vì một danh sách gõ tay thiếu một dòng.
   */
  it("danh sách trạng thái là tập con THẬT của sáu trạng thái đơn", () => {
    /**
     * ⚠ LẤY BẢN CUỐI CÙNG, KHÔNG LẤY BẢN ĐẦU TIÊN. `schema_full.sql`
     * là mọi migration nối lại theo thứ tự, nên một ràng buộc bị
     * `DROP … ADD` lại nhiều lần sẽ xuất hiện NHIỀU LẦN. Bản đầu của
     * chốt này bắt trúng bản ở migration 119 — bản CHƯA có
     * `partially_invoiced`, đã bị migration sau thay hẳn — rồi kết tội
     * đoạn mã đang làm đúng. Cùng bài học với chốt
     * `tests/sql-update-from-aggregate.test.ts`: soi bản ĐANG CHẠY.
     */
    const ms = Array.from(
      SCHEMA.matchAll(/chk_sales_orders_status_v2[\s\S]{0,80}?\(status IN \(([^)]+)\)\)/g)
    )
    expect(ms.length, "không tìm thấy CHECK constraint trạng thái đơn").toBeGreaterThan(0)
    const all = ms[ms.length - 1][1].split(",").map((x) => x.trim().replace(/'/g, ""))
    expect(all, "đang đọc phải một bản ràng buộc đã bị thay").toContain("closed")
    for (const st of REORDER_ORDER_STATUSES) {
      expect(all, `trạng thái "${st}" không có thật trong CHECK constraint`).toContain(st)
    }
    expect(REORDER_ORDER_STATUSES, "thiếu nhóm đơn đang giao dở").toContain("partially_invoiced")
    expect(REORDER_ORDER_STATUSES as readonly string[], "đơn nháp không phải cam kết")
      .not.toContain("draft")
    expect(REORDER_ORDER_STATUSES as readonly string[], "đơn đã huỷ không còn nhu cầu")
      .not.toContain("cancelled")
  })

  it("màn lọc theo đúng danh sách ấy, không gõ tay lại", () => {
    expect(PAGE).toContain('.in("order.status", REORDER_ORDER_STATUSES')
  })
})

describe("màn đề xuất đặt hàng", () => {
  /**
   * ⚠ PHẢI ĐỌC ĐỦ. PostgREST cắt ở 1.000 dòng; dòng đơn hàng và lô hàng
   * đều vượt xa con số đó ở một nhà phân phối thật. Cắt là đề xuất
   * THIẾU, và một bảng thiếu trông y hệt một bảng đủ.
   */
  it("đọc dòng đơn và lô hàng qua fetchAllForAggregate", () => {
    const n = (PAGE.match(/fetchAllForAggregate/g) ?? []).length
    expect(n, `mới ${n} câu đọc dùng phép đọc đủ — còn câu bị cắt ở 1.000 dòng`).toBeGreaterThanOrEqual(3)
    expect(PAGE, "câu đọc phân trang thiếu mốc sắp xếp — các trang sẽ lặp/sót")
      .toContain('.order("id")')
  })

  /** ⚠ Đọc bị cắt thì NÓI RA, đừng để người mua hàng đặt theo bảng thiếu. */
  it("đọc bị cắt thì cảnh báo ra màn", () => {
    expect(PAGE).toContain("lineRes.truncated || batchRes.truncated")
    expect(PAGE).toContain("Chưa đọc hết dữ liệu")
  })

  /** ⚠ Màn này CHỈ ĐỌC — không lập phiếu, không đụng kho hay công nợ. */
  it("không ghi gì cả", () => {
    const flat = PAGE.replace(/\s+/g, " ")
    for (const verb of ["insert", "update", "delete", "upsert", "rpc"]) {
      expect(flat, `màn đề xuất đang gọi .${verb}( — nó phải chỉ đọc`)
        .not.toContain(`.${verb}(`)
    }
  })

  /** ⚠ Nói rõ phép tính ngay trên màn — người ta tiêu tiền thật theo nó. */
  it("nói ra công thức và phạm vi dữ liệu", () => {
    expect(PAGE).toContain("Cần đặt = Còn phải giao − Tồn khả dụng")
    expect(PAGE).toContain("đơn nháp và đơn đã huỷ không tính")
  })

  /** ⚠ Dùng chung dải viên thuốc với màn đơn hàng, không dựng bản thứ hai. */
  it("lọc theo NCC bằng dải viên thuốc dùng chung", () => {
    expect(PAGE).toContain('from "@/components/ui/status-chips"')
    expect(PAGE).toContain("<StatusChips")
  })
})
