import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { isAbortError } from "@/lib/supabase/resilient"

/**
 * Pack M2 — khuôn danh sách chung cho mobile.
 *
 * Test đọc mã nguồn (dự án chưa có hạ tầng test component), trừ phần
 * isAbortError là hàm thuần nên gọi thẳng.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/**
 * Bỏ chú thích trước khi soi mã. Chú thích nhắc tên một lớp CSS làm test
 * xanh oan — đã dính bốn lần.
 *
 * KHÔNG có luật riêng cho `{/* … *\/}`: luật đó là `\{ … \*\/\s*\}`, mà
 * `interface X {` mở ngoặc rồi tới một khối `/** … *\/` sẽ khiến nó chạy
 * tiếp tới `*\/}` xa tít phía dưới. Đo trên handover/page.tsx: nuốt mất
 * 19.294 ký tự (39% file) — mọi assert trong vùng đó xanh vì KHÔNG CÒN
 * GÌ ĐỂ SAI. Xoá `/* … *\/` trước là đủ; cặp `{ }` rỗng còn lại vô hại.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

const FILTER_BAR = read("src/components/ui/mobile-filter-bar.tsx")
const SCROLLER = read("src/components/ui/segmented-scroller.tsx")
const LOAD_MORE = read("src/components/ui/load-more.tsx")
const CARD = read("src/components/ui/mobile-record-card.tsx")
const PIPELINE = read("src/components/orders/order-pipeline.tsx")
const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
const ORDERS_CODE = strip(ORDERS)
const RESILIENT = read("src/lib/supabase/resilient.ts")
const CUSTOMERS = strip(read("src/app/(dashboard)/customers/page.tsx"))
const RECEIVABLES = strip(read("src/app/(dashboard)/receivables/page.tsx"))
const DELIVERIES = strip(read("src/app/(dashboard)/deliveries/page.tsx"))

describe("M2.1 — MobileFilterBar", () => {
  /**
   * Giấu bộ lọc vào sheet mà không hiện số đang bật là giấu mất TRẠNG
   * THÁI: người dùng thấy danh sách ngắn bất thường và không biết vì sao.
   */
  it("hiện badge số bộ lọc đang bật", () => {
    // Phải kiểm chính CON SỐ hiện ra, không chỉ kiểm điều kiện: aria-label
    // cũng dùng `activeCount > 0`, nên xoá hẳn badge mà chỉ kiểm điều kiện
    // thì test vẫn xanh (đã đo).
    const i = FILTER_BAR.indexOf("<SlidersHorizontal")
    expect(i).toBeGreaterThan(0)
    const btn = FILTER_BAR.slice(i, FILTER_BAR.indexOf("</Button>", i))
    expect(btn, "không render con số lên nút Lọc").toContain("{activeCount}")
    expect(btn).toContain("rounded-full")
    // Và nhãn cho trình đọc màn hình cũng phải nói ra con số.
    expect(FILTER_BAR).toMatch(/aria-label=\{activeCount > 0 \? `Bộ lọc \(\$\{activeCount\} đang bật\)`/)
  })

  /**
   * ⚠ iOS tự PHÓNG TO trang khi focus vào ô nhập có font nhỏ hơn 16px, và
   * không tự thu lại — người dùng kẹt ở trạng thái phóng to.
   */
  it("ô tìm dùng text-base (16px)", () => {
    const i = FILTER_BAR.indexOf("<input")
    expect(i).toBeGreaterThan(0)
    const input = FILTER_BAR.slice(i, FILTER_BAR.indexOf("/>", i))
    expect(input).toContain("text-base")
    expect(input).not.toMatch(/text-(xs|sm)\b/)
  })

  it("bàn phím ảo hiện nút Tìm", () => {
    expect(FILTER_BAR).toContain('enterKeyHint="search"')
    expect(FILTER_BAR).toContain('inputMode="search"')
  })

  /** Thanh dính phải neo theo token, không phải một con số cứng. */
  it("neo dưới app bar bằng token, không hardcode", () => {
    expect(FILTER_BAR).toContain("top-below-appbar")
    expect(FILTER_BAR).not.toMatch(/sticky[^"]*top-\d/)
  })

  it("nút xoá tìm kiếm và nút lọc đều đủ 44px", () => {
    expect(FILTER_BAR).toMatch(/aria-label="Xoá tìm kiếm"[\s\S]{0,200}?tap/)
    expect(FILTER_BAR).toMatch(/className="tap relative shrink-0 px-3"/)
  })
})

describe("M2.1 — SegmentedScroller", () => {
  /**
   * Chọn một chip ở cuối dãy rồi tải lại trang: chip đó nằm ngoài màn hình
   * và người dùng không thấy bộ lọc nào đang bật.
   */
  it("tự cuộn chip đang chọn vào giữa", () => {
    expect(SCROLLER).toContain('scrollIntoView({ inline: "center"')
    expect(SCROLLER).toMatch(/\}, \[value\]\)/)
  })

  /** Bấm lại chip đang chọn = bỏ chọn, không cần đi tìm chip "Tất cả". */
  it("bấm lại chip đang chọn thì bỏ chọn", () => {
    expect(SCROLLER).toContain("onChange(active ? null : s.key)")
  })

  it("có aria-pressed cho trình đọc màn hình", () => {
    expect(SCROLLER).toContain("aria-pressed={active}")
  })

  /** shrink-0: thiếu nó thì chip bị bóp lại thay vì cuộn ngang. */
  it("chip không bị bóp, hàng cuộn ngang", () => {
    expect(SCROLLER).toContain("shrink-0")
    expect(SCROLLER).toContain("row-scroll")
  })
})

