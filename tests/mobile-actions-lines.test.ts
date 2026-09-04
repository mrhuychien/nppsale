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
 * Bỏ chú thích trước khi soi mã — chú thích nhắc tên một lớp CSS làm test
 * xanh oan (đã dính bốn lần).
 *
 * QUÉT THEO DÒNG, KHÔNG DÙNG REGEX. Hai lần đo cho thấy vì sao:
 *
 *  1. Luật cho chú thích JSX phải khớp tới `*\/}`. `interface X {` mở
 *     ngoặc rồi tới một khối tài liệu sẽ khiến nó chạy tiếp xuống tận
 *     `*\/}` xa phía dưới — nuốt 19.294 ký tự (39%) của handover/page.tsx.
 *  2. Ngay cả luật `/*` … `*\/` trần cũng sai: `accept="image/*"` có
 *     `/*` bên trong một chuỗi, và nó nuốt 815 ký tự của
 *     pod-capture-sheet.tsx — mất luôn `capture="environment"` mà test
 *     đang đòi.
 *
 * Cả hai lần, vùng bị nuốt đều làm test XANH vì không còn gì để sai.
 *
 * Giới hạn đã biết: chỉ bỏ chú thích CHIẾM TRỌN DÒNG. Repo này viết chú
 * thích như vậy; `code() /* ghi chú *\/` giữa dòng sẽ không bị bỏ.
 */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes("*/")) inBlock = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}

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

const POD = strip(read("src/components/deliveries/pod-capture-sheet.tsx"))
const DELIVERY_DETAIL = strip(read("src/app/(dashboard)/deliveries/[id]/page.tsx"))
const MIG_101 = read("supabase/migrations/101_pod_photos_bucket.sql")

