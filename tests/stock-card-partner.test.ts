import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * THẺ KHO PHẢI TRẢ LỜI "LÔ NÀY Ở ĐÂU RA, ĐI ĐÂU VỀ".
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Phần tra soát […] Thêm cột VD xuất cho
 * Khách hàng nào. Nhập của NCC nào".
 *
 * ⚠ MỘT CỘT CHO CẢ HAI CHIỀU. Hai cột riêng thì mỗi dòng bỏ trống đúng
 * một cột và bảng rộng thêm vô ích — một dòng nhập không bao giờ có
 * khách, một dòng xuất không bao giờ có NCC.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const CARD = strip(read("src/app/(dashboard)/inventory/stock-card/[productId]/page.tsx"))
const HUB = strip(read("src/app/(dashboard)/inventory/page.tsx"))
const AUDIT = strip(read("src/app/(dashboard)/inventory/audit/page.tsx"))

describe("thẻ kho hiện đối tác của từng lần nhập / xuất", () => {
  /**
   * ⚠ PHẢI KÉO CỘT VỀ THÌ MỚI HIỆN ĐƯỢC. Thiếu `supplier:suppliers(name)`
   * trong câu đọc là mọi dòng nhập đọc ra `undefined` → cột hiện dấu
   * gạch ở KHẮP NƠI, và màn hình trông y hệt như lúc chạy đúng với một
   * kho chưa từng nhập của NCC nào. Đây đúng loại hỏng im lặng.
   */
  it("câu đọc kéo cả NCC của phiếu về", () => {
    expect(CARD, "câu đọc thiếu NCC — cột sẽ trống trong im lặng")
      .toContain("supplier:suppliers(name)")
    expect(CARD).toContain("supplier_name: l.entry!.supplier?.name ?? null")
  })

  it("có cột đối tác, và nó nói cả hai chiều", () => {
    expect(CARD).toContain("<TableHead>Đối tác / Hóa đơn</TableHead>")
    expect(CARD).toContain("m.customer_name")
    expect(CARD).toContain("m.supplier_name")
  })

  /**
   * ⚠ KHÔNG CÓ ĐỐI TÁC THÌ ĐỂ GẠCH, ĐỪNG BỊA. Nhập kho thường, chuyển
   * kho và kiểm kê đều không gắn đối tác nào. Điền bừa một cái tên vào
   * đó là biến thẻ kho — thứ người ta mở ra để ĐỐI CHIẾU — thành nguồn
   * của một con số sai.
   */
  it("phiếu không gắn đối tác thì để gạch", () => {
    const flat = CARD.replace(/\s+/g, " ")
    expect(flat).toMatch(/m\.supplier_name \? \([\s\S]{0,400}?\) : \([\s\S]{0,200}?—/)
  })

  /** ⚠ Bản điện thoại cũng phải có, nếu không nửa số người dùng không thấy. */
  it("bản điện thoại cũng hiện đối tác", () => {
    const n = (CARD.match(/m\.supplier_name/g) ?? []).length
    expect(n, `mới ${n} chỗ — thiếu bản bảng hoặc bản thẻ điện thoại`).toBeGreaterThanOrEqual(3)
  })
})

describe("xem nhanh giao dịch mã hàng từ danh sách tồn kho", () => {
  /**
   * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "xem nhanh giao dịch mã hàng từ danh
   * sách tồn kho". Trước đây muốn biết mã đang đứng trước mặt nhập của
   * ai, xuất cho ai thì phải đi vòng qua màn Tra soát rồi gõ tìm lại
   * đúng mã ấy.
   */
  it("mỗi dòng tồn kho có đường sang thẻ kho của mã đó", () => {
    expect(HUB).toContain("/inventory/stock-card/${b.product.id}")
  })

  /** Màn Tra soát vẫn là cửa vào bằng ô tìm — hai đường, cùng một đích. */
  it("màn tra soát vẫn dẫn sang thẻ kho", () => {
    expect(AUDIT).toContain("/inventory/stock-card/${p.id}")
  })
})
