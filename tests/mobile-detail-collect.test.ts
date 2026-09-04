import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Pack M4 (chi tiết đơn) · M5 (thu tiền) · M6 (giao hàng) · M7 (SKILL.md).
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

const ORDER_DETAIL = strip(read("src/app/(dashboard)/orders/[id]/page.tsx"))
const COLLECT = strip(read("src/app/(dashboard)/receivables/collect/page.tsx"))
const RECEIVABLES = strip(read("src/app/(dashboard)/receivables/page.tsx"))
const DELIVERY = strip(read("src/app/(dashboard)/deliveries/[id]/page.tsx"))
const BAR = strip(read("src/components/ui/sticky-action-bar.tsx"))
const SKILL = read(".claude/skills/design-ux-ui/SKILL.md")

describe("M4.1 — dòng hàng không còn bị cắt chữ", () => {
  /**
   * ⚠ Ở 317px, lưới 3 cột cho mỗi cột ~95px mà "26.400.000" cần ~105px →
   * cột Thành tiền BỊ CẮT. Đã chụp lại trên máy thật.
   */
  it("bỏ lưới 3 cột ở khối dòng hàng mobile", () => {
    expect(ORDER_DETAIL).not.toContain('grid grid-cols-3 gap-2 mt-2 text-xs')
  })

  it("chế độ xem: SL × đơn giá một dòng, thành tiền tách riêng canh phải", () => {
    expect(ORDER_DETAIL).toMatch(/\{line\.quantity\} \{line\.unit_name\} × \{formatCurrency\(line\.unit_price\)\}/)
    expect(ORDER_DETAIL).toMatch(/text-right text-\[15px\] font-bold tabular-data/)
  })

  /** Chế độ sửa mới bung hai ô nhập xếp dọc, mỗi ô 44px. */
  it("chế độ sửa dùng ô nhập 44px xếp dọc", () => {
    // Neo vào ĐÚNG khối mobile: `{inEdit ? (` đầu tiên trong file là của
    // BẢNG DESKTOP (ô h-8, đúng cho desktop) — lấy nhầm nó thì test đo
    // sai chỗ và vẫn xanh khi mobile hỏng.
    const i = ORDER_DETAIL.indexOf('<div className="mt-2 space-y-2">')
    expect(i, "không thấy khối sửa của bản mobile").toBeGreaterThan(0)
    const block = ORDER_DETAIL.slice(i, ORDER_DETAIL.indexOf("</div>\n                      )", i))
    expect(block.match(/h-11/g)?.length).toBeGreaterThanOrEqual(2)
    expect(block).not.toContain("h-8 mt-0.5")
  })

  /**
   * "-" khiến người dùng tưởng giao diện hỏng. Sản phẩm bị xoá khỏi danh
   * mục sau khi lên đơn là chuyện có thật (gặp trên SO-20260903-7045).
   */
  it("sản phẩm đã xoá nói thẳng, không hiện dấu gạch", () => {
    expect(ORDER_DETAIL).toContain("Sản phẩm đã xoá")
  })
})

describe("M4/M5 — StickyActionBar", () => {
  it("neo trên nav bằng token và tự trốn khi bàn phím mở", () => {
    // strip(): chú thích đầu file cũng nhắc `kb-hide` và `bottom-above-nav`
    // — soi mã thô thì xoá hẳn hai lớp đó khỏi className mà test vẫn xanh
    // (đã đo).
    expect(BAR).toContain("bottom-above-nav")
    expect(BAR).toContain("kb-hide")
    expect(BAR).toContain("lg:hidden")
  })
})

