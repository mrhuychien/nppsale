import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import {
  likeTerm, buildOrFilter, lookupSettled, MATCH_CAP, NO_MATCH,
} from "../src/lib/search/list-search"

/**
 * Ô TÌM TRÊN DANH SÁCH CÓ PHÂN TRANG PHẢI HỎI MÁY CHỦ.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "trong danh sách Hóa đơn, danh sách Đơn
 * hàng, Tìm kiếm chỉ tìm trong trang 1, phải tìm toàn bộ chứ?".
 *
 * ⚠ LỖI NÀY ĐÃ ĐƯỢC GHI LẠI MÀ KHÔNG ĐƯỢC SỬA. Màn hoá đơn bán có hẳn
 * một chú thích thừa nhận "ô tìm nhanh lọc trong trang đang xem", và
 * cách vá là ghi câu ấy vào placeholder. Chốt này tồn tại để lần sau
 * không ai vá một lỗi bằng một dòng chữ nữa.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const ORDERS = strip(read("src/app/(dashboard)/orders/page.tsx"))
const SALES_INV = strip(read("src/app/(dashboard)/sales-invoices/page.tsx"))

describe("phép dựng mệnh đề tìm", () => {
  /**
   * ⚠ THOÁT `%` VÀ `_`. Người dùng gõ `50%` để tìm một mã khuyến mãi;
   * `%` của họ biến thành "khớp mọi thứ", và danh sách trả về mọi dòng
   * có số 50 ở bất kỳ đâu.
   */
  it("thoát ký tự đại diện của người dùng", () => {
    expect(likeTerm("50%")).toBe("%50\\%%")
    expect(likeTerm("a_b")).toBe("%a\\_b%")
    expect(likeTerm("  abc  ")).toBe("%abc%")
  })

  it("không gõ gì thì không lọc gì", () => {
    expect(buildOrFilter("", ["order_code"], []).filter).toBeNull()
    expect(buildOrFilter("   ", ["order_code"], []).filter).toBeNull()
  })

  it("nối cột của chính bảng với mã tra được", () => {
    const r = buildOrFilter("abc", ["order_code"], [
      { column: "customer_id", match: { ids: ["c1", "c2"], truncated: false } },
    ])
    expect(r.filter).toBe("order_code.ilike.%abc%,customer_id.in.(c1,c2)")
    expect(r.truncated).toBe(false)
  })

  /**
   * ⚠ KHÔNG DỰNG `in.()` RỖNG. Bỏ hẳn vế ấy thì vế còn lại vẫn chạy, và
   * người dùng vẫn tìm được theo mã chứng từ.
   */
  it("không có mã nào khớp thì bỏ hẳn vế đó", () => {
    const r = buildOrFilter("abc", ["order_code"], [{ column: "customer_id", match: NO_MATCH }])
    expect(r.filter).toBe("order_code.ilike.%abc%")
    expect(r.filter).not.toContain("in.()")
  })

  /** ⚠ Chạm trần phải NGẤM RA ngoài để màn hình nói được là kết quả thiếu. */
  it("chạm trần thì báo ra", () => {
    const r = buildOrFilter("abc", ["order_code"], [
      { column: "customer_id", match: { ids: ["c1"], truncated: true } },
    ])
    expect(r.truncated).toBe(true)
  })

  /**
   * ⚠ LUẬT "ĐÃ TRA XONG CHƯA" PHẢI ĐƯỢC CANH THẲNG. Đã thử phá bằng
   * cách cho hook trả `ready = true` luôn — cả 35 chốt vẫn xanh, vì
   * chúng chỉ soi được rằng các màn CÓ GỌI `listSearch.ready`. Luật
   * nay nằm ở `lookupSettled` và có chốt riêng.
   */
  it("chỉ sẵn sàng khi đã tra đúng từ khoá hiện tại", () => {
    expect(lookupSettled("", "")).toBe(true)
    expect(lookupSettled("", "  ")).toBe(true)
    expect(lookupSettled("abc", "abc")).toBe(true)
    expect(lookupSettled("abc", " abc ")).toBe(true)
    expect(lookupSettled("", "abc"), "chưa tra mà đã báo sẵn sàng").toBe(false)
    expect(lookupSettled("abc", "abcd"), "mã của từ khoá CŨ mà đã báo sẵn sàng").toBe(false)
  })

  it("hook dùng chung luật ấy, không viết lại", () => {
    const HOOK = strip(read("src/hooks/use-list-search.ts"))
    expect(HOOK).toContain("lookupSettled(state.term, t)")
    expect(HOOK, "hook tự viết lại luật — chốt trên không canh được nữa")
      .not.toContain("const ready = state.term === t")
  })

  it("có trần, và trần là một hằng số dùng chung", () => {
    expect(MATCH_CAP).toBeGreaterThan(0)
    for (const [ten, src] of [["đơn hàng", ORDERS], ["hoá đơn bán", SALES_INV]] as const) {
      expect(src, `${ten} gõ tay con số trần thay vì dùng MATCH_CAP`).toContain("MATCH_CAP")
    }
  })
})

