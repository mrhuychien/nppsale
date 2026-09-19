import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const ORDERS = code(read("src/app/(dashboard)/orders/page.tsx"))

/**
 * Lớp CSS của mọi thẻ `<div>` đang BỌC vị trí `at` — đi ngược lên, đếm thẻ
 * mở chưa đóng.
 *
 * ⚠ Cắt một khúc cố định phía trước rồi soi là chốt NÓI DỐI. Thử phá: bọc
 * cả khối lọc trong `hidden lg:flex` — khối bọc nằm cách hàng chip hơn 600
 * ký tự (vì ô chọn tuyến chen giữa), nên khúc cắt không với tới và chốt
 * vẫn XANH trong khi bộ lọc biến mất sạch trên điện thoại.
 */
function enclosingClasses(src: string, at: number): string[] {
  const out: string[] = []
  let depth = 0
  const re = /<div\b([^>]*)>|<\/div>/g
  const opens: Array<{ i: number; attrs: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) && m.index < at) {
    if (m[0] === "</div>") {
      opens.pop()
      depth--
    } else {
      opens.push({ i: m.index, attrs: m[1] })
      depth++
    }
  }
  for (const o of opens) {
    const c = /className="([^"]*)"/.exec(o.attrs)
    if (c) out.push(c[1])
  }
  return out
}