describe("M2.1 — LoadMore", () => {
  /**
   * ⚠ `shown` phải là số dòng THẬT trả về, không phải pageSize: trang cuối
   * trả ít hơn pageSize, lấy pageSize thì nút "Tải thêm" không bao giờ tắt
   * và người dùng bấm mãi không hết.
   */
  it("tính đã tải từ số dòng thật", () => {
    expect(LOAD_MORE).toContain("const loaded = pg.from + shown")
    expect(LOAD_MORE).toContain("const done = loaded >= pg.total")
  })

  it("hết dòng thì ẩn nút", () => {
    expect(LOAD_MORE).toContain("{!done && (")
  })

  /** use-pagination phục vụ cả desktop — không được sửa để chiều mobile. */
  it("không đụng use-pagination", () => {
    const hook = read("src/hooks/use-pagination.ts")
    expect(hook).not.toContain("loadMore")
    expect(hook).not.toContain("append")
  })
})

describe("M2.1 — MobileRecordCard", () => {
  /** Tiền là thứ NVBH quét mắt tìm — phải ở dòng đầu, bên phải. */
  it("tiền nằm cùng dòng với tiêu đề", () => {
    const i = CARD.indexOf("const body = (")
    const body = CARD.slice(i, CARD.indexOf("const cls", i))
    const titleAt = body.indexOf("{title}")
    const amountAt = body.indexOf("{amount}")
    expect(titleAt).toBeGreaterThan(0)
    expect(amountAt).toBeGreaterThan(titleAt)
    // Cùng một hàng flex, không phải hai khối rời.
    expect(body.slice(0, titleAt)).toContain("flex items-start justify-between")
  })

  /**
   * ⚠ Nút hành động nằm TRONG vùng chạm chính thì bấm nút cũng mở luôn bản
   * ghi, và người dùng không hiểu vì sao.
   */
  it("footer nằm ngoài link/nút chính", () => {
    const i = CARD.indexOf("return (\n    <div")
    const ret = CARD.slice(i)
    // footer render SAU khi đóng thẻ Link/button.
    expect(ret).toMatch(/<\/Link>[\s\S]{0,200}?\{footer &&/)
  })

  /**
   * ⚠ Bộ đếm nhấn giữ phải nằm trong ref. Là biến cục bộ thì mỗi lần render
   * là một biến mới — onTouchEnd của render sau không huỷ được bộ đếm do
   * onTouchStart của render trước đặt, và thao tác nổ dù ngón tay đã rời.
   */
  it("nhấn giữ dùng ref, không dùng biến cục bộ", () => {
    expect(CARD).toContain("const timer = React.useRef")
    expect(CARD).not.toMatch(/^\s*let timer/m)
  })

  /** Huỷ khi ngón tay DI CHUYỂN — không thì cuộn danh sách cũng kích hoạt. */
  it("nhấn giữ huỷ khi cuộn", () => {
    expect(CARD).toContain("onTouchMove: clear")
    expect(CARD).toContain("onTouchCancel: clear")
  })

  /** Nhấn giữ đã nổ thì cú chạm đó không được mở bản ghi nữa. */
  it("nhấn giữ nổ rồi thì chặn click mở bản ghi", () => {
    expect(CARD).toMatch(/if \(fired\.current\)[\s\S]{0,80}?preventDefault\(\)/)
  })

  /** Dọn bộ đếm khi thẻ bị gỡ — cuộn danh sách dài là gỡ hàng chục thẻ. */
  it("dọn bộ đếm khi gỡ thẻ", () => {
    expect(CARD).toContain("React.useEffect(() => clear, [clear])")
  })
})

describe("M2.2 — /orders", () => {
  /**
   * ⚠ `STEPS` và `StepDef` phải export, nếu không file khác import sẽ
   * không build.
   */
  it("STEPS và StepDef đã export", () => {
    expect(PIPELINE).toContain("export const STEPS")
    expect(PIPELINE).toContain("export interface StepDef")
  })

  /**
   * ⚠ `sticky top-14` = 56px trong khi app bar cao 64px → dãy pipeline bị
   * header đè mất 8px. Nay neo theo token.
   */
  it("không còn sticky top-14", () => {
    expect(strip(PIPELINE)).not.toContain("top-14")
    expect(PIPELINE).toContain("top-below-appbar")
  })

  /** Chỉ lớp trình bày đổi — phân loại đơn có ý nghĩa nghiệp vụ. */
  it("classifyOrder không bị đụng", () => {
    expect(PIPELINE).toContain("export function classifyOrder")
    const i = PIPELINE.indexOf("export function classifyOrder")
    const fn = PIPELINE.slice(i, PIPELINE.indexOf("\n}", i))
    expect(fn).not.toContain("SegmentedScroller")
  })

  /** Một hàng chip, không phải hai: chip trạng thái gộp vào pipeline. */
  it("chip trạng thái đặc biệt chỉ còn ở desktop", () => {
    expect(ORDERS_CODE).toContain('<div className="hidden lg:flex flex-wrap gap-2">')
    expect(ORDERS_CODE).toContain("extra={{")
    expect(ORDERS_CODE).toContain('key: "pending_approval"')
  })

  /**
   * ⚠ Một hàng chip phục vụ HAI bộ lọc loại trừ nhau — phải định tuyến
   * theo khoá, chọn bước pipeline thì xoá lọc trạng thái và ngược lại.
   */
  it("hai bộ lọc không đánh nhau", () => {
    const p = strip(PIPELINE)
    expect(p).toContain("stepKeys.has(k)")
    expect(ORDERS_CODE).toMatch(/onChange: \(k\) => \{[\s\S]{0,200}?setPipelineStep\(null\)/)
  })

  /**
   * Banner phạm vi dữ liệu là thông tin MỘT LẦN. Đọc localStorage ngay lúc
   * render đầu làm HTML máy chủ khác máy khách (lỗi hydrate #418) — phải
   * khởi tạo false rồi bật trong effect.
   */
  it("banner nhớ đã đọc, và không gây lỗi hydrate", () => {
    expect(ORDERS_CODE).toContain('const SCOPE_HINT_KEY = "npp.hint.orders-scope"')
    expect(ORDERS_CODE).toContain("useState(false)")
    expect(ORDERS_CODE).toMatch(/useEffect\(\(\) => \{[\s\S]{0,300}?localStorage\.getItem\(SCOPE_HINT_KEY\)/)
    expect(ORDERS_CODE).toContain("dismissScopeHint")
  })

  /** localStorage ném lỗi ở chế độ riêng tư — không được làm trắng trang. */
  it("localStorage hỏng thì vẫn chạy", () => {
    const i = ORDERS_CODE.indexOf("localStorage.getItem(SCOPE_HINT_KEY)")
    expect(ORDERS_CODE.slice(i, i + 300)).toContain("catch")
    const j = ORDERS_CODE.indexOf("localStorage.setItem(SCOPE_HINT_KEY")
    expect(ORDERS_CODE.slice(j - 60, j + 120)).toContain("catch")
  })

  /**
   * ⚠ Chỗ xoá được ~51 vùng chạm 16px: bỏ checkbox trên từng thẻ, thay
   * bằng chế độ chọn.
   */
  it("không còn checkbox trên thẻ mobile", () => {
    // Neo bằng MÃ THẬT, không bằng chú thích: `strip()` đã bỏ chú thích
    // nên neo vào đó cho ra lát cắt rỗng và test luôn xanh.
    const i = ORDERS_CODE.indexOf('<div className="lg:hidden space-y-3">')
    expect(i).toBeGreaterThan(0)
    const j = ORDERS_CODE.indexOf("<LoadMore", i)
    expect(j).toBeGreaterThan(i)
    const block = ORDERS_CODE.slice(i, j)
    expect(block).not.toContain("<Checkbox")
    expect(block).toContain("selectMode")
  })

  it("chế độ chọn: tắt thì mở đơn, bật thì chọn", () => {
    expect(ORDERS_CODE).toContain("onSelect={selectMode ? () => toggleOne(order.id) : undefined}")
    expect(ORDERS_CODE).toContain("onLongPress")
  })

  /** Nút xuất hoá đơn chỉ khi ĐÃ GIAO — mời bấm rồi báo lỗi là tệ hơn. */
  it("nút xuất hoá đơn chỉ hiện khi đã giao", () => {
    expect(ORDERS_CODE).toContain('const showInvoiceAction = order.status === "delivered"')
    expect(ORDERS_CODE).toMatch(/showInvoiceAction && !selectMode \?/)
  })

  it("phân trang desktop ẩn trên mobile, thay bằng LoadMore", () => {
    expect(ORDERS_CODE).toMatch(/hidden lg:block[\s\S]{0,120}?<DataPagination/)
    expect(ORDERS_CODE).toContain("<LoadMore pg={pg} shown={filtered.length} />")
  })

  /** Bộ lọc nâng cao dùng CHUNG cho thẻ desktop và sheet mobile. */
  it("ô lọc nâng cao không bị nhân đôi JSX", () => {
    expect(ORDERS_CODE).toContain("const advancedFilterFields = (")
    expect(ORDERS_CODE.match(/\{advancedFilterFields\}/g)?.length).toBe(2)
  })
})

describe("⚠ AbortError không phải lỗi để ném vào mặt người dùng", () => {
  /**
   * Điều hướng nhanh làm request bị huỷ. Trước đây selectResilient biến nó
   * thành `error: "signal is aborted without reason"` → thẻ đỏ, và mảng
   * rỗng ghi đè lên danh sách đang hiện.
   */
  it("nhận ra lỗi huỷ theo cả name lẫn message", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true)
    expect(isAbortError(new Error("signal is aborted without reason"))).toBe(true)
    expect(isAbortError(new Error("Lỗi kết nối"))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError("aborted")).toBe(false)
  })

  it("selectResilient trả cờ aborted thay vì lỗi", () => {
    expect(RESILIENT).toContain("aborted?: boolean")
    expect(RESILIENT).toMatch(/if \(isAbortError\(err\)\)[\s\S]{0,160}?aborted: true/)
  })

  /** Trang gọi phải return sớm — không thì vẫn ghi mảng rỗng đè danh sách. */
  it("/orders bỏ qua kết quả bị huỷ", () => {
    expect(ORDERS_CODE).toContain("if (cancelled || res.aborted) return")
  })
})

describe("primitive mới không phá quy ước sẵn có", () => {
  it("không thêm file CSS nào", () => {
    const cssFiles = readdirSync(resolve(ROOT, "src/app")).filter((f) => f.endsWith(".css"))
    expect(cssFiles).toEqual(["globals.css"])
  })

  /** Brief cấm thêm thư viện — mọi thứ làm bằng React + Tailwind + Radix. */
  it("không thêm thư viện mới", () => {
    const pkg = JSON.parse(read("package.json"))
    const deps = Object.keys(pkg.dependencies || {})
    for (const banned of ["react-hook-form", "framer-motion", "@tanstack/react-query", "swr"]) {
      expect(deps, `đã thêm ${banned}`).not.toContain(banned)
    }
  })
})

describe("M2.3 — /customers", () => {
  /**
   * Hai việc NVBH làm nhiều nhất khi mở danh sách khách. Gọi điện trước
   * đây phải vào màn chi tiết mới làm được.
   */
  it("thẻ khách có nút Gọi (tel:) và Tạo đơn", () => {
    expect(CUSTOMERS).toMatch(/href=\{`tel:\$\{c\.phone\}`\}/)
    expect(CUSTOMERS).toContain("/orders/new?customerId=${c.id}")
  })

  /**
   * ⚠ Tham số là `customerId`, KHÔNG phải `customer` — order-form đọc đúng
   * tên này rồi tự chọn khách; sai tên thì link mở form trống.
   */
  it("dùng đúng tên tham số customerId", () => {
    expect(CUSTOMERS).not.toMatch(/orders\/new\?customer=/)
    const form = read("src/components/orders/order-form.tsx")
    expect(form).toContain('searchParams.get("customerId")')
  })

  /** Không có SĐT thì không render link tel: rỗng. */
  it("khách chưa có SĐT thì không có link gọi hỏng", () => {
    // Khối <a> khá dài — cửa sổ hẹp làm test đỏ dù mã đúng.
    expect(CUSTOMERS).toMatch(/c\.phone \? \([\s\S]{0,1200}?Chưa có SĐT/)
  })

  /** Công nợ lên dòng đầu, chỉ hiện khi > 0. */
  it("công nợ là amount của thẻ, tô đỏ", () => {
    expect(CUSTOMERS).toContain("amount={debt > 0 ? formatCurrency(debt) : undefined}")
    expect(CUSTOMERS).toContain('amountTone={debt > 0 ? "danger" : "default"}')
  })

  it("thẻ lộ trình thu về một dòng trên mobile", () => {
    expect(CUSTOMERS).toContain("p-3 lg:p-4")
    expect(CUSTOMERS).toMatch(/h-2 flex-1 overflow-hidden rounded-full/)
  })

  it("có MobileFilterBar và LoadMore", () => {
    expect(CUSTOMERS).toContain("<MobileFilterBar")
    expect(CUSTOMERS).toContain("<LoadMore")
    expect(CUSTOMERS).toContain("if (cancelled || res.aborted) return")
  })
})

describe("M2.4 — /receivables", () => {
  /**
   * ⚠ ĐÚNG BỐN khoảng theo bucketConfig. Dữ liệu tổng hợp phía DB chỉ có
   * bốn — phát minh khoảng thứ năm là bịa số.
   */
  it("thanh xếp chồng dựng từ chính bucketConfig, không hardcode", () => {
    expect(RECEIVABLES).toContain("(Object.keys(bucketConfig) as BucketKey[])")
    // Cắt từ dấu `= {` — khai báo KIỂU phía trước cũng chứa `label:` nên
    // cắt từ đầu dòng sẽ đếm ra 5.
    const at = RECEIVABLES.indexOf("const bucketConfig")
    const body = RECEIVABLES.slice(RECEIVABLES.indexOf("= {", at), RECEIVABLES.indexOf("\n  }", at))
    expect(body.match(/label:/g)?.length, "phải đúng 4 khoảng tuổi nợ").toBe(4)
  })

  /** Chia cho 0 khi chưa có nợ nào — không được ra NaN%. */
  it("không chia cho 0", () => {
    expect(RECEIVABLES).toContain("totalAging > 0 ?")
  })

  /** Số CÒN NỢ mới là con số quyết định có đi thu hay không. */
  it("thẻ hiện số còn nợ, không phải số phải thu ban đầu", () => {
    expect(RECEIVABLES).toContain("amount={formatCurrency(remaining)}")
    expect(RECEIVABLES).toContain('amountTone="danger"')
  })

  /** Đã kiểm: collect/page.tsx đọc `receivableId`. */
  it("nút Thu tiền dẫn thẳng tới màn thu với đúng tham số", () => {
    expect(RECEIVABLES).toContain("/receivables/collect?receivableId=${r.id}")
    const collect = read("src/app/(dashboard)/receivables/collect/page.tsx")
    expect(collect).toContain('"receivableId"')
  })

  /**
   * ⚠ So ngày quá hạn phải dùng VN_TZ cho cả hai vế: so bằng giờ máy chủ
   * (UTC) thì suốt 7 tiếng đầu mỗi ngày kết quả lệch một ngày.
   */
  it("đếm ngày quá hạn theo giờ Việt Nam", () => {
    const i = RECEIVABLES.indexOf("const daysOverdue")
    expect(i).toBeGreaterThan(0)
    expect(RECEIVABLES.slice(i, i + 320)).toContain("VN_TZ")
  })

  /** Chip tuổi nợ chỉ lọc danh sách mobile — desktop có bộ lọc riêng. */
  it("chip tuổi nợ không đụng danh sách desktop", () => {
    expect(RECEIVABLES).toContain("const mobileReceivables = agingFilter")
    expect(RECEIVABLES).toMatch(/\{mobileReceivables\.map/)
  })
})

describe("M2.5 — /deliveries", () => {
  /** 5 thẻ thống kê ~250px → một hàng cuộn ngang ~72px. */
  it("thẻ thống kê thành hàng cuộn ngang trên mobile", () => {
    expect(DELIVERIES).toContain("row-scroll -mx-4 px-4 lg:mx-0 lg:grid")
    expect(DELIVERIES).toContain('shrink-0 w-[108px] lg:w-auto')
  })

  /** TabsList `flex-wrap` nên ba tab xuống dòng ở 320px. */
  it("tabs thành SegmentedScroller trên mobile", () => {
    expect(DELIVERIES).toContain("<SegmentedScroller")
    expect(DELIVERIES).toMatch(/className="hidden lg:block flex-1"/)
  })

  /** Chip dựng từ TAB_FILTERS, bỏ "all" vì bỏ chọn chip = tất cả. */
  it("chip dựng từ chính TAB_FILTERS", () => {
    expect(DELIVERIES).toContain('TAB_FILTERS.filter((t) => t.value !== "all")')
    expect(DELIVERIES).toContain('setActiveTab((k as typeof activeTab) ?? "all")')
  })

  it("bỏ qua kết quả bị huỷ", () => {
    expect(DELIVERIES).toContain("if (cancelled || res.aborted) return")
  })
})
