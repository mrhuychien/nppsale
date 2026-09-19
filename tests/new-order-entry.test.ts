import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import { NEW_ORDER_HREF, newOrderHref } from "../src/lib/nav/new-order"
import { canSeeHref, NAV_PERMISSION } from "../src/lib/nav/nav-permission"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** Mọi file .ts/.tsx dưới src, đã bỏ chú thích. */
function sources(): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && statSync(p).isFile()) {
        out.push({ rel: p.slice(ROOT.length + 1), src: code(readFileSync(p, "utf-8")) })
      }
    }
  }
  walk(resolve(ROOT, "src"))
  return out
}

describe("Đường vào tạo đơn", () => {
  it("trỏ tới luồng bán hàng", () => {
    expect(NEW_ORDER_HREF).toBe("/sell")
    expect(newOrderHref()).toBe("/sell")
  })

  it("kèm được mã khách", () => {
    expect(newOrderHref("abc-123")).toBe("/sell?customerId=abc-123")
  })

  /** ⚠ Nối chuỗi thô là chỗ một ký tự `&` trong dữ liệu làm hỏng tham số. */
  it("mã khách được mã hoá, không nối chuỗi thô", () => {
    expect(newOrderHref("a&b=c")).toBe("/sell?customerId=a%26b%3Dc")
  })

  it("không có khách thì không đẻ ra tham số rỗng", () => {
    expect(newOrderHref(null)).toBe("/sell")
    expect(newOrderHref("   ")).toBe("/sell")
  })

  /**
   * ⚠ ĐÍCH PHẢI ĐƯỢC GÁC QUYỀN. Đổi nút sang một đường dẫn chưa khai trong
   * bảng phân quyền thì `canSeeHref` fail-closed và nút biến mất với MỌI vai
   * trò — hoặc tệ hơn, nếu ai đó khai lỏng thì nó hiện cho cả người chỉ được
   * xem đơn.
   */
  it("đích được khai đúng quyền TẠO đơn", () => {
    expect(NAV_PERMISSION[NEW_ORDER_HREF]).toEqual({
      module: "orders",
      feature: "orders",
      action: "create",
    })
    expect(canSeeHref("sales", NEW_ORDER_HREF)).toBe(true)
    expect(canSeeHref("driver", NEW_ORDER_HREF)).toBe(false)
  })

  /**
   * Màn cũ đã bị xoá nên không còn gì để gác — đường dẫn `/orders/new` nay
   * chỉ chuyển hướng sang `/sell`, và `/sell` mới là chỗ gác quyền.
   *
   * ⚠ Khai quyền cho một màn không còn tồn tại là RÁC, và rác trong bảng
   * này che mất chỗ đang thiếu.
   */
  it("màn tạo đơn cũ không còn trong bảng phân quyền", () => {
    expect(NAV_PERMISSION["/orders/new"]).toBeUndefined()
  })
})

