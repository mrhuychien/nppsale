import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { isValidElement, type ReactNode } from "react"
import { InvoiceMoneySummary } from "../src/components/orders/invoice-money-summary"

/**
 * KHỐI CỘNG TIỀN CỦA HÓA ĐƠN — MỘT KHỐI, HAI MÀN.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Xem nhanh bên ngoài cũng phải hiện chi
 * tiết thế này chứ" — ngăn xem nhanh chỉ có một dòng "Tổng tiền
 * 1.000.000đ", trong khi khối hàng trả ngay dưới nói −164.000đ và không
 * dòng nào trên màn nói số phải thu thật là 836.000đ.
 *
 * ⚠ CHỐT NÀY CHẠY THẬT KHỐI ẤY, không đọc chữ trong tệp. Ghim nguyên
 * văn `label="Còn phải thu"` là thứ vừa vỡ khi khối được tách ra dùng
 * chung: chốt đỏ vì mã DỜI CHỖ, chứ không vì luật nào sai. Ở đây gọi
 * thẳng hàm rồi soi cây phần tử trả về — dời đi đâu cũng vẫn đúng.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/** Gom mọi cặp nhãn/giá trị khối vẽ ra, bất kể lồng sâu bao nhiêu. */
function docDong(node: ReactNode): Array<{ label: string; value: string; strong: boolean }> {
  const out: Array<{ label: string; value: string; strong: boolean }> = []
  const di = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(di)
    if (!isValidElement(n)) return
    const p = n.props as { label?: unknown; value?: unknown; strong?: boolean; children?: ReactNode }
    if (typeof p.label === "string" && typeof p.value === "string") {
      out.push({ label: p.label, value: p.value, strong: p.strong === true })
    }
    di(p.children)
  }
  di(node)
  return out
}

/** Chữ thường của khối — để tìm lời nhắc "chưa trừ vào công nợ". */
function docChu(node: ReactNode): string {
  let s = ""
  const di = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(di)
    if (typeof n === "string" || typeof n === "number") { s += String(n); return }
    if (!isValidElement(n)) return
    di((n.props as { children?: ReactNode }).children)
  }
  di(node)
  return s
}

const ve = (
  invoice: { total: number; subtotal?: number | null; vat?: number | null },
  returns: Array<{ status: string; credit_note_amount?: number | null; credit_with_invoice?: boolean | null }>
) => InvoiceMoneySummary({ invoice, returns })

