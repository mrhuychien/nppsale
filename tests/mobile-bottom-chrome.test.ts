import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { showsBottomNav, OWN_ACTION_BAR_ROUTES, TASK_FLOW_ROUTES } from "../src/lib/nav/mobile-chrome"

const isTaskFlow = (route: string) => (TASK_FLOW_ROUTES as readonly string[]).includes(route)

const ROOT = resolve(__dirname, "..")
const SELL_DIR = resolve(ROOT, "src/app/(dashboard)/sell")
const read = (p: string) => readFileSync(p, "utf-8")

/** Mọi màn trong luồng bán hàng: đường dẫn route + mã nguồn. */
function sellScreens(): Array<{ route: string; src: string }> {
  const out: Array<{ route: string; src: string }> = []
  const walk = (dir: string, route: string) => {
    const page = join(dir, "page.tsx")
    if (existsSync(page)) out.push({ route, src: read(page) })
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${route}/${e.name}`)
    }
  }
  walk(SELL_DIR, "/sell")
  return out
}

/**
 * Màn có tự dựng khối DÍNH ĐÁY hoặc phủ TOÀN MÀN của riêng nó không.
 *
 * `BarcodeScanner` tự dựng lớp phủ `fixed inset-0` bên trong nó, và
 * `SellBottomBar` giữ lớp `fixed inset-x-0 bottom-0` bên trong nó — nên cả
 * hai đều tính là có, dù mã của chính trang không chứa lớp `fixed` nào.
 *
 * ⚠ Gỡ một trong ba vế là phép quét lặng lẽ bỏ sót cả một nhóm màn, và
 * chốt "có thanh riêng thì tắt nav" tưởng là xanh vì không còn màn nào để
 * xét.
 */
function hasOwnBottomChrome(src: string): boolean {
  return (
    /fixed inset-x-0 bottom-0/.test(src) ||
    /fixed inset-0/.test(src) ||
    /<SellBottomBar\b/.test(src) ||
    /<BarcodeScanner\b/.test(src)
  )
}

describe("Không màn nào có HAI thanh dính đáy chồng nhau", () => {
  /**
   * ⚠ LỖI NGƯỜI DÙNG BÁO. Màn giỏ hàng có thanh "Lưu tạm / Đặt hàng" dính
   * đáy, mà thanh nav cũng dính đáy và nằm TRÊN nó — hai nút quan trọng
   * nhất của cả luồng bị che mất một nửa. Cuộn kiểu gì cũng không thấy, vì
   * cả hai đều `fixed` và cuộn không làm chúng nhúc nhích.
   *
   * Đây là lỗi BỐ CỤC, không phải lỗi đệm: thêm padding chỉ đẩy nội dung,
   * không đẩy được một khối `fixed`.
   */
  const screens = sellScreens()

  it("quét được các màn của luồng bán hàng", () => {
    expect(screens.length).toBeGreaterThanOrEqual(6)
    expect(screens.map((s) => s.route)).toContain("/sell/cart")
  })

  it.each(sellScreens())("$route: có thanh riêng thì KHÔNG hiện nav", ({ route, src }) => {
    // Màn luồng tác vụ (thiết kế 24/09/2026) cố ý ẩn nav dù không có thanh
    // riêng — có nút lùi rõ ràng; xem `TASK_FLOW_ROUTES`.
    const own = hasOwnBottomChrome(src) || isTaskFlow(route)
    // Hai chiều, không chỉ một: có thanh riêng thì phải tắt nav, và tắt
    // nav thì phải vì có thanh riêng — tắt thừa là lấy mất đường đi của
    // người dùng mà chẳng đổi lấy gì.
    expect(showsBottomNav(route), own ? `${route} có thanh riêng mà vẫn hiện nav` : `${route} không có thanh riêng mà lại tắt nav`).toBe(!own)
  })

  /** Màn không có thanh riêng phải chừa đệm cho nav, nếu không nội dung cuối bị che. */
  it.each(sellScreens().filter((s) => !hasOwnBottomChrome(s.src) && !isTaskFlow(s.route)))(
    "$route: chừa đệm đáy cho thanh nav",
    ({ src }) => {
      expect(src).toContain("pb-nav")
    }
  )

  /**
   * ⚠ Màn có thanh riêng cũng phải chừa đệm — cho CHÍNH thanh đó. Thử phá
   * cho thấy chốt trên bỏ sót hẳn nhóm này: gỡ `pb-24` của màn điều khoản
   * mà mọi phép kiểm vẫn XANH, trong khi dòng cuối trang chui xuống dưới
   * nút "Xong".
   */
  it.each(
    sellScreens().filter(
      (s) => /fixed inset-x-0 bottom-0/.test(s.src) || /<SellBottomBar\b/.test(s.src)
    )
  )("$route: chừa đệm đáy cho thanh của chính nó", ({ src }) => {
    const root = /<div className="([^"]*min-h-screen[^"]*)"/.exec(src)
    expect(root, "không tìm thấy khối gốc của trang").toBeTruthy()
    expect(root![1], `khối gốc thiếu đệm đáy: ${root![1]}`).toMatch(/\bpb-(nav|\d+|\[)/)
  })
})

describe("Vỏ trang thật sự có dùng phép quyết định này", () => {
  /**
   * ⚠ Thử phá cho thấy gỡ hẳn điều kiện ở `dashboard-shell` mà mọi chốt
   * trên vẫn XANH — vì chúng chỉ soi hàm thuần và mã từng màn, không soi
   * chỗ DÙNG. Hàm đúng mà không ai gọi thì nav vẫn che nút như cũ.
   */
  const SHELL = read(resolve(ROOT, "src/components/layout/dashboard-shell.tsx"))

  it("mọi lần dựng thanh nav đều đi qua cờ showNav", () => {
    const uses = SHELL.match(/<MobileNav\b/g) ?? []
    expect(uses.length, "không tìm thấy lần dựng MobileNav nào").toBeGreaterThan(0)
    const guarded = SHELL.match(/\{showNav && <MobileNav\b/g) ?? []
    expect(guarded.length).toBe(uses.length)
  })

  it("cờ lấy từ lib dùng chung, không tự chế lại", () => {
    expect(SHELL).toContain('from "@/lib/nav/mobile-chrome"')
    expect(SHELL).toContain("const showNav = showsBottomNav(pathname)")
  })
})

describe("Luồng tác vụ /sell ẩn nav (thiết kế 24/09/2026)", () => {
  it("màn Thêm hàng và Chọn khách không có nav", () => {
    expect(showsBottomNav("/sell")).toBe(false)
    expect(showsBottomNav("/sell/customer")).toBe(false)
  })

  /** So đúng đường dẫn — tiền tố "/sell" mà khớp là tắt nav ở MỌI màn bán hàng. */
  it("so đúng đường dẫn, không theo tiền tố", () => {
    expect(showsBottomNav("/sell/drafts")).toBe(true)
    expect(showsBottomNav("/sellx")).toBe(true)
  })

  it("màn luồng tác vụ có nút lùi", () => {
    for (const r of TASK_FLOW_ROUTES) {
      const src = read(join(SELL_DIR, r.replace(/^\/sell\/?/, ""), "page.tsx"))
      expect(src, `${r} thiếu nút lùi`).toContain("<ChevronLeft")
    }
  })
})

describe("Danh sách màn tự dựng thanh đáy", () => {
  it("mọi đường dẫn khai trong danh sách đều là route có thật", () => {
    for (const r of OWN_ACTION_BAR_ROUTES) {
      const dir = r.replace("/sell/", "")
      expect(existsSync(join(SELL_DIR, dir, "page.tsx")), `${r} không có màn`).toBe(true)
    }
  })

  it("màn ngoài danh sách vẫn có nav", () => {
    expect(showsBottomNav("/sell/drafts")).toBe(true)
    expect(showsBottomNav("/sell/done")).toBe(true)
    expect(showsBottomNav("/orders")).toBe(true)
    expect(showsBottomNav("/home")).toBe(true)
  })

  /** So theo tiền tố: màn con của giỏ hàng cũng không được có nav. */
  it("màn con kế thừa quyết định của màn cha", () => {
    expect(showsBottomNav("/sell/cart")).toBe(false)
    expect(showsBottomNav("/sell/cart/abc")).toBe(false)
    // Nhưng không bắt nhầm đường dẫn chỉ TRÙNG TIỀN TỐ chuỗi.
    expect(showsBottomNav("/sell/cartoon")).toBe(true)
  })
})
