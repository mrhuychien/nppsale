import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Pack còn lại của brief mobile:
 *   M3.3e — dòng hàng nén 2 hàng + sheet "Sửa dòng" + vuốt xoá có hoàn tác
 *   M4.2  — gom hành động theo STATUS_FLOW vào MỘT thanh dính đáy
 *   M4.3  — đổi thứ tự khối trên mobile
 *   M5.1/7 — màn xác nhận sau khi thu tiền, có "In phiếu thu"
 *   M6.3  — màn tài xế: nút h-14 trong thanh dính đáy
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/**
 * Bỏ chú thích TRƯỚC khi soi: chú thích nhắc tên lớp làm test xanh oan.
 *
 * KHÔNG có luật riêng cho chú thích JSX. Luật đó phải khớp tới `*\/}`, mà
 * `interface X {` mở ngoặc rồi tới ngay một khối tài liệu sẽ khiến nó
 * chạy tiếp xuống tận `*\/}` xa phía dưới. Đo trên handover/page.tsx:
 * nuốt 19.294 ký tự (39% file) — mọi assert trong vùng đó xanh vì KHÔNG
 * CÒN GÌ ĐỂ SAI. Bỏ chú thích khối trước là đủ; cặp `{ }` rỗng vô hại.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

const ORDER_DETAIL = strip(read("src/app/(dashboard)/orders/[id]/page.tsx"))
const ORDER_FORM = strip(read("src/components/orders/order-form.tsx"))
const COLLECT = strip(read("src/app/(dashboard)/receivables/collect/page.tsx"))
const HANDOVER = strip(read("src/app/(dashboard)/deliveries/[id]/handover/page.tsx"))
const SETTLE = strip(read("src/app/(dashboard)/deliveries/[id]/settle/page.tsx"))
const SWIPE = strip(read("src/components/ui/swipe-to-delete.tsx"))
const UNDO = strip(read("src/hooks/use-undoable-remove.ts"))
const COLLAPSE = strip(read("src/components/ui/collapsible-section.tsx"))
const CSS = read("src/app/globals.css")

describe("M4.2 — một thanh hành động theo STATUS_FLOW", () => {
  /**
   * ⚠ Thẻ "Thao tác" nằm CUỐI cột phụ. Trên điện thoại cột phụ xếp sau
   * toàn bộ bảng hàng → nút "Duyệt đơn" nằm dưới ~3.400px cuộn.
   */
  it("thẻ Thao tác cũ chỉ còn ở desktop", () => {
    const i = ORDER_DETAIL.indexOf("<CardTitle>Thao tác</CardTitle>")
    expect(i, "không thấy thẻ Thao tác").toBeGreaterThan(0)
    // Card mở ra ngay trước CardHeader chứa title.
    expect(ORDER_DETAIL.slice(i - 200, i)).toContain('<Card className="hidden lg:block">')
  })

  it("hành động chính lấy từ STATUS_FLOW, lọc theo vai trò", () => {
    expect(ORDER_DETAIL).toContain("const roleTransitions = availableTransitions.filter")
    expect(ORDER_DETAIL).toContain("t.roles.includes(user.role)")
  })

  /**
   * ⚠ "Hủy đơn" có mặt ở draft/confirmed/picking. Nếu chọn phần tử đầu
   * của STATUS_FLOW làm nút to thì ở picking nút to vẫn là bước tiến,
   * nhưng chỉ cần đảo thứ tự map một lần là nút to thành "Hủy đơn".
   */
  it("Hủy đơn KHÔNG bao giờ là nút chính", () => {
    expect(ORDER_DETAIL).toContain(
      'const primaryTransition = roleTransitions.find((t) => t.value !== "cancelled") || null'
    )
  })

  it("phần còn lại + Xoá đơn nằm trong menu ⋮", () => {
    expect(ORDER_DETAIL).toContain("const menuTransitions = roleTransitions.filter")
    const i = ORDER_DETAIL.indexOf("<DropdownMenuContent")
    expect(i).toBeGreaterThan(0)
    const menu = ORDER_DETAIL.slice(i, i + 1200)
    expect(menu).toContain("Xóa đơn hàng")
    expect(menu).toContain("menuTransitions.map")
  })

  /**
   * ⚠ delivered không còn bước nào trong STATUS_FLOW, nhưng việc thì
   * còn: ghi nhận công nợ rồi xuất hoá đơn. Thanh rỗng ở đúng trạng thái
   * có việc là tệ hơn không có thanh.
   */
  it("đơn đã giao vẫn có hành động chính", () => {
    expect(ORDER_DETAIL).toContain("const deliveredNext")
    const i = ORDER_DETAIL.indexOf("const deliveredNext")
    const block = ORDER_DETAIL.slice(i, i + 700)
    expect(block).toContain("Ghi nhận công nợ")
    expect(block).toContain("Xuất hóa đơn")
  })

  /** Thanh dính đáy che cuối trang nếu vùng nội dung không chừa đệm. */
  it("chừa đệm đáy đúng khi (và chỉ khi) có thanh", () => {
    expect(ORDER_DETAIL).toContain("const hasMobileActions")
    expect(ORDER_DETAIL).toMatch(/hasMobileActions \? "pb-nav-action" : ""/)
    expect(ORDER_DETAIL).toContain("{hasMobileActions && (")
  })
})

