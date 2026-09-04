import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Pack M3 — /orders/new, màn hình quan trọng nhất.
 *
 * Test đọc mã nguồn. Toàn bộ logic giá / tồn / offline KHÔNG được đụng —
 * vài test dưới đây canh đúng chuyện đó.
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

const FORM = read("src/components/orders/order-form.tsx")
const CODE = strip(FORM)
const STEPPER = read("src/components/ui/qty-stepper.tsx")
const PICKER = read("src/components/orders/product-picker-sheet.tsx")
const FREQ = read("src/lib/orders/frequent-products.ts")
const KB = read("src/hooks/use-keyboard-open.ts")
const CSS = read("src/app/globals.css")
const SHELL = strip(read("src/components/layout/dashboard-shell.tsx"))

describe("M3.3f — stepper số lượng 44px", () => {
  /** Nút −/+ cũ 36×36 và ô số h-9 — thứ NVBH bấm nhiều nhất khi đứng. */
  it("cả ba phần đều h-11 (44px)", () => {
    expect(STEPPER.match(/h-11/g)?.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * ⚠ `onFocus → select()`: NVBH gõ "24" đè lên "1" thay vì phải xoá
   * trước. Lặp lại ở mọi dòng hàng nên tiết kiệm thật.
   */
  it("chạm vào ô là bôi đen sẵn", () => {
    expect(STEPPER).toContain("e.currentTarget.select()")
  })

  /**
   * ⚠ type="number" trên iOS hiện bàn phím có cả dấu chấm và `e`, và cuộn
   * trang làm đổi giá trị. Phải là text + inputMode numeric.
   */
  it("không dùng type=number", () => {
    // strip(): chú thích giải thích VÌ SAO tránh type=number cũng chứa
    // đúng chuỗi đó — soi mã thô thì test đỏ oan.
    expect(STEPPER).toContain('type="text"')
    expect(STEPPER).toContain('inputMode="numeric"')
    expect(strip(STEPPER)).not.toContain('type="number"')
  })

  /**
   * ⚠ Xoá hết chữ trong ô mà lập tức nhảy về `min` thì không xoá để gõ lại
   * được — người dùng kẹt ở số cũ.
   */
  it("xoá hết chữ không bị ép về min ngay", () => {
    expect(STEPPER).toMatch(/if \(digits === ""\) return/)
  })

  it("form dùng QtyStepper, không còn nút 36px tự viết", () => {
    expect(CODE).toContain("<QtyStepper")
    expect(CODE).not.toContain('className="w-9 h-9 rounded-l-lg')
  })
})

describe("M3.3d — bộ chọn sản phẩm là bottom sheet", () => {
  /**
   * ⚠ Dropdown cũ `absolute` trong thẻ: bàn phím ảo đẩy trang lên là che
   * mất kết quả. Sheet 88vh nên kết quả luôn nằm trên bàn phím.
   */
  it("sheet cao 88vh, cuộn bên trong", () => {
    expect(PICKER).toContain("h-[88vh]")
    expect(PICKER).toContain("overflow-y-auto overscroll-contain")
  })

  /**
   * ⚠ KHÔNG tự đóng sau mỗi lần chọn — NVBH gõ 3–8 mặt hàng một lượt,
   * đóng mở lại từng lần là nhân số chạm lên gấp ba.
   */
  it("chọn xong KHÔNG đóng sheet", () => {
    const i = PICKER.indexOf("onClick={() => onPick(p.id)}")
    expect(i).toBeGreaterThan(0)
    // Không có onOpenChange(false) đi kèm lời gọi onPick.
    expect(PICKER.slice(i - 120, i + 120)).not.toContain("onOpenChange(false)")
  })

  it("có nút Xong và đếm số mặt hàng đã thêm", () => {
    expect(PICKER).toContain("{addedCount}")
    expect(PICKER).toMatch(/onClick=\{\(\) => onOpenChange\(false\)\}[\s\S]{0,60}?Xong/)
  })

  /** Đóng sheet phải xoá từ khoá, không thì mở lại thấy danh sách đã lọc. */
  it("đóng sheet thì xoá ô tìm", () => {
    expect(PICKER).toMatch(/if \(!open\) setQ\(""\)/)
  })

  /** Chữ ký là (rawQuery, ...values) — query đứng TRƯỚC. */
  it("dùng viMatchAllWords đúng thứ tự tham số", () => {
    expect(PICKER).toContain("viMatchAllWords(term, p.name, p.sku)")
  })

  /** Biết tồn TRƯỚC khi thêm rẻ hơn biết lúc bấm lưu. */
  it("hiện tồn và giá ngay trong danh sách", () => {
    expect(PICKER).toContain("stockByProduct[p.id] ?? 0")
    expect(PICKER).toMatch(/stock <= 0 \? "font-bold text-error"/)
  })

  /** SP đã có trong đơn hiện ✓ để khỏi thêm trùng mà không biết. */
  it("đánh dấu SP đã có trong đơn", () => {
    expect(PICKER).toContain("addedIds?.has(p.id)")
  })

  it("ô tìm 16px để iOS không tự phóng to", () => {
    const i = PICKER.indexOf("<input")
    expect(PICKER.slice(i, PICKER.indexOf("/>", i))).toContain("text-base")
  })

  /** Hai cách thêm SP cạnh nhau chỉ gây phân vân — Select giữ cho desktop. */
  it("Select 'Thêm sản phẩm' ẩn trên mobile", () => {
    expect(CODE).toContain('<div className="relative hidden w-64 lg:block">')
  })
})

describe("M3.4 — khách này hay lấy", () => {
  /**
   * ⚠ KHÔNG dùng embed `!inner`: kết quả phụ thuộc cách RLS áp lên bảng
   * cha, và sales_order_lines không có org_id riêng. Hai truy vấn là đường
   * đi rõ ràng.
   */
  it("hai truy vấn, không nhúng !inner", () => {
    expect(strip(FREQ)).not.toContain("!inner")
    expect(FREQ).toContain('.from("sales_orders")')
    expect(FREQ).toContain('.from("sales_order_lines")')
    expect(FREQ).toContain('.in("order_id"')
  })

  /** Đơn đã huỷ phản ánh một lần nhầm, không phải thói quen mua. */
  it("bỏ đơn đã huỷ", () => {
    expect(FREQ).toContain('.neq("status", "cancelled")')
  })

  /** Đếm theo SỐ LẦN, không theo số lượng. */
  it("đếm số lần mua, không cộng số lượng", () => {
    expect(FREQ).toMatch(/freq\.set\(r\.product_id, \(freq\.get\(r\.product_id\) \?\? 0\) \+ 1\)/)
    expect(FREQ).not.toContain("r.quantity")
  })

  /** Hỏng thì trả rỗng — không được chặn việc tạo đơn. */
  it("lỗi thì trả mảng rỗng, không ném", () => {
    expect(FREQ).toMatch(/if \(orderErr \|\| !orders\?\.length\) return \[\]/)
    expect(FREQ).toMatch(/if \(lineErr \|\| !lines\?\.length\) return \[\]/)
    expect(FREQ).not.toContain("throw")
  })

  it("form nạp theo khách và bắt lỗi im lặng", () => {
    expect(CODE).toContain("fetchFrequentProducts(customerId)")
    expect(CODE).toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setFrequentIds\(\[\]\) \}\)/)
    expect(CODE).toContain("recentIds={frequentIds}")
  })

  /** Đổi khách phải xoá danh sách cũ, không để SP của khách trước. */
  it("bỏ chọn khách thì xoá danh sách", () => {
    expect(CODE).toMatch(/if \(!customerId\) \{[\s\S]{0,80}?setFrequentIds\(\[\]\)/)
  })
})

describe("M3.3i — bàn phím ảo không che thanh hành động", () => {
  /**
   * ⚠ Trên iOS `window.innerHeight` KHÔNG đổi khi bàn phím mở (bàn phím
   * phủ lên chứ không thu viewport) — so innerHeight với chính nó là luôn
   * false. Phải đo bằng visualViewport.
   */
  it("đo bằng visualViewport", () => {
    expect(KB).toContain("window.visualViewport")
    expect(KB).toContain("window.innerHeight - vv.height > 120")
  })

  /** Cuộn trang khi bàn phím mở cũng đổi visualViewport trên iOS. */
  it("nghe cả resize lẫn scroll, và gỡ cả hai", () => {
    expect(KB).toContain('vv.addEventListener("resize", onResize)')
    expect(KB).toContain('vv.addEventListener("scroll", onResize)')
    expect(KB).toContain('vv.removeEventListener("resize", onResize)')
    expect(KB).toContain('vv.removeEventListener("scroll", onResize)')
  })

  /** Không có visualViewport thì giữ thanh luôn hiện — thà thừa hơn ẩn nhầm. */
  it("trình duyệt cũ thì không bao giờ báo mở", () => {
    expect(KB).toMatch(/if \(!vv\) return/)
  })

  it("shell gắn cờ lên body và dọn khi gỡ", () => {
    expect(SHELL).toContain('document.body.classList.toggle("kb-open", keyboardOpen)')
    expect(SHELL).toContain('document.body.classList.remove("kb-open")')
  })

  it("CSS giấu cả nav lẫn thanh hành động", () => {
    expect(CSS).toContain('body.kb-open nav[aria-label="Điều hướng chính"]')
    expect(CSS).toContain("body.kb-open .kb-hide")
  })

  it("thanh hành động của form mang lớp kb-hide", () => {
    expect(CODE).toMatch(/bottom-above-nav[^"]*kb-hide/)
  })
})

describe("M3.3b — cảnh báo vượt hạn mức", () => {
  /**
   * ⚠ Form vẫn hiện hạn mức và nợ cạnh nhau nhưng KHÔNG cộng đơn đang lập
   * vào — NVBH chốt xong mới biết vượt, lúc đó đơn đã nằm chờ duyệt.
   */
  it("so nợ CỘNG đơn này với hạn mức", () => {
    expect(CODE).toContain("const projected = customerOutstanding + orderTotal")
    expect(CODE).toMatch(/if \(projected <= limit\) return null/)
  })

  /**
   * Không đoán khi thiếu dữ liệu: chưa chọn khách, chưa nạp xong nợ, hoặc
   * khách không đặt hạn mức thì KHÔNG cảnh báo.
   */
  it("thiếu dữ liệu thì không cảnh báo bừa", () => {
    const i = CODE.indexOf("const creditWarning = (() => {")
    const fn = CODE.slice(i, CODE.indexOf("})()", i))
    expect(fn).toContain("if (!selectedCustomer) return null")
    expect(fn).toContain("if (customerOutstanding === null) return null")
    expect(fn).toContain("if (limit <= 0) return null")
  })

  /** Amber theo SKILL.md §1 — đỏ dành cho lỗi cứng chặn hẳn việc lưu. */
  it("dùng amber, không dùng đỏ", () => {
    const i = CODE.indexOf("{creditWarning && (")
    const block = CODE.slice(i, i + 900)
    expect(block).toContain("amber")
    expect(block).not.toContain("text-error")
    expect(block).not.toContain("destructive")
  })

  /** Cảnh báo, không chặn: đơn vẫn lưu được và nói rõ điều đó. */
  it("nói rõ đơn vẫn lưu được", () => {
    expect(CODE).toContain("Đơn vẫn lưu được nhưng sẽ cần duyệt")
  })
})

describe("M3.3a/g/h — lấy lại chiều cao", () => {
  it("thẻ nén padding trên mobile", () => {
    expect(CODE).toContain('className="p-4 pb-2 lg:p-6 lg:pb-6"')
    expect(CODE).toContain('className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0"')
  })

  /** ⚠ Thẻ tổng inline trùng với thanh dính đáy — ~230px cho cùng con số. */
  it("không còn thẻ tổng inline", () => {
    expect(CODE).not.toContain('lg:hidden rounded-2xl border border-outline-variant')
    // Nhưng chi tiết KHÔNG mất — nó bung ra từ thanh dính đáy.
    expect(CODE).toContain("{breakdownOpen && (")
    expect(CODE).toContain("setBreakdownOpen((v) => !v)")
  })

  it("chi tiết bung ra có đủ bốn vế và nút huỷ", () => {
    const i = CODE.indexOf("{breakdownOpen && (")
    const block = CODE.slice(i, CODE.indexOf("</div>\n        )}", i))
    for (const label of ["Tạm tính", "Tổng chiết khấu", "VAT", "Huỷ đơn"]) {
      expect(block, `thiếu ${label}`).toContain(label)
    }
  })

  it("ghi chú nội bộ 3 dòng thay vì 6", () => {
    expect(CODE).toContain("rows={3}")
    expect(CODE).not.toContain("rows={6}")
  })
})

describe("logic giá / tồn / offline KHÔNG được đụng", () => {
  /**
   * M3 là pack TRÌNH BÀY. Những hàm này quyết định chặn lưu đơn hay không
   * — đổi chúng ở đây là đổi nghiệp vụ dưới danh nghĩa làm đẹp.
   */
  it("các chốt tồn kho còn nguyên", () => {
    for (const fn of [
      "isSaleLineOverstock",
      "checkOverstock",
      "availableForExchangeLine",
      "isReturnLineOverstock",
      "getUnitPrice",
    ]) {
      expect(CODE, `mất ${fn}`).toContain(fn)
    }
  })

  it("chốt chặn nút lưu còn nguyên", () => {
    expect(CODE).toContain("disabled={loading || (hasOverstock && !allowOversell) || hasPriceViolation || !customerId}")
  })

  /** Truy vấn phân trang của tồn kho — bỏ là quay lại trần 1.000 dòng. */
  it("vẫn phân trang khi nạp tồn kho", () => {
    expect(CODE).toContain("fetchAllForAggregate")
  })
})
