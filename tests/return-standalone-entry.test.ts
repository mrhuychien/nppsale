import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * TẠO PHIẾU TRẢ ĐỘC LẬP — hai lối vào chủ nhà chốt.
 *
 * Phiếu trả độc lập là phiếu VỪA trừ công nợ VỪA nhập kho (khác phiếu
 * sinh ra từ đơn, vốn chỉ còn việc nhập kho — xem mig 133).
 *
 * ⚠ MÀN `/returns/new` ĐÃ DỰNG ĐỦ TỪ TRƯỚC nhưng KHÔNG CÓ ĐƯỜNG NÀO DẪN
 * TỚI: danh sách Trả hàng chỉ để tra cứu, và màn hóa đơn không có nút.
 * Một tính năng không có lối vào thì không tồn tại với người dùng.
 */
const LIST = readFileSync("src/app/(dashboard)/returns/page.tsx", "utf8")
const NEW = readFileSync("src/app/(dashboard)/returns/new/page.tsx", "utf8")
const INV = readFileSync("src/app/(dashboard)/sales-invoices/[id]/page.tsx", "utf8")

describe("lối vào 1 — từ danh sách Trả hàng", () => {
  it("có nút tạo phiếu trả", () => {
    expect(LIST).toContain('<Link href="/returns/new">')
    expect(LIST).toContain("Tạo phiếu trả")
  })
})

describe("lối vào 2 — từ hóa đơn bán", () => {
  it("nút Trả hàng mang theo hóa đơn và khách", () => {
    expect(INV).toContain("href={`/returns/new?invoiceId=${inv.id}$")
    expect(INV).toContain("&customerId=${inv.customer_id}")
  })

  /**
   * ⚠ CHỈ HÓA ĐƠN CÒN HIỆU LỰC. Hóa đơn đã huỷ đã hoàn hàng về kho;
   * `complete_return` từ chối bằng `INVOICE_NOT_POSTED`, nên hiện nút ở
   * đó là mời người dùng đi vào một màn sẽ bị chặn.
   */
  it("hóa đơn đã huỷ thì không hiện nút", () => {
    const i = INV.indexOf("TRẢ HÀNG CỦA CHÍNH HÓA ĐƠN NÀY")
    expect(i).toBeGreaterThan(-1)
    expect(INV.slice(i, i + 900)).toContain("{posted && (")
  })
})

describe("màn tạo phiếu trả nhận tham số", () => {
  it("mở sẵn theo khách và hóa đơn được chỉ định", () => {
    expect(NEW).toContain('useState(() => params.get("customerId") ?? "")')
    expect(NEW).toContain('useState(() => params.get("invoiceId") ?? "")')
  })

  /** ⚠ Đọc mỗi lần render rồi ghi đè là người dùng đổi khách bị kéo ngược lại. */
  it("chỉ đọc tham số một lần lúc dựng", () => {
    expect(NEW).not.toContain('setCustomerId(params.get("customerId")')
  })

  /**
   * ⚠ DANH SÁCH HÓA ĐƠN CẮT Ở 20 TỜ GẦN NHẤT. Tới đây từ một hóa đơn
   * tháng trước thì ô chọn trống trơn trong khi bên dưới đã nạp đúng dòng
   * hàng của nó — một màn tự mâu thuẫn.
   */
  it("hóa đơn được chỉ đích danh luôn có mặt trong ô chọn", () => {
    expect(NEW).toContain("if (invoiceId && !rows.some((r) => r.id === invoiceId)) {")
    expect(NEW).toContain("if (one) rows.unshift(one as InvoiceLite)")
  })

  /** ⚠ Hóa đơn đã huỷ không được gắn phiếu trả — nhập kho lần thứ hai. */
  it("chỉ liệt kê hóa đơn còn hiệu lực", () => {
    expect(NEW).toContain('.eq("status", "posted")')
  })
})
