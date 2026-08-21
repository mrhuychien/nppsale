import { describe, it, expect, vi, afterEach } from "vitest"
import { invoiceToMisaPayload, vnInvoiceDate } from "@/lib/misa/mapper"
import type { MapperLine, MapperOptions } from "@/lib/misa/mapper"
import type { SellerInfo } from "@/lib/misa/types"

/**
 * Dựng dữ liệu gửi sang MISA để phát hành HOÁ ĐƠN THUẾ.
 *
 * Đây là chỗ sai đắt nhất trong toàn hệ thống: hoá đơn đã phát hành thì
 * KHÔNG sửa được, chỉ có thể huỷ và lập lại — mà mỗi lần như vậy là làm
 * việc với cơ quan thuế. Sai tiền, sai thuế suất, hay sai mã số thuế người
 * mua đều rơi vào nhóm đó.
 *
 * Test dưới đây ghim lại các công thức cộng tiền và các quy tắc dễ nhầm.
 */

const seller = {} as SellerInfo

const line = (over: Partial<MapperLine> = {}): MapperLine => ({
  product_name: "Sữa hộp 180ml",
  sku: "SUA-180",
  unit_name: "hộp",
  base_unit: "hộp",
  quantity: 10,
  unit_price: 10_000,
  vat_rate: 10,
  ...over,
})

const build = (over: Partial<MapperOptions> = {}) =>
  invoiceToMisaPayload({
    buyer: { name: "Tạp hoá A" },
    seller,
    lines: [line()],
    ...over,
  })[0]

afterEach(() => vi.useRealTimers())

describe("cộng tiền trên hoá đơn", () => {
  it("thành tiền = số lượng × đơn giá", () => {
    const h = build()
    expect(h.InvoiceDetails[0].AmountOC).toBe(100_000)
    expect(h.TotalSaleAmountOC).toBe(100_000)
  })

  it("thuế tính SAU khi trừ chiết khấu, không phải trước", () => {
    // (100.000 − 20.000) × 10% = 8.000. Tính trước chiết khấu ra 10.000 —
    // nộp thừa thuế và lệch với sổ sách.
    const h = build({ lines: [line({ line_discount: 20_000 })] })
    expect(h.InvoiceDetails[0].VATAmountOC).toBe(8_000)
    expect(h.TotalAmountWithoutVATOC).toBe(80_000)
    expect(h.TotalAmountOC).toBe(88_000)
  })

  it("tổng cuối = (thành tiền − chiết khấu) + thuế", () => {
    const h = build({
      lines: [line({ quantity: 3, unit_price: 33_333, line_discount: 1_000 })],
    })
    const d = h.InvoiceDetails[0]
    expect(h.TotalAmountOC).toBe(d.AmountOC - d.DiscountAmountOC + d.VATAmountOC)
  })

  it("cộng đúng khi có nhiều dòng", () => {
    const h = build({
      lines: [
        line({ quantity: 10, unit_price: 10_000 }),
        line({ quantity: 5, unit_price: 20_000, line_discount: 5_000 }),
      ],
    })
    expect(h.TotalSaleAmountOC).toBe(200_000)
    expect(h.TotalDiscountAmountOC).toBe(5_000)
    expect(h.TotalVATAmountOC).toBe(10_000 + 9_500)
  })

  it("mọi số tiền đều là số nguyên đồng — MISA không nhận số lẻ", () => {
    const h = build({ lines: [line({ quantity: 3, unit_price: 33_333, vat_rate: 8 })] })
    const d = h.InvoiceDetails[0]
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "number" && k.includes("Amount")) {
        expect(Number.isInteger(v), `${k} = ${v} không phải số nguyên`).toBe(true)
      }
    }
  })

  it("hoá đơn không có dòng nào thì mọi tổng bằng 0, không NaN", () => {
    const h = build({ lines: [] })
    expect(h.TotalSaleAmountOC).toBe(0)
    expect(h.TotalAmountOC).toBe(0)
    expect(Number.isNaN(h.TotalVATAmountOC)).toBe(false)
  })
})

