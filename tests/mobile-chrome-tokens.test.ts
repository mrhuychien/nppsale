import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * Pack M0 — nền tảng chrome mobile.
 *
 * Ba con số chiều cao (88px trong mobile-nav, 7rem/10rem trong
 * dashboard-shell, 88px + 11rem trong order-form) từng nằm ở ba file khác
 * nhau trong khi thanh nav thật cao 103px. Hậu quả đo được: thanh tổng tiền
 * của form tạo đơn bị nav đè mất 15px — đúng chỗ nút "Tạo đơn hàng".
 *
 * Các test dưới đây chặn việc hằng số ma quay trở lại và ghim ý nghĩa của
 * từng token. Đây là test đọc mã nguồn, không dựng giao diện — chúng không
 * thay được việc mở điện thoại thật ra đo.
 */

const ROOT = resolve(__dirname, "..")

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8")
}

const CSS = read("src/app/globals.css")
const SHELL = read("src/components/layout/dashboard-shell.tsx")
const NAV = read("src/components/layout/mobile-nav.tsx")
const ORDER_FORM = read("src/components/orders/order-form.tsx")
const HOME = read("src/app/(dashboard)/home/page.tsx")
const LAYOUT = read("src/app/layout.tsx")

/**
 * Bỏ chú thích để không tự bắt lỗi trên chính đoạn văn giải thích lỗi cũ.
 * Xoá cả `{/* … *\/}` của JSX, không chỉ `//` và `/* … *\/`.
 */
function code(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "")
}

