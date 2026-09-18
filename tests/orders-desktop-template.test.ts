import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repAvatar } from "../src/components/orders/desktop-order-table"
import { explainCompleteError, completeWarnings } from "../src/lib/orders/complete-order"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = code(read("src/app/(dashboard)/orders/page.tsx"))
const TABS = code(read("src/components/orders/pipeline-tabs.tsx"))
const TABLE = code(read("src/components/orders/desktop-order-table.tsx"))
const DRAWER = code(read("src/components/orders/order-drawer.tsx"))

/**
 * Màn "Đơn hàng" trên MÁY TÍNH theo mẫu claude.ai/artifact/N59JiSWXwcUd4ReoTRZC9m:
 * thẻ trạng thái có số to, một thẻ bảng gồm thanh công cụ + dải chọn nhiều +
 * bảng + phân trang, và ngăn chi tiết bên phải khi chạm một dòng.
 */
describe("Thẻ trạng thái (PipelineTabs) — cùng số với bảng bên dưới", () => {
  it("dựng từ COUNTED_STATUSES với số đếm từ máy chủ, vạch màu theo orderTone", () => {
    const i = PAGE.indexOf("<PipelineTabs")
    const block = PAGE.slice(i, PAGE.indexOf("/>", i))
    expect(block).toContain("tabKeys.map(")
    expect(block).toContain("count: statusCounts[k] ?? 0")
    expect(block).toContain("orderTone(")
    // Chọn thẻ thì buông bước pipeline — hai bộ lọc loại trừ nhau.
    expect(block).toContain("setPipelineStep(null)")
  })

  it("ô 0 đơn mờ đi, ô đang chọn có vạch đáy; hiện ở mọi khổ màn", () => {
    /**
     * ⚠ KHÔNG CÒN LÀ THỨ CHỈ CÓ Ở MÀN RỘNG. Ba tab này LÀ điều hướng của
     * màn đơn hàng cho mọi vai trò, và hàng chip trong sheet lọc đã bỏ —
     * nên giấu chúng trên điện thoại là màn mở ra ở tab Phiếu tạm và kẹt
     * ở đó, không có đường nào sang hai tab kia.
     */
    expect(PAGE).toContain('className="grid"')
    expect(PAGE).not.toContain('"hidden lg:grid"')
    expect(TABS).toContain('t.count === 0 ? "text-outline-variant" : "text-on-surface"')
    expect(TABS).toContain("background: on ? t.accent : \"transparent\"")
    expect(TABS).toContain("aria-selected={on}")
  })
})

describe("Thẻ bảng máy tính: thanh công cụ · dải chọn · bảng · phân trang", () => {
  it("một thẻ, thứ tự đúng, chỉ máy tính", () => {
    const card = PAGE.indexOf('<div className="hidden lg:flex flex-col overflow-hidden rounded-2xl')
    expect(card).toBeGreaterThan(0)
    const toolbar = PAGE.indexOf('placeholder="Tìm mã đơn hàng…"', card)
    const bulk = PAGE.indexOf("{bulkBar}", card)
    const table = PAGE.indexOf("<DesktopOrderTable", card)
    const pager = PAGE.indexOf("<DataPagination", card)
    expect(toolbar).toBeGreaterThan(card)
    expect(bulk).toBeGreaterThan(toolbar)
    expect(table).toBeGreaterThan(bulk)
    expect(pager).toBeGreaterThan(table)
  })

  it("thanh công cụ có tuyến, NVBH (trừ NVBH tự xem), khoảng ngày, Xoá lọc", () => {
    expect(PAGE).toContain("<RouteFilter routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />")
    expect(PAGE).toContain("{!isSales && salesUsers.length > 0 && (")
    expect(PAGE).toContain('<Select value={rangePreset} onValueChange={applyRangePreset}>')
    expect(PAGE).toContain("Xoá lọc")
  })

  /**
   * Khoảng ngày chỉ là cách đặt nhanh dateFrom/dateTo. Người dùng chọn tay
   * một khoảng lạ trong bộ lọc nâng cao thì ô này phải nói "Tuỳ chọn", không
   * được hiện "Hôm nay" cho một khoảng không phải hôm nay.
   */
  it("khoảng ngày nhận ra khoảng tuỳ chọn, không gán bừa", () => {
    expect(PAGE).toContain('if (!dateFrom && !dateTo) return "all"')
    expect(PAGE).toContain('return "custom"')
    expect(PAGE).toContain('{rangePreset === "custom" && <SelectItem value="custom">Tuỳ chọn</SelectItem>}')
  })

  /** Ô tìm chỉ khớp MÃ ĐƠN trên máy chủ — placeholder không được hứa tìm tên khách. */
  it("placeholder ô tìm nói đúng thứ nó tìm", () => {
    expect(PAGE).not.toContain('placeholder="Tìm mã đơn, tên khách, SĐT…"')
    expect(PAGE).toContain('x = x.ilike("order_code", term)')
  })

  it("dải chọn nhiều là một JSX dùng cho cả hai khổ màn, in tổng tiền đã chọn", () => {
    expect(PAGE).toContain("const bulkBar = selectedIds.size > 0 && (() => {")
    expect(PAGE.match(/\{bulkBar\}/g)?.length).toBe(2)
    expect(PAGE).toContain("Đã chọn {selectedIds.size} đơn ·")
  })
})