describe("khối Cộng tiền của hóa đơn", () => {
  /**
   * ⚠ ĐÚNG CON SỐ CHỦ NHÀ CHỤP MÀN HÌNH. Phiếu trả đi cùng hóa đơn
   * (mig 133) trừ NGAY từ lúc 'submitted' — hàng đã đổi tay lúc NVBH
   * giao. Nên 1.000.000 − 164.000 = 836.000, và đó là số người đi thu
   * tiền phải đọc.
   */
  it("có hàng trả thì hiện khoản trừ và số còn phải thu", () => {
    const rows = docDong(
      ve({ total: 1_000_000, subtotal: 1_000_000, vat: 0 }, [
        { status: "submitted", credit_note_amount: 164_000, credit_with_invoice: true },
      ])
    )
    const nhan = rows.map((r) => r.label)
    expect(nhan).toEqual(["Tiền hàng", "Thuế GTGT", "Tổng hóa đơn", "Trừ hàng trả", "Còn phải thu"])
    expect(rows.find((r) => r.label === "Trừ hàng trả")?.value).toContain("164.000")
    expect(rows.find((r) => r.label === "Còn phải thu")?.value).toContain("836.000")
    // ⚠ Tổng hóa đơn KHÔNG bị trừ — nó là giá trị lô hàng đã giao.
    expect(rows.find((r) => r.label === "Tổng hóa đơn")?.value).toContain("1.000.000")
  })

  /** ⚠ Số phải thu mới là dòng đậm — người thu tiền đọc đúng dòng đó. */
  it("dòng đậm là số còn phải thu, không phải tổng hóa đơn", () => {
    const rows = docDong(
      ve({ total: 1_000_000 }, [
        { status: "submitted", credit_note_amount: 164_000, credit_with_invoice: true },
      ])
    )
    expect(rows.filter((r) => r.strong).map((r) => r.label)).toEqual(["Còn phải thu"])
  })

  /**
   * ⚠ KHÔNG CÓ HÀNG TRẢ THÌ ĐỪNG THÊM DÒNG. "Trừ hàng trả: 0" là một
   * dòng không nói gì, và nó làm người đọc đi tìm một phiếu trả không
   * tồn tại.
   */
  it("không có hàng trả thì chỉ một dòng tổng", () => {
    const rows = docDong(ve({ total: 1_000_000, subtotal: 1_000_000, vat: 0 }, []))
    expect(rows.map((r) => r.label)).toEqual(["Tiền hàng", "Thuế GTGT", "Tổng cộng"])
    expect(rows.filter((r) => r.strong).map((r) => r.label)).toEqual(["Tổng cộng"])
  })

  /**
   * ⚠ PHIẾU ĐỘC LẬP CHƯA HOÀN THÀNH THÌ CHƯA TRỪ — và phải NÓI RA, nếu
   * không người đi đòi tiền đòi nhầm một số sắp thay đổi.
   */
  it("phiếu chưa trừ thì chưa giảm số phải thu, nhưng có nhắc", () => {
    const node = ve({ total: 1_000_000 }, [
      { status: "submitted", credit_note_amount: 164_000, credit_with_invoice: false },
    ])
    const rows = docDong(node)
    expect(rows.map((r) => r.label)).toEqual(["Tổng cộng"])
    expect(docChu(node)).toContain("chưa trừ vào công nợ")
  })

  /**
   * ⚠ NGƯỢC LẠI: PHIẾU ĐÃ TRỪ THÌ ĐỪNG NHẮC. Nhắc là người đọc tưởng
   * còn giảm nữa và đòi THIẾU đúng bằng khoản ấy.
   */
  it("phiếu đã trừ rồi thì không nhắc giảm tiếp", () => {
    const node = ve({ total: 1_000_000 }, [
      { status: "submitted", credit_note_amount: 164_000, credit_with_invoice: true },
    ])
    expect(docChu(node)).not.toContain("chưa trừ vào công nợ")
  })

  /**
   * ⚠ KHÁCH TRẢ NHIỀU HƠN GIÁ TRỊ HÓA ĐƠN THÌ KẸP VỀ 0, giống hệt
   * `GREATEST(0, …)` của `_wf2b_recompute_receivable`. Hiện số âm là nói
   * khác sổ, và người đọc tưởng nhà phân phối đang nợ ngược khách.
   */
  /** ⚠ CHỦ NHÀ 25/09/2026: "phải in cả số âm" — khớp công nợ âm của sổ (mig 186). */
  it("trả quá tổng hóa đơn thì còn phải thu ÂM, không kẹp 0", () => {
    const rows = docDong(
      ve({ total: 100_000 }, [
        { status: "completed", credit_note_amount: 500_000, credit_with_invoice: false },
      ])
    )
    const conPhaiThu = rows.find((r) => r.label === "Còn phải thu")?.value ?? ""
    expect(conPhaiThu).toMatch(/[-−]400\.000/)
  })

  /**
   * ⚠ CHƯA ĐỌC ĐƯỢC TIỀN HÀNG / THUẾ THÌ ĐỂ TRỐNG, ĐỪNG ĐIỀN 0. Ngăn
   * xem nhanh lấy hai số ấy bằng một lượt đọc phụ; "Thuế GTGT 0" cho
   * một lỗi mạng đọc như một hóa đơn không thuế. Phần còn lại vẫn đúng
   * vì nó chỉ cần `total`.
   */
  it("chưa đọc được tiền hàng thì không vẽ dòng đó, không điền 0", () => {
    const rows = docDong(ve({ total: 1_000_000, subtotal: null, vat: null }, []))
    expect(rows.map((r) => r.label)).toEqual(["Tổng cộng"])
  })

  /** ⚠ Thuế thật sự bằng 0 thì VẪN vẽ — khác hẳn "chưa đọc được". */
  it("thuế bằng 0 thật thì vẫn vẽ", () => {
    const rows = docDong(ve({ total: 1_000_000, subtotal: 1_000_000, vat: 0 }, []))
    expect(rows.map((r) => r.label)).toContain("Thuế GTGT")
  })
})

describe("hai màn dùng CHUNG khối ấy, không tự cộng", () => {
  const DETAIL = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")
  const DRAWER = read("src/components/sales-invoices/invoice-drawer.tsx")

  /**
   * ⚠ ĐÚNG LÝ DO CỦA `ReturnSummary`. Cùng một tờ hóa đơn hiện ở hai
   * chỗ; dựng riêng mỗi bên là ít lâu sau một bên nói "còn phải thu
   * 836.000" còn bên kia nói "1.000.000", và người đi đòi tiền tin bên
   * nào cũng có thể sai.
   */
  it.each([
    ["màn chi tiết", () => DETAIL],
    ["ngăn xem nhanh", () => DRAWER],
  ])("%s vẽ bằng khối dùng chung", (_ten, lay) => {
    expect(lay()).toContain("<InvoiceMoneySummary")
  })

  /**
   * ⚠ VÀ KHÔNG ĐƯỢC TỰ CỘNG THÊM MỘT LẦN NỮA. Một phép trừ thứ hai
   * cạnh phép trừ của khối chung là hai con số cho cùng một tờ hóa đơn
   * — và chúng sẽ lệch nhau đúng vào hôm có người sửa một bên.
   */
  it.each([
    ["màn chi tiết", () => DETAIL],
    ["ngăn xem nhanh", () => DRAWER],
  ])("%s không tự tính khoản trừ", (_ten, lay) => {
    const s = lay()
    expect(/creditOnInvoice\s*\(/.test(s), "tự cộng khoản trừ lần thứ hai").toBe(false)
    expect(/netDueOnInvoice\s*\(/.test(s), "tự tính số còn phải thu lần thứ hai").toBe(false)
  })

  /**
   * ⚠ NGĂN XEM NHANH PHẢI ĐỌC ĐƯỢC TIỀN HÀNG VÀ THUẾ. Không đọc thì
   * khối chung để trống hai dòng ấy — đúng luật, nhưng vẫn không phải
   * cái chủ nhà yêu cầu.
   */
  it("ngăn xem nhanh có đọc tiền hàng và thuế", () => {
    expect(
      /\.select\("[^"]*\bsubtotal\b[^"]*\bvat\b[^"]*"\)/.test(DRAWER),
      "ngăn xem nhanh không đọc subtotal/vat — hai dòng đầu sẽ trống"
    ).toBe(true)
  })
})