describe("Hai bộ lọc dùng nhiều nhất: máy tính đứng NGOÀI, điện thoại nằm TRONG sheet lọc", () => {
  /**
   * Lịch sử: trước đây chip trạng thái chỉ có trên máy tính còn tuyến thì
   * không lọc được ở đâu — nên hai bộ lọc được đưa ra ngoài. Sau đó người
   * dùng xem trên điện thoại và yêu cầu ngược lại: "toàn bộ lọc cho vào màn
   * hình lọc hiện ra khi bấm nút lọc". Hai yêu cầu không mâu thuẫn — một
   * cho máy tính, một cho điện thoại — nên chốt kiểm cả hai.
   */
  it.each([
    ["thẻ trạng thái (PipelineTabs)", '<PipelineTabs'],
    ["ô chọn tuyến (máy tính)", "<RouteFilter routes={routes} counts={routeCounts}"],
  ])("máy tính: %s đứng NGOÀI sheet lọc", (_label, needle) => {
    const i = ORDERS.indexOf(needle)
    expect(i, `không tìm thấy ${_label}`).toBeGreaterThan(0)
    // "Ngoài sheet" là ngoài khối <MobileFilterBar>…</MobileFilterBar> —
    // trước hay sau nó trong file đều được (hàng lọc desktop đứng sau).
    const sheet = ORDERS.indexOf("<MobileFilterBar")
    const end = ORDERS.indexOf("</MobileFilterBar>", sheet)
    expect(i < sheet || i > end, `${_label} đang nằm trong sheet lọc`).toBe(true)
  })

  /**
   * ⚠ HÀNG CHIP TRẠNG THÁI ĐÃ BỎ HẲN. Ba tab (`PipelineTabs`) nay đứng
   * ngoài sheet ở MỌI khổ màn và là chỗ duy nhất đổi trạng thái — giữ
   * thêm một bản trong sheet là hai chỗ cùng ghi một giá trị, và người
   * dùng bấm một chỗ rồi thấy chỗ kia không đổi theo.
   */
  it.each([
    ["ô chọn tuyến", "<RouteFilter inline routes={routes}"],
    ["bước xử lý", "{pipelineChips}"],
  ])("điện thoại: %s nằm TRONG sheet lọc", (_label, needle) => {
    const sheet = ORDERS.indexOf("<MobileFilterBar")
    const end = ORDERS.indexOf("</MobileFilterBar>", sheet)
    expect(sheet).toBeGreaterThan(0)
    const inside = ORDERS.slice(sheet, end)
    expect(inside, `${_label} không có trong sheet`).toContain(needle)
  })

  /**
   * ⚠ MỘT CHỖ DUY NHẤT ĐỔI TRẠNG THÁI. Trước đây có hai: hàng chip trong
   * sheet và thẻ `PipelineTabs`, cùng ghi vào `statusFilter`. Hàng chip
   * đã bỏ; nếu ai đó dựng lại nó thì hai bên sẽ trôi khỏi nhau.
   */
  it("chỉ còn MỘT chỗ vẽ tab, dựng từ một danh sách duy nhất", () => {
    expect(ORDERS, "hàng chip trạng thái đã quay lại").not.toContain("const statusChips = (")
    expect(ORDERS.match(/const tabKeys: readonly string\[\] =/g)?.length).toBe(1)
    expect(ORDERS.match(/tabKeys\.map\(/g)?.length).toBe(1)
    expect(ORDERS.match(/<PipelineTabs/g)?.length).toBe(1)
    expect(ORDERS.match(/count: statusCounts\[k\] \?\? 0/g)?.length).toBe(1)
  })

  /**
   * ⚠ BA TAB CỦA NVBH LÀ ĐIỀU HƯỚNG, KHÔNG PHẢI BỘ LỌC — nên chúng là
   * ngoại lệ DUY NHẤT của quy tắc "điện thoại thì mọi bộ lọc vào sheet".
   * Màn "Đơn của tôi" mở ra ở tab Phiếu tạm; nhét tab vào sheet là NVBH
   * không còn đường nào sang Hoàn thành / Đã huỷ, tức là một ngõ cụt.
   */
  it("ba tab đứng NGOÀI sheet và hiện ở mọi khổ màn", () => {
    const i = ORDERS.indexOf("<PipelineTabs")
    expect(i).toBeGreaterThan(0)
    const sheet = ORDERS.indexOf("<MobileFilterBar")
    const end = ORDERS.indexOf("</MobileFilterBar>", sheet)
    expect(i < sheet || i > end, "PipelineTabs đang nằm trong sheet lọc").toBe(true)
    /**
     * ⚠ KHÔNG `hidden lg:grid`. Giấu tab trên điện thoại là màn mở ra ở
     * tab Phiếu tạm và KẸT ở đó — không có đường nào sang Hoàn thành hay
     * Đã huỷ, vì hàng chip trong sheet đã bỏ.
     */
    expect(ORDERS).toContain('className="grid"')
    expect(ORDERS, "tab lại bị giấu trên điện thoại").not.toContain('"hidden lg:grid"')
    // Và sheet không được vẽ lại một bản trạng thái nào nữa.
    expect(ORDERS.slice(sheet, end)).not.toContain("statusChips")
  })

  /**
   * ⚠ Bộ lọc nằm trong sheet thì con số trên nút Lọc PHẢI đếm nó — đang
   * lọc "Đã duyệt" mà nút báo 0 là người dùng không hiểu vì sao thiếu đơn.
   * Và "Xoá lọc" phải xoá cả ba.
   */
  it("nút Lọc đếm cả trạng thái / tuyến / bước xử lý, Xoá lọc xoá cả ba", () => {
    const i = ORDERS.indexOf("const activeFilterCount =")
    const cnt = ORDERS.slice(i, ORDERS.indexOf("const clearAdvancedFilters", i))
    /**
     * ⚠ NVBH đo "đang lọc" theo một mốc khác: tab mặc định của họ là Phiếu
     * tạm, không phải "Tất cả". Đếm theo mốc cũ thì màn vừa mở đã báo
     * "đang lọc 1" và mọc ra nút Xoá lọc cho một thứ không ai đặt.
     */
    expect(cnt).toContain("(statusIsFiltered ? 1 : 0)")
    expect(ORDERS).toContain('const statusIsFiltered = effectiveStatus !== "submitted"')
    expect(cnt).toContain('(routeFilter !== "all" ? 1 : 0)')
    expect(cnt).toContain("(pipelineStep ? 1 : 0)")
    const j = ORDERS.indexOf("const clearAdvancedFilters = () => {")
    const clr = ORDERS.slice(j, ORDERS.indexOf("\n  }", j))
    expect(clr).toContain('setRouteFilter("all"); setPipelineStep(null)')
    /**
     * ⚠ "XOÁ LỌC" KHÔNG ĐƯỢC ĐỤNG TỚI TAB. Đặt `statusFilter` về "all" ở
     * đây thì nó bị quy ngược về "submitted" ngay sau đó — tức nút này
     * âm thầm ném người dùng từ tab họ đang đứng về tab Phiếu tạm, trong
     * khi họ chỉ muốn bỏ bộ lọc tuyến hay khoảng ngày.
     */
    expect(clr, "Xoá lọc đang đổi cả tab").not.toContain("setStatusFilter(")
  })

  /** Chưa khai tuyến nào thì đừng hiện một ô chọn rỗng. */
  it("chưa có tuyến thì không hiện ô chọn", () => {
    expect(ORDERS.match(/\{routes\.length > 0 && \(/g)?.length).toBe(2)
  })

  /**
   * NGƯỜI DÙNG YÊU CẦU (máy tính): bộ lọc tuyến "cho xuống cạnh Tìm mã đơn
   * hàng". Bản desktop phải nằm TRONG hàng lọc desktop, ngay sau ô tìm.
   */
  it("máy tính: bộ lọc tuyến đứng cạnh ô tìm mã đơn", () => {
    const row = ORDERS.indexOf('<div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3">')
    const search = ORDERS.indexOf('placeholder="Tìm mã đơn hàng…"', row)
    const route = ORDERS.indexOf("<RouteFilter routes={routes}", search)
    const advanced = ORDERS.indexOf("Bộ lọc nâng cao", search)
    expect(row).toBeGreaterThan(0)
    expect(search).toBeGreaterThan(row)
    expect(route, "bộ lọc tuyến không nằm sau ô tìm").toBeGreaterThan(search)
    expect(route, "bộ lọc tuyến phải đứng trước nút Bộ lọc nâng cao").toBeLessThan(advanced)
  })
})

describe("Lọc theo tuyến bán hàng", () => {
  /**
   * ⚠ Tuyến của đơn = tuyến của ĐIỂM BÁN, và nó nằm ở `customers.channel`
   * (cột lưu MÃ tuyến — xem migration 018). Lọc nhầm sang `sales_routes.id`
   * thì không đơn nào khớp và danh sách rỗng trong im lặng.
   */
  it("lọc theo mã tuyến trên bảng khách hàng", () => {
    expect(ORDERS).toContain('x.eq("customer.channel", routeFilter)')
    expect(ORDERS).toContain('.from("sales_routes")')
    expect(ORDERS).toContain('.select("code, name")')
  })

  /**
   * ⚠ Lọc trên bảng NHÚNG thì phần nhúng phải là `!inner`. Thiếu nó thì
   * PostgREST vẫn trả đơn về nhưng bỏ TRỐNG phần khách — danh sách đầy
   * dòng "—" trông như dữ liệu hỏng, chứ không phải như một bộ lọc.
   */
  it("bật !inner khi lọc tuyến", () => {
    expect(ORDERS).toContain('const CUSTOMER_EMBED_INNER = "customer:customers!inner(store_name, phone, channel, ward, address)"')
    expect(ORDERS).toContain(
      "const cust = routeFilter !== \"all\" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED"
    )
  })

  /**
   * ⚠ Và CHỈ khi đang lọc. Bật `!inner` luôn thì đơn nào chưa gắn khách sẽ
   * biến mất khỏi danh sách mà không ai biết vì sao.
   */
  it("không lọc thì giữ nguyên phép nối cũ", () => {
    expect(ORDERS).toContain('const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel, ward, address)"')
  })

  /** Đổi bộ lọc mà không tải lại là bộ lọc không có tác dụng. */
  it("đổi tuyến thì tải lại danh sách và về trang 1", () => {
    const deps = ORDERS.match(/\}, \[pg\.from, pg\.to, debouncedSearch, effectiveStatus, routeFilter/)
    expect(deps, "truy vấn danh sách không theo dõi routeFilter").toBeTruthy()
    expect(ORDERS).toMatch(/pg\.reset\(\)[\s\S]{0,200}?routeFilter/)
  })
})

describe("Con số trên chip phải khớp danh sách bên dưới nó", () => {
  /**
   * ⚠ Phép đếm trước đây chạy MỘT lần lúc mở trang và bỏ qua mọi bộ lọc
   * khác. Lọc theo tuyến rồi thì chip ghi "Đã giao 120" trong khi danh sách
   * dưới nó chỉ có 7 dòng — và người dùng tin con số. Con số phải trả lời
   * đúng một câu: bấm vào đây thì thấy bao nhiêu đơn.
   */
  it("phép đếm ăn theo cùng bộ lọc với danh sách", () => {
    expect(ORDERS).toContain("applyCommonFilters(")
    expect(ORDERS).toContain("COUNTED_STATUSES.map((st) => applyStatusFilter(base(), st))")
    // Đếm phải chạy lại khi bất kỳ bộ lọc chung nào đổi.
    expect(ORDERS).toMatch(
      /\}, \[debouncedSearch, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax\]/
    )
  })

  /** Một nơi khai duy nhất thì không có chỗ để hai bên lệch nhau. */
  it("danh sách và phép đếm dùng chung một hàm lọc", () => {
    /**
     * ⚠ TRUY VẤN PHẢI DÙNG `effectiveStatus`, KHÔNG PHẢI `statusFilter`.
     * NVBH không có tab "Tất cả", nên giá trị thô còn nằm ở "all" cho tới
     * khi họ chạm một tab — lấy giá trị thô đi lọc là màn vừa mở đã liệt
     * kê cả nháp lẫn đơn huỷ, đúng cái ba tab sinh ra để tránh.
     */
    expect(ORDERS).toContain("return applyStatusFilter(applyCommonFilters(q), effectiveStatus)")
    /**
     * ⚠ BA NƠI, KHÔNG PHẢI HAI: danh sách · phép đếm của chip · phép
     * CỘNG TIỀN của dải tóm tắt trên điện thoại (mẫu mới). Cả ba phải
     * đi qua cùng một hàm lọc, nếu không dải tổng cộng trên một tập còn
     * danh sách hiện một tập khác — hai con số cạnh nhau, không khớp,
     * không ai giải thích được.
     */
    const uses = ORDERS.match(/applyCommonFilters\(/g) ?? []
    expect(uses.length, "phải gọi ở danh sách, phép đếm và phép cộng tiền").toBe(3)
  })

  /**
   * ⚠ Muốn lọc trên bảng nhúng thì bảng nhúng PHẢI có mặt trong câu select,
   * kể cả khi đếm bằng `head: true` — không có thì PostgREST trả lỗi
   * "column customer.channel does not exist" và mọi chip về 0.
   */
  it("phép đếm khi lọc tuyến có nhúng bảng khách", () => {
    expect(ORDERS).toContain('const COUNT_SELECT_WITH_ROUTE = "id, customer:customers!inner(id)"')
    expect(ORDERS).toContain(
      'routeFilter !== "all" ? COUNT_SELECT_WITH_ROUTE : "id"'
    )
  })

  /**
   * ⚠ Đếm hỏng thì mọi chip hiện 0 — trông y hệt "chưa có đơn nào", và
   * người dùng kết luận tuyến này chưa ai đặt hàng. Kiểm CẢ phép đếm tổng:
   * bỏ sót nó thì chip "Tất cả" về 0 trong im lặng.
   */
  it("đếm hỏng thì ghi log, không im lặng", () => {
    expect(ORDERS).toContain("const countErr = [total, ...resps].find((r) => r?.error)?.error")
    expect(ORDERS).toContain("đếm theo trạng thái lỗi:")
  })
})