describe("M6.3 — ký nhận & ảnh giao hàng (POD)", () => {
  /**
   * ⚠ Cột pod_photo_url / pod_signature có từ migration 001 và
   * /orders/[id] đã HIỂN THỊ ảnh POD — nhưng chưa màn nào ghi vào.
   */
  it("ghi vào đúng cặp cột đã có sẵn", () => {
    expect(POD).toContain("updates.pod_signature")
    expect(POD).toContain("updates.pod_photo_url")
    expect(POD).toContain('from("delivery_lines").update(updates)')
  })

  /**
   * Brief: ô ký ≥ 200px. Dưới ngưỡng đó chữ ký bị bó thành một vệt.
   *
   * Đếm số lần `h-[220px]` xuất hiện là ĐO SAI: khối ảnh có hai ô cùng
   * cỡ (ảnh xem trước + ô rỗng), nên bóp riêng canvas xuống h-24 vẫn còn
   * đủ 2 lần và test vẫn xanh (đã đo). Phải soi ĐÚNG thẻ <canvas>.
   */
  it("ô ký cao ít nhất 200px", () => {
    const i = POD.indexOf("<canvas")
    expect(i).toBeGreaterThan(0)
    const tag = POD.slice(i, POD.indexOf(">", i))
    const px = tag.match(/h-\[(\d+)px\]/)
    expect(px, "canvas không đặt chiều cao bằng px cố định").not.toBeNull()
    expect(Number(px![1])).toBeGreaterThanOrEqual(200)
  })

  /** Ô ảnh cũng phải cao bằng, cả lúc có ảnh lẫn lúc còn rỗng. */
  it("ô ảnh cao ít nhất 200px ở cả hai trạng thái", () => {
    const i = POD.indexOf("Ảnh giao hàng")
    const block = POD.slice(i, POD.indexOf("Ghi chú giao hàng", i))
    const sizes = (block.match(/h-\[(\d+)px\]/g) || []).map((m) => Number(m.slice(3, -3)))
    expect(sizes.length, "thiếu ô xem trước hoặc ô rỗng").toBe(2)
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(200)
  })

  /**
   * ⚠ Không có touch-none thì ngón tay kéo trên canvas sẽ CUỘN TRANG
   * thay vì vẽ — ô ký trở thành ô trang trí.
   */
  it("canvas chặn cử chỉ cuộn mặc định", () => {
    const i = POD.indexOf("<canvas")
    expect(i).toBeGreaterThan(0)
    expect(POD.slice(i, i + 400)).toContain("touch-none")
  })

  /**
   * ⚠ Đo bằng rAF sau khi sheet mở: lúc sheet còn trượt vào,
   * getBoundingClientRect trả 0 và canvas rỗng vĩnh viễn.
   */
  it("chỉnh kích thước canvas sau khi sheet đã mở, chặn DPR ở 2", () => {
    expect(POD).toContain("requestAnimationFrame")
    expect(POD).toContain("Math.min(2, window.devicePixelRatio || 1)")
  })

  /**
   * ⚠ Đo một khung hình rồi bỏ cuộc thì canvas giữ cỡ mặc định 300×150:
   * nét ký lệch hẳn so với ngón tay, và không có gì báo hiệu.
   */
  it("đo lại nhiều khung hình chứ không bỏ cuộc sau khung đầu", () => {
    const i = POD.indexOf("const measure = () => {")
    expect(i, "không thấy vòng đo lại").toBeGreaterThan(0)
    // Cắt tới hết effect, KHÔNG cắt tại "id = requestAnimationFrame(
    // measure)": chuỗi đó xuất hiện lần đầu ngay TRONG dòng thử lại, nên
    // lát cắt sẽ chặt đúng dòng mình đang muốn kiểm (đã đo).
    const fn = POD.slice(i, POD.indexOf("}, [open])", i))
    expect(fn).toContain("if (rect.width === 0) {")
    expect(fn).toMatch(/if \(\+\+tries < \d+\) id = requestAnimationFrame\(measure\)/)
  })

  /** POD không có bằng chứng nào thì chỉ là một ô tick. */
  it("khoá nút khi chưa có chữ ký lẫn ảnh, và NÓI lý do", () => {
    expect(POD).toContain(
      'const blockReason = !hasStroke && !photo ? "Cần chữ ký hoặc ảnh giao hàng" : null'
    )
    expect(POD).toContain("disabled={saving || !!blockReason}")
    expect(POD).toContain("title={blockReason || undefined}")
  })

  it("nút xác nhận h-14", () => {
    expect(POD).toContain('className="h-14 w-full text-base"')
  })

  /**
   * ⚠ Đừng gán null đè lên cột đang có giá trị tốt: ghi null lên chữ ký
   * của lần xác nhận trước là xoá bằng chứng bằng một lần bấm nhầm.
   */
  it("chỉ ghi cột THỰC SỰ có giá trị mới", () => {
    expect(POD).toContain("if (hasStroke && canvasRef.current) {")
    expect(POD).toContain("if (uploadedUrl) updates.pod_photo_url = uploadedUrl")
    expect(POD).not.toContain("pod_signature: null")
    expect(POD).not.toContain("pod_photo_url: null")
  })

  /** Đóng sheet khi lỗi = mất chữ ký khách vừa ký, phải mời họ ký lại. */
  it("lỗi thì KHÔNG đóng sheet", () => {
    const i = POD.indexOf("} catch (err: unknown) {")
    expect(i).toBeGreaterThan(0)
    const block = POD.slice(i, POD.indexOf("} finally {", i))
    expect(block).not.toContain("onOpenChange(false)")
    expect(block).toContain("variant: \"destructive\"")
  })

  /**
   * ⚠ Ảnh gốc từ camera là 3–8MB. Tài xế đứng trước cửa khách, sóng 3G.
   * Nén hỏng thì trả BLOB GỐC — thà tải chậm còn hơn mất bằng chứng.
   */
  it("nén ảnh trước khi tải lên, hỏng thì dùng ảnh gốc", () => {
    expect(POD).toContain("const blob = await shrinkImage(photo)")
    expect(POD).toMatch(/MAX_EDGE = \d+/)
    const i = POD.indexOf("async function shrinkImage")
    const fn = POD.slice(i, POD.indexOf("\n}", i))
    expect(fn).toContain("} catch {")
    expect(fn).toContain("return file")
    expect(fn).not.toContain("throw")
  })

  /** Không có capture thì máy hiện bộ chọn ảnh — tài xế qua thêm một màn. */
  it("mở thẳng camera sau", () => {
    expect(POD).toContain('capture="environment"')
  })

  /**
   * ⚠ Thiếu org_id thì đường dẫn không qua nổi policy storage. Bỏ qua ảnh
   * rồi vẫn lưu dòng là mất bằng chứng mà không ai biết — SAI theo
   * "tách VẤN ĐỀ khỏi THÔNG TIN": phải dừng và nói ra.
   */
  it("thiếu org_id thì DỪNG, không lặng lẽ lưu thiếu ảnh", () => {
    const i = POD.indexOf("if (photo) {")
    expect(i, "nhánh tải ảnh phải chỉ phụ thuộc vào việc CÓ ảnh").toBeGreaterThan(0)
    expect(POD.slice(i, i + 300)).toContain("if (!orgId) throw new Error(")
    expect(POD).not.toContain("if (photo && orgId)")
  })
})

