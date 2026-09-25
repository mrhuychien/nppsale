import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { grossUpLines, type SalesInvoiceLine } from "../src/components/printing/sales-invoice"

/**
 * MẪU IN ĐƠN ĐẶT HÀNG — chủ nhà chốt: "giống Hoá đơn bán".
 *
 * ⚠ GIỐNG NGHĨA LÀ DÙNG CHUNG KHUÔN, KHÔNG PHẢI CHÉP RA HAI BẢN. Chép
 * là ít lâu sau sửa địa chỉ NPP ở một bên rồi hai tờ giấy của cùng một
 * nhà phân phối không còn giống nhau.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = read("src/app/(dashboard)/orders/[id]/print/page.tsx")
const DETAIL = read("src/app/(dashboard)/orders/[id]/page.tsx")
const TPL = read("src/components/printing/sales-invoice.tsx")

describe("màn in đơn đặt hàng", () => {
  it("dùng chung khuôn SalesInvoice, chỉ đổi tiêu đề và nhãn số", () => {
    expect(PAGE).toContain('from "@/components/printing/sales-invoice"')
    expect(PAGE).toContain('title="ĐƠN ĐẶT HÀNG"')
    expect(PAGE).toContain('numberLabel="Số ĐH"')
    expect(PAGE).toContain("invoiceNumber={order.order_code}")
  })

  /**
   * ⚠ PHẦN ĐẦU NPP QUA `loadOrgHeader`. Địa chỉ và điện thoại nằm trong
   * `organizations.settings` jsonb — hỏi thẳng `address`/`phone` là câu
   * truy vấn lỗi và tờ giấy in ra không có phần đầu, không báo gì.
   */
  it("đọc phần đầu NPP đúng chỗ", () => {
    expect(PAGE).toContain("loadOrgHeader(supabase, row.org_id)")
    expect(code(PAGE)).not.toContain('select("name, address, phone")')
    expect(PAGE).toContain("org={{ name: org.name, address: org.address, phone: org.phone }}")
  })

  /** ⚠ Giờ thật nằm ở `created_at`; `order_date` là cột kiểu `date`. */
  it("mốc in lấy giờ từ created_at", () => {
    expect(PAGE).toContain("docStampAt(order.created_at, order.order_date).at")
  })

  /**
   * ⚠ TỜ NÀY TRÔNG Y HỆT HÓA ĐƠN BÁN. Thiếu câu nói rõ nó là lời đặt thì
   * ai cầm nó cũng có thể đi thu tiền theo một con số hàng chưa chắc đã
   * giao đủ.
   */
  it("nói rõ chưa phải chứng từ thanh toán, và đơn huỷ thì nói là huỷ", () => {
    expect(PAGE).toContain("chưa phải chứng từ thanh toán")
    expect(PAGE).toContain('order.status === "cancelled"')
    expect(PAGE).toContain("ĐƠN ĐÃ HUỶ")
  })

  /**
   * ⚠ ĐƠN ĐẶT HÀNG KHÔNG CÓ "CÒN PHẢI THU". Khoản trừ hàng trả chỉ vào
   * sổ lúc xuất hóa đơn; ghi con số đó ở đây là hứa trước khi nó tồn
   * tại. Dòng đổi/trả chỉ đứng liệt kê.
   */
  /**
   * ⚠ CHỦ NHÀ 25/09/2026: "Mẫu in đơn đặt hàng in ra sai bét" — `total` đã trừ
   *   hàng trả và kẹp 0, khuôn giãn dòng bán về 0đ. Nay: tiền hàng từ
   *   subtotal + vat, rồi Trừ hàng trả → Còn phải thu (có thể âm).
   */
  it("tiền hàng từ subtotal + vat; trừ hàng trả ra Còn phải thu", () => {
    expect(PAGE).toContain("returnLines={printReturnLines}")
    expect(PAGE).toContain("total={tienHang}")
    expect(PAGE).toContain("returnCredit={traHang}")
    expect(PAGE).toMatch(/order\.subtotal != null \? \(Number\(order\.subtotal\) \|\| 0\) \+ \(Number\(order\.vat\) \|\| 0\)/)
    expect(code(PAGE)).not.toContain("total={Number(order.total) || 0}")
    // Phiếu đã huỷ không được in kèm.
    expect(PAGE).toContain('.neq("status", "cancelled")')
  })

  /** Nút "In đơn" phải mở màn in, không in nguyên trang chi tiết. */
  it("nút In đơn trỏ vào màn in", () => {
    expect(DETAIL).toContain("href={`/orders/${order.id}/print`}")
    const at = DETAIL.indexOf("In đơn")
    const around = DETAIL.slice(Math.max(0, at - 400), at)
    expect(around, "vẫn gọi window.print() trên trang chi tiết").not.toContain("window.print()")
  })
})

describe("cột CK phải cộng ra đúng", () => {
  const line = (id: string, qty: number, lineTotal: number, discount = 0): SalesInvoiceLine => ({
    id,
    name: id,
    unitName: "thùng",
    quantity: qty,
    unitPrice: lineTotal / qty,
    discount,
    lineTotal,
  })

  /**
   * ⚠ ĐẲNG THỨC PHẢI ĐÚNG THEO DỰNG, KHÔNG THEO MAY MẮN:
   *   Đ.giá × SL − CK = Thành tiền
   * Khách cộng tay đúng theo ba con số in trên giấy.
   */
  it("Đ.giá × SL − CK = Thành tiền, kể cả khi có thuế", () => {
    const rows = grossUpLines(
      [line("a", 10, 450_000, 50_000), line("b", 3, 90_000, 0)],
      594_000 // đã gồm VAT 10%
    ).rows
    for (const r of rows) {
      expect(Math.round(r.price * r.quantity - r.ck), `dòng ${r.id}`).toBe(r.amount)
    }
  })

  it("dòng không chiết khấu thì CK = 0 và đơn giá y như bản trước", () => {
    const rows = grossUpLines([line("a", 4, 400_000)], 400_000).rows
    expect(rows[0].ck).toBe(0)
    expect(rows[0].price).toBe(100_000)
  })

  /** ⚠ Chiết khấu phải quy CÙNG THANG với thành tiền, không in số thô. */
  it("chiết khấu được quy đổi theo cùng tỉ lệ với thành tiền", () => {
    const rows = grossUpLines([line("a", 10, 500_000, 100_000)], 550_000).rows
    // Tỉ lệ 550/500 = 1,1 → chiết khấu 100.000 in ra 110.000.
    expect(rows[0].ck).toBe(110_000)
  })

  it("cột tiền vẫn cộng khớp tuyệt đối với tổng", () => {
    const rows = grossUpLines(
      [line("x", 3, 100_000, 7_777), line("y", 7, 33_333), line("z", 1, 1)],
      146_668
    ).rows
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(146_668)
  })
})

describe("bằng chữ số âm", () => {
  it("đọc 'Âm …' cho dư có của khách", async () => {
    const { bangChu } = await import("../src/components/printing/sales-invoice")
    expect(bangChu(-250_000)).toMatch(/^Âm hai trăm năm mươi nghìn/)
    expect(bangChu(250_000)).toMatch(/^Hai trăm năm mươi nghìn/)
    expect(bangChu(0)).toBe("Không đồng")
  })
})
