import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  backToOrder,
  backToReturnSlip,
  SELL_ORDER_HREF,
  SELL_RETURNS_HREF,
} from "../src/lib/nav/sell-nav"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const POS = code(read("src/app/(dashboard)/sell/page.tsx"))
const RET = code(read("src/app/(dashboard)/sell/returns/page.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))

const fakeRouter = () => ({ back: vi.fn(), replace: vi.fn() })

/**
 * ⚠ LỖI NGƯỜI DÙNG BÁO: "màn hàng trả về trong đơn — ấn xong, về đơn hàng
 * thì lại ra phần chọn hàng trả."
 *
 * Ngăn xếp lịch sử lúc đó:
 *     giỏ hàng → phiếu trả → chọn hàng trả → phiếu trả
 * vì màn chọn hàng `push` một bản phiếu trả THỨ HAI thay vì thay chính nó.
 * Nút "Xong · về đơn hàng" gọi `router.back()`, mà tầng ngay dưới không
 * phải giỏ hàng — nó là màn chọn hàng. Bấm Xong là rơi ngược vào đúng chỗ
 * vừa thoát ra, và bấm mãi không ra khỏi vòng.
 */
describe("Chọn hàng trả xong thì ĐÓNG màn đó, không mở thêm một màn nữa", () => {
  it("quay về phiếu trả bằng replace, không phải push", () => {
    const r = fakeRouter()
    backToReturnSlip(r)
    expect(r.replace).toHaveBeenCalledWith(SELL_RETURNS_HREF)
    expect(r.back, "push/back đều để lại tầng thừa trong ngăn xếp").not.toHaveBeenCalled()
  })

  /**
   * ⚠ Soi TỪNG lời gọi ở màn chọn hàng. Cả ba đường ra (chạm vào một mặt
   * hàng, nút "Xong" trên đầu, nút nổi dưới chân) đều phải đóng màn này —
   * chừa một đường dùng `push` là vòng lặp quay lại.
   */
  it("màn chọn hàng không còn đường nào push phiếu trả", () => {
    expect(POS, "còn push phiếu trả").not.toContain('router.push("/sell/returns")')
    const calls = POS.match(/backToReturnSlip\(router\)/g) ?? []
    // Thiết kế 24/09/2026 (1a): hai đường ra — nút lùi ở đầu và "Tiếp tục" ở
    // thanh đáy (thẻ +/− ngay tại chỗ, không rời màn; bỏ chế độ chọn nhiều).
    expect(calls.length, "thiếu đường quay về phiếu trả").toBe(2)
  })

  /** Giỏ hàng MỞ phiếu trả nên nó vẫn `push` — đó là tầng đúng. */
  it("giỏ hàng vẫn mở phiếu trả bằng push", () => {
    expect(CART).toContain('router.push("/sell/returns")')
  })
})

describe("Nút hứa 'về đơn hàng' thì phải tới đơn hàng", () => {
  /**
   * Ngăn xếp sạch (mở phiếu trả từ giỏ) thì `back()` vừa đúng đích vừa
   * không để lại một tầng giỏ hàng trùng.
   */
  it("có chỗ để lùi thì lùi một tầng", () => {
    const r = fakeRouter()
    vi.stubGlobal("window", { history: { length: 4 } })
    backToOrder(r)
    expect(r.back).toHaveBeenCalled()
    expect(r.replace).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  /**
   * ⚠ KHÔNG CÓ GÌ ĐỂ LÙI — mở thẳng bằng đường dẫn, hoặc vừa tải lại
   * trang. `back()` lúc đó đưa người dùng RA KHỎI ứng dụng, trong khi nút
   * ghi rõ "về đơn hàng".
   */
  it("không có chỗ để lùi thì đi thẳng tới đơn hàng", () => {
    const r = fakeRouter()
    vi.stubGlobal("window", { history: { length: 1 } })
    backToOrder(r)
    expect(r.replace).toHaveBeenCalledWith(SELL_ORDER_HREF)
    expect(r.back).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("chạy ngoài trình duyệt cũng không gọi back vào hư không", () => {
    const r = fakeRouter()
    const saved = globalThis.window
    // @ts-expect-error — dựng lại cảnh render phía máy chủ.
    delete globalThis.window
    backToOrder(r)
    expect(r.replace).toHaveBeenCalledWith(SELL_ORDER_HREF)
    globalThis.window = saved
  })

  /** Cả hai đường ra của phiếu trả — mũi tên trên đầu và nút Xong. */
  it("phiếu trả không còn gọi thẳng router.back()", () => {
    expect(RET, "router.back() đoán đích, không biết đích").not.toContain("router.back()")
    const calls = RET.match(/backToOrder\(router\)/g) ?? []
    expect(calls.length, "thiếu đường về đơn hàng").toBe(2)
  })
})
