import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repAvatar } from "../src/components/orders/desktop-order-table"
import { explainInvoiceError, invoiceWarnings, type PostInvoiceResult } from "../src/lib/orders/post-invoice"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = code(read("src/app/(dashboard)/orders/page.tsx"))
const TABS = code(read("src/components/ui/status-chips.tsx"))
const TABLE = code(read("src/components/orders/desktop-order-table.tsx"))
const DRAWER = code(read("src/components/orders/order-drawer.tsx"))

/**
 * Màn "Đơn hàng" trên MÁY TÍNH theo mẫu claude.ai/artifact/N59JiSWXwcUd4ReoTRZC9m:
 * thẻ trạng thái có số to, một thẻ bảng gồm thanh công cụ + dải chọn nhiều +
 * bảng + phân trang, và ngăn chi tiết bên phải khi chạm một dòng.
 */
describe("Thẻ trạng thái (StatusChips) — cùng số với bảng bên dưới", () => {
  it("dựng từ COUNTED_STATUSES với số đếm từ máy chủ, vạch màu theo orderTone", () => {
    const i = PAGE.indexOf("<StatusChips")
    const block = PAGE.slice(i, PAGE.indexOf("/>", i))
    expect(block).toContain("tabKeys.map(")
    expect(block).toContain("count: statusCounts[k] ?? 0")
    expect(block).toContain("orderTone(")
    // Chọn thẻ thì buông bước pipeline — hai bộ lọc loại trừ nhau.
    expect(block).toContain("setPipelineStep(null)")
  })

  /**
   * ⚠ DẢI THỐNG KÊ NAY LÀ MỘT HÀNG VIÊN THUỐC, KHÔNG KHUNG (chủ nhà chốt
   * 20/09/2026: "cho về đơn giản dễ nhìn thôi, không cần làm khung như
   * cũ nữa"). Bản cũ là thẻ có viền chia ô đều nhau — và chính cái lưới
   * chia đều ấy ĐẶT TRẦN cho số ô: bốn ô đã phải thu đệm cho vừa màn
   * 375px, nên `partially_invoiced` không có ô nào và đơn xuất một phần
   * biến mất khỏi màn hình. Hàng cuộn ngang thì không có trần.
   */
  it("viên thuốc cuộn ngang, hiện ở mọi khổ màn", () => {
    expect(PAGE, "dải bị giấu trên điện thoại").not.toContain('"hidden lg:grid"')
    expect(PAGE).not.toContain('"hidden lg:flex"> <StatusChips')
    // ⚠ Gộp khoảng trắng: Prettier ngắt dòng biểu thức ba ngôi, và một
    //   luật dò bám vào dấu cách sẽ không khớp nữa — chốt hoá xanh vì
    //   không tìm thấy gì để kiểm.
    const flat = TABS.replace(/\s+/g, " ")
    expect(flat).toContain("overflow-x-auto")
    // Không co lại, không xuống dòng — dải dài thì cuộn, không gãy.
    expect(flat).toContain("shrink-0")
    expect(flat).toContain("aria-selected={on}")
    // Viên đang chọn tô đậm; chấm màu giữ lại ngôn ngữ màu của orderTone.
    expect(flat).toContain('on ? "bg-on-surface text-surface"')
    expect(flat).toContain("background: c.accent")
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
  /**
   * ⚠ MỘT TRUY VẤN NUÔI HAI MÀN. Cùng câu đọc dòng hàng này vừa đếm cho
   * cột "SL MH" của bảng máy tính, vừa dựng "mặt hàng chính" cho thẻ
   * điện thoại (mẫu mới). Tách ra hai câu là hai lần kéo cùng một dữ
   * liệu về trên 3G ở quầy khách.
   */
  it("SL MH đếm từ sales_order_lines cho đúng trang, có phân trang, chưa đếm thì '…'", () => {
    const i = PAGE.indexOf('.from("sales_order_lines")')
    expect(i).toBeGreaterThan(0)
    const q = PAGE.slice(i, i + 320)
    expect(q).toContain('.in("order_id", ids)')
    expect(q).toContain('count: "exact"')
    expect(q).toContain(".range(from, to)")
    expect(PAGE.slice(i - 700, i)).toContain("fetchAllForAggregate<")
    expect(TABLE).toContain('{lines == null ? "…" : lines}')
    // Và câu ấy phải kéo đủ thứ thẻ điện thoại cần.
    expect(q).toContain("line_total")
    expect(q).toContain("product:products(name)")
  })

  it("tuyến của khách lấy từ customers.channel qua bảng tên tuyến", () => {
    expect(PAGE).toContain('const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel, ward, address)"')
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
  /**
   * ⚠ V2B TÁCH LÀM HAI ĐƯỜNG. `approveOrders` nay chỉ phục vụ THANH CHỌN
   * NHIỀU và xuất đủ phần còn lại; nút trên từng dòng và ngăn chi tiết đi
   * sang MÀN SOẠN để sửa số lượng / giá. Một hàm cho cả ba như bản v2 thì
   * hoặc bắt mở mười màn soạn cho mười đơn, hoặc mất hẳn chỗ sửa.
   */
  it("một hàm cho loạt nhiều đơn, một đường sang màn soạn", () => {
    expect(PAGE).toContain("const approveOrders = async (ids: string[]) => {")
    expect(PAGE).toContain("const handleBulkApprove = () => approveOrders(Array.from(selectedIds))")
    // ⚠ Sang tab MỚI từ 20/09/2026 — xem `openInNewTab`.
    expect(PAGE.match(/onApprove=\{\(o\) => openInNewTab\(`\/sales-invoices\/new\?order=\$\{o\.id\}`\)\}/g)?.length).toBe(2)
  })

  /**
   * ⚠ XUẤT HÀNG PHẢI ĐI QUA RPC. Trừ kho, dựng hóa đơn, sinh công nợ và
   * đổi trạng thái là một việc; làm bằng lệnh ghi thẳng từ trình duyệt là
   * quay về đúng cảnh đơn "đã xuất" mà kho chưa trừ. Trigger ở migration
   * 124 chặn, nên lệnh ghi thẳng cũng chỉ ném lỗi USE_RPC.
   */
  it("gọi RPC post_invoice, không UPDATE thẳng", () => {
    expect(PAGE).toContain("postInvoice(supabase, {")
    expect(PAGE).toContain('from "@/lib/orders/post-invoice"')
    expect(PAGE).not.toMatch(/\.update\(\{\s*status: "completed"/)
    expect(PAGE).not.toMatch(/\.update\(\{\s*status: "partially_invoiced"/)
  })

  /**
   * ⚠ HỎI RPC XEM CÒN GÌ CHƯA XUẤT, không dựng dòng từ state của trang.
   * Trang có thể đang giữ bản chụp cũ vài phút; đơn đã xuất một phần ở
   * máy khác thì dựng lại từ state là xuất chồng lên phần đã giao — và
   * không lệnh nào báo, vì `post_invoice` cho phép xuất vượt số đặt.
   */
  it("loạt xuất hàng hỏi lại phần còn lại trước khi ghi", () => {
    const i = PAGE.indexOf("const approveOrders = async (ids: string[]) => {")
    const body = PAGE.slice(i, PAGE.indexOf("\n  }", i))
    expect(body).toContain("loadInvoiceableLines(supabase, id)")
    expect(body).toContain("l.remainingQty > 0")
  })

  /**
   * ⚠ TRẠNG THÁI MỚI LẤY TỪ RPC, KHÔNG ĐOÁN "completed". Đơn xuất thiếu
   * một dòng sẽ về `partially_invoiced`; vá state thành "completed" là
   * màn hình nói đơn đã giao đủ trong khi còn hàng nằm lại, rồi không ai
   * bấm Xuất tiếp nữa.
   */
  it("vá trạng thái theo order_status mà RPC trả về", () => {
    expect(PAGE).toContain("newStatus.set(id, r.orderStatus ?? \"completed\")")
    expect(PAGE).toContain("newStatus.get(o.id) ?? \"completed\"")
  })

  /**
   * ⚠ HAI ĐƯỜNG XUẤT HÀNG, CÓ CHỦ Ý. Loạt nhiều đơn xuất đủ phần còn lại
   * và không hỏi gì; muốn sửa số lượng hay giá thì bấm trên ĐÚNG một
   * dòng, và đường đó sang màn soạn. Gộp làm một là hoặc bắt mở mười màn
   * soạn cho mười đơn, hoặc mất hẳn chỗ sửa.
   */
  it("nút trên từng dòng sang màn soạn (tab mới), không xuất thẳng", () => {
    expect(PAGE).toContain("onApprove={(o) => openInNewTab(`/sales-invoices/new?order=${o.id}`)}")
    expect(PAGE).not.toContain("onApprove={(o) => approveOrders([o.id])}")
    // Hộp thoại cũ đã gỡ — để sót là hai màn soạn song song.
    expect(PAGE).not.toContain("<InvoiceDialog")
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
    expect(body, "vẫn chỉ kiểm error, vứt kết quả trả về").toContain("invoiceWarnings(")
    expect(body).toContain("warned.push(")
    // Và cảnh báo phải NỔI LÊN, không nằm lẫn trong toast thành công.
    expect(body).toContain("đơn xuất thiếu hàng")

    const LIB = read("src/lib/orders/post-invoice.ts")
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
      explainInvoiceError('… INSUFFICIENT_STOCK: thiếu 24 đơn vị của "Sữa X"')
    ).toBe('Không đủ tồn: thiếu 24 đơn vị của "Sữa X"')
    expect(
      explainInvoiceError("… ORDER_NOT_INVOICEABLE: đơn DH-1 đang ở trạng thái closed")
    ).toContain("không còn xuất hàng được")
    expect(explainInvoiceError("… ORG_MISMATCH")).toContain("đơn vị của bạn")
    expect(explainInvoiceError("… FORBIDDEN: bạn không có quyền xuất hàng")).toBe(
      "bạn không có quyền xuất hàng"
    )
    expect(explainInvoiceError("… USE_RPC: dùng nút Xuất hàng")).toContain("nút Xuất hàng")
    // Migration chưa chạy thì nói đúng việc phải làm, đừng để tưởng đơn hỏng.
    expect(
      explainInvoiceError('function public.post_invoice(jsonb) does not exist')
    ).toContain("supabase db push")
    // ⚠ Lỗi lạ trả NGUYÊN VĂN — đoán sai rồi họ đi sửa nhầm chỗ còn tệ hơn.
    expect(explainInvoiceError("một lỗi chưa ai gặp")).toBe("một lỗi chưa ai gặp")
  })

  /**
   * ⚠ Hai cột cảnh báo có ý nghĩa KHÁC NHAU và đơn vị KHÁC NHAU. Nói sai
   * một trong hai thì người đọc hoặc hoảng vô cớ, hoặc yên tâm nhầm.
   */
  it("câu cảnh báo nói đúng đơn vị và đúng mức độ", () => {
    const warnArg = (over: Partial<PostInvoiceResult>): PostInvoiceResult => ({
      invoiceId: null, invoiceCode: null, entryId: null, receivableId: null,
      shortQty: 0, nearExpirySkipped: 0, orderStatus: null, ...over,
    })
    expect(invoiceWarnings(warnArg({}))).toBeNull()

    const thieu = invoiceWarnings(warnArg({
      shortQty: 24,
    }))
    // short_qty là ĐƠN VỊ CƠ SỞ, không phải đơn vị bán — phải nói rõ.
    expect(thieu).toContain("24 đơn vị cơ sở")
    expect(thieu).toContain("âm")

    const canHan = invoiceWarnings(warnArg({
      nearExpirySkipped: 3,
    }))
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
