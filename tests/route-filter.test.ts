import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const RF = code(read("src/components/orders/route-filter.tsx"))
const ORDERS = code(read("src/app/(dashboard)/orders/page.tsx"))
const SHELL = code(read("src/components/layout/dashboard-shell.tsx"))

/**
 * NGƯỜI DÙNG YÊU CẦU (máy tính): "Khi mở lọc phải có tìm kiếm, các tuyến
 * có đơn ở trên kèm số đơn (trạng thái đã duyệt)".
 */
describe("Bộ lọc tuyến: tìm được, tuyến có đơn chờ xuất xếp trên kèm số", () => {
  it("có ô tìm, lọc theo tên lẫn mã tuyến, bỏ dấu", () => {
    expect(RF).toContain('placeholder="Tìm tuyến…"')
    expect(RF).toContain("viMatchAllWords(term, r.name, r.code)")
  })

  it("tuyến có đơn xếp trước, nhiều đơn hơn lên trên, in số đơn", () => {
    expect(RF).toContain(".filter((r) => (counts[r.code] ?? 0) > 0)")
    expect(RF).toContain(".sort((a, b) => (counts[b.code] ?? 0) - (counts[a.code] ?? 0)")
    expect(RF).toContain("{count} đơn")
    expect(RF).toContain("Đang có đơn chờ xuất")
  })

  /** Tuyến không có đơn vẫn chọn được — nó chỉ xuống dưới, không biến mất. */
  it("tuyến chưa có đơn vẫn nằm trong danh sách", () => {
    expect(RF).toContain("const idle = visible.filter((r) => !(counts[r.code] ?? 0))")
    expect(RF).toContain("{idle.map((r) => (")
  })

  /**
   * ⚠ Số là số PHIẾU TẠM chưa xuất — hàng đang chờ ra xe — không phải
   * tổng đơn mọi thời. Và phải phân trang: server cắt 1.000 dòng không báo.
   */
  it("số đếm lấy phiếu tạm chờ xuất, nhúng tuyến của điểm bán, có phân trang", () => {
    const i = ORDERS.indexOf("async function loadRouteCounts()")
    expect(i).toBeGreaterThan(0)
    const fn = ORDERS.slice(i, ORDERS.indexOf("\n    }", i))
    expect(fn).toContain("fetchAllForAggregate<")
    expect(fn).toContain('.eq("status", "submitted")')
    expect(fn).toContain('"id, customer:customers!inner(channel)"')
    // Đọc hỏng thì ghi log, không im lặng.
    expect(fn).toContain("console.warn(")
  })

  it("mobile (trong sheet, inline) và desktop (popover) dùng CÙNG một component, cùng một bộ số", () => {
    expect(ORDERS).toContain("<RouteFilter routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />")
    expect(ORDERS).toContain("<RouteFilter inline routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />")
    // Popover lồng trong sheet là hai lớp phủ chồng nhau — trong sheet vẽ thẳng.
    expect(RF).toContain("if (inline) {")
    expect(RF).toContain("autoFocus={!inline}")
  })
})

describe("Máy tính vào /sell phải thoát ra được", () => {
  /**
   * ⚠ NGƯỜI DÙNG BÁO: "Ấn vào Bán hàng > Bán hàng → không thoát ra được".
   * Nhánh launcher bỏ cả Sidebar lẫn Header, còn nav dưới thì lg:hidden —
   * trên màn lớn không còn đường nào ra khỏi /sell ngoài gõ lại địa chỉ.
   */
  it("nhánh launcher dựng Sidebar (hidden lg:flex) cạnh nội dung", () => {
    const i = SHELL.indexOf("if (isLauncher)")
    const branch = SHELL.slice(i, SHELL.indexOf("\n  return (", i))
    expect(branch).toContain("<Sidebar role={role} />")
    expect(branch).toContain('<div className="min-w-0 flex-1">{children}</div>')
  })
})
