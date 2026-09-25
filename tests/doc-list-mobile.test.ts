import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { invoiceTone, groupDocsByDay } from "@/lib/orders/status-tone"

/**
 * DANH SÁCH ĐƠN HÀNG VÀ HÓA ĐƠN TRÊN ĐIỆN THOẠI — mẫu chủ nhà gửi.
 *
 * ⚠ HAI MÀN, MỘT KHUÔN. Chủ nhà chốt cả hai theo cùng một mẫu; dựng hai
 * khuôn là ít lâu sau một bên có giờ, bên kia không, và người dùng phải
 * học hai cách nhìn cho cùng một việc.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const ROW = read("src/components/ui/doc-list-row.tsx")
const SUMMARY = read("src/components/ui/doc-list-summary.tsx")
const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
const INVOICES = read("src/app/(dashboard)/sales-invoices/page.tsx")
const MOBILE_INV = read("src/components/sales-invoices/mobile-invoice-list.tsx")
const MOBILE_ORD = read("src/components/orders/mobile-order-list.tsx")
const INV_TABLE = read("src/components/sales-invoices/desktop-invoice-table.tsx")
const ORD_TABLE = read("src/components/orders/desktop-order-table.tsx")
const HEADER = read("src/components/ui/page-header.tsx")
const MOBILE_NAV = read("src/components/layout/mobile-nav.tsx")

describe("khuôn hàng dùng chung", () => {
  /** Bốn dòng, đúng thứ tự người bán đọc. */
  it("dòng đầu là tên khách + tiền, dòng hai là giờ·mã + điều khoản", () => {
    const flat = ROW.replace(/\s+/g, " ")
    const t = flat.indexOf("{title}")
    const tot = flat.indexOf("{total}")
    const m = flat.indexOf("{meta}")
    const pay = flat.indexOf("{payment || \"\"}")
    expect(t).toBeGreaterThan(0)
    expect(tot).toBeGreaterThan(t)
    expect(m).toBeGreaterThan(tot)
    expect(pay).toBeGreaterThan(m)
    expect(flat.indexOf("{summary}")).toBeGreaterThan(pay)
  })

  /**
   * ⚠ MỌI Ô CHỮ DÀI PHẢI CO ĐƯỢC. Tên khách và tên hàng ở kho này dài tới
   * 70 ký tự; thiếu `min-w-0` hoặc `truncate` là dòng đẩy ngang cả màn
   * hình thay vì bị cắt.
   */
  it("tên khách, dòng phụ đều min-w-0 + truncate", () => {
    const flat = ROW.replace(/\s+/g, " ")
    expect(flat).toContain('className="min-w-0 truncate text-[17px] font-bold leading-tight text-on-surface"')
    expect(flat).toContain('className="min-w-0 truncate text-[13px] font-semibold tabular-data text-on-surface-variant"')
    // Tên hàng có cụm dài không dấu cách ("30g(30cái/bịch") nên phải ngắt.
    expect(flat).toContain("[overflow-wrap:anywhere]")
  })

  /** Vạch màu trạng thái cao bằng cả hàng, không đẩy lưới. */
  it("vạch màu tuyệt đối theo accent", () => {
    expect(ROW).toContain('className="absolute inset-y-0 left-0 w-1"')
    expect(ROW).toContain("style={{ background: accent }}")
  })

  /** ⚠ Cả hàng là MỘT vùng chạm — không nút con nào bên trong. */
  it("khuôn hàng không chứa nút hay link con", () => {
    expect(code(ROW)).not.toContain("<button")
    expect(code(ROW)).not.toContain("<a ")
    expect(code(ROW)).not.toContain("<Link")
  })

  it("cả hai danh sách đều dùng khuôn này", () => {
    expect(MOBILE_ORD).toContain('from "@/components/ui/doc-list-row"')
    expect(MOBILE_INV).toContain('from "@/components/ui/doc-list-row"')
  })
})

