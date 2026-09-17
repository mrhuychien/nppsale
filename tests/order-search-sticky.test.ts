import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const FORM = read("src/components/orders/order-form.tsx")

/**
 * Mã đã bỏ chú thích.
 *
 * ⚠ Phần giải thích trong mã có nhắc nguyên văn lớp CŨ đã sai
 * (`lg:static`) — nhắc để người sau khỏi khôi phục lại nó. Soi cả chú
 * thích thì phép kiểm bắt nhầm lời giải thích và ép phải xoá nó đi.
 */
const FORM_CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const HEADER = read("src/components/layout/header.tsx")
const SHEET = read("src/components/ui/sheet.tsx")
const CARD = read("src/components/ui/card.tsx")
const CSS = read("src/app/globals.css")

/**
 * Chỉ phần thẻ "Sản phẩm" — từ mốc bình luận tới thẻ `</CardContent>` đầu
 * tiên sau đó.
 */
const CARD_START = FORM.indexOf("{/* Products card */}")
const PRODUCTS_CARD = FORM.slice(CARD_START, FORM.indexOf("</CardContent>", CARD_START))

/** className của khối dính, lấy nguyên văn để soi từng lớp. */
const classOf = (marker: string) => {
  const i = PRODUCTS_CARD.indexOf(marker)
  expect(i, `không tìm thấy khối ${marker}`).toBeGreaterThanOrEqual(0)
  const start = PRODUCTS_CARD.lastIndexOf('className="', i)
  return PRODUCTS_CARD.slice(start + 'className="'.length, PRODUCTS_CARD.indexOf('"', start + 11))
}

const MOBILE_BAR = classOf("sticky top-below-appbar")
const DESKTOP_BAR = classOf("hidden lg:sticky")

/**
 * MỌI ô dính trong màn tạo đơn — không chỉ hai ô của thẻ Sản phẩm.
 *
 * ⚠ Màn này có ba ô dính: hai ô tìm sản phẩm (mobile + desktop) và một ô
 * tìm hàng trả lại. Chốt nào chỉ soi hai ô đầu là chốt bỏ sót — và ô thứ
 * ba đúng là ô đang sai.
 */
const STICKY_BARS = (FORM_CODE.match(/className="[^"]*\bsticky\b[^"]*"/g) ?? []).map((s) =>
  s.slice('className="'.length, -1)
)
const has = (cls: string, token: string) =>
  new RegExp(`(^|\\s)${token.replace(/[-[\]]/g, "\\$&")}(\\s|$)`).test(cls)
const showsOnMobile = (cls: string) => !has(cls, "hidden")
const showsOnDesktop = (cls: string) => !has(cls, "lg:hidden")