describe("Bảng: cột theo mẫu, số liệu thật", () => {
  it("SL MH đếm từ sales_order_lines cho đúng trang, có phân trang, chưa đếm thì '…'", () => {
    const i = PAGE.indexOf('supabase.from("sales_order_lines").select("order_id", { count: "exact" }).in("order_id", ids)')
    expect(i).toBeGreaterThan(0)
    expect(PAGE.slice(i - 400, i)).toContain("fetchAllForAggregate<")
    expect(TABLE).toContain('{lines == null ? "…" : lines}')
  })

  it("tuyến của khách lấy từ customers.channel qua bảng tên tuyến", () => {
    expect(PAGE).toContain('const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel)"')
    expect(TABLE).toContain("routeNameByCode[o.customer.channel] ?? o.customer.channel")
  })

  it("avatar NVBH: hai chữ cái cuối, màu ổn định theo tên", () => {
    expect(repAvatar("Nguyễn Thị Hòa").initials).toBe("TH")
    expect(repAvatar("Trần Tiến").initials).toBe("TT")
    expect(repAvatar(null).initials).toBe("?")
    expect(repAvatar("Nguyễn Thị Hòa").color).toBe(repAvatar("Nguyễn Thị Hòa").color)
  })

  /** ⚠ Sắp xếp là trên TRANG đang xem — nói rõ trong mã, không giả vờ sắp toàn bộ. */
  it("sắp xếp trong trang, đổi chiều khi bấm lại", () => {
    expect(TABLE).toContain("if (!sort) return orders")
    expect(PAGE).toContain('setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))')
  })

  it("nút Xuất hàng trên dòng chỉ khi đơn là phiếu tạm và người dùng có quyền", () => {
    expect(TABLE).toContain("{pending && canApprove ? (")
    expect(TABLE).toContain("onClick={() => onApprove(o)}")
  })
})