describe("M5.1 — màn thu tiền", () => {
  /**
   * ⚠ <Select> chỉ hiện một dòng chữ dài bị cắt trên điện thoại. NVBH
   * đang cầm tiền của khách — không được đoán mình chọn đúng khoản chưa.
   */
  it("chọn công nợ bằng thẻ, không bằng Select", () => {
    const i = COLLECT.indexOf("Công nợ *")
    expect(i).toBeGreaterThan(0)
    const block = COLLECT.slice(i, i + 1600)
    expect(block).not.toContain("<Select")
    expect(block).toContain("min-h-16")
    expect(block).toContain("aria-pressed={active}")
  })

  /**
   * ⚠ type="number" không nhóm hàng nghìn ⇒ NVBH gõ 12400000 và KHÔNG đếm
   * được số 0. MoneyInput tự format 12.400.000.
   */
  it("số tiền dùng MoneyInput, để to hẳn", () => {
    expect(COLLECT).toContain("<MoneyInput")
    expect(COLLECT).toContain("h-14 text-right text-2xl font-bold")
    const i = COLLECT.indexOf("Số tiền thu *")
    expect(COLLECT.slice(i, i + 700)).not.toContain('type="number"')
  })

  /** Chip số tiền nhanh, mỗi chip 44px. */
  it("có chip Thu đủ / 50% / Làm tròn / Xoá", () => {
    for (const chip of ["Thu đủ", "50%", "Làm tròn", "Xoá"]) {
      expect(COLLECT, `thiếu chip ${chip}`).toContain(chip)
    }
    const i = COLLECT.indexOf("Thu đủ")
    expect(COLLECT.slice(i - 300, i)).toContain("tap")
  })

  /** Làm tròn phải XUỐNG và không được vượt số nợ. */
  it("làm tròn xuống, và ẩn khi bằng đúng số nợ", () => {
    expect(COLLECT).toContain("Math.floor(remaining / 100_000) * 100_000")
    expect(COLLECT).toMatch(/roundedDown > 0 && roundedDown < remaining/)
  })

  /**
   * ⚠ Trước đây chỉ hiện nợ TRƯỚC khi thu — NVBH phải tự trừ nhẩm ngay
   * lúc đang đếm tiền.
   */
  it("hiện dư nợ SAU khi thu, đổi màu khi về 0", () => {
    expect(COLLECT).toContain("const afterCollect = remaining - amountNum")
    expect(COLLECT).toContain("Còn nợ sau khi thu")
    expect(COLLECT).toMatch(/afterCollect > 0 \? "text-error" : "text-tertiary"/)
  })

  /**
   * ⚠ `max` trên <input type="number"> KHÔNG chặn được khi gõ tay — trình
   * duyệt chỉ dùng nó cho nút tăng/giảm. Phải chặn ở nút VÀ ở submit:
   * Enter trên bàn phím ảo gửi form mà không đi qua nút.
   */
  it("chặn thu quá số nợ ở CẢ HAI chỗ", () => {
    expect(COLLECT).toContain("const overCollect = amountNum > remaining")
    expect(COLLECT).toMatch(/if \(amountNum <= 0 \|\| amountNum > remaining\)/)
    expect(COLLECT).toContain("disabled={!canSubmit}")
  })

  /** SKILL.md §4: disable + nói lý do, dễ tìm hơn là ẩn nút. */
  it("nút bị khoá phải NÓI RA lý do", () => {
    expect(COLLECT).toContain("const submitBlockReason")
    expect(COLLECT).toContain('title={submitBlockReason || undefined}')
    for (const reason of ["Chọn khoản nợ", "Nhập số tiền", "Vượt số còn nợ"]) {
      expect(COLLECT, `thiếu lý do "${reason}"`).toContain(reason)
    }
  })

  it("nút xác nhận vào StickyActionBar, bỏ nút Huỷ trên mobile", () => {
    expect(COLLECT).toContain("<StickyActionBar>")
    expect(COLLECT).toContain('className="hidden lg:flex gap-2 justify-end"')
    expect(COLLECT).toContain("pb-nav-action")
  })

  /** Một nguồn số tiền duy nhất — parseInt rải rác là chỗ để lệch nhau. */
  it("dùng amountNum ở mọi chỗ, không parseInt lặp lại", () => {
    expect(COLLECT).not.toContain("parseInt(amount)")
    expect(COLLECT).toContain("const amountNum = parseInt(amount")
  })
})

describe("M5.2 — /receivables sắp theo mức gấp", () => {
  /** NVBH đi thu cần biết khoản nào gấp nhất, không phải khoản nào mới tạo. */
  it("hạn cũ nhất trước, khoản không có hạn xuống cuối", () => {
    expect(RECEIVABLES).toContain('.order("due_date", { ascending: true, nullsFirst: false })')
  })
})

describe("M6.2 — điểm dừng của tài xế", () => {
  /** Tài xế đi xe máy, dừng bên đường — không mở được menu con. */
  it("mỗi điểm dừng có Gọi / Chỉ đường / Chi tiết, đều 44px", () => {
    const i = DELIVERY.indexOf('<div className="space-y-3 lg:hidden">')
    expect(i).toBeGreaterThan(0)
    const block = DELIVERY.slice(i, DELIVERY.indexOf('<div className="hidden overflow-x-auto', i))
    expect(block).toMatch(/href=\{`tel:\$\{cust\.phone\}`\}/)
    expect(block).toContain("google.com/maps/dir/?api=1&destination=")
    expect(block.match(/h-11/g)?.length).toBeGreaterThanOrEqual(3)
  })

  /** Địa chỉ Việt Nam có dấu và dấu phẩy — không encode là link hỏng. */
  it("địa chỉ được encode trước khi nhét vào URL", () => {
    expect(DELIVERY).toContain("encodeURIComponent(addr)")
  })

  /** Thiếu SĐT / địa chỉ thì không render link rỗng. */
  it("thiếu dữ liệu thì hiện ô mờ, không phải link hỏng", () => {
    expect(DELIVERY).toContain("Chưa có SĐT")
    expect(DELIVERY).toContain("Chưa có địa chỉ")
  })

  it("bảng cũ chỉ còn ở desktop", () => {
    expect(DELIVERY).toContain('className="hidden overflow-x-auto rounded-xl border lg:block"')
  })
})

describe("M7 — SKILL.md không để lần sau đi lùi", () => {
  /** Con số 36px cũ chính là thứ sinh ra 107 vùng chạm dưới chuẩn. */
  it("sàn vùng chạm nâng lên 44px", () => {
    expect(SKILL).toContain("Tap targets **≥ 44px**")
    expect(SKILL).not.toContain("Tap targets ≥ 36px")
  })

  it("có mục §2b Mobile", () => {
    expect(SKILL).toContain("## 2b. Mobile")
  })

  /** Bảng token + bảng primitive: người sau tra là thấy, không phải đoán. */
  it("liệt kê token chrome và primitive dùng chung", () => {
    for (const t of ["--app-bar-h", "--bottom-nav-h", ".pb-nav-action", ".bottom-above-nav"]) {
      expect(SKILL, `thiếu ${t}`).toContain(t)
    }
    for (const c of [
      "MobileFilterBar",
      "SegmentedScroller",
      "MobileRecordCard",
      "LoadMore",
      "QtyStepper",
      "StickyActionBar",
      "ProductPickerSheet",
    ]) {
      expect(SKILL, `thiếu ${c}`).toContain(c)
    }
  })

  /** Mỗi luật phải kèm LÝ DO đo được, không thì lần sau lại bị bỏ qua. */
  it("ghi cả những cái bẫy đã trả giá để biết", () => {
    for (const trap of [
      "viewport-fit=cover",
      "visualViewport",
      "AbortError",
      "hydration mismatch",
      "type=\"number\"",
    ]) {
      expect(SKILL, `thiếu bẫy: ${trap}`).toContain(trap)
    }
  })
})
