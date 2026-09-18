import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * TẠO KHÁCH NGAY TỪ MÀN CHỌN KHÁCH (chủ nhà yêu cầu).
 *
 * "Màn tạo đơn đặt hàng, phần chọn khách thêm nút Tạo khách mới — trên
 * điện thoại thì là dấu +; khi bấm vào chọn khách, hiện dấu + ở cạnh chữ
 * Chọn khách hàng."
 *
 * Cửa hàng chưa có trong danh mục là chuyện xảy ra GIỮA LÚC BÁN. Bắt NVBH
 * thoát ra, vào Khách hàng, tạo, rồi tự tìm đường về giỏ là đủ lâu để họ
 * bỏ luôn đơn.
 */
const PICKER = readFileSync("src/app/(dashboard)/sell/customer/page.tsx", "utf8")
const NEWPAGE = readFileSync("src/app/(dashboard)/customers/new/page.tsx", "utf8")
const FORM = readFileSync("src/components/customers/customer-form.tsx", "utf8")

describe("nút tạo khách trên màn chọn khách", () => {
  it("nằm ngay cạnh tiêu đề Chọn khách hàng", () => {
    const h = PICKER.indexOf(">Chọn khách hàng</h1>")
    const btn = PICKER.indexOf('aria-label="Tạo khách hàng mới"')
    expect(h).toBeGreaterThan(-1)
    expect(btn).toBeGreaterThan(h)
    // Cùng một hàng tiêu đề, không rơi xuống thân trang.
    expect(PICKER.indexOf("</div>", btn)).toBeLessThan(PICKER.indexOf("Tìm khách hàng"))
  })

  /** ⚠ Điện thoại chỉ còn dấu + — hàng tiêu đề không đủ chỗ cho chữ. */
  it("điện thoại chỉ hiện dấu +, màn rộng mới hiện chữ", () => {
    expect(PICKER).toContain("<Plus className=\"h-6 w-6\" />")
    expect(PICKER).toContain('className="hidden text-[15px] sm:inline">Tạo khách mới')
  })

  /**
   * ⚠ BIỂU TƯỢNG KHÔNG CÓ CHỮ THÌ PHẢI CÓ NHÃN CHO TRÌNH ĐỌC MÀN HÌNH.
   * Trên điện thoại nút này KHÔNG có chữ nào cả.
   */
  it("có nhãn cho trình đọc màn hình", () => {
    expect(PICKER).toContain('aria-label="Tạo khách hàng mới"')
  })

  it("mang theo đường quay về luồng bán hàng", () => {
    expect(PICKER).toContain('router.push("/customers/new?next=/sell/customer")')
  })
})

describe("tạo xong quay lại chọn sẵn khách vừa tạo", () => {
  /**
   * ⚠ GẮN MÃ NGAY, ĐỪNG ĐỢI DANH MỤC. Giỏ phải đúng từ giây đầu; cái còn
   * thiếu chỉ là tên để hiện.
   */
  it("gắn mã khách vào giỏ ngay khi quay về", () => {
    // ⚠ SOI TRONG THÂN EFFECT. Bản đầu của chốt này hỏi cả tệp, mà
    //   "reload()" còn nằm trong chú thích ngay phía trên — nên tôi bỏ hẳn
    //   lời gọi mà test vẫn xanh (đã thử phá).
    const eff = PICKER.slice(
      PICKER.indexOf("if (!picked || pickDone.current) return"),
      PICKER.indexOf("}, [picked])")
    )
    expect(eff).toContain("cart.setCustomerId(picked)")
    expect(eff).toContain("reload()")
    expect(eff).toContain("setPickWait(true)")
  })

  /**
   * ⚠ KHÔNG GỌI `reload()` THÌ KHÁCH MỚI KHÔNG CÓ TRONG DANH MỤC NẠP SẴN,
   * và màn /sell hiện lại chữ "Chọn khách hàng" như chưa chọn gì.
   */
  it("chờ tên hiện ra rồi mới đi tiếp", () => {
    expect(PICKER).toContain("const c = customerById(picked)")
    expect(PICKER).toContain("if (!c) return")
    expect(PICKER).toContain('router.replace("/sell")')
    expect(PICKER).toContain("Đang nạp khách vừa tạo…")
  })

  /** ⚠ Đọc lại hỏng thì không kẹt ở đây mãi — mã khách đã đúng rồi. */
  it("có đường thoát khi đọc lại hỏng", () => {
    expect(PICKER).toMatch(/setTimeout\(\(\) => router\.replace\("\/sell"\), \d+\)/)
  })

  /** ⚠ Chỉ chạy MỘT lần; effect chạy lượt nữa là nhảy trang giữa chừng. */
  it("chỉ nhận một lần", () => {
    expect(PICKER).toContain("if (!picked || pickDone.current) return")
    expect(PICKER).toContain("pickDone.current = true")
  })

  /** Điều khoản mặc định theo khách, y như khi chọn từ danh sách. */
  it("nạp điều khoản thanh toán của khách mới", () => {
    expect(PICKER).toContain("if (!cart.paymentTerms && c.payment_terms) cart.setPaymentTerms(c.payment_terms)")
  })
})

describe("trang tạo khách nhận đường quay về", () => {
  /**
   * ⚠ CHỈ NHẬN ĐƯỜNG DẪN NỘI BỘ. `?next=` đi thẳng vào `router.push`;
   * `//kẻ-xấu.example` cũng là URL tuyệt đối hợp lệ với trình duyệt, nên
   * chặn cả dạng hai gạch chéo.
   */
  it("từ chối đường dẫn ra ngoài", () => {
    expect(NEWPAGE).toContain('if (!v.startsWith("/") || v.startsWith("//")) return undefined')
  })

  it("nút quay lui về đúng chỗ đã bấm +", () => {
    expect(NEWPAGE).toContain('backHref={next ?? "/customers"}')
  })

  it("truyền đường quay về xuống form", () => {
    expect(NEWPAGE).toContain("<CustomerForm groups={groups} nextHref={next} />")
  })

  /**
   * ⚠ KHÔNG CÓ MÃ KHÁCH THÌ ĐỪNG QUAY VỀ. Gửi `?picked=` rỗng về màn chọn
   * khách là nó ngồi đợi một khách không bao giờ tới.
   */
  it("chỉ quay về luồng cũ khi thật sự có mã khách", () => {
    expect(FORM).toContain("if (nextHref && newId) {")
    expect(FORM).toContain("router.push(`${nextHref}?picked=${encodeURIComponent(newId)}`)")
    expect(FORM).toContain('router.push("/customers")')
  })

  /** ⚠ Sửa khách thì không đổi đường về — `nextHref` chỉ dành cho TẠO. */
  it("không đụng luồng sửa khách", () => {
    const save = FORM.slice(FORM.indexOf("if (customer) {"))
    expect(save.indexOf("nextHref")).toBeGreaterThan(save.indexOf("Đã tạo khách hàng mới"))
  })
})