describe("Xuất hàng: MỘT hàm cho dải chọn, dòng, ngăn chi tiết", () => {
  it("approveOrders(ids) được ba nơi gọi", () => {
    expect(PAGE).toContain("const approveOrders = async (ids: string[]) => {")
    expect(PAGE).toContain("const handleBulkApprove = () => approveOrders(Array.from(selectedIds))")
    expect(PAGE.match(/onApprove=\{\(o\) => approveOrders\(\[o\.id\]\)\}/g)?.length).toBe(2)
  })

  /**
   * ⚠ XUẤT HÀNG PHẢI ĐI QUA RPC. Trừ kho, sinh công nợ và đổi trạng thái
   * là một việc; làm bằng lệnh ghi thẳng từ trình duyệt là quay về đúng
   * cảnh đơn "đã xuất" mà kho chưa trừ. Trigger ở migration 119 chặn, nên
   * lệnh ghi thẳng cũng chỉ ném lỗi USE_RPC.
   */
  it("gọi RPC complete_order, không UPDATE thẳng", () => {
    expect(PAGE).toContain("completeOrder(supabase, id)")
    expect(PAGE).toContain('from "@/lib/orders/complete-order"')
    expect(PAGE).not.toMatch(/\.update\(\{\s*status: "completed"/)
  })

  /**
   * ⚠ XUẤT THÀNH CÔNG ≠ XUẤT ĐỦ HÀNG. Khi `organizations.allow_oversell`
   * bật, `post_stock_export` KHÔNG ném lỗi lúc thiếu hàng: nó trừ hết tồn
   * có, cho tồn ÂM, đơn vẫn sang hoàn thành, công nợ vẫn sinh ĐỦ tiền, và
   * RPC trả `error = null`. Bản cũ viết `const { error } = await
   * supabase.rpc(...)` nên vứt luôn `short_qty` — màn in "Đã xuất hàng 1
   * đơn", kho đóng hàng theo phiếu, tài xế tới nơi thì thiếu, và thẻ kho
   * âm không ai biết cho tới kỳ kiểm kê.
   */
  it("đọc short_qty và near_expiry_skipped, không chỉ kiểm error", () => {
    const i = PAGE.indexOf("const approveOrders = async (ids: string[]) => {")
    const body = PAGE.slice(i, PAGE.indexOf("\n  }", i))
    expect(body, "vẫn chỉ kiểm error, vứt kết quả trả về").toContain("completeWarnings(")
    expect(body).toContain("warned.push(")
    // Và cảnh báo phải NỔI LÊN, không nằm lẫn trong toast thành công.
    expect(body).toContain("đơn xuất thiếu hàng")

    const LIB = read("src/lib/orders/complete-order.ts")
    // ⚠ `RETURNS TABLE` nên `data` là MỘT MẢNG. Đọc `data.short_qty` ra
    // undefined rồi Number(...) ra NaN — cảnh báo im lặng biến mất y như
    // cũ, nhưng lần này lại trông như đã sửa.
    expect(LIB).toContain("Array.isArray(data) ? data[0] : data")
    expect(LIB).toContain("short_qty")
    expect(LIB).toContain("near_expiry_skipped")
  })

  /**
   * ⚠ RPC của v2 RAISE với ERRCODE 'P0001', mà `errorMessage` dùng chung
   * không biết mã đó — nó in nguyên văn kỹ thuật kèm "(mã P0001)". Luồng
   * CŨ dịch đẹp nhờ `explainPostError`; nút mới không được thua nút cũ.
   */
  it("dịch mã lỗi của RPC sang tiếng Việt", () => {
    /**
     * ⚠ GỌI THẲNG HÀM, đừng soi chuỗi trong tệp. Bản đầu của chốt này chỉ
     * kiểm `LIB.toContain("INSUFFICIENT_STOCK")` — thử phá bằng cách tắt
     * hẳn nhánh dịch mà nó VẪN XANH, vì cái tên mã còn nằm trong khối chú
     * thích ở đầu tệp. Chốt nói dối thì phải sửa chốt.
     */
    expect(
      explainCompleteError('… INSUFFICIENT_STOCK: thiếu 24 đơn vị của "Sữa X"')
    ).toBe('Không đủ tồn: thiếu 24 đơn vị của "Sữa X"')
    expect(explainCompleteError("… ORDER_NOT_SUBMITTED: đơn DH-1 không ở Phiếu tạm")).toContain(
      "không còn ở Phiếu tạm"
    )
    expect(explainCompleteError("… ORG_MISMATCH")).toContain("đơn vị của bạn")
    expect(explainCompleteError("… FORBIDDEN: bạn không có quyền xuất hàng")).toBe(
      "bạn không có quyền xuất hàng"
    )
    expect(explainCompleteError("… USE_RPC: dùng nút Xuất hàng")).toContain("nút Xuất hàng")
    // Migration chưa chạy thì nói đúng việc phải làm, đừng để tưởng đơn hỏng.
    expect(
      explainCompleteError('function public.complete_order(uuid) does not exist')
    ).toContain("supabase db push")
    // ⚠ Lỗi lạ trả NGUYÊN VĂN — đoán sai rồi họ đi sửa nhầm chỗ còn tệ hơn.
    expect(explainCompleteError("một lỗi chưa ai gặp")).toBe("một lỗi chưa ai gặp")
  })

  /**
   * ⚠ Hai cột cảnh báo có ý nghĩa KHÁC NHAU và đơn vị KHÁC NHAU. Nói sai
   * một trong hai thì người đọc hoặc hoảng vô cớ, hoặc yên tâm nhầm.
   */
  it("câu cảnh báo nói đúng đơn vị và đúng mức độ", () => {
    expect(completeWarnings({ entryId: null, receivableId: null, returnId: null, shortQty: 0, nearExpirySkipped: 0 })).toBeNull()

    const thieu = completeWarnings({
      entryId: null, receivableId: null, returnId: null, shortQty: 24, nearExpirySkipped: 0,
    })
    // short_qty là ĐƠN VỊ CƠ SỞ, không phải đơn vị bán — phải nói rõ.
    expect(thieu).toContain("24 đơn vị cơ sở")
    expect(thieu).toContain("âm")

    const canHan = completeWarnings({
      entryId: null, receivableId: null, returnId: null, shortQty: 0, nearExpirySkipped: 3,
    })
    // Đây là LƯỢT LẤY LÔ, không phải số lô hết hạn — và là chuyện bình
    // thường của FIFO, nên câu chữ phải nhẹ.
    expect(canHan).toContain("3 lượt")
    expect(canHan).not.toContain("âm")
  })

  /** Mỗi đơn một giao dịch: đơn thiếu tồn không kéo cả loạt còn lại đổ theo. */
  it("mỗi đơn một lệnh gọi, đơn hỏng được kể tên", () => {
    const i = PAGE.indexOf("const approveOrders = async (ids: string[]) => {")
    const body = PAGE.slice(i, PAGE.indexOf("\n  }", i))
    expect(body).toContain("for (const id of ids)")
    expect(body).toContain("failed.push(")
  })
})

describe("Ngăn chi tiết bên phải", () => {
  it("tải dòng hàng khi mở; tải hỏng thì nói ra, không hiện 0 mặt hàng", () => {
    expect(DRAWER).toContain('.from("sales_order_lines")')
    // ⚠ Chốt này từng chỉ soi câu chữ: bỏ nhánh `if (error)` đi mà vẫn
    // xanh vì câu báo lỗi còn nguyên trong JSX. Soi cả nhánh.
    expect(DRAWER).toContain("if (error) {\n        setError(errorMessage(error))\n        return\n      }")
    expect(DRAWER).toContain("Không tải được dòng hàng — {error}")
    expect(DRAWER).toContain('{lines ? `${lines.length} mặt hàng` : "Mặt hàng"}')
  })

  it("tổng lấy từ đơn đã lưu, không cộng lại; sản phẩm đã xoá nói thẳng", () => {
    expect(DRAWER).toContain("formatCurrency(order.subtotal)")
    expect(DRAWER).toContain("formatCurrency(order.total)")
    expect(DRAWER).not.toMatch(/lines\.reduce\(/)
    expect(DRAWER).toContain("Sản phẩm đã xoá")
  })

  it("nút Duyệt / Sửa / Chi tiết gài đúng quyền", () => {
    expect(DRAWER).toContain("{pending && canApprove && (")
    expect(DRAWER).toContain("{canEdit && (")
    expect(DRAWER).toContain("isSellEditable(order.status) ? `/sell/edit/${order.id}` : `/orders/${order.id}`")
    expect(PAGE).toContain("hasUpdatePermission: hasPermission(user.role, \"orders\", \"update\"),")
  })

  it("dòng đang mở được tô nền trên bảng", () => {
    expect(PAGE).toContain("activeId={drawerId}")
    expect(TABLE).toContain('activeId === o.id ? "bg-surface-container-low"')
  })
})

describe("Dòng mô tả đầu trang: hôm nay · phiếu tạm chờ xuất", () => {
  it("tổng hôm nay đọc theo ngày VN, bỏ đơn huỷ, đọc hỏng thì không hiện số", () => {
    const i = PAGE.indexOf("async function loadTodaySummary()")
    const fn = PAGE.slice(i, PAGE.indexOf("\n    }", i))
    expect(fn).toContain('.eq("order_date", vnDateKey(new Date()))')
    expect(fn).toContain('.neq("status", "cancelled")')
    expect(fn).toContain("fetchAllForAggregate<")
    expect(PAGE).toContain("todaySummary ? `${todaySummary.count} đơn hôm nay · ${formatCurrency(todaySummary.total)}` : null")
    expect(PAGE).toContain("(statusCounts.submitted ?? 0) > 0 ? `${statusCounts.submitted} phiếu tạm chờ xuất` : null")
  })
})