const RETURNS = strip(read("src/app/(dashboard)/returns/page.tsx"))
const PAYABLES = strip(read("src/app/(dashboard)/payables/page.tsx"))
const INVENTORY = strip(read("src/app/(dashboard)/inventory/page.tsx"))
const PURCH_INV = strip(read("src/app/(dashboard)/purchasing/invoices/page.tsx"))

/** Sáu màn có phân trang phía máy chủ và có ô tìm. */
const MAN_CO_O_TIM = [
  ["đơn hàng", ORDERS],
  ["hoá đơn bán", SALES_INV],
  ["trả hàng", RETURNS],
  ["công nợ NCC", PAYABLES],
  ["kho hàng", INVENTORY],
  ["hoá đơn mua", PURCH_INV],
] as const

describe("mọi danh sách có phân trang đều tìm cả sổ", () => {
  for (const [ten, src] of MAN_CO_O_TIM) {
    /**
     * ⚠ LỌC BẰNG `.or(...)` TRÊN TRUY VẤN, không bằng `rows.filter(...)`
     * sau khi đã `.range()`. Lọc sau phân trang là chỉ lọc trang đang
     * xem — đúng cái chủ nhà báo.
     */
    it(`${ten}: dựng mệnh đề tìm cho truy vấn, không lọc mảng đã phân trang`, () => {
      expect(src, `${ten} không dùng hook tìm chung`).toContain("useListSearch(")
      expect(src, `${ten} không đưa mệnh đề tìm vào truy vấn`).toContain("listSearch.filter")
    })

    /**
     * ⚠ CHỜ LƯỢT TRA MÃ XONG RỒI MỚI HỎI DANH SÁCH. Không chờ thì lần
     * gõ đầu trả về một danh sách THIẾU (chỉ khớp mã chứng từ) rồi tự
     * sửa vài trăm mili giây sau — người dùng đọc phải cái danh sách
     * thiếu ấy.
     */
    it(`${ten}: truy vấn chính chờ lượt tra mã`, () => {
      expect(
        src.includes("if (!searchReady) return") || src.includes("if (!listSearch.ready) return"),
        `${ten} không chờ lượt tra mã — lần gõ đầu trả về danh sách thiếu rồi tự sửa`
      ).toBe(true)
    })

    /** ⚠ Chạm trần thì NÓI RA — thiếu mà im là đi lại con đường cũ. */
    it(`${ten}: chạm trần thì cảnh báo ra màn`, () => {
      expect(src).toContain("listSearch.truncated")
      expect(src).toContain("Kết quả tìm đang thiếu")
    })

    /** ⚠ Placeholder phải nói đúng phạm vi — đừng hứa hẹn sai. */
    it(`${ten}: ô tìm không còn hứa "trong trang này"`, () => {
      expect(src, `${ten} vẫn còn placeholder thú nhận chỉ tìm trong trang`)
        .not.toContain("Tìm trong trang này")
    })
  }

  /**
   * ⚠ TÌM ĐƯỢC THEO TÊN KHÁCH. Bản cũ của màn đơn hàng chỉ
   * `ilike("order_code")` — gõ tên điểm bán ra RỖNG, còn tệ hơn "chỉ
   * trang 1", vì không có trang nào chứa kết quả cả.
   */
  it("đơn hàng tìm được theo tên khách và số điện thoại", () => {
    expect(ORDERS).toContain('table: "customers", columns: ["store_name", "owner_name", "phone"]')
    expect(ORDERS, "ô tìm vẫn chỉ soi mã đơn")
      .not.toMatch(/x = x\.ilike\("order_code"/)
  })

  it("hoá đơn bán tìm được theo số hoá đơn, mã đơn và tên khách", () => {
    expect(SALES_INV).toContain('table: "customers", columns: ["store_name", "owner_name", "phone"]')
    expect(SALES_INV).toContain('table: "sales_orders", columns: ["order_code"]')
    expect(SALES_INV).toContain('["invoice_code"]')
  })

  /**
   * ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT. Lọc hai lần theo hai luật khác nhau
   * (máy chủ `ilike`, trình duyệt `toLowerCase().includes`) là dòng vừa
   * được máy chủ trả về lại bị trình duyệt giấu đi, và số trên phân
   * trang không khớp số dòng nhìn thấy.
   */
  it("hoá đơn bán không lọc lại mảng đã phân trang", () => {
    expect(SALES_INV).toContain("const filtered = rows")
    expect(SALES_INV, "vẫn còn lọc ở trình duyệt sau khi đã phân trang")
      .not.toMatch(/rows\.filter\([\s\S]{0,200}?toLowerCase\(\)\.includes/)
  })
})

/**
 * QUÉT CẢ KHO MÃ — còn màn nào lọc sau khi phân trang nữa không.
 *
 * ⚠ DANH SÁCH NỢ NAY RỖNG (chủ nhà chốt 21/09/2026: "Dọn nốt"). Bốn
 * màn từng nằm đây — Trả hàng, Công nợ NCC, Kho hàng, Hoá đơn mua —
 * đã chuyển hẳn sang lọc ở máy chủ.
 *
 * ⚠ GIỮ DANH SÁCH LẠI DÙ RỖNG, ĐỪNG XOÁ. Nó là chỗ DUY NHẤT hợp lệ để
 * ghi một màn còn mắc lỗi, và chốt ngay dưới đòi mỗi tên trong đó phải
 * THẬT SỰ còn mắc lỗi — nên không ai nhét được một màn đã sửa vào đây
 * để né. Xoá mảng đi thì lần sau người ta lại nới chính chốt quét.
 */
const CON_NO_LOC_SAU_PHAN_TRANG: string[] = []

function allPages(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allPages(p, acc)
    else if (name === "page.tsx") acc.push(p)
  }
  return acc
}

describe("không màn nào MỚI lọc sau khi đã phân trang", () => {
  it("chỉ những màn đã ghi nợ mới còn lọc ở trình duyệt", () => {
    const bad: string[] = []
    for (const abs of allPages(resolve(ROOT, "src/app/(dashboard)"))) {
      const rel = abs.slice(ROOT.length + 1)
      const src = strip(readFileSync(abs, "utf-8"))
      // Chỉ xét màn có phân trang phía máy chủ.
      if (!src.includes("usePagination") || !src.includes(".range(pg.from, pg.to)")) continue
      // Lọc theo từ khoá ở trình duyệt?
      const filtersLocally =
        /\.filter\(\s*\(?[a-z]\)?\s*=>[\s\S]{0,400}?(viIncludes|toLowerCase\(\)\.includes)/.test(src)
      if (filtersLocally && !CON_NO_LOC_SAU_PHAN_TRANG.includes(rel)) bad.push(rel)
    }
    expect(
      bad,
      "màn có phân trang phía máy chủ nhưng lọc từ khoá ở trình duyệt — ô tìm " +
        "chỉ tìm trong trang đang xem:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ DANH SÁCH NỢ PHẢI CÒN ĐÚNG. Sửa xong một màn mà quên xoá tên nó
   * khỏi đây thì cái lỗ vẫn mở cho lần sau — chốt này bắt đúng chuyện
   * đó bằng cách đòi mỗi tên trong danh sách phải THẬT SỰ còn mắc lỗi.
   */
  it("mỗi màn trong danh sách nợ đều thật sự còn mắc lỗi", () => {
    for (const rel of CON_NO_LOC_SAU_PHAN_TRANG) {
      const src = strip(read(rel))
      const filtersLocally =
        /\.filter\(\s*\(?[a-z]\)?\s*=>[\s\S]{0,400}?(viIncludes|toLowerCase\(\)\.includes)/.test(src)
      expect(
        filtersLocally,
        `${rel} đã hết lọc ở trình duyệt — xoá tên nó khỏi CON_NO_LOC_SAU_PHAN_TRANG`
      ).toBe(true)
    }
  })
})