describe("thuế suất", () => {
  it("một mức thuế: master lấy đúng mức đó, IsMoreVATRate = false", () => {
    const h = build({ lines: [line({ vat_rate: 8 }), line({ vat_rate: 8 })] })
    expect(h.IsMoreVATRate).toBe(false)
    expect(h.VATRate).toBe(8)
  })

  it("nhiều mức thuế: master phải để 0 và bật cờ IsMoreVATRate", () => {
    // Để nguyên một mức khi hoá đơn có nhiều mức là khai sai thuế.
    const h = build({ lines: [line({ vat_rate: 10 }), line({ vat_rate: 8 })] })
    expect(h.IsMoreVATRate).toBe(true)
    expect(h.VATRate).toBe(0)
  })

  it("thuế suất không khai thì mặc định 10%, không phải 0", () => {
    const h = build({ lines: [line({ vat_rate: null })] })
    expect(h.InvoiceDetails[0].VATRate).toBe(10)
  })

  it("thuế 0% được giữ nguyên là 0, không bị coi là 'chưa khai'", () => {
    const h = build({ lines: [line({ vat_rate: 0 })] })
    expect(h.InvoiceDetails[0].VATRate).toBe(0)
    expect(h.InvoiceDetails[0].VATAmountOC).toBe(0)
  })

  it("có dòng thuế 8% thì bật cờ giảm thuế theo Nghị quyết 43", () => {
    expect(build({ lines: [line({ vat_rate: 8 })] }).IsTaxReduction43).toBe(true)
    expect(build({ lines: [line({ vat_rate: 10 })] }).IsTaxReduction43).toBe(false)
  })
})

describe("chế độ xuất theo đơn vị cơ sở (box)", () => {
  const thung = () =>
    line({
      unit_name: "thùng",
      base_unit: "hộp",
      quantity: 2,
      unit_price: 120_000,
      conversion_factor: 12,
    })

  it("mặc định as_sold: giữ nguyên đơn vị bán", () => {
    const d = build({ lines: [thung()] }).InvoiceDetails[0]
    expect(d.UnitName).toBe("thùng")
    expect(d.Quantity).toBe(2)
    expect(d.UnitPrice).toBe(120_000)
  })

  it("box: quy về đơn vị cơ sở, nhân số lượng và chia đơn giá", () => {
    const d = build({ mode: "box", lines: [thung()] }).InvoiceDetails[0]
    expect(d.UnitName).toBe("hộp")
    expect(d.Quantity).toBe(24)
    expect(d.UnitPrice).toBe(10_000)
  })

  it("box KHÔNG được làm đổi tổng tiền", () => {
    // Đây là điểm cốt lõi: chỉ đổi cách trình bày, tuyệt đối không đổi số
    // tiền khách phải trả.
    const a = build({ lines: [thung()] })
    const b = build({ mode: "box", lines: [thung()] })
    expect(b.TotalAmountOC).toBe(a.TotalAmountOC)
    expect(b.TotalVATAmountOC).toBe(a.TotalVATAmountOC)
  })

  it("box với hệ số 1 thì không đổi gì", () => {
    const d = build({ mode: "box", lines: [line({ conversion_factor: 1 })] }).InvoiceDetails[0]
    expect(d.UnitName).toBe("hộp")
    expect(d.Quantity).toBe(10)
  })

  it("box mà thiếu đơn vị cơ sở thì giữ đơn vị bán, không để trống", () => {
    const d = build({
      mode: "box",
      lines: [line({ unit_name: "thùng", base_unit: null, conversion_factor: 12 })],
    }).InvoiceDetails[0]
    expect(d.UnitName).toBe("thùng")
  })

  it("hệ số 0 hoặc null được coi là 1, không chia cho 0", () => {
    for (const cf of [0, null, undefined]) {
      const d = build({ mode: "box", lines: [line({ conversion_factor: cf })] }).InvoiceDetails[0]
      expect(Number.isFinite(d.UnitPrice)).toBe(true)
      expect(d.Quantity).toBe(10)
    }
  })
})

