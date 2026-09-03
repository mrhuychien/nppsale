import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Pack M1 — app bar + thanh nav dưới + ngăn kéo menu.
 *
 * Test đọc mã nguồn, không dựng giao diện (dự án chưa có hạ tầng test
 * component). Chúng chặn được lỗi cũ quay lại chứ không thay được việc mở
 * điện thoại thật ra đo.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Bỏ chú thích, để không tự bắt lỗi trên đoạn văn giải thích lỗi cũ. */
function code(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
}

const HEADER = read("src/components/layout/header.tsx")
const NAV = read("src/components/layout/mobile-nav.tsx")
const SHELL = read("src/components/layout/dashboard-shell.tsx")
const PAGE_HEADER = read("src/components/ui/page-header.tsx")
const CTX = read("src/components/layout/page-title-context.tsx")
const SHEET = read("src/components/ui/sheet.tsx")
const SIDEBAR = read("src/components/layout/sidebar.tsx")
const HOME = read("src/app/(dashboard)/home/page.tsx")
const OVERLAY = read("src/components/layout/mobile-search-overlay.tsx")

describe("M1.1 — app bar: hết trùng tiêu đề", () => {
  /**
   * Lỗi đo được: app bar hiện "Quản lý công nợ" (từ bảng PAGE_TITLES), rồi
   * PageHeader hiện "Công nợ của tôi" ngay dưới — hai tiêu đề khác chữ, cùng
   * nghĩa, tốn khoảng 120px trên màn cao 691px.
   */
  it("PageHeader ẩn khối tiêu đề trên mobile", () => {
    const i = PAGE_HEADER.indexOf("<h1")
    expect(i).toBeGreaterThan(0)
    // Thẻ bọc H1 phải là `hidden lg:block`.
    const wrapper = PAGE_HEADER.slice(PAGE_HEADER.lastIndexOf("<div", i), i)
    expect(wrapper).toContain("hidden lg:block")
  })

  it("PageHeader đẩy tiêu đề lên app bar", () => {
    expect(PAGE_HEADER).toContain("setPageTitle({ title, backHref })")
    // Dọn khi rời trang, nếu không trang sau còn giữ tiêu đề cũ.
    expect(PAGE_HEADER).toMatch(/return clearPageTitle/)
  })

  /**
   * PageHeader được dùng ở cả trang không có Provider (login, setup, trang
   * lỗi). Bản `usePageTitle` ném lỗi khi thiếu Provider, nên PageHeader phải
   * dùng bản optional — nếu không là làm trắng cả màn hình đăng nhập chỉ vì
   * một tính năng trình bày.
   */
  it("PageHeader dùng hook bản optional, không phải bản ném lỗi", () => {
    expect(PAGE_HEADER).toContain("usePageTitleOptional")
    expect(PAGE_HEADER).not.toMatch(/\busePageTitle\b(?!Optional)/)
  })

  /**
   * backHref có BA trạng thái: undefined (không có nút back → hiện
   * hamburger), null (back bằng router.back), "/orders" (đi tới đường dẫn).
   * Gộp undefined vào null là mất nút mở menu trên mọi trang chi tiết.
   */
  it("app bar phân biệt undefined và null của backHref", () => {
    expect(HEADER).toContain("backHref !== undefined")
    expect(HEADER).toMatch(/backHref \? router\.push\(backHref\) : router\.back\(\)/)
  })

  it("tiêu đề trang thắng tiêu đề nhóm, nhưng vẫn có bản dự phòng", () => {
    expect(HEADER).toMatch(/pushedTitle \?\? fallbackTitle/)
    expect(HEADER).toContain("PAGE_TITLES")
  })

  /**
   * Ô tìm kiếm cũ là `hidden md:block`, nên trên điện thoại KHÔNG có đường
   * nào để tìm một mã đơn — NVBH phải cuộn danh sách.
   */
  it("app bar có nút tìm kiếm riêng cho mobile", () => {
    const i = HEADER.indexOf('aria-label="Tìm đơn hàng"')
    expect(i).toBeGreaterThan(0)
    const btn = HEADER.slice(HEADER.lastIndexOf("<Button", i), i)
    expect(btn).toContain("md:hidden")
    expect(HEADER).toContain("<MobileSearchOverlay")
  })

  it("lớp phủ tìm kiếm đi tới /orders?q= và đóng được bằng Esc", () => {
    expect(OVERLAY).toContain("/orders?q=${encodeURIComponent(term)}")
    expect(OVERLAY).toContain('e.key === "Escape"')
    // Bàn phím ảo phải hiện nút "Tìm", không phải "Xuống dòng".
    expect(OVERLAY).toContain('enterKeyHint="search"')
  })

  it("app bar và lớp phủ nằm trong Provider", () => {
    expect(SHELL).toContain("<PageTitleProvider>")
    // Cả hai nhánh (trang chủ và trang thường) đều phải được bọc.
    expect(SHELL.match(/<PageTitleProvider>/g)?.length).toBe(2)
  })
})