describe("Ô tìm sản phẩm dính đỉnh khi cuộn", () => {
  it("bản mobile dính, không còn trôi theo trang", () => {
    expect(MOBILE_BAR).toContain("sticky")
    expect(MOBILE_BAR).toContain("top-below-appbar")
  })

  /**
   * ⚠ Lớp cũ của bản desktop là `lg:static` kèm `z-20 bg-card` — hai thứ
   * chỉ có nghĩa cho một ô ĐANG dính. Tức là phần dính đã bị gỡ mà quên
   * dọn, để lại lớp nền và z-index vô dụng suốt từ đó.
   */
  it("bản desktop cũng dính, không còn lg:static", () => {
    expect(DESKTOP_BAR).toContain("lg:sticky")
    expect(DESKTOP_BAR).toContain("top-below-appbar")
    expect(FORM_CODE).not.toContain("lg:static")
  })

  /**
   * ⚠ KHÔNG ĐƯỢC GÕ TAY CHIỀU CAO APP BAR. App bar mobile 52px, desktop
   * 64px — một con số cứng thì sai ở một trong hai, và ô dính sẽ nằm đè
   * lên app bar hoặc hở một khe nhìn thấy dòng hàng chạy qua.
   *
   * Đây là lỗi ĐÃ XẢY RA một lần ở dãy pipeline đơn hàng (`sticky top-14`
   * trong khi app bar cao 64px).
   */
  it("neo theo biến chiều cao app bar, không phải con số cứng", () => {
    for (const cls of [MOBILE_BAR, DESKTOP_BAR]) {
      expect(cls).not.toMatch(/(^|\s|:)top-\d/)
      expect(cls).not.toMatch(/(^|\s|:)top-\[/)
    }
    expect(CSS).toContain(".top-below-appbar { top: var(--app-bar-h); }")
  })
})

describe("Ô dính bị giới hạn TRONG thẻ Sản phẩm", () => {
  /**
   * ⚠ ĐÂY LÀ VẾ THỨ HAI CỦA YÊU CẦU: "kéo xuống hết thì mới trôi đi".
   *
   * `sticky` chỉ dính trong phạm vi THẺ CHA. Đặt ô tìm trong cùng
   * `CardContent` với danh sách hàng thì cuộn hết hàng là nó trôi theo,
   * không đeo bám sang phần Điều khoản hay Tổng tiền. Đưa nó ra ngoài thẻ
   * là mất đúng tính chất đó.
   */
  it("ô tìm và danh sách hàng nằm chung một CardContent", () => {
    expect(PRODUCTS_CARD).toContain("sticky top-below-appbar")
    expect(PRODUCTS_CARD).toContain("lines.map(")
  })

  /**
   * ⚠ LỖI THỨ HAI, TÌM RA KHI VIẾT PHÉP KIỂM NÀY. Ô tìm của thẻ "Hàng trả
   * lại" cũng dính, nhưng gõ tay `top-16` (64px) trong khi app bar mobile
   * chỉ cao 52px — dính thấp hơn app bar 12px, và dòng hàng chạy qua khe
   * đó. Nó còn bù `-mx-2` cho một CardContent đệm `p-4`, hụt 8px mỗi bên.
   *
   * Nên chốt này quét MỌI ô dính trong màn, không chỉ ô người dùng chỉ ra.
   */
  it("mọi ô dính trong màn đều neo theo biến, không con số cứng", () => {
    const stickies = FORM_CODE.match(/className="[^"]*\bsticky\b[^"]*"/g) ?? []
    expect(stickies.length).toBeGreaterThan(1)
    for (const s of stickies) {
      expect(s, s).toContain("top-below-appbar")
      expect(s, s).not.toMatch(/(^|\s)top-\d/)
      expect(s, s).not.toMatch(/(^|\s)top-\[/)
    }
  })

  /**
   * ⚠ `sticky` đã là vị trí CÓ ĐỊNH VỊ nên nó làm khung neo cho dropdown
   * kết quả bên trong. Gắn thêm `lg:static` là trên desktop khung neo tuột
   * lên tổ tiên xa hơn và `top-full` của dropdown tính sai.
   */
  it("không ô dính nào bị tắt định vị ở desktop", () => {
    expect(FORM_CODE).not.toContain("lg:static")
  })
})

describe("Nền ô dính phải che kín", () => {
  /**
   * ⚠ `-mx-*` phải BÙ ĐÚNG `p-*` của CardContent. Thiếu vế này thì nền ô
   * hẹp hơn thẻ đúng hai mép padding, và dòng hàng chạy lấp ló hai bên ô
   * đang dính — trông như màn hình vỡ.
   */
  it("mọi ô dính bù đúng padding của CardContent, ở khổ màn nó hiện ra", () => {
    const cc = /<CardContent className="([^"]*)">/.exec(PRODUCTS_CARD)
    expect(cc, "không đọc được className của CardContent").toBeTruthy()
    const pad = /(?:^|\s)p-(\d+)/.exec(cc![1])
    const padLg = /(?:^|\s)lg:p-(\d+)/.exec(cc![1])
    expect(pad, "CardContent không khai p-*").toBeTruthy()
    expect(padLg, "CardContent không khai lg:p-*").toBeTruthy()

    expect(STICKY_BARS.length).toBeGreaterThan(1)
    for (const cls of STICKY_BARS) {
      if (showsOnMobile(cls)) {
        expect(has(cls, `-mx-${pad![1]}`), `thiếu -mx-${pad![1]}: ${cls}`).toBe(true)
        expect(has(cls, `px-${pad![1]}`), `thiếu px-${pad![1]}: ${cls}`).toBe(true)
      }
      if (showsOnDesktop(cls)) {
        const okX = has(cls, `-mx-${padLg![1]}`) || has(cls, `lg:-mx-${padLg![1]}`)
        const okP = has(cls, `px-${padLg![1]}`) || has(cls, `lg:px-${padLg![1]}`)
        expect(okX, `thiếu bù lề desktop: ${cls}`).toBe(true)
        expect(okP, `thiếu đệm desktop: ${cls}`).toBe(true)
      }
    }
  })

  /**
   * ⚠ Nền phải là nền CỦA THẺ. Lấy màu khác thì lúc chưa cuộn, ô tìm hiện
   * ra như một mảng màu lạ nằm giữa thẻ.
   */
  it("dùng đúng màu nền của thẻ", () => {
    const cardBg = /bg-(surface[\w-]*)/.exec(CARD)
    expect(cardBg, "không đọc được màu nền thẻ").toBeTruthy()
    for (const cls of STICKY_BARS) {
      expect(cls).toContain(`bg-${cardBg![1]}/`)
      // Mờ một chút thì phải có blur, không thì chữ dưới hiện xuyên qua.
      expect(cls).toContain("backdrop-blur")
    }
  })

  /** Không có đường kẻ thì chữ cuộn qua trông như bị cắt giữa không trung. */
  it("có đường kẻ dưới để thấy ranh giới", () => {
    for (const cls of STICKY_BARS) expect(cls, cls).toContain("border-b")
  })
})

describe("Thứ tự tầng", () => {
  const z = (cls: string) => {
    const m = /(?:^|\s)z-(\d+)/.exec(cls)
    expect(m, `không có z-index trong "${cls}"`).toBeTruthy()
    return Number(m![1])
  }

  /**
   * ⚠ Ô dính phải NẰM DƯỚI app bar và DƯỚI tấm trượt chọn sản phẩm, nhưng
   * TRÊN dòng hàng. Cao quá thì nó đè lên app bar lúc cuộn; thấp quá thì
   * dòng hàng chạy đè lên chính nó.
   */
  it("thấp hơn app bar và tấm trượt, cao hơn dòng hàng", () => {
    const appBar = z(/<header className="([^"]*)"/.exec(HEADER)![1])
    const sheet = z(/"fixed z-(\d+)/.test(SHEET) ? `z-${/"fixed z-(\d+)/.exec(SHEET)![1]}` : "")
    for (const cls of STICKY_BARS) {
      expect(z(cls)).toBeLessThan(appBar)
      expect(z(cls)).toBeLessThan(sheet)
      expect(z(cls)).toBeGreaterThan(0)
    }
  })
})
