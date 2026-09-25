import { describe, it, expect, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { viMatchAllWords, viMatchKey, viQueryWords, viSearchKey } from "../src/lib/search"
import {
  FRESH_MS,
  isSellRefDataFresh,
  loadSellRefDataShared,
  peekSellRefData,
  resetSellRefData,
} from "../src/lib/sell/ref-store"
import type { SellRefData } from "../src/lib/sell/ref-data"
import { SELL_SCREENS } from "../src/components/sell/prefetch"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const POS = code(read("src/app/(dashboard)/sell/page.tsx"))
const CUST = code(read("src/app/(dashboard)/sell/customer/page.tsx"))
const CARD = code(read("src/components/sell/product-card.tsx"))
const DEBT = code(read("src/lib/sell/debt.ts"))
const HOOK = code(read("src/hooks/use-sell-data.tsx"))
const LAYOUT = code(read("src/app/(dashboard)/sell/layout.tsx"))
const NAV = code(read("src/components/layout/mobile-nav.tsx"))
const BAR = code(read("src/components/sell/bottom-bar.tsx"))
const UTILS = code(read("src/lib/utils.ts"))
const FREQ = code(read("src/lib/orders/frequent-products.ts"))

/**
 * NHÂN VIÊN GHI ĐƠN TRÊN ĐIỆN THOẠI. Mỗi chốt ở đây giữ một quyết định
 * đã đo được là làm màn hình chậm hoặc giật — đo ở đâu thì ghi ở đó.
 */

describe("Chỉ mục tìm kiếm: chuẩn hoá MỘT lần, kết quả Y HỆT đường cũ", () => {
  /**
   * ⚠ Đo trên 1.700 SP (scripts/bench-search.ts): chuẩn hoá lại ở mỗi
   * phím gõ 5,1 ms, chỉ mục tính sẵn 0,08 ms — 63 lần. Trên điện thoại
   * Android tầm trung nhân thêm 5–8 lần: 30 ms/phím là gõ nhanh bị nuốt
   * chữ. Nhưng nhanh mà LỆCH kết quả thì là lỗi mới, nên chốt này so hai
   * đường trên dữ liệu ngẫu nhiên có dấu, có đ, có hoa thường.
   */
  const ALPHABET = "aăâbcdđeêghiklmnoôơpqrstuưvxyAĂÂĐÊÔƠƯ áàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệóòỏõọốồổỗộớờởỡợúùủũụứừửữựíìỉĩịýỳỷỹỵ.-/0123456789"
  const rnd = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const word = (r: () => number) =>
    Array.from({ length: 1 + Math.floor(r() * 8) }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join("")
  const phrase = (r: () => number) => Array.from({ length: 1 + Math.floor(r() * 4) }, () => word(r)).join(" ")

  it("500 dòng × 40 chuỗi tìm: hai đường không lệch một dòng", () => {
    const r = rnd(42)
    const rows = Array.from({ length: 500 }, () => [phrase(r), word(r), word(r)] as const)
    const keys = rows.map((f) => viSearchKey(...f))
    const queries = Array.from({ length: 40 }, () => {
      // Nửa số chuỗi tìm lấy từ chính dữ liệu để chắc chắn có khớp.
      if (r() < 0.5) {
        const row = rows[Math.floor(r() * rows.length)]
        const src = row[Math.floor(r() * 3)]
        const a = Math.floor(r() * src.length)
        return src.slice(a, a + 1 + Math.floor(r() * 4))
      }
      return phrase(r)
    })
    for (const q of queries) {
      const words = viQueryWords(q)
      for (let i = 0; i < rows.length; i++) {
        expect(viMatchKey(keys[i], words), `q=${JSON.stringify(q)} row=${i}`).toBe(
          viMatchAllWords(q, ...rows[i])
        )
      }
    }
  })

  it("chuỗi tìm rỗng hoặc toàn khoảng trắng khớp tất cả", () => {
    expect(viQueryWords("   ")).toEqual([])
    expect(viMatchKey("bat ky", [])).toBe(true)
  })

  it("provider dựng khoá một lần theo danh mục, màn hình lọc qua khoá", () => {
    expect(HOOK).toContain("viSearchKey(p.name, p.sku, p.barcode ?? \"\")")
    expect(HOOK).toContain("viSearchKey(c.store_name, c.owner_name ?? \"\", c.phone ?? \"\", c.address ?? \"\")")
    expect(POS).toContain("filterProducts(term)")
    expect(CUST).toContain("filterCustomers(deferredQ.trim())")
    // Không màn nào còn chuẩn hoá lại ở mỗi phím.
    expect(POS).not.toContain("viMatchAllWords")
    expect(CUST).not.toContain("viMatchAllWords")
  })

  /** Chữ gõ vào ô là việc khẩn; lọc danh sách theo sau. */
  it("hai ô tìm đều tách việc gõ khỏi việc lọc", () => {
    expect(POS).toContain("const deferredQ = useDeferredValue(q)")
    expect(CUST).toContain("const deferredQ = useDeferredValue(q)")
  })
})

describe("60 thẻ sản phẩm KHÔNG vẽ lại theo mỗi phím gõ", () => {
  /**
   * ⚠ Bản đầu: `onAdd={() => addToCart(p)}` — closure mới ở mỗi lần vẽ,
   * nên `memo` (nếu có) cũng vô dụng: prop đổi là thẻ vẽ lại. Mỗi phím gõ
   * là 60 thẻ × (sellableUnits + unitPriceFor + stockInUnit + 3 formatCurrency).
   */
  it("thẻ được memo", () => {
    expect(CARD).toContain("export const ProductCard = memo(function ProductCard(")
  })

  it("màn truyền callback ỔN ĐỊNH, thẻ tự đưa sản phẩm vào", () => {
    const calls = POS.match(/<ProductCard[\s\S]*?\/>/g) ?? []
    expect(calls.length).toBe(1)
    const c = calls[0]
    expect(c).toContain("onPickUnit={onPickUnit}")
    // Thiết kế 24/09/2026: thẻ có nút + / bộ đếm ngay trên thẻ → một callback `onStep`.
    expect(c).toContain("onStep={onStep}")
    expect(c, "closure mới ở mỗi lần vẽ là memo vô dụng").not.toMatch(/on(Step|PickUnit)=\{\(/)
    expect(POS).toContain("const onStep = useCallback((p: PricedProduct, unit: string, delta: number) => stepRef.current(p, unit, delta), [])")
    // 25/09/2026: bấm cả DÒNG là +1 (`them`), không còn nút + lúc đầu.
    expect(CARD).toContain("const them = () => onStep(product, unit, 1)")
    expect(CARD).toContain("onClick={them}")
    expect(CARD).toContain("onPickUnit(product.id, u)")
  })

  /** Thẻ ngoài màn hình không dựng bố cục, không vẽ. */
  it("thẻ ngoài màn hình được bỏ qua khi cuộn", () => {
    expect(CARD).toContain("[content-visibility:auto]")
    expect(CARD).toContain("[contain-intrinsic-size:auto_112px]")
  })

  /** Ngón tay đặt xuống là thẻ phản hồi ngay — không đợi nhả. */
  it("thẻ có phản hồi lúc chạm", () => {
    expect(CARD).toMatch(/active:(scale|bg-)/)
  })
})

describe("Danh mục: hiện-cũ-tải-mới, không tải lại từ đầu ở mỗi lần vào", () => {
  const server = (n: number): SellRefData => ({
    products: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) as never,
    customers: [],
    stockByProduct: {},
    source: "server",
    warnings: [],
  })

  it("bản máy chủ được giữ trong RAM và còn tươi trong FRESH_MS", async () => {
    resetSellRefData()
    let now = 1_000_000
    await loadSellRefDataShared(async () => server(3), () => now)
    expect(peekSellRefData()?.products.length).toBe(3)
    expect(isSellRefDataFresh(now + FRESH_MS - 1)).toBe(true)
    expect(isSellRefDataFresh(now + FRESH_MS)).toBe(false)
  })

  /** ⚠ Bản rỗng / bản cache KHÔNG được đè lên bản RAM đang tốt. */
  it("kết quả không phải từ máy chủ thì không ghi đè RAM", async () => {
    resetSellRefData()
    await loadSellRefDataShared(async () => server(3))
    await loadSellRefDataShared(async () => ({ ...server(0), source: "empty" }))
    expect(peekSellRefData()?.products.length).toBe(3)
    await loadSellRefDataShared(async () => ({ ...server(1), source: "cache" }))
    expect(peekSellRefData()?.products.length).toBe(3)
  })

  /** Hai nơi gọi cùng lúc → một request. */
  it("gọi trùng lúc đang tải thì dùng chung một request", async () => {
    resetSellRefData()
    const loader = vi.fn(async () => server(2))
    const a = loadSellRefDataShared(loader)
    const b = loadSellRefDataShared(loader)
    expect(a).toBe(b)
    await a
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("provider: có RAM thì hiện ngay; còn tươi thì không gửi gì; cũ thì tải ngầm", () => {
    expect(HOOK).toContain("const mem = peekSellRefData()")
    expect(HOOK).toContain("if (isSellRefDataFresh() && tick === 0) return")
    expect(HOOK).toContain("const cached = await peekCachedSellRefData()")
    expect(HOOK).toContain("loadSellRefDataShared(() => loadSellRefData(createClient()))")
    // ⚠ Đang hiện bản tốt thì bản rỗng chỉ được gắn cảnh báo, không thay.
    expect(HOOK).toContain('if (data.source === "server" || !shown) apply(data, true)')
    expect(HOOK).toContain("else setWarnings(data.warnings)")
  })

  /** "Khách hay lấy" và công nợ cũng không hỏi lại máy chủ ở mỗi lần mở màn. */
  it("khách hay lấy và công nợ có bộ nhớ theo phiên", () => {
    expect(FREQ).toContain("const freqCache = new Map<string, { ids: string[]; at: number }>()")
    expect(FREQ).toContain("if (hit && Date.now() - hit.at < FREQ_TTL_MS) return hit.ids")
    // Công nợ nay ở lib/sell/debt.ts — dùng chung màn chọn khách (2c) và màn đơn (2b).
    expect(CUST).toContain('from "@/lib/sell/debt"')
    expect(DEBT).toContain("if (debtMemo && Date.now() - debtMemo.at < DEBT_TTL_MS) return debtMemo.map")
    // ⚠ Đọc hỏng thì KHÔNG ghi nhớ — lần sau phải thử lại.
    const i = DEBT.indexOf("if (res.error || res.truncated) {")
    const j = DEBT.indexOf("debtMemo = { map: m, at: Date.now() }")
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
  })
})

describe("Chuyển màn trong luồng không chờ mạng", () => {
  /**
   * ⚠ Các màn /sell/* là route động, mở bằng `router.push` nên Next không
   * tự nạp sẵn: mỗi cú chạm "Xem đơn" / "Chọn khách" là một vòng đi-về
   * máy chủ trước khi vẽ. `router.prefetch` (kiểu FULL mặc định ở Next
   * 14.2) kéo khung màn hình về trước và giữ 5 phút.
   */
  it("layout của luồng gắn SellPrefetch", () => {
    expect(LAYOUT).toContain("<SellPrefetch />")
  })

  /**
   * ⚠ Danh sách nạp sẵn phải khớp THƯ MỤC ROUTE. Thêm một màn mới mà quên
   * ghi vào đây là màn đó — và chỉ màn đó — chờ mạng, người dùng không
   * hiểu vì sao một nút chậm. Route động (`[id]`) không nạp sẵn được.
   */
  it("mọi màn tĩnh trong src/app/(dashboard)/sell đều được nạp sẵn", () => {
    const base = resolve(ROOT, "src/app/(dashboard)/sell")
    const found = new Set<string>(["/sell"])
    const walk = (dir: string, href: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (!statSync(full).isDirectory()) continue
        if (name.startsWith("[")) continue
        const next = `${href}/${name}`
        if (readdirSync(full).includes("page.tsx")) found.add(next)
        walk(full, next)
      }
    }
    walk(base, "/sell")
    const missing = Array.from(found).filter((h) => !(SELL_SCREENS as readonly string[]).includes(h))
    expect(missing, `chưa nạp sẵn: ${missing.join(", ")}`).toEqual([])
  })

  /** Nạp lại ở mỗi lần đổi màn — mục hết hạn sau 5 phút. */
  it("nạp lại theo pathname, sau khi màn hiện tại đã vẽ", () => {
    const PRE = code(read("src/components/sell/prefetch.tsx"))
    expect(PRE).toContain("}, [router, pathname])")
    expect(PRE).toContain("router.prefetch(href)")
  })
})

describe("Về danh sách thì thấy lại đúng chỗ vừa đứng", () => {
  /**
   * ⚠ Chạm thẻ → giỏ → chạm "tìm" → về danh sách. Tab và vị trí cuộn phải
   * còn nguyên; trí nhớ nằm ở provider của layout nên sống qua việc
   * chuyển màn.
   */
  it("ô tìm và tab khởi tạo từ trí nhớ, và ghi lại khi đổi", () => {
    expect(POS).toContain("useState(() => listMemory.current.q)")
    expect(POS).toContain('useState<"freq" | "all">(() => listMemory.current.tab)')
    expect(POS).toContain("listMemory.current.q = q")
    expect(POS).toContain("listMemory.current.tab = tab")
  })

  /**
   * ⚠ THÊM HÀNG XONG THÌ XOÁ Ô TÌM — ĐÂY LÀ MỘT QUYẾT ĐỊNH BỊ ĐẢO LẠI.
   *
   * Trí nhớ ô tìm dựng ra với lý do "gõ coca cho thùng thứ nhất khỏi gõ
   * lại cho thùng thứ hai". Lý do đó sai: thùng thứ hai là cùng một dòng,
   * sửa số lượng chứ không thêm lần nữa. Mỗi lần quay lại danh sách là để
   * tìm một MẶT HÀNG KHÁC, và chữ cũ nằm trong ô khi đó là một bộ lọc
   * không ai yêu cầu, che mất đúng thứ người ta sắp gõ.
   */
  it("thêm vào giỏ thì xoá ô tìm, ở cả đường bán lẫn đường trả", () => {
    expect(POS).toContain("const clearSearchMemory = () => {")
    // Hai đường rời màn sau khi thêm: "Xem đơn" (giỏ) và "Tiếp tục" (phiếu
    // trả). Thiết kế 24/09/2026 bỏ chế độ chọn nhiều — thẻ có bộ đếm ngay
    // trên thẻ. Dòng khai báo không khớp mẫu này (`= () =>`), nên đúng bằng
    // số nơi GỌI. Lối thứ ba (25/09/2026): chế độ "chọn từng mã" thêm một mã
    // mới là sang thẳng giỏ — cũng rời màn nên cũng phải xoá ô tìm. Và lối thứ
    // tư: chọn từng mã ở màn chọn hàng TRẢ về thẳng phiếu trả.
    expect((POS.match(/clearSearchMemory\(\)/g) ?? []).length).toBe(4)
  })

  /**
   * ⚠ PHẢI XOÁ CẢ TRÍ NHỚ Ở PROVIDER, không chỉ gọi `setQ("")`. Hiệu ứng
   * đồng bộ `listMemory.current.q = q` chạy SAU khi vẽ lại, mà `router.push`
   * gỡ màn ngay — nên rất có thể nó không kịp chạy, và lần sau vào lại vẫn
   * thấy chữ cũ. Chốt này canh đúng chỗ đó.
   */
  it("xoá thẳng vào ref, không trông vào hiệu ứng đồng bộ", () => {
    const i = POS.indexOf("const clearSearchMemory = () => {")
    const body = POS.slice(i, POS.indexOf("\n  }", i))
    expect(body).toContain('listMemory.current.q = ""')
    expect(body).toContain("listMemory.current.scrollY = 0")
  })

  /**
   * ⚠ VỊ TRÍ CUỘN VỀ ĐỈNH CÙNG LÚC. Chỗ đang cuộn là chỗ trong danh sách
   * ĐÃ LỌC; bỏ bộ lọc mà giữ nguyên số đó là thả người dùng xuống giữa
   * một danh sách khác hẳn.
   */
  it("xoá ô tìm thì cũng đặt lại vị trí cuộn", () => {
    const i = POS.indexOf("const clearSearchMemory = () => {")
    const body = POS.slice(i, POS.indexOf("\n  }", i))
    expect(body).toContain("listMemory.current.scrollY = 0")
  })

  it("vị trí cuộn ghi liên tục, khôi phục một lần sau khi danh sách vẽ", () => {
    expect(POS).toContain('window.addEventListener("scroll", onScroll, { passive: true })')
    expect(POS).toContain("if (restoredRef.current || loading || list.length === 0) return")
    expect(POS).toContain("if (y > 0) window.scrollTo(0, y)")
  })

  /** Về từ giỏ thì tab người dùng đã chọn phải còn nguyên. */
  it("tải xong 'khách hay lấy' không ép tab về freq", () => {
    expect(POS).toContain('setTab((t) => (ids.length ? t : "all"))')
    expect(POS).not.toContain('setTab(ids.length ? "freq" : "all")')
  })
})

describe("Không tốn GPU cho thứ không nhìn thấy", () => {
  /**
   * ⚠ `backdrop-blur` trên thanh `fixed` đè lên danh sách đang cuộn là bắt
   * GPU vẽ lại vùng phía sau ở MỖI KHUNG HÌNH. Trên Android tầm trung là
   * cuộn giật thấy rõ. Nền đặc trông gần như hệt.
   */
  it.each([
    ["thanh nav dưới", NAV],
    ["thanh hành động luồng bán", BAR],
  ])("%s không dùng backdrop-blur", (_l, src) => {
    expect(src).not.toContain("backdrop-blur")
  })

  it("formatCurrency không dựng Intl.NumberFormat ở mỗi lần gọi", () => {
    const i = UTILS.indexOf("export function formatCurrency(")
    const body = UTILS.slice(i, UTILS.indexOf("\n}", i))
    expect(body).not.toContain("new Intl.NumberFormat")
    expect(UTILS).toContain('const VND = new Intl.NumberFormat("vi-VN")')
  })
})