describe("M4.3 — thứ tự khối trên mobile", () => {
  // Neo vào ĐÚNG nhãn của khối tóm tắt. Chuỗi "Tổng đơn" trần cũng khớp
  // một toast ở handleSaveEdit đứng trước đó trong file — lấy nhầm nó thì
  // cả hai assert dưới đây đo sai chỗ (đã đo).
  const SUMMARY_LABEL =
    '<span className="text-xs uppercase tracking-wider text-on-surface-variant">Tổng đơn</span>'

  /** Tên khách + tổng tiền phải nằm trên màn đầu, không phải cuối trang. */
  it("tóm tắt khách + tổng đơn đứng TRƯỚC lưới hai cột", () => {
    const summary = ORDER_DETAIL.indexOf(SUMMARY_LABEL)
    const grid = ORDER_DETAIL.indexOf('<div className="grid gap-4 lg:grid-cols-3">')
    expect(summary, "không thấy khối tóm tắt mobile").toBeGreaterThan(0)
    expect(grid).toBeGreaterThan(0)
    expect(summary, "khối tóm tắt phải đứng trước lưới").toBeLessThan(grid)
  })

  it("tóm tắt chỉ dành cho mobile và có nút gọi khách", () => {
    const i = ORDER_DETAIL.indexOf(SUMMARY_LABEL)
    expect(i).toBeGreaterThan(0)
    const block = ORDER_DETAIL.slice(i - 1200, i)
    expect(block).toContain("lg:hidden")
    expect(block).toMatch(/href=\{`tel:\$\{order\.customer\.phone\}`\}/)
  })

  /** Ba khối lịch sử gập lại; khối "Hàng trả kèm" thì KHÔNG — nó chờ duyệt. */
  it("các khối lịch sử gập được, khối cần hành động thì không", () => {
    for (const t of ["Lịch sử kho", "Lịch sử trạng thái", "Lịch sử sửa dòng đơn"]) {
      expect(
        ORDER_DETAIL,
        `khối "${t}" chưa được bọc CollapsibleSection`
      ).toMatch(new RegExp(`<CollapsibleSection[^>]*\\n?[^>]*${t}`))
    }
    const i = ORDER_DETAIL.indexOf("Hàng trả kèm đơn này")
    expect(ORDER_DETAIL.slice(i - 400, i)).not.toContain("<CollapsibleSection")
  })

  /**
   * ⚠ Gập bằng <details> thì desktop phải chống lại quy tắc ẩn của trình
   * duyệt. Ở đây desktop luôn mở nhờ lg:block, và nút gập lg:hidden.
   */
  it("desktop luôn mở, không có nút gập", () => {
    expect(COLLAPSE).not.toContain("<details")
    expect(COLLAPSE).toContain('className="tap flex w-full items-center justify-between gap-2 px-4 py-3 text-left lg:hidden"')
    expect(COLLAPSE).toMatch(/open \? "block" : "hidden", "lg:block"/)
    expect(COLLAPSE).toContain("aria-expanded={open}")
  })
})