describe("M1.2 — thanh nav 5 ô, không còn FAB nổi", () => {
  /**
   * Lý do bỏ FAB: nó đè lên nội dung ở /customers, /receivables,
   * /deliveries; ở /home nó trùng chức năng với nút "Tạo đơn hàng mới" và đè
   * lên chính nút đó; đáy nó bị nav nuốt 15px; và nó nằm góc phải nên khó
   * cho tay trái.
   */
  it("không còn FAB nổi ở đâu nữa", () => {
    expect(NAV).not.toContain("hasMobileFab")
    expect(NAV).not.toContain("ROLE_FAB")
    expect(NAV).not.toMatch(/\bfixed\b[^"]*\bbottom-\[/)
    expect(SHELL).not.toContain("hasMobileFab")
  })

  it("hành động chính nằm ở ô giữa thanh nav", () => {
    expect(NAV).toContain("ROLE_ACTION")
    // 2 mục trái, action, 2 mục phải.
    expect(NAV).toContain("items.slice(0, 2)")
    expect(NAV).toContain("items.slice(2, 4)")
  })

  /**
   * `driver` chỉ có 2 mục và không có hành động chính → grid phải tự co về
   * 2 cột, không để lại ô trống hay chia 5 phần.
   */
  it("số cột grid tính từ số ô thật, không cứng 5", () => {
    expect(NAV).toMatch(/left\.length \+ \(showAction \? 1 : 0\) \+ right\.length/)
    expect(NAV).toContain("repeat(${cols}, minmax(0,1fr))")
  })

  it("cần ít nhất 2 mục mới chèn ô hành động vào giữa", () => {
    expect(NAV).toMatch(/items\.length >= 2/)
  })

  /** Quyền phải được kiểm cho cả ô hành động, không chỉ 4 mục điều hướng. */
  it("ô hành động cũng qua canAccessModule", () => {
    expect(NAV).toMatch(/canAccessModule\(role,\s*action\.module\)/)
  })

  it("bỏ mục Menu khỏi thanh nav", () => {
    expect(code(NAV)).not.toContain('"Menu"')
    expect(code(NAV)).not.toContain("onMenuClick")
  })

  /** Chữ 10px in đậm một mình không đủ để nhận ra ô đang chọn. */
  it("ô đang chọn có chỉ báo nhìn thấy được, không chỉ chữ đậm", () => {
    expect(NAV).toContain('aria-current={active ? "page" : undefined}')
    expect(NAV).toMatch(/rounded-b-full/)
  })

  it("thanh nav có nhãn cho trình đọc màn hình", () => {
    expect(NAV).toContain('aria-label="Điều hướng chính"')
  })

  /** Thanh gạt iPhone nằm dưới nav — không có pb-safe là nav bị che. */
  it("thanh nav chừa safe-area đáy", () => {
    const i = NAV.indexOf("<nav")
    expect(NAV.slice(i, NAV.indexOf(">", i))).toContain("pb-safe")
  })
})

describe("M1.3 — ngăn kéo menu là bottom sheet", () => {
  it("bottom sheet bo góc trên, cao tối đa 85vh, cuộn được, có pb-safe", () => {
    const i = SHEET.indexOf("bottom:")
    const decl = SHEET.slice(i, SHEET.indexOf("left:", i))
    expect(decl).toContain("rounded-t-3xl")
    expect(decl).toContain("max-h-[85vh]")
    expect(decl).toContain("overflow-y-auto")
    expect(decl).toContain("pb-safe")
  })

  it("có thanh kéo, và chỉ ở dạng bottom", () => {
    expect(SHEET).toMatch(/side === "bottom" &&/)
  })

  /**
   * Nút ✕ của Radix là `absolute right-4 top-4`. Ngăn kéo dùng `p-0` nên nó
   * đè lên ô đầu tiên của lưới menu. Bottom sheet đã có thanh kéo và bấm ra
   * ngoài để đóng, nên bỏ ✕ ở dạng đó.
   */
  it("không render ✕ đè nội dung ở bottom sheet", () => {
    expect(SHEET).toMatch(/side !== "bottom" &&/)
  })

  it("shell mở menu bằng bottom sheet, không phải ngăn kéo trái", () => {
    expect(SHELL).toContain('side="bottom"')
    expect(SHELL).not.toContain('side="left"')
  })

  /**
   * Danh sách dọc 8 nhóm accordion trong một sheet cao 85vh nghĩa là mỗi lần
   * muốn tới một trang phải bung nhóm rồi cuộn. Lưới 3 cột cho ngón cái với
   * tới cả 3 cột.
   */
  it("sidebar bản mobile là lưới 3 cột", () => {
    const i = SIDEBAR.indexOf("if (mobile)")
    expect(i).toBeGreaterThan(0)
    const block = SIDEBAR.slice(i, SIDEBAR.indexOf("\n  return (", i))
    expect(block).toContain("grid-cols-3")
    // Không dùng lại accordion trong nhánh mobile.
    expect(block).not.toContain("expandedGroups")
    expect(block).not.toContain("ScrollArea")
  })

  /** Ô lưới phải đủ 64px chiều cao (min-h-16 = 64px). */
  it("ô lưới menu cao ít nhất 64px", () => {
    const i = SIDEBAR.indexOf("function MenuTile")
    expect(i).toBeGreaterThan(0)
    expect(SIDEBAR.slice(i)).toContain("min-h-16")
  })

  /**
   * Nhánh trang chủ không có nút hamburger nên không gì mở được ngăn kéo —
   * dựng nó ở đó là để lại state chết. Bản thân trang chủ đã là lưới toàn bộ
   * chức năng.
   */
  it("nhánh trang chủ không dựng ngăn kéo menu", () => {
    const i = SHELL.indexOf("if (isLauncher)")
    expect(i).toBeGreaterThan(0)
    const branch = SHELL.slice(i, SHELL.indexOf("\n  return (", i))
    expect(branch).not.toContain("{menuSheet}")
    // Nhưng thanh nav dưới thì vẫn phải có.
    expect(branch).toContain("<MobileNav role={role} />")
  })
})

describe("M1 — /home: câu quote không chiếm màn hình đầu", () => {
  /**
   * Quote nằm ngay dưới lời chào tức chiếm chỗ đẹp nhất và đẩy nút "Tạo đơn
   * hàng mới" xuống dưới mép nhìn thấy. Thứ tự mới: lời chào → 4 ô số liệu →
   * CTA lớn → lưới chức năng → quote.
   */
  it("quote nằm SAU lưới chức năng", () => {
    const cta = HOME.indexOf("Tạo đơn hàng mới")
    const grid = HOME.indexOf("Tất cả chức năng")
    const quote = HOME.indexOf("QUOTE_CATEGORY_LABEL[dailyQuote.category]")
    expect(cta).toBeGreaterThan(0)
    expect(grid).toBeGreaterThan(0)
    expect(quote).toBeGreaterThan(0)
    expect(quote, "quote phải nằm sau CTA tạo đơn").toBeGreaterThan(cta)
    expect(quote, "quote phải nằm sau lưới chức năng").toBeGreaterThan(grid)
  })

  /** Đang tìm kiếm thì không hiện quote — nó không phải kết quả tìm kiếm. */
  it("quote vẫn giữ điều kiện isSales && !searching", () => {
    const i = HOME.indexOf("QUOTE_CATEGORY_LABEL[dailyQuote.category]")
    const before = HOME.slice(Math.max(0, i - 700), i)
    expect(before).toContain("isSales && !searching")
  })
})

describe("M1 — nút back của Provider không rò giữa các trang", () => {
  /** clearPageTitle phải trả backHref về undefined, không phải null. */
  it("clearPageTitle đặt lại backHref về undefined", () => {
    const i = CTX.indexOf("clearPageTitle = React.useCallback")
    const body = CTX.slice(i, CTX.indexOf("}, [])", i))
    expect(body).toContain("setBackHref(undefined)")
    expect(body).toContain("setTitle(null)")
  })
})
