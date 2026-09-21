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
    const i = S.indexOf("Đơn vị tính dòng")
    expect(i, "không thấy ô chọn đơn vị").toBeGreaterThan(-1)
    const o = S.slice(i, i + 900)
    expect(o).toMatch(/unitPriceFor\(p, u, groupId\)/)
    expect(
      /price: Math\.round\(\(l\.price \/ cu\) \* moi\)/.test(S),
      "đổi đơn vị lại nhân chia hệ số thay vì tra bảng giá"
    ).toBe(false)
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

  /** ⚠ Và khung vẽ đúng MỘT ô, không vẽ hai. */
  it("header vẽ đúng một ô tìm hàng", () => {
    expect(BAR.split("<ProductPicker").length - 1, "header vẽ nhiều hơn một ô tìm").toBe(1)
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
  it("ô trên header đóng danh sách sau khi thêm", () => {
    expect(BAR).toMatch(/closeOnPick/)
    const picker = code(read("src/components/ui/product-picker.tsx"))
    expect(picker).toMatch(/closeOnPick = false/)
    expect(picker).toMatch(/if \(closeOnPick\) setOpen\(false\)/)
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
   * ⚠ HEADER XANH LAM, KHÔNG CÒN ĐEN. `#0f172a` là màu của bản xem
   * thiết kế; cả app dùng `--primary: #2563eb`.
   */
  it("header dùng token xanh, không còn nền đen", () => {
    expect(BAR).toMatch(/bg-\[var\(--pos-bar\)\]/)
    expect(/#0f172a/.test(BAR), "nền đen của bản thiết kế đã quay lại header").toBe(false)
    expect(/#1e293b|#334155|#475569/.test(BAR), "còn sắc xám của thanh nền đen").toBe(false)
  })

  /** ⚠ Token thanh header khai trong `.pos-scope`, không rò ra `:root`. */
  it("token thanh header nằm trong .pos-scope", () => {
    const css = read("src/app/globals.css")
    const i = css.indexOf(".pos-scope {")
    const khoi = css.slice(i, css.indexOf("\n}", i))
    for (const t of ["--pos-bar", "--pos-bar-deep", "--pos-bar-line", "--pos-bar-dim"]) {
      expect(khoi, `thiếu token ${t}`).toContain(`${t}:`)
    }
    expect(/--pos-bar[a-z-]*\s*:/.test(css.slice(0, i)), "token thanh khai ngoài .pos-scope").toBe(false)
  })

  /** ⚠ Dãy tab nằm TRÊN nền xanh — không được giữ màu chữ của nền đen. */
  it("dãy tab đổi màu theo nền xanh", () => {
    const tabs = code(read("src/components/pos/doc-tabs.tsx"))
    expect(tabs).toMatch(/var\(--pos-bar-dim\)/)
    expect(/#cbd5e1|#475569|#94a3b8/.test(tabs.replace(/text-\[#94a3b8\][^"]*hover:bg-\[#e2e8f0\]/, "")),
      "tab còn màu chữ của thanh nền đen").toBe(false)
  })
})