/** Mọi file .ts/.tsx dưới src/ — dùng để quét hằng số ma toàn cục. */
function sourceFiles(dir = resolve(ROOT, "src"), acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sourceFiles(p, acc)
    else if (/\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

describe("M0.1 — viewport cho phép safe-area và cho phép người dùng zoom", () => {
  /**
   * `env(safe-area-inset-*)` TRẢ VỀ 0 nếu không có viewport-fit=cover. Thiếu
   * dòng này thì mọi token --safe-b bên dưới đều thành 0 và thanh gạt iPhone
   * lại che nội dung — nền của cả pack sụp mà không có lỗi nào báo ra.
   */
  it("có viewportFit cover", () => {
    expect(LAYOUT).toMatch(/viewportFit:\s*["']cover["']/)
  })

  /**
   * Chặn zoom là rào cản tiếp cận: NVBH lớn tuổi đọc bảng giá bằng cách
   * chụm ngón tay phóng to. `maximumScale: 1` / `userScalable: false` khoá
   * mất thao tác đó.
   */
  it("không khoá zoom", () => {
    expect(LAYOUT).toMatch(/userScalable:\s*true/)
    const max = LAYOUT.match(/maximumScale:\s*(\d+)/)
    expect(max).not.toBeNull()
    expect(Number(max![1])).toBeGreaterThanOrEqual(5)
  })
})

describe("M0.2 — token chiều cao chrome là nguồn sự thật duy nhất", () => {
  it("khai báo đủ token chrome ở :root", () => {
    for (const token of ["--app-bar-h", "--bottom-nav-h", "--action-bar-h", "--safe-b"]) {
      expect(CSS, `thiếu token ${token}`).toContain(`${token}:`)
    }
  })

  /** M1.2 xoá FAB nổi nên token dành riêng cho nó cũng phải đi theo. */
  it("không còn token --fab-extra-h", () => {
    expect(CSS).not.toContain("--fab-extra-h:")
  })

  /**
   * Token phải KHỚP GIAO DIỆN ĐANG CHẠY. Nav cũ đo được 103px và M0 đặt
   * đúng 103; M1.2 dựng lại nav thành 5 ô cao 64px nên token đổi theo trong
   * CÙNG pack. Lệch một pack là đệm sai và nav che mất nội dung.
   *
   * Con số này phải khớp `h-[var(--bottom-nav-h)]` trong mobile-nav.tsx —
   * test dưới đây kiểm chính chỗ đó, nên hai bên không tự trôi khỏi nhau.
   */
  it("--bottom-nav-h khớp chiều cao nav mới (64px)", () => {
    const m = CSS.match(/--bottom-nav-h:\s*(\d+)px/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(64)
  })

  /** App bar mobile 52px — trước M1.1 là 64px và hiện tiêu đề trùng lặp. */
  it("--app-bar-h mobile là 52px, desktop 64px", () => {
    const m = CSS.match(/--app-bar-h:\s*(\d+)px/)
    expect(Number(m![1])).toBe(52)
    const lg = CSS.indexOf("min-width: 1024px")
    expect(CSS.slice(lg, lg + 300)).toMatch(/--app-bar-h:\s*64px/)
  })

  /**
   * Thanh nav phải LẤY chiều cao từ token, không tự đặt một con số khác —
   * đó chính là cách ba con số cũ trôi khỏi nhau.
   */
  it("mobile-nav lấy chiều cao từ var(--bottom-nav-h)", () => {
    expect(NAV).toContain("h-[var(--bottom-nav-h)]")
  })

  /** App bar cũng vậy. */
  it("header lấy chiều cao từ var(--app-bar-h)", () => {
    expect(read("src/components/layout/header.tsx")).toContain("h-[var(--app-bar-h)]")
  })

  /** --safe-b phải là env(), không phải một con số cứng. */
  it("--safe-b lấy từ env(safe-area-inset-bottom)", () => {
    expect(CSS).toMatch(/--safe-b:\s*env\(safe-area-inset-bottom/)
  })

  /**
   * Ba lớp đệm phải CỘNG chiều cao nav, chứ không được đặt một con số riêng
   * — cộng bằng biến là toàn bộ lý do pack này tồn tại.
   */
  it("các lớp .pb-nav* cộng --bottom-nav-h và --safe-b", () => {
    for (const cls of [".pb-nav", ".pb-nav-action"]) {
      const i = CSS.indexOf(`${cls} `)
      expect(i, `thiếu lớp ${cls}`).toBeGreaterThan(0)
      const decl = CSS.slice(i, CSS.indexOf("}", i))
      expect(decl, `${cls} không cộng --bottom-nav-h`).toContain("var(--bottom-nav-h)")
      expect(decl, `${cls} không cộng --safe-b`).toContain("var(--safe-b)")
    }
  })

  /** .pb-nav-action phải cộng THÊM thanh hành động, .pb-nav thì không. */
  it("chỉ .pb-nav-action cộng --action-bar-h", () => {
    const action = CSS.slice(CSS.indexOf(".pb-nav-action"), CSS.indexOf("}", CSS.indexOf(".pb-nav-action")))
    expect(action).toContain("var(--action-bar-h)")
    const plain = CSS.slice(CSS.indexOf(".pb-nav "), CSS.indexOf("}", CSS.indexOf(".pb-nav ")))
    expect(plain).not.toContain("var(--action-bar-h)")
  })

  /**
   * Các lớp .pb-* này được sinh SAU utilities của Tailwind, nên không giới
   * hạn media query thì chúng ghi đè cả `lg:pb-32` / `lg:pb-container-padding`
   * ở nơi gọi và desktop tụt đệm — đúng chỗ thanh tổng tiền cố định của
   * order-form nằm.
   */
  it("các lớp .pb-nav* chỉ áp dụng dưới lg", () => {
    const i = CSS.indexOf(".pb-nav ")
    const guard = CSS.lastIndexOf("@media", i)
    expect(guard).toBeGreaterThan(0)
    expect(CSS.slice(guard, i)).toMatch(/max-width:\s*1023px/)
  })

  /** Thanh dính đáy phải neo TRÊN nav, không chồng lên. */
  it(".bottom-above-nav neo theo --bottom-nav-h", () => {
    const i = CSS.indexOf(".bottom-above-nav")
    expect(i).toBeGreaterThan(0)
    const decl = CSS.slice(i, CSS.indexOf("}", i))
    expect(decl).toContain("var(--bottom-nav-h)")
    expect(decl).toContain("var(--safe-b)")
  })

  /** Desktop không có nav dưới — để 103px ở đó là chừa một khoảng trống to. */
  it("desktop đặt --bottom-nav-h về 0", () => {
    const i = CSS.indexOf("min-width: 1024px")
    expect(i).toBeGreaterThan(0)
    expect(CSS.slice(i, i + 300)).toMatch(/--bottom-nav-h:\s*0px/)
  })
})

describe("M0.4 — hằng số chiều cao chrome không còn nằm rải rác", () => {
  it("mobile-nav không còn export hằng số chiều cao", () => {
    expect(NAV).not.toContain("MOBILE_NAV_HEIGHT")
    expect(NAV).not.toContain("MOBILE_FAB_TOP")
  })

  /**
   * Quét TOÀN BỘ src/, không chỉ bốn file đã sửa — nếu không thì lần sau
   * thêm một trang mới với `pb-[calc(7rem+env(...))]` là hằng số ma quay lại
   * mà test vẫn xanh.
   */
  it("không file nào dưới src/ còn tự tính đệm nav bằng rem+env", () => {
    const offenders = sourceFiles()
      .filter((p) => /rem\+env\(safe-area/.test(readFileSync(p, "utf-8")))
      .map((p) => p.replace(ROOT + "/", ""))
    expect(offenders).toEqual([])
  })

  it("dashboard-shell chọn lớp token thay vì chuỗi pb-calc", () => {
    expect(SHELL).not.toMatch(/pb-\[calc\(/)
    expect(SHELL).toMatch(/pb-nav\b/)
  })

  /**
   * Đây là lỗi ĐO ĐƯỢC mà M0 sửa: thanh tổng tiền của form tạo đơn neo ở
   * bottom-[88px] trong khi nav cao 103px, nên bị đè mất 15px — che đúng nút
   * "Tạo đơn hàng".
   */
  it("thanh tổng tiền order-form neo theo token, không phải 88px", () => {
    const i = ORDER_FORM.indexOf("Tổng cộng")
    expect(i).toBeGreaterThan(0)
    // Thẻ bọc thanh dính đáy = thẻ `lg:hidden fixed` gần nhất TRƯỚC nhãn.
    const barStart = ORDER_FORM.lastIndexOf("lg:hidden fixed", i)
    expect(barStart).toBeGreaterThan(0)
    const bar = ORDER_FORM.slice(barStart, ORDER_FORM.indexOf(">", barStart))
    expect(bar).toContain("bottom-above-nav")
    expect(bar).not.toMatch(/bottom-\[\d+px\]/)
  })

  it("order-form dùng .pb-nav-action cho đệm cuối form", () => {
    expect(ORDER_FORM).toContain("pb-nav-action")
  })

  it("trang chủ NVBH dùng .pb-nav", () => {
    expect(HOME).toMatch(/pb-nav\b/)
  })

  /**
   * `88px` còn lại trong src/ là CHIỀU RỘNG cột (`min-w-[88px]`, `w-[88px]`)
   * — không liên quan chrome, không được sửa. Cái phải chặn là NEO DỌC theo
   * px: `bottom-[NNpx]` / `top-[NNpx]`, vì đó chính là cách thanh tổng tiền
   * bị nav đè 15px. Sau khi M1.2 xoá nút "+" nổi thì không còn ngoại lệ nào.
   */
  it("không còn chỗ nào neo dọc bằng px cứng", () => {
    const offenders = sourceFiles()
      .map((p) => ({ rel: p.replace(ROOT + "/", ""), src: code(readFileSync(p, "utf-8")) }))
      .filter(({ src }) => /className="[^"]*\b(?:bottom|top)-\[\d+px\]/.test(src))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })
})

describe("M0.3 — MoneyInput cho phép tạo class riêng cho ô nhập", () => {
  const MONEY = read("src/components/ui/money-input.tsx")

  /**
   * Trước đây component đọc `(props as {className?: string}).className`,
   * nhưng `className` không nằm trong kiểu props nên giá trị LUÔN undefined:
   * mọi nơi truyền class cho ô nhập đều bị bỏ im lặng.
   */
  it("nhận inputClassName và truyền xuống input", () => {
    expect(MONEY).toMatch(/inputClassName\?:\s*string/)
    expect(code(MONEY)).not.toContain("props as {className")
    const input = MONEY.slice(MONEY.indexOf("<input"))
    expect(input).toContain("inputClassName")
  })

  /** Ô nhập tiền là mục tiêu bấm chính trên mobile — phải đủ 44px. */
  it("ô nhập cao ít nhất 44px trên mobile", () => {
    expect(MONEY).toMatch(/h-11\s+lg:h-10|h-11 /)
  })
})

describe("M0.3 — vùng chạm 44px cho các control dùng chung", () => {
  const BUTTON = read("src/components/ui/button.tsx")
  const INPUT = read("src/components/ui/input.tsx")
  const CHECKBOX = read("src/components/ui/checkbox.tsx")

  /**
   * h-11 = 44px (sàn WCAG 2.5.5), `lg:` trả về cỡ cũ để không phá layout
   * bảng trên desktop. Riêng `sm` đáng chú ý: nó đang được dùng cho nút hành
   * động chính trên thẻ mobile, nên h-8 (32px) là chỗ cần to nhất lại nhỏ
   * nhất.
   */
  it("mọi size của Button đạt >= 40px trên mobile", () => {
    const block = BUTTON.slice(BUTTON.indexOf("size: {"), BUTTON.indexOf("}", BUTTON.indexOf("size: {")))
    // Chiều cao mobile = lớp h-N KHÔNG có tiền tố lg:.
    const heights: { key: string; h: number }[] = []
    const re = /(\w+):\s*"([^"]+)"/g
    let hit: RegExpExecArray | null
    while ((hit = re.exec(block)) !== null) {
      const m = hit[2].match(/(?:^|\s)h-(\d+)/)
      heights.push({ key: hit[1], h: m ? Number(m[1]) * 4 : 0 })
    }
    expect(heights.length).toBeGreaterThanOrEqual(4)
    for (const { key, h } of heights) {
      expect(h, `size ${key} chỉ cao ${h}px trên mobile`).toBeGreaterThanOrEqual(40)
    }
  })

  it("Input cao 44px trên mobile, 40px từ lg", () => {
    expect(INPUT).toMatch(/h-11 lg:h-10/)
  })

  /**
   * Ô vuông 16×16 giữ nguyên (phóng to thì phá layout bảng); vùng chạm mở
   * rộng bằng pseudo-element vô hình, chỉ trên mobile. `relative` là bắt
   * buộc — thiếu nó thì `after:absolute` neo vào ông bà xa nhất có
   * positioning và vùng chạm nhảy đi chỗ khác.
   */
  it("Checkbox mở rộng vùng chạm bằng after và có relative", () => {
    expect(CHECKBOX).toContain("after:-inset-3.5")
    expect(CHECKBOX).toContain("lg:after:hidden")
    const cls = CHECKBOX.slice(CHECKBOX.indexOf('"peer'), CHECKBOX.indexOf("after:-inset"))
    expect(cls, "thiếu `relative` nên vùng chạm neo sai chỗ").toContain("relative")
  })
})