describe("Không còn nút nào trỏ về màn tạo đơn cũ", () => {
  /**
   * ⚠ SÁU CHỖ CÓ NÚT "TẠO ĐƠN": trang chủ, menu bên trái, thanh nav dưới,
   * danh sách đơn, danh sách khách, hồ sơ khách, tuyến thăm. Sót một chỗ là
   * đưa người dùng vào một màn nhập hàng KHÁC — hai cách làm cho cùng một
   * việc, đúng thứ luồng bán hàng mới sinh ra để dọn.
   *
   * Quét TOÀN BỘ `src`, không liệt kê tay: chốt liệt kê tay chỉ canh được
   * những chỗ đã biết, mà lỗi nằm ở chỗ chưa biết.
   */
  it("không file nào còn dựng đường dẫn /orders/new", () => {
    const offenders = sources().filter((f) => /["'`]\/orders\/new/.test(f.src))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  /**
   * ⚠ Màn cũ đã xoá nhưng ĐƯỜNG DẪN thì không: `/orders/new` nằm trong dấu
   * trang của người dùng, trong tin nhắn hướng dẫn nhau, trong lịch sử
   * trình duyệt của mọi máy đang dùng. Để nó trả 404 thì người mở lên không
   * kết luận "màn này đổi chỗ" mà kết luận "app hỏng".
   */
  it("đường dẫn cũ chuyển hướng sang màn mới và giữ mã khách", () => {
    const redirect = code(read("src/app/(dashboard)/orders/new/page.tsx"))
    expect(redirect).toContain("redirect(newOrderHref(searchParams.customerId))")
    // Không còn dựng lại màn nào ở đây.
    expect(redirect).not.toContain("OrderForm")
  })

  /** Màn cũ và mọi thứ chỉ nó dùng đã đi hẳn, không để lại mã chết. */
  it.each([
    "src/components/orders/order-form.tsx",
    "src/components/orders/product-picker-sheet.tsx",
    "src/components/ui/qty-stepper.tsx",
    "src/components/ui/swipe-to-delete.tsx",
    "src/hooks/use-undoable-remove.ts",
    "src/lib/inventory/uom.ts",
  ])("%s đã bị xoá", (rel) => {
    expect(existsSync(resolve(ROOT, rel)), `${rel} vẫn còn`).toBe(false)
  })

  /** Đích đến phải là hằng số dùng chung, không phải chuỗi chép tay. */
  it.each([
    ["trang chủ", "src/app/(dashboard)/home/page.tsx", "href={newOrderHref()}"],
    ["menu bên trái", "src/components/layout/sidebar.tsx", "href={NEW_ORDER_HREF}"],
    ["thanh nav dưới", "src/components/layout/mobile-nav.tsx", "href: NEW_ORDER_HREF"],
    ["danh sách đơn", "src/app/(dashboard)/orders/page.tsx", "router.push(newOrderHref())"],
    [
      "hồ sơ khách",
      "src/app/(dashboard)/customers/[id]/page.tsx",
      "router.push(newOrderHref(customer.id))",
    ],
    // Danh sách khách nay là dòng gọn, không có nút con nào — nút "Tạo
    // đơn" chuyển vào thanh dính đáy của MÀN CHI TIẾT (một chạm từ dòng
    // khách). Hai chốt dưới đây phủ cả nút trên đầu lẫn nút dính đáy.
    ["hồ sơ khách — thanh đáy", "src/app/(dashboard)/customers/[id]/page.tsx", "href={newOrderHref(customer.id)}"],
    ["tuyến thăm", "src/app/(dashboard)/sales/pjp/page.tsx", "href={newOrderHref(route.customer_id)}"],
  ])("%s dùng hằng số dùng chung", (_label, rel, expected) => {
    expect(code(read(rel))).toContain(expected)
  })

  /** Menu bên trái gác nút theo ĐÚNG đích nó sẽ mở, không theo màn cũ. */
  it("menu bên trái xét quyền theo đích mới", () => {
    expect(code(read("src/components/layout/sidebar.tsx"))).toContain(
      "const canCreateOrder = canSeeHref(role, NEW_ORDER_HREF)"
    )
  })

  it("trang trợ giúp chỉ đúng màn", () => {
    const help = read("src/app/(dashboard)/help/page.tsx")
    expect(help).toContain("mở /sell")
    expect(help).not.toContain("/orders/new")
  })
})

describe("Mở màn bán hàng kèm sẵn khách", () => {
  const DEEP = code(read("src/components/sell/customer-deeplink.tsx"))
  const POS = code(read("src/app/(dashboard)/sell/page.tsx"))

  it("màn bán hàng có đọc tham số khách", () => {
    expect(POS).toContain("<SellCustomerDeepLink />")
    expect(DEEP).toContain('params.get("customerId")')
  })

  /**
   * ⚠ KHÔNG LẶNG LẼ ĐỔI KHÁCH CỦA GIỎ ĐANG CÓ HÀNG. Đổi khách là đổi BẢNG
   * GIÁ: mọi dòng trong giỏ lập tức tính theo giá cửa hàng khác. Bấm nhầm
   * một nút trên danh sách khách rồi quay lại giỏ thì thấy đúng số hàng cũ
   * nhưng sai số tiền, mà không có gì nói vì sao.
   */
  it("giỏ rỗng thì nhận luôn, giỏ có hàng thì hỏi", () => {
    expect(DEEP).toContain("if (cart.cart.length === 0 && !cart.editing) cart.setCustomerId(wanted)")
    expect(DEEP).toContain("Đổi khách")
    expect(DEEP).toContain("Giữ nguyên")
    expect(DEEP).toContain("sẽ tính lại theo bảng giá của khách này")
  })

  /** Đang sửa một đơn đã lưu thì càng không được đổi khách sau lưng. */
  it("đang sửa đơn thì không tự đổi khách", () => {
    expect(DEEP).toContain("!cart.editing")
  })

  /** ⚠ Mã khách lạ thì NÓI RA, đừng để nhân viên tưởng đã chọn khách rồi. */
  it("mã khách không có trong danh mục thì báo", () => {
    expect(DEEP).toContain("if (!known) {")
    expect(DEEP).toContain("Không tìm thấy khách hàng của đường dẫn này")
  })

  /** Chưa đọc xong danh mục thì chưa kết luận gì. */
  it("đợi đọc xong giỏ và danh mục rồi mới xử", () => {
    expect(DEEP).toContain("const ready = cart.ready && !loading")
    expect(DEEP).toContain("if (!wanted || !ready) return null")
  })
})

describe("Thanh dính đáy của luồng bán hàng không đè lên menu trái", () => {
  const BAR = code(read("src/components/sell/bottom-bar.tsx"))

  /**
   * ⚠ `fixed inset-x-0` NEO THEO CỬA SỔ, KHÔNG THEO CỘT NỘI DUNG. Menu bên
   * trái rộng `lg:w-60` và nằm cạnh nội dung; thanh `inset-x-0` chạy thẳng
   * qua dưới nó, che mất mục cuối của menu. Trên điện thoại không thấy vì
   * menu trái ẩn hẳn — lỗi chỉ lộ ra khi mở màn bán hàng bằng máy tính.
   */
  it("thanh dùng chung chừa đúng bề ngang menu trái", () => {
    expect(BAR).toContain("lg:left-60")
  })

  it("ba màn có thanh đáy đều dùng thanh dùng chung", () => {
    for (const rel of [
      "src/app/(dashboard)/sell/cart/page.tsx",
      "src/app/(dashboard)/sell/terms/page.tsx",
      "src/app/(dashboard)/sell/returns/page.tsx",
    ]) {
      const src = code(read(rel))
      expect(src, `${rel} không dùng SellBottomBar`).toContain("<SellBottomBar")
      // Chép tay lại lớp `fixed` là mở đường cho ba bản lệch nhau.
      expect(src, `${rel} vẫn còn thanh chép tay`).not.toContain("fixed inset-x-0 bottom-0")
    }
  })

  it("nút giỏ nổi ở màn tìm hàng cũng chừa menu trái", () => {
    expect(code(read("src/app/(dashboard)/sell/page.tsx"))).toContain(
      "lg:left-[calc(15rem+1rem)]"
    )
  })
})