describe("M6.3 — POD gắn vào màn chuyến giao", () => {
  /**
   * ⚠ Không select hai cột này thì chỉ báo "đã ký / có ảnh" luôn rỗng,
   * và trang trông như chưa ai ký bao giờ.
   */
  it("truy vấn lấy cả cột POD, và select là MỘT chuỗi literal", () => {
    expect(DELIVERY_DETAIL).toContain(
      '.select("id, delivery_id, order_id, status, notes, amount_collected, pod_photo_url, pod_signature, delivered_at, order:sales_orders(order_code, total, status, customer:customers(store_name, phone, address))")'
    )
    // Nối chuỗi bằng + làm Supabase suy kiểu ra GenericStringError.
    const i = DELIVERY_DETAIL.indexOf('.select("id, delivery_id, order_id')
    expect(DELIVERY_DETAIL.slice(i, DELIVERY_DETAIL.indexOf("\n", i))).not.toContain('" +')
  })

  /** Vai trò phải khớp policy RLS ở migration 002 — RLS mới là hàng rào. */
  it("chỉ vai trò được RLS cho phép, và chỉ khi đang giao", () => {
    const i = DELIVERY_DETAIL.indexOf("const canCapturePod")
    expect(i).toBeGreaterThan(0)
    const block = DELIVERY_DETAIL.slice(i, i + 300)
    expect(block).toContain('["owner", "manager", "warehouse", "driver"].includes(user.role)')
    expect(block).toContain('delivery.status === "in_transit"')
  })

  it("nút ký nhận chiếm trọn chiều ngang, chỉ hiện khi chưa giao", () => {
    expect(DELIVERY_DETAIL).toContain("{canCapturePod && !done && (")
    const i = DELIVERY_DETAIL.indexOf("{canCapturePod && !done && (")
    expect(DELIVERY_DETAIL.slice(i, i + 300)).toContain('className="mt-2 h-12 w-full"')
  })

  /** Giao xong mà không có bằng chứng thì phải NÓI RA, không để trống. */
  it("đã giao nhưng thiếu bằng chứng thì nói thẳng", () => {
    expect(DELIVERY_DETAIL).toContain("{done && !hasSignature && !hasPhoto && (")
    expect(DELIVERY_DETAIL).toContain("Đã giao — chưa có chữ ký hay ảnh")
  })

  /** Xác nhận xong phải nạp lại, không bắt người ta kéo để làm mới. */
  it("lưu xong thì nạp lại danh sách", () => {
    expect(DELIVERY_DETAIL).toContain("onSaved={fetchData}")
  })
})

describe("Migration 101 — bucket ảnh POD", () => {
  /** Đã chạy hai lần trên Postgres 16 thật: 2 bucket / 3 policy cả hai lần. */
  it("chạy lại được, không nhân bản", () => {
    expect(MIG_101).toContain("ON CONFLICT (id) DO NOTHING")
    expect(MIG_101.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/g)?.length).toBe(2)
  })

  /**
   * ⚠ Ảnh POD là chứng từ. Cho xoá từ client thì lúc tranh chấp với
   * khách, bên xoá được là bên thắng. visit-photos có DELETE vì ảnh viếng
   * thăm là ghi nhận nội bộ.
   */
  it("KHÔNG có policy DELETE", () => {
    expect(MIG_101).not.toContain("FOR DELETE")
  })

  /** Ghi bị khoá trong thư mục org của người dùng. */
  it("ghi chỉ trong thư mục org", () => {
    expect(MIG_101).toContain("(split_part(name, '/', 1))::uuid = public.user_org_id()")
  })

  /** Không thêm cột — hai cột POD đã có từ migration 001. */
  it("không đụng vào schema bảng", () => {
    expect(MIG_101).not.toMatch(/ALTER TABLE|ADD COLUMN/)
  })

  /** Đánh đổi "bucket public" phải được ghi ra, không để người sau tự đoán. */
  it("nói rõ đánh đổi của bucket public", () => {
    expect(MIG_101).toContain("ĐÁNH ĐỔI ĐÃ BIẾT")
    expect(MIG_101).toContain("public = true")
  })
})