describe("dải tóm tắt", () => {
  /**
   * ⚠ `null` HIỆN "—", KHÔNG HIỆN 0. Số 0 nghĩa là "bán được 0 đồng" —
   * câu trả lời sai cho một câu hỏi chưa cộng được.
   */
  it("chưa cộng được tổng thì hiện dấu gạch", () => {
    expect(SUMMARY).toContain('{total ?? "—"}')
  })

  /**
   * ⚠ TỔNG PHẢI LÀ TỔNG CỦA CẢ BỘ LỌC. Danh sách phân trang 50 dòng;
   * cộng các dòng đang tải về rồi gọi nó là "Tổng tiền hàng" là in ra
   * một con số nhỏ hơn sự thật mà không có gì báo.
   */
  it.each([
    ["đơn hàng", "src/app/(dashboard)/orders/page.tsx"],
    ["hóa đơn", "src/app/(dashboard)/sales-invoices/page.tsx"],
  ])("%s: tổng cộng bằng truy vấn riêng, chạm trần thì để null", (_l, rel) => {
    const src = read(rel)
    /* Hóa đơn đọc thêm `id` để trừ hàng trả của chính các tờ ấy (mig 192). */
    expect(src).toMatch(/fetchAllForAggregate<\{ (id: string; )?total: number \| string \}>/)
    const at = src.indexOf("res.error || res.truncated")
    expect(at, "không xử lý trường hợp đọc thiếu").toBeGreaterThan(0)
    expect(src.slice(at, at + 300)).toContain("setFilteredTotal(null)")
    /**
     * Và tổng phải cộng từ KẾT QUẢ TRUY VẤN RIÊNG (`res.rows`), không
     * phải từ state của danh sách đang hiện (`orders` / `rows` /
     * `filtered`) — đó mới là chỗ con số bị hụt.
     */
    const froms: string[] = []
    const body = code(src)
    const re = /setFilteredTotal\(\s*([A-Za-z_$][\w$.]*)\.reduce/g
    for (let m = re.exec(body); m; m = re.exec(body)) froms.push(m[1])
    expect(froms.length, "không thấy chỗ nào cộng tổng").toBeGreaterThan(0)
    expect(froms).toEqual(froms.map(() => "res.rows"))
  })

  it("viên thuốc khoảng thời gian quay vòng bốn mức", () => {
    for (const src of [ORDERS, INVOICES]) {
      expect(src).toContain("setPeriod((p) => nextPeriod(p))")
      expect(src).toContain('useState<ListPeriod>("month")')
    }
  })

  /**
   * ⚠ KHOẢNG THỜI GIAN PHẢI LỌC Ở MÁY CHỦ, cùng đường với bộ lọc ngày.
   * Lọc riêng ở trình duyệt là dải tổng cộng trên một tập còn danh sách
   * hiện một tập khác — hai con số cạnh nhau, không khớp.
   */
  it("khoảng thời gian đi vào chính câu truy vấn", () => {
    expect(ORDERS).toContain('x = x.gte("order_date", pFrom)')
    expect(INVOICES).toContain('x = x.gte("invoice_date", pFrom)')
  })
})

describe("giờ trên cột Ngày (máy tính)", () => {
  /**
   * ⚠ GIỜ LẤY TỪ `created_at`. `order_date` / `invoice_date` là cột kiểu
   * `date`, không mang giờ — dựng giờ từ chúng là in "07:00" cho mọi
   * dòng, một con số trông như dữ liệu thật mà không phải.
   */
  it.each([
    ["đơn hàng", ORD_TABLE, "o"],
    ["hóa đơn", INV_TABLE, "r"],
  ])("%s: cột Ngày có thêm giờ", (_l, table, v) => {
    expect(table).toContain(`{${v}.created_at && (`)
    expect(table).toContain(`vnTime(${v}.created_at)`)
  })

  /** Không có `created_at` trong câu select thì cột giờ luôn trống. */
  it("hóa đơn kéo created_at về", () => {
    expect(INVOICES).toContain("invoice_code, invoice_date, created_at")
    expect(INV_TABLE).toContain("created_at?: string | null")
  })
})

describe("gom nhóm theo ngày", () => {
  const row = (d: string, total: number) => ({ d, total })

  it("giữ thứ tự đầu vào và cộng tổng từng nhóm", () => {
    const g = groupDocsByDay(
      [row("2026-09-17", 100), row("2026-09-16", 50), row("2026-09-17", 25)],
      (x) => x.d,
      (x) => x.total,
      new Date("2026-09-17T05:00:00Z")
    )
    expect(g.map((x) => x.key)).toEqual(["2026-09-17", "2026-09-16"])
    expect(g[0].total).toBe(125)
    expect(g[0].label).toBe("Hôm nay")
    expect(g[1].label).toBe("Hôm qua")
  })

  it("số về dạng chuỗi vẫn cộng ra số", () => {
    const g = groupDocsByDay(
      [{ d: "2026-09-17", total: "100" as unknown as number }],
      (x) => x.d,
      (x) => x.total,
      new Date("2026-09-17T05:00:00Z")
    )
    expect(g[0].total).toBe(100)
  })
})

describe("màu hóa đơn", () => {
  /** ⚠ Hai trạng thái, và nhãn lấy từ bảng dùng chung — không viết tay. */
  it("posted xanh, cancelled đỏ, nhãn tiếng Việt", () => {
    expect(invoiceTone("posted").label).toBe("Đã xuất")
    expect(invoiceTone("cancelled").label).toBe("Đã hủy")
    expect(invoiceTone("posted").accent).not.toBe(invoiceTone("cancelled").accent)
  })

  /** ⚠ Mã lạ KHÔNG được rơi về màu của "đã xuất" — xanh nghĩa là xong. */
  it("trạng thái lạ thì xám và in nguyên mã", () => {
    const t = invoiceTone("gi_do_la")
    expect(t.label).toBe("gi_do_la")
    expect(t.accent).not.toBe(invoiceTone("posted").accent)
  })

  /**
   * ⚠ `posted` LÀ TRẠNG THÁI BÌNH THƯỜNG nên không đeo huy hiệu; dòng nào
   * cũng đeo thì mắt không bắt được dòng ĐÃ HUỶ.
   */
  it("hóa đơn đã ghi sổ không đeo huy hiệu, trừ bản lập lại / đã bị thay", () => {
    expect(MOBILE_INV).toContain('if (r.status !== "posted") return tone')
    expect(MOBILE_INV).toContain('if (r.replaced_by) return')
    expect(MOBILE_INV).toContain('if (r.replaced_from) return')
    expect(MOBILE_INV).toContain("return null")
  })
})

describe("dọn dải trên đầu danh sách (điện thoại)", () => {
  /**
   * ⚠ GIẤU TRÊN ĐIỆN THOẠI, GIỮ Ở MÁY TÍNH — không xoá hẳn. Dòng mô tả
   * của màn đơn hàng in "N đơn hôm nay · tiền", và trên máy tính đó là
   * nơi DUY NHẤT nói ra con số ấy (bảng máy tính không gom theo ngày).
   * Xoá hẳn là lấy mất một con số khỏi màn hình rộng để dọn màn hình hẹp.
   */
  it("cờ chỉ tắt đoạn mô tả của điện thoại, khối tiêu đề máy tính không đụng tới", () => {
    expect(HEADER).toContain("descriptionDesktopOnly?: boolean")
    expect(HEADER).toContain("{description && !descriptionDesktopOnly && (")
    const flat = HEADER.replace(/\s+/g, " ")
    // Khối `hidden lg:block` (máy tính) KHÔNG được gắn thêm điều kiện nào.
    expect(flat).toContain("{description && <p className=\"text-sm text-on-surface-variant\">{description}</p>}")
  })

  it.each([
    ["đơn hàng", "src/app/(dashboard)/orders/page.tsx"],
    ["hóa đơn", "src/app/(dashboard)/sales-invoices/page.tsx"],
  ])("%s: đầu trang không còn dải mô tả trên điện thoại", (_l, rel) => {
    const src = read(rel)
    const i = src.indexOf("<PageHeader")
    expect(i, "không tìm thấy đầu trang").toBeGreaterThan(0)
    const tag = src.slice(i, src.indexOf(">", i))
    expect(tag, "thiếu cờ giấu mô tả trên điện thoại").toContain("descriptionDesktopOnly")
  })

  /**
   * ⚠ NÚT "TẠO ĐƠN" CHỈ CÒN Ở MÁY TÍNH, và chỉ giấu được vì thanh dưới
   * của điện thoại đã có nút đi tới ĐÚNG cùng một chỗ. Nếu ngày nào đó
   * thanh dưới đổi đích, chốt này đỏ trước khi điện thoại mất hẳn đường
   * tạo đơn.
   */
  it("giấu Tạo đơn trên điện thoại vì thanh dưới đã có nút cùng đích", () => {
    const i = ORDERS.indexOf("Tạo đơn\n")
    expect(i).toBeGreaterThan(0)
    expect(ORDERS.slice(i - 300, i)).toContain('className="hidden lg:inline-flex"')
    expect(ORDERS.slice(i - 300, i)).toContain("newOrderHref()")
    // Thanh dưới đi tới cùng hằng số đó, không phải một đường dẫn viết tay.
    expect(MOBILE_NAV).toContain("href: NEW_ORDER_HREF")
  })

  /** Nháp thì ngược lại: không có tab riêng, nên nút này phải ở lại. */
  it("nút đơn nháp KHÔNG bị giấu — đó là đường duy nhất sang /sell/drafts", () => {
    const i = ORDERS.indexOf('router.push("/sell/drafts")')
    expect(i).toBeGreaterThan(0)
    expect(ORDERS.slice(i - 200, i + 200)).not.toContain("hidden lg:")
  })
})

describe("dải đếm trạng thái", () => {
  /**
   * ⚠ CẢ HAI MÀN ĐỀU CÓ VIÊN "TẤT CẢ" — chủ nhà chốt 19/09/2026 ("3 ô
   * thống kê thành 4 ô, áp dụng cả sang bên ds hoá đơn").
   *
   * ⚠ CHỖ ĐỨNG CỦA NÓ ĐÃ LẬT, ghi lại cả hai. Bản 19/09 bắt nó đứng
   * CUỐI, lý do: ô đầu tiên mắt chạm tới phải là hàng đợi việc trong
   * ngày. Chủ nhà chốt lại 20/09/2026: "cho mặc định hiển thị là tất
   * cả" — viên đang chọn phải là viên đầu tiên, nếu không dải mở ra với
   * một viên ở giữa được tô đậm.
   *
   * Riêng màn HÓA ĐƠN giữ "Tất cả" ở cuối vì mặc định của nó vẫn là "Đã
   * xuất": hóa đơn huỷ là nhiễu, không phải việc phải làm.
   */
  it("đơn hàng: Tất cả đứng đầu vì nó là mặc định", () => {
    const i = ORDERS.indexOf("const ORDER_TABS = ")
    const decl = ORDERS.slice(i, ORDERS.indexOf("] as const", i))
    expect(decl.indexOf('"all"')).toBeLessThan(decl.indexOf('"submitted"'))
    expect(ORDERS).toContain('const DEFAULT_ORDER_TAB = "all"')
  })

  it("hóa đơn: Tất cả vẫn đứng cuối, mặc định là Đã xuất", () => {
    expect(INVOICES).toContain('useLuuTrangThai("sales-invoices", "posted")')
    const i = INVOICES.indexOf("const TABS = [")
    const decl = INVOICES.slice(i, INVOICES.indexOf("] as const", i))
    expect(decl).toContain('label: "Tất cả"')
    expect(decl.indexOf('key: "all"')).toBeGreaterThan(decl.indexOf('key: "cancelled"'))
  })

  /**
   * ⚠ CHỐT CŨ "đệm và cỡ chữ co lại ở khổ hẹp" ĐÃ BỎ CÙNG VỚI THỨ NÓ
   * GIỮ. Nó đo đệm và cỡ chữ của `PipelineTabs` — thẻ có khung chia ô
   * đều nhau, phải thu đệm cho bốn ô vừa màn 375px. Chính cái trần ấy
   * là lý do trạng thái thứ năm không có ô nào và đơn xuất một phần
   * biến mất; chủ nhà chốt 20/09/2026 bỏ khung, dùng hàng viên thuốc
   * cuộn ngang. Hình dáng mới do `tests/orders-desktop-template` giữ.
   */
})