describe("M3.3e — dòng hàng nén còn 2 hàng", () => {
  /**
   * ⚠ Thẻ cũ có ô ghi chú + ô giá + ô VAT + ô CK ngay trên thẻ →
   * ~250px/dòng. Đơn 10 dòng phải cuộn 2.500px để xem lại đơn.
   */
  it("ô ghi chú và ô giá rời khỏi thẻ, vào sheet", () => {
    const i = ORDER_FORM.indexOf('<div className="lg:hidden space-y-2">')
    expect(i).toBeGreaterThan(0)
    const card = ORDER_FORM.slice(i, ORDER_FORM.indexOf("<Sheet open={editLineIndex", i))
    expect(card).not.toContain('placeholder="Ghi chú dòng (tuỳ chọn)…"')
    expect(card).not.toContain("<MoneyInput")
    // Còn đúng hai thứ bấm được trong thẻ: stepper và nút Sửa.
    expect(card).toContain("<QtyStepper")
    expect(card).toContain("onClick={() => setEditLineIndex(i)}")
  })

  /** Nén không được phép GIẤU thứ đã sửa — hiện lại bằng chip. */
  it("chip chỉ hiện khi có gì lệch mặc định", () => {
    expect(ORDER_FORM).toMatch(
      /\{\(over \|\| warning \|\| line\.line_discount_percent > 0 \|\| !!line\.note\?\.trim\(\)\) && \(/
    )
  })

  it("sheet Sửa dòng mang đủ giá / VAT / CK / ghi chú", () => {
    const i = ORDER_FORM.indexOf("<Sheet open={editLineIndex")
    expect(i).toBeGreaterThan(0)
    const sheet = ORDER_FORM.slice(i, ORDER_FORM.indexOf("</Sheet>", i))
    for (const label of ["Đơn giá", "VAT", "Chiết khấu %", "Ghi chú dòng"]) {
      expect(sheet, `sheet thiếu ${label}`).toContain(label)
    }
    expect(sheet).toContain("<MoneyInput")
  })

  /**
   * ⚠ type="number" trên iOS: bàn phím có "e", cuộn trang làm đổi giá
   * trị. Ô CK là ô duy nhất còn nhập số tay trong sheet.
   */
  it("ô chiết khấu không dùng type=number", () => {
    const i = ORDER_FORM.indexOf("Chiết khấu %")
    const block = ORDER_FORM.slice(i, i + 800)
    expect(block).not.toContain('type="number"')
    expect(block).toContain('inputMode="numeric"')
    expect(block).toContain("Math.min(100, Math.max(0, n))")
  })
})

describe("M3.3e — vuốt xoá có hoàn tác", () => {
  /**
   * ⚠ Danh sách dòng hàng CUỘN DỌC. Không khoá trục thì cuộn hơi chéo
   * tay là kéo trôi một dòng ra — và NVBH cuộn danh sách này liên tục.
   */
  it("khoá trục ở lần di chuyển đầu, cuộn dọc thì bỏ qua", () => {
    expect(SWIPE).toContain('axis.current = Math.abs(mx) > Math.abs(my) ? "x" : "y"')
    expect(SWIPE).toContain('if (axis.current !== "x") return')
    expect(SWIPE).toMatch(/AXIS_LOCK = \d+/)
  })

  /** Chỉ kéo sang TRÁI, và phải qua ngưỡng mới tính là xoá. */
  it("chỉ xoá khi vuốt trái quá ngưỡng", () => {
    expect(SWIPE).toContain("Math.max(-THRESHOLD * 1.4, Math.min(0, mx))")
    expect(SWIPE).toMatch(/const shouldDelete = axis\.current === "x" && dx <= -THRESHOLD/)
  })

  /**
   * ⚠ Xoá THẬT ngay, chỉ nhớ lại phần tử: giữ dòng "đang chờ xoá" trong
   * danh sách làm tổng tiền và cảnh báo tồn kho sai trong đúng 5 giây đó.
   */
  it("xoá ngay, hoàn tác chèn lại ĐÚNG vị trí cũ", () => {
    expect(UNDO).toContain("onRemove(index)")
    expect(ORDER_FORM).toContain(
      "setLines((prev) => [...prev.slice(0, index), item, ...prev.slice(index)])"
    )
  })

  /** setTimeout gọi setState sau khi component chết = cảnh báo + rò rỉ. */
  it("hẹn giờ nằm trong ref và huỷ khi unmount", () => {
    expect(UNDO).toContain("const timer = useRef")
    expect(UNDO).toContain("useEffect(() => clearTimer, [])")
    expect(UNDO).toMatch(/UNDO_MS = 5000/)
  })

  /** Một lối xoá duy nhất — nút xoá trong sheet cũng đi qua hoàn tác. */
  it("mọi đường xoá dòng đều qua undoableRemove", () => {
    const mobile = ORDER_FORM.slice(ORDER_FORM.indexOf('<div className="lg:hidden space-y-2">'))
    expect(mobile).not.toMatch(/onClick=\{\(\) => removeLine\(i\)\}/)
    expect(mobile.match(/undoableRemove\.remove\(i, line\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(mobile).toContain("undoableRemove.undo")
  })
})

describe("M5.1 mục 7 — màn xác nhận sau khi thu tiền", () => {
  /**
   * ⚠ Trước đây router.push chạy ngay sau khi ghi xong: khách đang đứng
   * đó, không kịp thấy còn nợ bao nhiêu, và không có đường nào in phiếu.
   */
  it("không điều hướng ngay, dừng ở màn xác nhận", () => {
    const i = COLLECT.indexOf("const handleSubmit")
    const j = COLLECT.indexOf("const pageTitle")
    const body = COLLECT.slice(i, j)
    expect(body).not.toContain("router.push")
    expect(body).toContain("setDone({")
  })

  it("hiện số đã thu, còn nợ sau khi thu, và nút In phiếu thu", () => {
    expect(COLLECT).toContain("Còn nợ khoản này")
    expect(COLLECT).toContain("In phiếu thu")
    expect(COLLECT).toContain("data-print-mode")
    expect(COLLECT).toContain("<PaymentReceiptTT200")
  })

  /**
   * ⚠ Số phiếu SUY RA từ id dòng payments — màn này không lập
   * cash_receipts, in ra một số thuộc dải của kế toán là đụng số thật.
   */
  it("số phiếu suy ra từ id dòng payments, không tự sinh", () => {
    expect(COLLECT).toContain('.select("id")')
    expect(COLLECT).toContain("`PT-${done.paymentId.slice(0, 8).toUpperCase()}`")
    expect(COLLECT).not.toContain("Math.random()")
  })

  /**
   * ⚠ @media print chỉ ẩn sẵn aside/header/nav. Không bọc `no-print` thì
   * tờ phiếu in kèm cả thẻ xác nhận và hai cái nút.
   */
  it("phần trên màn nằm trong no-print", () => {
    const i = COLLECT.indexOf('<div className="space-y-4 pb-nav-action lg:pb-0">')
    expect(i).toBeGreaterThan(0)
    expect(COLLECT.slice(i, i + 200)).toContain('<div className="space-y-4 no-print">')
  })
})

describe("M6.3 — màn tài xế / thủ kho", () => {
  /** Người bấm đang đứng ở cửa kho, một tay giữ hàng. */
  it("handover: nút xác nhận h-14 trong thanh dính đáy", () => {
    const i = HANDOVER.indexOf("<StickyActionBar>")
    expect(i).toBeGreaterThan(0)
    expect(HANDOVER.slice(i, i + 400)).toContain("h-14 flex-1")
    expect(HANDOVER).toContain('<div className="hidden lg:flex justify-end gap-2">')
  })

  /** Một nhãn dùng cho cả hai nút — hai chỗ tự viết là một chỗ bị quên. */
  it("handover: nhãn nút desktop và mobile dùng chung một biến", () => {
    expect(HANDOVER).toContain("const submitLabel = (")
    expect(HANDOVER.match(/: submitLabel\}/g)?.length).toBe(2)
  })

  it("settle: mobile còn MỘT nút, ba nút cũ chỉ ở desktop", () => {
    expect(SETTLE).toContain('<div className="hidden lg:flex flex-col gap-2 sm:flex-row sm:justify-end">')
    const i = SETTLE.indexOf("<StickyActionBar>")
    expect(i).toBeGreaterThan(0)
    expect(SETTLE.slice(i, i + 400)).toContain("h-14 flex-1")
  })

  /** Nhánh không có thanh thì không chừa đệm — hở đáy trang là lỗi thấy được. */
  it("settle: chỉ chừa đệm ở nhánh còn việc", () => {
    expect(SETTLE).toContain(
      "const showSettleBar = !alreadySettled && !hasNothingToCollect && !saved"
    )
    expect(SETTLE).toMatch(/showSettleBar \? "pb-nav-action-tall" : ""/)
  })

  /**
   * ⚠ Thanh chứa nút h-14 cao 76px, dùng --action-bar-h (64px) thì thiếu
   * 12px và dòng cuối trang bị che.
   */
  it("có token riêng cho thanh cao, không gõ tay con số", () => {
    expect(CSS).toContain("--action-bar-h-tall: 76px")
    expect(CSS).toContain(
      ".pb-nav-action-tall { padding-bottom: calc(var(--bottom-nav-h) + var(--action-bar-h-tall) + var(--safe-b) + var(--content-pad-b)); }"
    )
    // Vẫn phải nằm trong media query max-width:1023px như .pb-nav-action,
    // nếu không nó đè lên lg:pb-* của desktop.
    const mq = CSS.indexOf("@media (max-width: 1023px)")
    const tall = CSS.indexOf(".pb-nav-action-tall {")
    expect(tall).toBeGreaterThan(mq)
    expect(tall).toBeLessThan(CSS.indexOf("}", CSS.indexOf(".pb-nav-action-tall")) + 200)
    expect(CSS.slice(mq, CSS.indexOf("/* Neo cho thanh dính đáy"))).toContain(".pb-nav-action-tall")
  })
})
