import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { parsePosPath, posHref, posPrintHref } from "../src/lib/pos/tabs"
import { RETURN_REASONS } from "../src/lib/constants"

/**
 * RÀ SOÁT NHÁNH `newdesign` — mỗi chốt ở đây là một lỗi ĐÃ CÓ THẬT trong
 * bản đầu của `/pos`, và câu chú thích nói lỗi ấy đã hỏng thế nào.
 *
 * ⚠ CHỐT CANH LUẬT, KHÔNG CANH CÂU CHỮ. Mọi phép quét mã nguồn đều đọc
 * bản đã bóc chú thích (`code()`), vì một chốt khớp với chính câu giải
 * thích ở đầu tệp là chốt mù — đã gặp một lần ở `pos-mua-hang`.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function quet(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) quet(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}
const FILES = [
  ...quet(resolve(ROOT, "src/components/pos")),
  ...quet(resolve(ROOT, "src/app/pos")),
  ...quet(resolve(ROOT, "src/store/pos")),
]
const MAN = [
  "src/components/pos/order-screen.tsx",
  "src/components/pos/return-screen.tsx",
  "src/components/pos/invoice-edit-screen.tsx",
  "src/components/pos/purchase-screen.tsx",
  "src/components/pos/supplier-return-screen.tsx",
  "src/app/pos/hoa-don/[id]/page.tsx",
]

/* ==================================================================
 * 1. URL ↔ TAB — hai nguồn sự thật phải nghe nhau
 * ================================================================== */
describe("đọc ngược đường dẫn /pos ra chứng từ", () => {
  /** ⚠ `parsePosPath` phải là nghịch đảo đúng của `posHref` cho MỌI loại. */
  it("nghịch đảo posHref cho cả 5 loại, có mã và chưa có mã", () => {
    for (const docType of ["SO", "INV", "RET", "PUR", "PRET"] as const) {
      expect(parsePosPath(posHref({ docType, docId: "abc-123" }))).toEqual({ docType, docId: "abc-123" })
      expect(parsePosPath(posHref({ docType, docId: null }))).toEqual({ docType, docId: null })
    }
  })

  /**
   * ⚠ `/sua` VỀ CÙNG MỘT TAB. Sửa và xem là hai màn của MỘT chứng từ;
   * tách thành hai tab là người dùng có hai bản của cùng một tờ.
   */
  it("đường dẫn /sua thuộc cùng chứng từ với đường dẫn xem", () => {
    expect(parsePosPath("/pos/don-hang/abc/sua")).toEqual({ docType: "SO", docId: "abc" })
    expect(parsePosPath("/pos/hoa-don/x1/sua")).toEqual({ docType: "INV", docId: "x1" })
  })

  /** ⚠ Chuỗi truy vấn không lọt vào mã — `?invoice=…` là tham số, không phải id. */
  it("bỏ chuỗi truy vấn khỏi mã", () => {
    expect(parsePosPath("/pos/tra-hang/moi?invoice=abc")).toEqual({ docType: "RET", docId: null })
  })

  it("đường dẫn ngoài /pos thì null", () => {
    expect(parsePosPath("/sell/cart")).toBeNull()
    expect(parsePosPath("/pos")).toBeNull()
    expect(parsePosPath("/pos/khac/abc")).toBeNull()
  })

  /**
   * ⚠ STORE PHẢI NGHE URL. Không có `usePathname` trong store là dán
   * thẳng một đường dẫn không mở tab nào, và lưu xong tab vẫn tên "Đơn
   * mới 1" với `docId` rỗng — mở lại cùng tờ là ra tab thứ hai.
   */
  it("store tab đồng bộ từ pathname", () => {
    const s = code(read("src/store/pos/tabs.tsx"))
    expect(s).toMatch(/usePathname\(\)/)
    expect(s).toMatch(/parsePosPath\(pathname\)/)
  })

  /**
   * ⚠ KHÔNG LÀM VIỆC PHỤ TRONG HÀM CẬP NHẬT STATE. `router.push` bên
   * trong `setTabs((cu) => …)` chạy hai lần dưới StrictMode.
   */
  it("không gọi router.push bên trong setTabs", () => {
    const s = code(read("src/store/pos/tabs.tsx"))
    expect(/setTabs\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?router\.push[\s\S]*?\}\s*\)/.test(s)).toBe(false)
  })

  /** ⚠ Mỗi màn phải đặt tên tab theo mã thật khi đọc được. */
  it("mọi màn chứng từ gọi usePosDocLabel", () => {
    for (const f of MAN) expect(code(read(f)), f).toMatch(/usePosDocLabel\(/)
  })

  /** ⚠ Đóng tab cuối về `/pos` — và `/pos` phải là một trang có thật. */
  it("trang gốc /pos tồn tại và cho mở chứng từ mới", () => {
    const s = code(read("src/app/pos/page.tsx"))
    expect(s).toMatch(/openNew\(/)
  })
})

/* ==================================================================
 * 2. PHÍM TẮT — khung phải giữ được tiêu điểm
 * ================================================================== */
