import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vatKeTiep, vatChungCuaDong, vatChungKeTiep } from "../src/lib/pos/vat"
import { posTotals } from "../src/lib/pos/totals"
import { cartTotals } from "../src/lib/sell/cart"
import { posLinesToCart } from "../src/lib/pos/save"
import { posNewOrderHref, posEditOrderHref } from "../src/lib/nav/pos-preview"
import type { PosLine } from "../src/lib/pos/types"

/**
 * BẬC THUẾ BẤM VÒNG, VÀ LỐI VÀO MÀN `/pos` TRÊN MÁY TÍNH.
 *
 * Chủ nhà chốt 22/09/2026:
 *   · "Các dòng mã hàng thiếu chọn VAT (tạo 1 nút bấm như nút giảm giá,
 *     mặc định là 0 bấm vào -> 5 -> 8 -> 10 -> 0)"
 *   · "Đơn tổng cũng thiếu VAT (làm tương tự)"
 *   · "trên desktop ấn tạo đơn -> dùng tạo đơn pos, sửa -> dùng sửa
 *     pos, main vẫn chạy production bình thường"
 *
 * ⚠ VÀ VIỆC NÀY ĐÓNG MỘT LỖ TÔI ĐÃ BÁO Ở ĐỢT TRƯỚC: panel `/pos` tính
 *   "Khách cần trả" mà KHÔNG cộng thuế, trong khi `sales_orders.total`
 *   thì có. Chưa lộ vì cột VAT đang tắt và mọi dòng là 0%; bật lên là
 *   hai con số lệch nhau âm thầm. Nay `posTotals` cộng thuế, và bộ chốt
 *   dưới đây bắt hai phép cộng phải ra CÙNG một số.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const DON = code(read("src/components/pos/order-screen.tsx"))
const BANG = code(read("src/components/pos/line-table.tsx"))
const SELL = code(read("src/app/(dashboard)/sell/page.tsx"))
const SUA = code(read("src/app/(dashboard)/sell/edit/[id]/page.tsx"))

describe("bậc thuế bấm vòng 0 → 5 → 8 → 10 → 0", () => {
  it("đi đúng vòng chủ nhà chốt", () => {
    expect([0, 0.05, 0.08, 0.1].map(vatKeTiep)).toEqual([0.05, 0.08, 0.1, 0])
  })

  /**
   * ⚠ THUẾ SUẤT NGOÀI BẬC VỀ 0, KHÔNG ÉP VỀ BẬC GẦN NHẤT. Một mặt hàng
   *   lỡ có 7% (nhập từ sổ cũ) mà bấm một cái thành 8% là ĐỔI TIỀN THUẾ
   *   của người ta bằng một phép đoán.
   */
  it("thuế suất lạ về 0 chứ không bị ép về bậc gần nhất", () => {
    expect(vatKeTiep(0.07)).toBe(0)
    expect(vatKeTiep(0.02)).toBe(0)
  })

  /** ⚠ `null` là "mỗi dòng một kiểu", KHÁC HẲN 0. */
  it("đọc ra bậc chung, và nói được khi các dòng lệch nhau", () => {
    expect(vatChungCuaDong([]), "chứng từ rỗng thì không có gì để lệch").toBe(0)
    expect(vatChungCuaDong([{ vatRate: 0.08 }, { vatRate: 0.08 }])).toBe(0.08)
    expect(vatChungCuaDong([{ vatRate: 0.08 }, { vatRate: 0 }])).toBeNull()
    expect(vatChungCuaDong([{ vatRate: null }, { vatRate: 0 }]), "rỗng và 0 là một").toBe(0)
  })

  /**
   * ⚠ ĐANG LỆCH NHAU THÌ BẤM MỘT CÁI VỀ 0, không nhảy sang 5%. Người
   *   bấm lúc ấy muốn "dẹp hết cho đồng nhất"; đưa thẳng sang 5% là ép
   *   một thuế suất lên những dòng họ chưa kịp nhìn.
   */
  it("các dòng lệch nhau thì nút cả đơn đưa về 0 trước", () => {
    expect(vatChungKeTiep(null)).toBe(0)
    expect(vatChungKeTiep(0)).toBe(0.05)
  })

  it("nút dòng và nút cả đơn dùng CHUNG một component", () => {
    /* Hai nút trông khác nhau cho cùng một việc là học hai lần. */
    expect(BANG, "không còn component nút thuế dùng chung")
      .toContain("export function VatChip")
    const soLan = (DON.match(/<VatChip/g) || []).length
    expect(soLan, "màn đơn phải vẽ nút thuế ở CẢ dòng lẫn cả đơn").toBeGreaterThanOrEqual(2)
    /* Và không còn ô <select> thuế nào sót lại. */
    expect(DON, "ô thuế cũ dạng select vẫn còn").not.toMatch(/aria-label=\{`Thuế GTGT dòng[\s\S]{0,80}<select/)
  })

  /**
   * ⚠ NÚT CẢ ĐƠN ĐẶT HÀNG LOẠT, KHÔNG PHẢI MỘT Ô THUẾ THỨ HAI. Thuế
   *   suất chỉ có MỘT nguồn: từng dòng. Dựng thêm một ô thuế cấp chứng
   *   từ độc lập là ngày nào đó cộng cả hai vào một tờ.
   */
  it("nút cả đơn đặt lại thuế suất của MỌI dòng", () => {
    const i = DON.indexOf("Thuế GTGT cả đơn")
    expect(i, "panel không có nút thuế cả đơn").toBeGreaterThan(-1)
    const khoi = DON.slice(i, i + 400)
    expect(khoi, "nút cả đơn không đặt lại các dòng").toMatch(
      /setLines\(\(c\) => c\.map\(\(l\) => \(\{ \.\.\.l, vatRate: \w+ \}\)\)\)/
    )
    expect(khoi, "nút cả đơn không đi qua phép nhảy bậc").toContain("vatChungKeTiep")
  })
})

describe("thuế nằm trong số khách cần trả, và khớp với số ghi xuống sổ", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT CHẠY THẬT, và nó canh đúng cái lỗ tôi đã báo: panel
   *   và tải trọng là hai phép cộng khác nhau. Chúng phải ra cùng số.
   */
  it("đơn 1.000.000 thuế 8%: panel và sổ ra cùng một số", () => {
    const lines = [dong("p1", 2, 500_000, 0.08)]
    const panel = posTotals({ lines, docDiscount: { value: 0, unit: "vnd" }, other: 0, returnCredit: 0 })
    expect(panel.vat, "panel tính sai tiền thuế").toBe(80_000)
    expect(panel.due, "panel không cộng thuế vào số khách cần trả").toBe(1_080_000)

    const cart = posLinesToCart(lines)
    const so = cartTotals(cart, 0)
    expect(so.vat, "sổ tính thuế trên một nền khác panel").toBe(panel.vat)
    expect(so.grandTotal, "sổ và panel lệch nhau").toBe(panel.due)
  })

  /**
   * ⚠ NỀN THUẾ LÀ TIỀN DÒNG SAU GIẢM GIÁ DÒNG. Tính trên giá gốc là
   *   bắt khách trả thuế cho phần đã được giảm.
   */
  it("giảm giá dòng hạ luôn nền thuế", () => {
    const lines = [dong("p1", 1, 100_000, 0.1, { value: 20_000, unit: "vnd" })]
    const panel = posTotals({ lines })
    expect(panel.vat, "thuế vẫn tính trên giá gốc").toBe(8_000)
    expect(cartTotals(posLinesToCart(lines), 0).vat, "sổ lệch nền với panel").toBe(8_000)
  })

  /** ⚠ Thuế cộng THEO DÒNG, nên các dòng lệch bậc vẫn cộng đúng. */
  it("mỗi dòng một bậc thuế thì cộng đủ cả hai", () => {
    const lines = [dong("a", 1, 100_000, 0.1), dong("b", 1, 100_000, 0.05)]
    expect(posTotals({ lines }).vat).toBe(15_000)
  })

  /**
   * ⚠ HÀNG TRẢ TRỪ SAU THUẾ, và panel với sổ phải cùng thứ tự. Đây
   *   chính là chỗ đợt trước lệch nhau.
   */
  it("có thuế lẫn hàng trả thì hai bên vẫn khớp", () => {
    const lines = [dong("p1", 1, 500_000, 0.1)]
    const panel = posTotals({ lines, returnCredit: 200_000 })
    const so = cartTotals(posLinesToCart(lines), 200_000)
    expect(panel.due).toBe(350_000)
    expect(so.grandTotal, "sổ và panel lệch khi có cả thuế lẫn hàng trả").toBe(panel.due)
  })
})

describe("lối vào màn /pos trên máy tính", () => {
  it("đường dẫn mang theo khách, và mã khách được mã hoá", () => {
    /* ⚠ Đường tắt "tạo đơn cho khách này" mà mất khách là bắt nhân
       viên đứng trước cửa hàng đi tìm lại tên trong vài nghìn dòng. */
    expect(posNewOrderHref()).toBe("/pos/don-hang/moi")
    expect(posNewOrderHref("kh-1")).toBe("/pos/don-hang/moi?customerId=kh-1")
    expect(posNewOrderHref("a&b"), "mã khách không được mã hoá").toContain("a%26b")
    expect(posEditOrderHref("dh-1")).toBe("/pos/don-hang/dh-1/sua")
  })

  /**
   * ⚠ CHẶN Ở CỬA, KHÔNG SỬA SÁU CÁI NÚT. Nút "Tạo đơn" nằm ở sáu chỗ;
   *   sót một cái là người test rơi về màn cũ rồi kết luận POS không
   *   chạy.
   */
  it("hai màn cũ đều có cú chuyển hướng sang POS", () => {
    expect(SELL, "màn /sell không đưa máy tính sang POS").toContain("<PosDesktopRedirect")
    expect(SELL).toContain("posNewOrderHref")
    expect(SUA, "màn sửa đơn không đưa máy tính sang POS").toContain("<PosDesktopRedirect")
    expect(SUA).toContain("posEditOrderHref")
  })

  /**
   * ⚠ `/sell?mode=return` LÀ BƯỚC CHỌN HÀNG TRẢ, không phải lập đơn.
   *   Đẩy nó sang màn lập đơn là cắt ngang một việc khác hẳn.
   */
  it("bước chọn hàng trả KHÔNG bị đẩy sang màn lập đơn", () => {
    const i = SELL.indexOf("<PosDesktopRedirect")
    const truoc = SELL.slice(Math.max(0, i - 200), i)
    expect(truoc, "chọn hàng trả cũng bị đẩy sang màn lập đơn").toContain("!returning")
  })

  /**
   * ⚠ ĐO BỀ NGANG SAU KHI DỰNG, VÀ CHỈ ĐO MỘT LẦN. Đoán trên máy chủ là
   *   đẩy cả người dùng điện thoại sang màn không dùng được; nghe
   *   `resize` là người đang gõ dở bị ném đi chỉ vì kéo hẹp cửa sổ.
   */
  it("chuyển hướng chỉ chạy trên máy tính, một lần, và không phá nút Quay lại", () => {
    const R = code(read("src/components/sell/pos-desktop-redirect.tsx"))
    expect(R, "không đo bề ngang màn hình").toContain("manDuRong()")
    expect(R, "dùng push — bấm Quay lại là kẹt trong vòng lặp").toContain("router.replace")
    expect(R, "không có chốt chạy một lần").toContain("daChay.current")
    expect(R, "nghe resize — người đang gõ dở bị ném đi").not.toContain("resize")

    const NAV = code(read("src/lib/nav/pos-preview.ts"))
    expect(NAV, "đoán 'đủ rộng' khi không có window").toMatch(
      /typeof window === "undefined"\) return false/
    )
    expect(NAV, "ngưỡng lệch với `lg:` của Tailwind").toContain("1024")
  })
})

/** Một dòng POS tối thiểu, đủ cho phép cộng tiền. */
function dong(
  productId: string,
  qty: number,
  price: number,
  vatRate = 0,
  discount: PosLine["discount"] = { value: 0, unit: "vnd" }
): PosLine {
  return {
    key: productId,
    productId,
    name: productId,
    sku: productId,
    unit: "cái",
    units: [{ unit_name: "cái", conversion: 1 }],
    qty,
    price,
    listPrice: price,
    discount,
    vatRate,
  } as PosLine
}