describe("thông tin người mua", () => {
  it("mã số thuế, tên và địa chỉ được đưa lên hoá đơn", () => {
    const h = build({
      buyer: {
        name: "Công ty TNHH A",
        tax_code: "0123456789",
        address: "12 Lê Lợi",
        email: "ke-toan@a.vn",
      },
    })
    expect(h.AccountObjectTaxCode).toBe("0123456789")
    expect(h.AccountObjectName).toBe("Công ty TNHH A")
    expect(h.AccountObjectAddress).toBe("12 Lê Lợi")
    expect(h.ReceiverEmail).toBe("ke-toan@a.vn")
  })

  it("thiếu mã số thuế thì để chuỗi rỗng, KHÔNG để undefined", () => {
    // undefined sẽ bị bỏ khỏi JSON và MISA báo lỗi thiếu trường.
    const h = build({ buyer: { name: "Tạp hoá A" } })
    expect(h.AccountObjectTaxCode).toBe("")
    expect(h.AccountObjectAddress).toBe("")
    expect(h.ReceiverEmail).toBe("")
  })

  it("có ghi chú đơn hàng thì ghép vào tên người liên hệ", () => {
    const h = build({ buyer: { name: "Tạp hoá A" }, poNote: "PO-123" })
    expect(h.ContactName).toBe("Tạp hoá A, PO-123")
  })

  it("không có ghi chú thì ContactName bằng tên người mua", () => {
    expect(build().ContactName).toBe("Tạp hoá A")
  })

  it("ghi chú chỉ có khoảng trắng thì bỏ qua", () => {
    expect(build({ poNote: "   " }).ContactName).toBe("Tạp hoá A")
  })

  it("hình thức thanh toán mặc định TM/CK", () => {
    expect(build().PaymentMethod).toBe("TM/CK")
    expect(build({ buyer: { name: "A", payment_method_label: "Chuyển khoản" } }).PaymentMethod)
      .toBe("Chuyển khoản")
  })
})

describe("định danh và số hoá đơn", () => {
  it("mỗi lần dựng payload là một RefID mới", () => {
    // Trùng RefID là MISA coi như gửi lại chính hoá đơn cũ.
    expect(build().RefID).not.toBe(build().RefID)
  })

  it("mọi dòng dùng chung RefID của hoá đơn", () => {
    const h = build({ lines: [line(), line()] })
    expect(h.InvoiceDetails.every((d) => d.RefID === h.RefID)).toBe(true)
  })

  it("mỗi dòng có RefDetailID riêng", () => {
    const h = build({ lines: [line(), line()] })
    const ids = h.InvoiceDetails.map((d) => d.RefDetailID)
    expect(new Set(ids).size).toBe(2)
  })

  it("số hoá đơn để trạng thái chưa cấp số — MISA tự cấp khi ký", () => {
    expect(build().InvNo).toBe("<Chưa cấp số>")
  })

  it("thứ tự dòng bắt đầu từ 1 và tăng dần", () => {
    const h = build({ lines: [line(), line(), line()] })
    expect(h.InvoiceDetails.map((d) => d.SortOrder)).toEqual([1, 2, 3])
  })

  it("cờ chiết khấu chỉ bật khi thực sự có chiết khấu", () => {
    expect(build().TypeDiscount).toBe(0)
    expect(build({ lines: [line({ line_discount: 1_000 })] }).TypeDiscount).toBe(1)
  })
})

describe("vnInvoiceDate — ngày hoá đơn theo giờ Việt Nam", () => {
  it("luôn kèm múi giờ +07:00", () => {
    expect(vnInvoiceDate(new Date("2026-08-19T08:30:00Z"))).toMatch(/\+07:00$/)
  })

  it("quy đổi đúng từ UTC sang giờ Việt Nam", () => {
    expect(vnInvoiceDate(new Date("2026-08-19T08:30:00Z"))).toBe("2026-08-19T15:30:00+07:00")
  })

  it("bắc qua nửa đêm: 23:00 UTC là 06:00 NGÀY HÔM SAU ở Việt Nam", () => {
    // Sai ở đây là hoá đơn ghi sai ngày, ảnh hưởng kỳ kê khai thuế.
    expect(vnInvoiceDate(new Date("2026-08-19T23:00:00Z"))).toBe("2026-08-20T06:00:00+07:00")
  })

  it("ngày do người dùng chọn được ưu tiên hơn thời điểm hiện tại", () => {
    const h = build({ invoiceDate: "2026-01-15T10:00:00+07:00" })
    expect(h.InvDate).toBe("2026-01-15T10:00:00+07:00")
  })
})
