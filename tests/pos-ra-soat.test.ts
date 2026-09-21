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

  /** ⚠ Ô tìm ở topbar phải dẫn tới dropdown thật, không phải một `<input>` chết. */
  it("ô tìm topbar kích F3 của màn đang mở, không phải input rời", () => {
    const t = code(read("src/components/pos/pos-top-bar.tsx"))
    expect(t).toMatch(/firePosKey\("F3"\)/)
    expect(/id="pos-tim-hang"/.test(t), "input tìm không nối vào đâu đã quay lại").toBe(false)
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
   * ⚠ DROPDOWN TÌM HÀNG NEO Ở ĐỈNH CỘT TRÁI. Neo ở đáy panel phải là
   * nó mở XUỐNG từ mép dưới màn hình và bị `overflow-hidden` cắt sạch —
   * bấm F3 chỉ thấy nền tối đi. Chốt: trong mỗi màn, `SearchDropdown`
   * tìm hàng (mở bằng `moTimHang`/`moTimTra`) phải xuất hiện TRƯỚC
   * `LineTableFrame` trong mã, tức nằm trên bảng.
   */
  it("dropdown tìm hàng nằm trước bảng hàng trong cột trái", () => {
    for (const f of MAN) {
      const s = code(read(f))
      const bang = s.indexOf("<LineTableFrame")
      if (bang < 0) continue
      const mo = s.search(/open=\{moTim(Hang|Tra)\}/)
      if (mo < 0) continue
      expect(mo, `${f}: dropdown tìm hàng neo sau bảng — sẽ mở rơi khỏi màn`).toBeLessThan(bang)
    }
  })

  /** ⚠ Chống mù: phải có ít nhất 4 màn thật sự có cả hai thứ. */
  it("phép quét dropdown nhìn thấy các màn", () => {
    let n = 0
    for (const f of MAN) {
      const s = code(read(f))
      if (s.indexOf("<LineTableFrame") >= 0 && s.search(/open=\{moTim(Hang|Tra)\}/) >= 0) n++
    }
    expect(n).toBeGreaterThanOrEqual(4)
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
  it("màn phiếu trả và bảng trả kèm đơn dùng RETURN_REASONS", () => {
    /* ⚠ Canh chỗ DÙNG, không canh dòng import — import còn mà bộ riêng
       quay lại thì `/RETURN_REASONS/` vẫn khớp. */
    const man = code(read("src/components/pos/return-screen.tsx"))
    expect(man).toMatch(/const LY_DO = RETURN_REASONS\b/)
    expect(man).toMatch(/LY_DO\.map\(/)
    const bang = code(read("src/components/pos/return-exchange-table.tsx"))
    expect(bang).toMatch(/RETURN_REASONS\.map\(/)
    for (const s of [man, bang]) {
      expect(/value="wrong"|id: "wrong"|value: "wrong"/.test(s), "vẫn có mã 'wrong'").toBe(false)
      expect(/<option value="damaged"/.test(s), "bộ lý do viết tay đã quay lại").toBe(false)
    }
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