describe("phím tắt chạy ngay khi mở trang", () => {
  const S = code(read("src/components/pos/pos-shell.tsx"))

  /**
   * ⚠ `keydown` chỉ nổi bọt từ phần tử có tiêu điểm. Mở trang xong tiêu
   * điểm ở `<body>` — ngoài khung — nên `F3` KHÔNG tới `onKeyDown` của
   * khung. Bản đầu đúng như thế: mở `/pos`, bấm F3, không có gì.
   */
  it("khung có tabIndex và tự lấy tiêu điểm", () => {
    expect(S).toMatch(/tabIndex=\{-1\}/)
    expect(S).toMatch(/\.focus\(/)
  })

  it("tiêu điểm rơi ra body thì kéo về khung", () => {
    expect(S).toMatch(/onBlur=/)
    expect(S).toMatch(/document\.activeElement === document\.body/)
  })

  /** ⚠ Vẫn KHÔNG gắn lên document/window — spec §10. */
  it("vẫn không gắn keydown toàn cục", () => {
    expect(/(document|window)\.addEventListener\(\s*["']keydown/.test(S)).toBe(false)
  })

  /**
   * ⚠ Ô TÌM PHẢI NỐI VÀO SỔ ĐĂNG KÝ CỦA MÀN ĐANG MỞ, không phải một
   * `<input>` chết. Bản đầu của ô ấy đúng là một `<input>` không nối
   * vào đâu: gõ vào thì chữ hiện ra rồi không có gì xảy ra.
   *
   * ⚠ CHỐT KHÔNG GHIM VỊ TRÍ NỮA. Bản trước soi thẳng `pos-top-bar.tsx`;
   * ô tìm đã chuyển sang cột phải (chủ nhà chốt *"2 bên phải"*) và chốt
   * đỏ oan trong khi luật còn nguyên. Nay nó tìm component NÀO đang vẽ
   * ô ấy, rồi kiểm chỗ nối.
   */
  it("ô tìm nối vào sổ đăng ký của màn đang mở, không phải input rời", () => {
    const veO = FILES.filter((f) => /POS_PICKER_ID/.test(code(readFileSync(f, "utf-8"))))
      .filter((f) => !f.endsWith("product-search.tsx"))
    expect(veO.length, "không tệp nào vẽ ô tìm — hoặc nhiều hơn một tệp vẽ").toBe(1)
    const tep = code(readFileSync(veO[0], "utf-8"))
    /**
     * ⚠ CẮT ĐÚNG THÂN HÀM VẼ Ô, ĐỪNG SOI CẢ TỆP. Bản đầu của chốt này
     * soi cả tệp và một đột biến gỡ hẳn `if (!reg) return null` khỏi ô
     * tìm vẫn LỌT — vì cái nút ở cuối tệp cũng có đúng dòng ấy. Chốt
     * xanh, còn màn không có gì để thêm thì mọc ra một ô rỗng.
     */
    const i = tep.indexOf("export function PosProductSearchBox")
    expect(i, "không thấy hàm vẽ ô tìm").toBeGreaterThan(-1)
    const j = tep.indexOf("export function", i + 10)
    const t = tep.slice(i, j > -1 ? j : undefined)
    expect(t, "ô tìm không đọc sổ đăng ký").toMatch(/usePosProductSearchHost\(\)/)
    expect(t, "ô tìm không lấy danh mục từ màn đang mở").toMatch(/items=\{reg\.items\}/)
    expect(t, "ô tìm không nối việc chọn về màn").toMatch(/onPick=\{reg\.onPick\}/)
    /* ⚠ Màn không đăng ký thì KHÔNG vẽ ô — vẽ ô rỗng là mời người dùng
       gõ vào một chỗ không trả lời. */
    expect(t, "màn không đăng ký vẫn bị vẽ một ô rỗng").toMatch(/if \(!reg\) return null/)
  })
})

/* ==================================================================
 * 3. BỐ CỤC — không cắt màn 1366px, dropdown không rơi khỏi màn
 * ================================================================== */
describe("bố cục vừa màn 1280–1440", () => {
  /**
   * ⚠ 1012 + 380 + lề = 1440. Màn 1366px (laptop phổ biến nhất) bị cắt
   * mất 74px panel phải và khung `overflow-hidden` giấu luôn nút lưu.
   */
  it("không còn cột trái cứng 1012px", () => {
    const pham: string[] = []
    for (const f of FILES) if (/w-\[1012px\]/.test(code(readFileSync(f, "utf-8")))) pham.push(f.replace(ROOT, ""))
    expect(pham).toEqual([])
  })

  /**
   * ⚠ Ô TÌM HÀNG NEO Ở ĐỈNH CỘT PHẢI, KHÔNG Ở ĐÁY.
   *
   * Đây là một lỗi ĐÃ CÓ THẬT: bản đầu neo dải gợi ý ở đáy panel phải,
   * nên nó mở XUỐNG từ mép dưới màn hình và bị `overflow-hidden` của
   * khung cắt sạch — bấm `F3` chỉ thấy nền tối đi.
   *
   * ⚠ LUẬT GIỮ NGUYÊN QUA CẢ HAI LẦN ĐỔI CHỖ, CHỐT THÌ PHẢI ĐỔI. Bản
   * trước canh `SearchDropdown` tìm hàng nằm trước `LineTableFrame` ở
   * cột TRÁI; nay cả bốn màn dùng ô chung ở cột PHẢI, nên chốt canh nó
   * nằm trước khối TỔNG TIỀN — tức ở nửa trên của cột, nơi dải gợi ý
   * còn đủ chỗ mở xuống.
   */
  it("ô tìm hàng neo ở nửa trên cột phải", () => {
    for (const f of MAN) {
      const s = code(read(f))
      const o = s.indexOf("<PosProductSearchBox")
      if (o < 0) continue
      const tong = s.indexOf("<MoneyRow")
      expect(tong, `${f}: không thấy khối tổng tiền để so`).toBeGreaterThan(-1)
      expect(o, `${f}: ô tìm neo dưới khối tổng tiền — dải gợi ý sẽ mở rơi khỏi màn`)
        .toBeLessThan(tong)
    }
  })

  /**
   * ⚠ ĐĂNG KÝ VÀ VẼ Ô LÀ MỘT CẶP — thiếu vế nào cũng hỏng, theo hai
   * kiểu khác nhau:
   *   · đăng ký mà không vẽ ô → danh mục nằm đó, người dùng không có
   *     đường nào tới nó, và `F3` đưa tiêu điểm về một ô không tồn tại;
   *   · vẽ ô mà không đăng ký → ô tự ẩn (`if (!reg) return null`), tức
   *     một dòng mã chết mà không ai biết.
   *
   * ⚠ ĐẾM SỐ MÀN KHÔNG ĐỦ. Bản đầu của chốt này đòi "ít nhất 4 màn có
   * ô tìm", và một đột biến gỡ hẳn ô khỏi màn NHẬP HÀNG vẫn lọt — vì
   * bốn màn còn lại vẫn đủ đếm. Nay nó so HAI TẬP phải trùng nhau.
   */
  it("mọi màn đăng ký danh mục đều vẽ ô tìm, và ngược lại", () => {
    const dangKy: string[] = []
    const veO: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      const ten = f.slice(ROOT.length + 1)
      if (/useRegisterPosProductSearch\(\{/.test(s)) dangKy.push(ten)
      if (/<PosProductSearchBox/.test(s)) veO.push(ten)
    }
    expect(dangKy.length, "không màn nào đăng ký danh mục hàng").toBeGreaterThanOrEqual(5)
    expect(veO.sort(), "tập màn vẽ ô lệch tập màn đăng ký danh mục").toEqual(dangKy.sort())
  })

  /**
   * ⚠ DANH MỤC ĐƯA LÊN Ô TÌM PHẢI LÀ DANH MỤC THẬT, VÀ PHẢI LỌC THEO
   * TỪ KHOÁ ĐANG GÕ.
   *
   * Ô tìm dùng chung KHÔNG tự lọc — mỗi màn một luật lọc nên sổ đăng ký
   * nhận danh sách đã lọc sẵn. Hai kiểu hỏng, cả hai đều im lặng:
   *   · truyền thẳng `[]` → gõ gì cũng không ra mã nào, màn thành vô
   *     dụng mà không có lỗi nào để lần ra;
   *   · quên lọc theo từ khoá → gõ bao nhiêu chữ dải gợi ý vẫn y nguyên
   *     60 dòng đầu danh mục.
   */
  it("mỗi màn đưa lên danh mục thật, lọc theo từ khoá đang gõ", () => {
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      const i = s.indexOf("useRegisterPosProductSearch({")
      if (i < 0) continue
      const ten = f.slice(ROOT.length + 1)
      const khoi = s.slice(i, s.indexOf("})", i))
      const m = khoi.match(/items:\s*([^,\n]+)/)
      expect(m, `${ten}: đăng ký không có danh mục`).toBeTruthy()
      expect(
        /^[A-Za-z_$][\w$]*$/.test(m![1].trim()),
        `${ten}: danh mục đưa lên là "${m![1].trim()}" chứ không phải một danh sách thật`
      ).toBe(true)
      expect(s, `${ten}: không đọc từ khoá của ô tìm`).toMatch(/usePosSearchTerm\(\)/)
      expect(
        s,
        `${ten}: danh mục không lọc theo từ khoá — gõ chữ nào dải gợi ý cũng y nguyên`
      ).toMatch(/viMatchAllWords\(\s*tuKhoa|viMatchAllWords\(\s*moTimHang/)
    }
  })

  /** ⚠ `:focus-visible` không được đổi bo góc của ô đang chọn. */
  it("focus-visible của POS không đặt border-radius", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope :focus-visible")
    expect(i).toBeGreaterThan(-1)
    const khoi = css.slice(i, css.indexOf("}", i)).replace(/\/\*[\s\S]*?\*\//g, "")
    expect(/border-radius/.test(khoi)).toBe(false)
  })
})

/* ==================================================================
 * 4. DỮ LIỆU — ô nào trên màn thì phải đi xuống sổ
 * ================================================================== */
describe("lý do trả hàng khớp CHECK của bảng", () => {
  /**
   * ⚠ `returns.reason` có CHECK `IN ('damaged','wrong_item','near_expiry',
   * 'expired','refused')` (migration 001 dòng 334). Bản đầu gửi `wrong`
   * → Postgres từ chối cả phiếu khi chọn "Sai hàng".
   */
  it("mọi ô chọn lý do trả đều lấy từ RETURN_REASONS", () => {
    /**
     * ⚠ CHỐT KHÔNG GHIM TỆP NỮA. Bản đầu soi thẳng
     * `return-exchange-table.tsx`; bản thiết kế chủ nhà đưa dựng lại
     * khối hàng trả ngay trong `order-screen.tsx` và tệp kia bị xoá —
     * chốt đỏ oan trong khi LUẬT còn nguyên: `returns.reason` và
     * `return_lines.reason` đều có CHECK năm giá trị, viết tay một bộ
     * riêng là Postgres từ chối cả phiếu (đã xảy ra với mã `wrong`).
     */
    const dungBoLyDo: string[] = []
    for (const f of FILES) {
      const src = code(readFileSync(f, "utf-8"))
      const ten = f.slice(ROOT.length + 1)
      if (/RETURN_REASONS\.map\(|LY_DO\.map\(/.test(src)) dungBoLyDo.push(ten)
      expect(
        /value="wrong"|id: "wrong"|value: "wrong"/.test(src),
        `${ten}: vẫn có mã 'wrong' — CHECK của bảng từ chối`
      ).toBe(false)
      expect(
        /<option value="damaged"/.test(src),
        `${ten}: bộ lý do viết tay đã quay lại`
      ).toBe(false)
    }
    /* ⚠ Chống mù: phải có ít nhất HAI chỗ thật sự vẽ ô chọn lý do —
       màn phiếu trả, và khối hàng trả kèm đơn của màn đơn. */
    expect(
      dungBoLyDo.length,
      "số chỗ dùng bộ lý do dùng chung tụt xuống dưới hai"
    ).toBeGreaterThanOrEqual(2)
    expect(dungBoLyDo).toContain("src/components/pos/order-screen.tsx")
    expect(dungBoLyDo).toContain("src/components/pos/return-screen.tsx")
  })

  it("RETURN_REASONS đúng bộ CHECK của migration 001", () => {
    const sql = read("supabase/migrations/001_schema.sql")
    const m = /reason text CHECK \(reason IN \(([^)]+)\)\)/.exec(sql)
    expect(m).not.toBeNull()
    const trongDb = m![1].split(",").map((x) => x.trim().replace(/'/g, "")).sort()
    expect(RETURN_REASONS.map((r) => r.value).slice().sort()).toEqual(trongDb)
  })
})

describe("ô không có cột thì không vẽ", () => {
  /**
   * ⚠ `reissue_invoice` chỉ nhận dòng hàng, `payment_terms`,
   * `invoice_date`, `notes`. Khách, kho, NVBH, hạn trả, giảm cấp chứng
   * từ, thu khác — không có cổng nào nhận. Ô nào ở đó là ô nói dối.
   */
  it("màn sửa hóa đơn không vẽ ô reissue_invoice không nhận", () => {
    const s = code(read("src/components/pos/invoice-edit-screen.tsx"))
    for (const id of ["e-giam", "e-thukhac", "e-han", "e-kho", "e-nvbh"]) {
      expect(s.includes(`id="${id}"`), `ô ${id} đã quay lại`).toBe(false)
    }
    expect(/moTimKhach/.test(s), "vẫn cho đổi khách trên tờ lập lại").toBe(false)
    expect(s).toMatch(/<PartnerCard[^>]*readOnly/)
  })

  /** ⚠ Nhưng THUẾ thì lưu được — qua `vat_rate` của từng dòng. */
  it("thuế của màn sửa hóa đơn đi xuống dòng", () => {
    const s = code(read("src/components/pos/invoice-edit-screen.tsx"))
    expect(s).toMatch(/vatRate: vatRate \/ 100/)
    const save = code(read("src/lib/pos/save.ts"))
    expect(save).toMatch(/posLinesToInvoice\(o\.lines, o\.vatRate \?\? 0\)/)
  })

  /** ⚠ `returns` không có cột phí. */
  it("màn phiếu trả không có ô phí trả hàng", () => {
    const s = code(read("src/components/pos/return-screen.tsx"))
    expect(/pos-phi-tra|Phí trả hàng/.test(s)).toBe(false)
  })

  /** ⚠ `purchase_invoices` không có cột chi phí khác, không có cột tiền đã trả. */
  it("màn nhập hàng không có ô chi phí khác / tiền trả NCC", () => {
    const s = code(read("src/components/pos/purchase-screen.tsx"))
    expect(/p-chiphi|Chi phí nhập khác/.test(s)).toBe(false)
    expect(/id="p-tra"|PaymentButtons/.test(s)).toBe(false)
  })

  /** ⚠ Thuế gõ ở cấp phiếu nhập phải đi qua `vat_override`, nếu không RPC ghi đè bằng 0. */
  it("phiếu nhập gửi vat_override", () => {
    const s = code(read("src/lib/pos/save.ts"))
    const i = s.indexOf("savePosPurchase")
    expect(s.slice(i, s.indexOf("savePosSupplierReturn"))).toMatch(/vat_override:/)
  })

  /**
   * ⚠ HÀNG TRẢ KÈM ĐƠN PHẢI ĐI XUỐNG. Bản đầu gửi `returnLines: []` trong
   * khi panel vẫn trừ "Trừ hàng trả" — tổng trên màn không có trong sổ.
   */
  it("đơn hàng gửi hàng trả kèm đơn xuống thật", () => {
    const s = code(read("src/components/pos/order-screen.tsx"))
    expect(/returnLines:\s*\[\]/.test(s), "vẫn gửi returnLines rỗng").toBe(false)
    expect(s).toMatch(/returnLines: posLinesToReturnCart\(retLines\)/)
    expect(s).toMatch(/heldReturnId,/)
    expect(s).toMatch(/editableReturnOf\(/)
  })

  /** ⚠ Mở đơn đã lưu thì khách của đơn phải lên card. */
  it("nạp đơn đã lưu thì đặt khách", () => {
    const s = code(read("src/components/pos/order-screen.tsx"))
    const i = s.indexOf('from("sales_orders")')
    const khoi = s.slice(i, s.indexOf("} catch", i))
    expect(khoi).toMatch(/setKhach\(\{/)
  })

  /** ⚠ Mã chống lặp sinh một lần mỗi lần mở màn, không phải mỗi cú bấm. */
  it("clientRequestId giữ trong ref", () => {
    const s = code(read("src/components/pos/order-screen.tsx"))
    expect(s).toMatch(/clientRequestId = useRef\(/)
    expect(s).toMatch(/clientRequestId: clientRequestId\.current/)
  })
})

/* ==================================================================
 * 5. NGÀY, IN, NÚT
 * ================================================================== */
describe("ngày là ô ngày, in đi qua mẫu in thật", () => {
  /** ⚠ Ô chữ tự do đi vào cột `date` → `21/09/2026` làm Postgres từ chối cả phiếu. */
  it("SubHeaderDate là type=date", () => {
    const s = code(read("src/components/pos/doc-sub-header.tsx"))
    const i = s.indexOf("export function SubHeaderDate")
    expect(s.slice(i)).toMatch(/type="date"/)
    expect(/type="text"/.test(s.slice(i))).toBe(false)
  })

  /**
   * ⚠ `window.print()` cả màn POS là in ra một trang toàn nút. Chứng từ
   * có mẫu in thì dẫn tới trang in; chưa có thì nút mờ kèm lý do.
   */
  it("không còn window.print() trong /pos", () => {
    const pham: string[] = []
    for (const f of FILES) if (/window\.print\(\)/.test(code(readFileSync(f, "utf-8")))) pham.push(f.replace(ROOT, ""))
    expect(pham).toEqual([])
  })

  it("posPrintHref chỉ trả trang in đã có thật", () => {
    expect(posPrintHref("SO", "a")).toBe("/orders/a/print")
    expect(posPrintHref("INV", "a")).toBe("/sales-invoices/a/print")
    expect(posPrintHref("RET", "a")).toBeNull()
    expect(posPrintHref("PUR", "a")).toBeNull()
    expect(posPrintHref("PRET", "a")).toBeNull()
  })

  /** ⚠ `<Link>` lồng trong `<button>` là HTML sai — bấm vào mép nút không đi đâu. */
  it("không có Link lồng trong PanelButton", () => {
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      expect(/<PanelButton[^>]*>\s*<Link/.test(s), f.replace(ROOT, "")).toBe(false)
    }
  })

  /** ⚠ Nút "Trả hàng" trên hóa đơn mở phiếu trả NẠP SẴN tờ ấy. */
  it("hóa đơn → trả hàng mang theo mã hóa đơn", () => {
    const s = code(read("src/app/pos/hoa-don/[id]/page.tsx"))
    expect(s).toMatch(/\/pos\/tra-hang\/moi\?invoice=\$\{id\}/)
    const r = code(read("src/components/pos/return-screen.tsx"))
    expect(r).toMatch(/sourceInvoiceId/)
  })
})

/* ==================================================================
 * 6. ĐỢT 7 — MÀN ĐƠN HÀNG GIỮ ĐỦ CHỨC NĂNG CỦA MÀN ĐƠN CŨ
 *
 * Chủ nhà chốt 21/09/2026: "các dòng trong đơn đặt hàng chỉ bố trí hình
 * thức khác đi thôi chứ vẫn phải giữ các chức năng của làm đơn hàng cũ".
 *
 * ⚠ MỖI CHỐT DƯỚI ĐÂY LÀ MỘT THỨ BẢN ĐẦU ĐÃ LÀM RƠI, và cả năm đều
 * đụng TIỀN. Chốt canh rằng màn POS gọi ĐÚNG hàm mà màn cũ gọi — không
 * chép lại phép tính, vì hai bản sao của một phép tính tiền là hai chỗ
 * trôi xa nhau được.
 * ================================================================== */
describe("§đợt7 — dòng đơn hàng giữ chức năng của màn đơn cũ", () => {
  const S = code(read("src/components/pos/order-screen.tsx"))

  /**
   * ⚠ BẢNG GIÁ THEO NHÓM KHÁCH. `unitPriceFor` xét bảng giá riêng của
   * nhóm TRƯỚC bảng giá chung; lấy `products.sell_price` phẳng là khách
   * sỉ bị tính giá lẻ, và không gì trên màn nói ra.
   */
  it("giá tra từ unitPriceFor kèm nhóm giá của khách", () => {
    expect(S).toMatch(/unitPriceFor\(/)
    expect(S).toMatch(/const groupId = customerById\(khach\?\.id\)\?\.group_id \?\? null/)
    /* Thêm hàng KHÔNG được lấy `sell_price` phẳng nữa. */
    expect(
      /price: Number\(p\.sell_price\)/.test(S),
      "thêm hàng lại lấy sell_price phẳng, bỏ qua bảng giá của khách"
    ).toBe(false)
  })

  /**
   * ⚠ ĐỔI ĐƠN VỊ LÀ TRA LẠI BẢNG GIÁ. Nhân chia hệ số đúng khi bảng giá
   * tuyến tính và SAI ngay khi NPP đặt giá thùng rẻ hơn 12× giá chai —
   * chuyện thường ngày của bán sỉ.
   */
  it("đổi đơn vị tra lại bảng giá, không nhân chia hệ số", () => {
    /**
     * ⚠ BÁM VÀO PHÉP ĐỔI, KHÔNG BÁM VÀO Ô ĐIỀU KHIỂN. Bản đầu của chốt
     * này neo vào chuỗi `"Đơn vị tính dòng"` — nhãn của một `<select>`.
     * Bản thiết kế chủ nhà đưa thay `<select>` ấy bằng dải chip, nhãn
     * biến mất, và chốt đỏ oan trong khi LUẬT — "đổi đơn vị là tra lại
     * bảng giá" — còn nguyên trong `doiDonVi`.
     */
    const i = S.search(/const doiDonVi = useCallback\(/)
    expect(i, "không thấy phép đổi đơn vị của dòng hàng").toBeGreaterThan(-1)
    const o = S.slice(i, S.indexOf("addProduct", i))
    expect(o, "đổi đơn vị không tra bảng giá theo nhóm khách")
      .toMatch(/unitPriceFor\(p, u, groupId\)/)
    /* ⚠ Và phép đổi phải THẬT SỰ ghi giá mới xuống dòng. */
    expect(o, "tra giá rồi không ghi xuống dòng").toMatch(/price: gia/)
    expect(o, "tra giá rồi không cập nhật giá bảng").toMatch(/listPrice: gia/)
    expect(
      /price: Math\.round\(\(l\.price \/ cu\) \* moi\)/.test(S),
      "đổi đơn vị lại nhân chia hệ số thay vì tra bảng giá"
    ).toBe(false)
    /* ⚠ Và dải chip phải nối vào chính phép ấy — bộ luật đúng mà không
       ai gọi thì vô nghĩa. */
    expect(S, "chip đơn vị không gọi phép đổi").toMatch(/doiDonVi\(l, u\.unit_name\)/)
  })

  /**
   * ⚠ `listPrice` ĐI XUỐNG SỔ. `lineDiscountOf` tính
   * `(listPrice − price) × qty` và ghi vào `sales_order_lines.line_discount`.
   * Để `listPrice = price` là mọi đơn ghi chiết khấu 0 dù vừa hạ giá.
   */
  it("dòng mang giá bảng riêng, và save.ts gửi nó xuống", () => {
    expect(S).toMatch(/listPrice: gia/)
    const save = code(read("src/lib/pos/save.ts"))
    expect(save).toMatch(/listPrice: l\.listPrice \?\? l\.price/)
    expect(
      /listPrice: l\.price,/.test(save),
      "save.ts lại lấy giá đang gõ làm giá bảng — chiết khấu của đơn về 0"
    ).toBe(false)
  })

  /**
   * ⚠ CHỐT CHẶN GIÁ CỦA NVBH. Sàn là giá bảng, trần là +N%. Tô đỏ mà
   * vẫn lưu được thì vệt đỏ chỉ là trang trí — phải chặn cả nút.
   */
  it("có chốt chặn giá, và nó chặn cả nút lưu", () => {
    expect(S).toMatch(/priceViolation\(/)
    expect(S).toMatch(/userPriceRulesFrom\(user\)/)
    const i = S.indexOf('variant="primary"')
    expect(i).toBeGreaterThan(-1)
    const nut = S.slice(i, i + 700)
    expect(/disabled=\{[^}]*coGiaXau/.test(nut), "nút lưu không mờ khi giá ngoài hạn mức").toBe(true)
    /* Và đường lưu cũng chặn — nút mờ không thay được chốt trong hàm. */
    expect(S).toMatch(/if \(coGiaXau\) \{/)
  })

  /** ⚠ Không có quyền sửa giá thì ô giá phải khoá, và nói vì sao. */
  it("ô giá khoá khi không có quyền sửa giá", () => {
    const i = S.indexOf("Đơn giá dòng")
    const o = S.slice(Math.max(0, i - 700), i + 700)
    expect(o).toMatch(/disabled=\{!canEditPrice\}/)
    expect(o).toMatch(/không có quyền sửa giá/)
  })

  /**
   * ⚠ THUẾ THEO DÒNG. Người dùng đã báo một lần ở màn cũ: "bấm vào chi
   * tiết hàng trong đơn chưa có chỗ để tuỳ chọn VAT".
   */
  it("có ô thuế theo dòng, và thuế ấy đi xuống hóa đơn", () => {
    expect(S).toMatch(/Thuế GTGT dòng/)
    expect(S).toMatch(/vatChoices\(/)
    const save = code(read("src/lib/pos/save.ts"))
    expect(save).toMatch(/vatRate: l\.vatRate \?\? vatRate/)
    expect(save).toMatch(/vatRate: Number\(l\.vatRate\) \|\| 0/)
  })

  /** ⚠ Thuế suất lạ (7%) của mặt hàng không bị ép về bậc gần nhất. */
  it("giữ thuế suất lạ của dòng trong ô chọn", () => {
    const i = S.indexOf("function vatChoices")
    expect(i).toBeGreaterThan(-1)
    const f = S.slice(i, i + 500)
    expect(f).toMatch(/Math\.abs\(v\.value - cur\) < 1e-9/)
    expect(f).toMatch(/vatLabel\(cur\)/)
  })

  /**
   * ⚠ VƯỢT TỒN XÉT TRÊN TỔNG MỌI DÒNG CÙNG MẶT HÀNG, và tồn hiện theo
   * ĐƠN VỊ CỦA DÒNG. Hai dòng 6 thùng trên tồn 10 thì từng dòng đều
   * "hợp lệ"; "Tồn 240" cạnh "2 thùng" là hai đơn vị không nhãn.
   */
  it("vượt tồn xét theo tổng, tồn hiện theo đơn vị của dòng", () => {
    expect(S).toMatch(/isSaleLineOverstock\(/)
    expect(S).toMatch(/stockInUnit\(p, l\.unit/)
  })

  /**
   * ⚠ ĐỔI KHÁCH LÀ ĐỔI BẢNG GIÁ, và dòng đã có giữ giá cũ. Lặng lẽ giữ
   * giá cũ là bán theo bảng giá của khách trước.
   */
  it("nói ra khi bảng giá của khách mới khác giá đang dùng", () => {
    expect(S).toMatch(/lechBangGia/)
    expect(read("src/components/pos/order-screen.tsx")).toMatch(/bảng giá mới/)
  })

  /**
   * ⚠ TẮT MỘT CỘT LÀ BỎ HẲN NÓ KHỎI LƯỚI. Bản đầu giữ nguyên lưới rồi
   * để trống ô — tắt "Mã hàng" xong vẫn thấy một khoảng 88px trống.
   */
  it("cột bật/tắt dựng lưới và ô từ cùng một nguồn", () => {
    expect(S).toMatch(/cols=\{cot\.cols\}/)
    expect(S).toMatch(/cells=\{cot\.cells\}/)
    expect(S).toMatch(/gridTemplateColumns: cot\.cols/)
    expect(
      /settings\.colIndex \? i \+ 1 : ""/.test(S),
      "cột tắt vẫn vẽ một ô rỗng thay vì rời khỏi lưới"
    ).toBe(false)
  })

  /** ⚠ `F3` phải tới đúng ô tìm trên header. */
  it("F3 đưa tiêu điểm về ô tìm trên header", () => {
    expect(S).toMatch(/F3: focusPosPicker/)
  })

  /**
   * ⚠ Ô TÌM KHÁCH GIỮ NGUYÊN. Chủ nhà chốt riêng câu ấy cùng đợt — nó
   * vẫn là `SearchDropdown` của POS, không đổi sang component khác.
   */
  it("ô tìm khách vẫn là SearchDropdown của POS", () => {
    expect(S).toMatch(/open=\{moTimKhach\}/)
    expect(S).toMatch(/<SearchDropdown/)
  })
})

/* ==================================================================
 * 7. ĐỢT 8 — BỘ CHỮ CỦA `/pos` LÀ BỘ CHỮ CỦA APP
 *
 * Chủ nhà chốt: *"các font chữ điều chỉnh về theo phong cách thiết kế
 * cũ"*. Bản đầu nạp Be Vietnam Pro + JetBrains Mono riêng cho `/pos`
 * theo bản xem thiết kế — mở `/pos` ra là một app khác hẳn phần còn
 * lại, và số liệu thì mang một họ chữ thứ ba.
 * ================================================================== */
describe("§đợt8 — /pos dùng đúng bộ chữ của app", () => {
  /**
   * ⚠ KHÔNG NẠP HỌ CHỮ RIÊNG. Đây là chốt chống quay lại: nạp thêm một
   * họ chữ "cho đúng bản thiết kế" là việc rất dễ làm lại.
   */
  it("layout /pos không nạp bộ chữ nào", () => {
    const s = code(read("src/app/pos/layout.tsx"))
    expect(/next\/font/.test(s), "/pos lại nạp bộ chữ riêng").toBe(false)
    expect(/Be_Vietnam_Pro|JetBrains_Mono/.test(s)).toBe(false)
  })

  /**
   * ⚠ VÀ KHÔNG KHAI `font-family` TRONG `.pos-scope`. Khối ấy nằm trong
   * `body`, nên nó THỪA HƯỞNG Manrope — khai lại là hai chỗ giữ cùng
   * một họ chữ, và chỗ nào quên sửa thì `/pos` lại trôi đi.
   */
  it(".pos-scope không khai font-family riêng", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope {")
    expect(i, "không thấy khối .pos-scope").toBeGreaterThan(-1)
    const khoi = css.slice(i, css.indexOf("\n}", i)).replace(/\/\*[\s\S]*?\*\//g, "")
    expect(/font-family/.test(khoi), ".pos-scope khai font-family riêng").toBe(false)
  })

  /**
   * ⚠ `.n` CHỈ LÀM MỘT VIỆC: giữ cột số thẳng hàng. Cho nó một họ chữ
   * riêng là mọi con số trên `/pos` khác hẳn số ở các màn còn lại — và
   * `tabular-nums` mới là thứ thật sự làm cột thẳng.
   */
  it(".n giữ tabular-nums và không đổi họ chữ", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope .n {")
    expect(i, "không thấy quy tắc .n").toBeGreaterThan(-1)
    const khoi = css.slice(i, css.indexOf("}", i))
    expect(khoi).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(/font-family/.test(khoi), ".n lại mang một họ chữ riêng").toBe(false)
  })

  /** ⚠ Và không còn biến chữ nào của bản cũ sót lại trong mã. */
  it("không còn biến --font-be-vietnam / --font-jetbrains", () => {
    const pham: string[] = []
    for (const f of [...FILES, resolve(ROOT, "src/app/globals.css")]) {
      if (/var\(--font-(be-vietnam|jetbrains)\)/.test(code(readFileSync(f, "utf-8")))) {
        pham.push(f.replace(ROOT, ""))
      }
    }
    expect(pham).toEqual([])
  })
})

/* ==================================================================
 * 8. ĐỢT 9 — MỘT Ô THÊM HÀNG, NẰM TRÊN HEADER, NỀN XANH
 *
 * Chủ nhà chốt: *"Bỏ bớt 1 cái thêm hàng. đang có 2 cái. Bỏ cái dưới.
 * giữ cái trên header, khi ấn vào tìm hàng, danh sách xổ ngay đó"*,
 * *"Màu Đen header -> màu xanh lam đang dùng"*, *"Khi ấn vào thêm hàng
 * xong danh sách phải thu gọn lại chứ?"*.
 * ================================================================== */
describe("§đợt9 — một ô thêm hàng trên header, nền xanh", () => {
  const ORDER = code(read("src/components/pos/order-screen.tsx"))
  const BAR = code(read("src/components/pos/pos-top-bar.tsx"))

  /**
   * ⚠ ĐÚNG MỘT Ô THÊM HÀNG TRÊN MÀN ĐƠN. Đây là chính cái chủ nhà đếm
   * được: header có một, trên bảng hàng có một nữa.
   */
  it("màn đơn không còn ô tìm hàng thứ hai", () => {
    expect(/<ProductPicker/.test(ORDER), "thẻ ô tìm dưới bảng đã quay lại").toBe(false)
    expect(/<SearchDropdown[\s\S]*?open=\{moTimHang\}/.test(ORDER)).toBe(false)
    /* Ô tìm KHÁCH thì vẫn còn — chủ nhà chốt giữ nguyên. */
    expect(ORDER).toMatch(/open=\{moTimKhach\}/)
  })

  /**
   * ⚠ VÀ MÀN PHẢI THẬT SỰ GỌI HÀM ĐĂNG KÝ. Không có chốt này thì gỡ
   *   sạch lời gọi vẫn xanh — ô tìm trên header rỗng, bấm vào không ra
   *   mã nào, và mọi chốt khác vẫn đúng.
   */
  it("màn đơn gọi hàm đăng ký, kèm danh mục và việc cần làm", () => {
    const i = ORDER.search(/useRegisterPosProductSearch\(\{/)
    expect(i, "màn đơn không gọi hàm đăng ký").toBeGreaterThan(-1)
    const khoi = ORDER.slice(i, ORDER.indexOf("})", i))
    expect(khoi).toMatch(/items: mucHang/)
    expect(khoi).toMatch(/onPick: chonHang/)
  })

  /**
   * ⚠ ĐÚNG MỘT Ô TÌM HÀNG TRONG CẢ `/pos` — luật bất biến qua ba lần
   * đổi chỗ (hai ô → một ô trên header → một ô ở cột phải). Đây chính
   * là điều chủ nhà đếm được và bác: *"đang có 2 cái"*.
   *
   * ⚠ ĐẾM TRÊN TOÀN `/pos`, KHÔNG ĐẾM TRONG MỘT TỆP. Bản trước chỉ đếm
   * trong `pos-top-bar.tsx`: dựng thêm một `ProductPicker` ở tệp khác là
   * hai ô mà chốt vẫn xanh.
   */
  it("cả /pos vẽ đúng một ô tìm hàng", () => {
    const o: string[] = []
    for (const f of FILES) {
      const n = code(readFileSync(f, "utf-8")).split("<ProductPicker").length - 1
      for (let k = 0; k < n; k++) o.push(f.slice(ROOT.length + 1))
    }
    expect(o, "số ô tìm hàng trong /pos khác 1").toHaveLength(1)
    expect(BAR, "ô tìm quay lại thanh header").not.toMatch(/<ProductPicker/)
  })

  /**
   * ⚠ DANH SÁCH XỔ NGAY DƯỚI Ô. `ProductPicker` neo dải gợi ý bằng
   * `absolute top-full` vào khung của chính nó — nên chốt canh rằng
   * khung ấy có `relative`, nếu không dải gợi ý neo nhầm vào tổ tiên
   * xa hơn và rơi ra giữa màn.
   */
  it("dải gợi ý neo vào chính ô tìm", () => {
    const picker = code(read("src/components/ui/product-picker.tsx"))
    expect(picker).toMatch(/cn\("relative"/)
    expect(picker).toMatch(/absolute inset-x-0 top-full/)
  })

  /**
   * ⚠ THÊM XONG THÌ THU GỌN — chủ nhà chốt. Nhưng CHỈ cho ô trên
   * header: năm màn khác đang chạy cố ý giữ danh sách mở để nhập hàng
   * loạt, và đổi mặc định là đổi luôn cả năm mà không ai yêu cầu.
   */
  it("ô tìm dùng chung đóng danh sách sau khi thêm", () => {
    /* ⚠ Đọc TỆP ĐANG VẼ ô, không đọc header — ô đã chuyển sang cột phải. */
    const veO = FILES.filter((f) => /<ProductPicker/.test(code(readFileSync(f, "utf-8"))))
    expect(veO).toHaveLength(1)
    expect(code(readFileSync(veO[0], "utf-8"))).toMatch(/closeOnPick/)
    const picker = code(read("src/components/ui/product-picker.tsx"))
    expect(picker).toMatch(/closeOnPick = false/)
    /**
     * ⚠ HÀNH VI THẬT NẰM Ở `tests/picker-open.test.ts` — chạy đúng chuỗi
     * sự kiện. Bản đầu của chốt này ghim chuỗi `if (closeOnPick)
     * setOpen(false)`: dòng ấy CÓ trong mã, chốt xanh, mà dải gợi ý vẫn
     * mở nguyên vì lệnh trả tiêu điểm mở lại nó. Chủ nhà phải báo tay.
     * Ở đây chỉ canh chỗ NỐI.
     */
    expect(picker).toMatch(/gui\(\{ t: "pick", refocus:/)
    expect(/setOpen\(/.test(picker), "component lại tự giữ trạng thái đóng/mở").toBe(false)
  })

  /**
   * ⚠ NÚT "THÊM SẢN PHẨM" Ở CỘT TRÁI CHỈ ĐƯA TIÊU ĐIỂM, KHÔNG TỰ TÌM.
   *
   * Chủ nhà chốt 21/09/2026: *"3 bấm vào đó nhảy sang ô thêm sản phẩm
   * bên phải"*. Nút ấy tồn tại vì ô tìm đã sang cột kia — nhưng nếu ai
   * đó "tiện tay" cho nó một ô nhập và một dải gợi ý riêng thì `/pos`
   * lại có hai chỗ thêm hàng, đúng thứ chủ nhà đã đếm và bác ở đợt 9.
   *
   * Chốt canh cả hai vế: nút PHẢI gọi `focusPosPicker`, và tệp vẽ nút
   * KHÔNG được chứa ô nhập hay dải gợi ý nào ngoài ô dùng chung.
   */
  it("nút thêm sản phẩm chỉ nhảy sang ô bên phải, không tự tìm", () => {
    /**
     * ⚠ CANH LUẬT, KHÔNG CANH TÊN COMPONENT. Bản đầu đòi màn đơn vẽ
     * `<PosAddProductButton />`. Bản thiết kế chủ nhà đưa dựng nút ấy
     * THẲNG trong khối tiêu đề, component dùng chung hết người gọi nên
     * bị gỡ — chốt đỏ oan trong khi luật còn nguyên: màn đơn phải có
     * một nút dẫn về ô tìm, và nút ấy không được tự mọc ô tìm riêng.
     */
    const i = ORDER.indexOf("Thêm sản phẩm (F2)")
    expect(i, "màn đơn mất nút thêm sản phẩm của bản vẽ").toBeGreaterThan(-1)
    const nut = ORDER.slice(Math.max(0, i - 500), i)
    expect(nut, "nút không đưa tiêu điểm về ô tìm").toMatch(/onClick=\{focusPosPicker\}/)
    expect(
      /<input|<ProductPicker|<SearchDropdown/.test(nut),
      "nút tự mọc ô tìm riêng — /pos lại có hai chỗ thêm hàng"
    ).toBe(false)

    /* ⚠ Và màn đơn phải THẬT SỰ vẽ ô tìm ở cột phải. */
    expect(ORDER, "màn đơn không vẽ ô tìm ở cột phải").toMatch(/<PosProductSearchBox\s*\/>/)
  })

  /**
   * ⚠ MÀN PHIẾU TRẢ CÓ HAI GIỎ, VÀ MỘT Ô TÌM. Đây là chỗ nguy nhất của
   * đợt chuyển ô tìm sang cột phải.
   *
   * Phiếu trả vừa nhận HÀNG KHÁCH TRẢ VỀ vừa nhận HÀNG MÌNH ĐỔI LẠI.
   * Hai bảng nằm chồng nhau và nhìn rất giống nhau. Nếu ô tìm không đi
   * theo giỏ đang chọn thì một món khách trả bị ghi thành một món mình
   * đưa thêm — lệch hẳn chiều tiền, và không ai thấy vì số dòng vẫn
   * đúng.
   *
   * Chốt canh ba vế của cùng một luật: việc chọn đi theo giỏ, ô tìm
   * HIỆN RA giỏ ấy, và hai nút "+ Hàng trả" / "+ Hàng đổi" mỗi nút đặt
   * đúng giỏ của nó.
   */
  it("màn phiếu trả: ô tìm đi theo giỏ đang chọn, và nói ra giỏ ấy", () => {
    const s = code(read("src/components/pos/return-screen.tsx"))

    /* 1. Việc chọn đọc giỏ đích — không đặt cứng một bên. */
    const i = s.indexOf("const chonHang")
    expect(i, "màn phiếu trả không còn hàm chọn hàng").toBeGreaterThan(-1)
    const chon = s.slice(i, i + 220)
    expect(chon, "việc chọn không đọc giỏ đích — mọi mã rơi vào cùng một giỏ")
      .toMatch(/gioDich\s*===\s*"doi"/)

    /* 2. Danh mục cũng đổi theo giỏ: giỏ hàng trả bị hóa đơn gốc chặn. */
    const j = s.indexOf("const mucChoODung")
    expect(j).toBeGreaterThan(-1)
    expect(s.slice(j, j + 260), "danh mục không đổi theo giỏ")
      .toMatch(/gioDich\s*===\s*"tra"\s*\?\s*mucHangTra/)

    /* 3. Ô tìm phải HIỆN giỏ đang chọn — xem `PosProductSearchBox`. */
    const k = s.indexOf("<PosProductSearchBox")
    expect(k, "màn phiếu trả không vẽ ô tìm").toBeGreaterThan(-1)
    const o = s.slice(k, s.indexOf("/>", k))
    expect(o, "ô tìm không nói đang thêm vào giỏ nào").toMatch(/note=\{/)
    expect(o, "dải báo giỏ không đổi theo giỏ").toMatch(/gioDich\s*===\s*"tra"/)

    /* 4. Hai nút mỗi nút một giỏ — cùng trỏ một giỏ là một nút chết. */
    expect(s, 'thiếu nút đặt giỏ "hàng trả"').toMatch(/themVao\("tra"\)/)
    expect(s, 'thiếu nút đặt giỏ "hàng đổi"').toMatch(/themVao\("doi"\)/)
  })

  /**
   * ⚠ KHÔNG CÒN NÚT NÀO TRỎ VÀO DROPDOWN ĐÃ GỠ. Ba màn vừa chuyển sang
   * ô tìm dùng chung; mỗi màn có sẵn hai nút "Thêm hàng" ở ô rỗng và ở
   * thanh chân bảng. Quên chỉnh một nút là nó thành NÚT CHẾT — bấm
   * không ra gì, và không có lỗi nào để lần ra.
   */
  it("không còn nút thêm hàng trỏ vào dropdown đã gỡ", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const s = code(readFileSync(f, "utf-8"))
      if (/setMoTim(Hang|Tra|Doi)\(true\)/.test(s)) pham.push(f.slice(ROOT.length + 1))
    }
    expect(pham, "nút thêm hàng còn mở một dropdown không còn tồn tại").toEqual([])
  })

  /** ⚠ Các màn cũ KHÔNG được đổi hành vi — không màn nào bật cờ ấy. */
  it("năm màn đang chạy giữ nguyên hành vi mở", () => {
    const pham: string[] = []
    for (const rel of [
      "src/components/orders/invoice-editor.tsx",
      "src/components/purchasing/purchasing-lines-editor.tsx",
      "src/app/(dashboard)/inventory/stock-issue/page.tsx",
      "src/app/(dashboard)/inventory/stock-in/page.tsx",
      "src/app/(dashboard)/returns/new/page.tsx",
    ]) {
      if (/closeOnPick/.test(code(read(rel)))) pham.push(rel)
    }
    expect(pham, "một màn đang chạy bị đổi hành vi mở/đóng danh sách").toEqual([])
  })

  /**
   * ⚠ NỀN THANH LẤY TỪ TOKEN, VÀ CHỮ CŨNG VẬY — đây là một CẶP.
   *
   * Thanh trên cùng đã đổi nền hai lần: đen → xanh lam (chủ nhà chốt
   * miệng đợt 9) → trắng (bản thiết kế 21/09/2026). Cả hai lần, cái
   * suýt hỏng là cùng một thứ: đổi nền mà quên màu chữ. Bản nền xanh
   * dùng `text-white` khắp nơi; để nguyên chuỗi ấy khi nền thành trắng
   * là cả thanh biến mất — chữ trắng trên nền trắng.
   *
   * Nên chốt không hỏi "thanh màu gì". Nó hỏi: nền có lấy từ token
   * không, và chữ có lấy từ token không.
   */
  it("nền và chữ của thanh đều lấy từ token, không ghim màu", () => {
    expect(BAR).toMatch(/bg-\[var\(--pos-bar\)\]/)
    expect(BAR, "thanh header còn mã màu cứng").not.toMatch(/#[0-9a-fA-F]{6}/)
    /**
     * ⚠ `text-white` CHỈ ĐƯỢC NẰM TRÊN MỘT MẢNG MÀU ĐẶC. Ô logo là mảng
     * ấy (nền `--pos-primary`). Mọi chỗ khác dùng `text-white` là đang
     * giả định thanh có nền tối — đúng giả định đã chết hai lần.
     */
    const trang = BAR.match(/text-white/g) ?? []
    expect(
      trang.length,
      "còn chữ trắng ngoài ô logo — thanh nay nền sáng, chữ trắng là chữ vô hình"
    ).toBeLessThanOrEqual(1)
    expect(BAR, "chữ trên thanh không lấy từ token").toMatch(/var\(--pos-bar-fg\)/)
  })

  /**
   * ⚠ Token thanh header khai trong `.pos-scope`, không rò ra `:root` —
   * khai ở `:root` là đổ biến của một màn lên mọi màn còn lại.
   *
   * ⚠ VÀ NỀN PHẢI ĐI KÈM CHỮ. Danh sách dưới đây không liệt kê mọi
   * token của thanh (bản trước liệt kê, rồi đỏ oan khi `--pos-bar-deep`
   * được gộp vào `--pos-primary-deep`); nó chỉ đòi đúng cặp không được
   * thiếu một vế.
   */
  it("token thanh header nằm trong .pos-scope, và có đủ cặp nền–chữ", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope {")
    const khoi = css.slice(i, css.indexOf("\n}", i))
    for (const t of ["--pos-bar", "--pos-bar-fg", "--pos-bar-line"]) {
      expect(khoi, `thiếu token ${t}`).toContain(`${t}:`)
    }
    expect(/--pos-bar[a-z-]*\s*:/.test(css.slice(0, i)), "token thanh khai ngoài .pos-scope").toBe(false)
  })

  /**
   * ⚠ KHÔNG MÃ MÀU CỨNG Ở BẤT KỲ ĐÂU TRONG `/pos`.
   *
   * Đây là luật đợt đổi giao diện 21/09/2026 dựng ra, và là luật sẽ mục
   * trước nhất: trước đợt ấy `/pos` có 496 mã màu rải khắp mười chín
   * tệp, nên bộ token `--pos-*` gần như không điều khiển được gì — đổi
   * token mà màn hình không đổi. Một mã cứng lọt lại là bắt đầu đúng
   * con đường ấy.
   */
  /**
   * ⚠ `/pos` DÙNG CHUNG BỘ MÀU VỚI APP, KHÔNG PHẢI BỘ THỨ HAI.
   *
   * Đây là lý do tồn tại của đợt đổi giao diện 21/09/2026. Bản đầu của
   * `/pos` lấy một dải slate riêng (`#0f172a`, `#64748b`, `#e2e8f0`) —
   * mở `/pos` cạnh một tab `/orders` là thấy hai sản phẩm khác nhau.
   * Bản thiết kế chủ nhà đưa dùng ĐÚNG các giá trị `:root`.
   *
   * ⚠ CHỐT TỰ ĐỔI HSL SANG RGB RỒI SO, không so chuỗi. `:root` khai
   * HSL, `.pos-scope` khai hex — so chuỗi thì không bao giờ khớp, mà
   * đọc mã hex trong CHÚ THÍCH của `:root` thì chỉ là so hai câu chữ
   * với nhau: sửa biến mà quên sửa chú thích là chốt vẫn xanh.
   *
   * ⚠ CÓ SAI SỐ, VÌ HSL LÀM TRÒN. `222 83% 53%` quay về RGB ra `#245feb`
   * chứ không đúng `#2563eb` — lệch 4 ở một kênh. Ngưỡng 8 vẫn bắt được
   * mọi lần đổi màu thật (khác họ màu là lệch hàng chục).
   */
  it("bộ màu /pos trùng bộ màu app, không phải hệ thứ hai", () => {
    const css = read("src/app/globals.css")
    const hslToRgb = (h: number, s: number, l: number) => {
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m = l - c / 2
      const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
      return [r, g, b].map((v) => Math.round((v + m) * 255))
    }
    const docRoot = (ten: string) => {
      const m = css.match(new RegExp(`\\n\\s*${ten}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`))
      expect(m, `không đọc được ${ten} ở :root`).toBeTruthy()
      return hslToRgb(Number(m![1]), Number(m![2]) / 100, Number(m![3]) / 100)
    }
    const i = css.indexOf(".pos-scope {")
    const khoiPos = css.slice(i, css.indexOf("\n}", i))
    const docPos = (ten: string) => {
      const m = khoiPos.match(new RegExp(`${ten}:\\s*#([0-9a-fA-F]{6})`))
      expect(m, `không đọc được ${ten} ở .pos-scope`).toBeTruthy()
      const h = m![1]
      return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16))
    }

    /* Bốn vai chịu lực: chữ · màu chính · chữ phụ · màu báo lỗi. */
    for (const [posVar, rootVar] of [
      ["--pos-ink", "--foreground"],
      ["--pos-primary", "--primary"],
      ["--pos-muted", "--muted-foreground"],
      ["--pos-danger", "--destructive"],
    ]) {
      const a = docPos(posVar)
      const b = docRoot(rootVar)
      const lech = Math.max(...a.map((v, k) => Math.abs(v - b[k])))
      expect(
        lech,
        `${posVar} đã tách khỏi ${rootVar} — /pos quay lại thành một hệ màu riêng`
      ).toBeLessThanOrEqual(8)
    }
  })

  it("không tệp nào trong /pos ghim mã màu", () => {
    const pham: string[] = []
    for (const f of FILES) {
      const hit = code(readFileSync(f, "utf-8")).match(/#[0-9a-fA-F]{6}/g)
      if (hit) pham.push(`${f.slice(ROOT.length + 1)} (${hit.slice(0, 3).join(", ")})`)
    }
    expect(pham, "mã màu cứng quay lại /pos — bộ token thành mã chết").toEqual([])
  })
})
