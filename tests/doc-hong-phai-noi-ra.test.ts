import { describe, it, expect } from "vitest"
import { loadPickerExtras } from "@/lib/purchasing/picker-extras"
import { loadReceiptLinesForReturn } from "@/lib/pos/load"

/**
 * ĐỌC HỎNG PHẢI NÓI RA (rà truy vấn không kiểm lỗi, 08/10/2026 — cổng CI "Truy vấn database phải kiểm lỗi").
 * Hai chỗ trong thư viện mà đọc hỏng ra đúng hình dạng của "dữ liệu thật": tồn 0 ở ô tìm hàng mua, và phiếu nhập
 * gốc không có lô nào ở phiếu trả NCC.
 */

type Kq = { data: unknown; error: { message: string } | null; count?: number | null }

/** Client giả: mọi phương thức nối chuỗi trả chính nó; `await` ra kết quả theo TÊN BẢNG. */
function sbGia(kq: (bang: string) => Kq) {
  return {
    from(bang: string) {
      const q: unknown = new Proxy(
        {},
        {
          get(_t, k) {
            if (k === "then") return (ok: (v: Kq) => unknown, hong: (e: unknown) => unknown) => Promise.resolve(kq(bang)).then(ok, hong)
            return () => q
          },
        }
      )
      return q
    },
  }
}

const HANG = [{ id: "p1", primary_supplier_id: "s1" }, { id: "p2", primary_supplier_id: null }] as never

describe("ô tìm hàng mua — NCC và tồn (`loadPickerExtras`)", () => {
  it("đọc TỒN hỏng thì tồn để trống (null), KHÔNG phải 0", async () => {
    /* `fetchAllForAggregate` hỏng trả mảng RỖNG kèm `truncated: false` — chỉ soi `truncated` là mọi mặt hàng "hết hàng",
       người nhập hàng nhập bù một mặt hàng đang đầy kho. */
    const sb = sbGia((b) => (b === "batches" ? { data: null, error: { message: "mất mạng" } } : { data: [{ id: "s1", name: "NCC A" }], error: null }))
    const kq = await loadPickerExtras(sb as never, HANG)
    expect(kq.p1).toEqual({ supplierName: "NCC A", onHand: null })
    expect(kq.p2).toEqual({ supplierName: null, onHand: null })
  })

  it("đọc NCC hỏng thì tên NCC để trống; tồn vẫn cộng đúng", async () => {
    const sb = sbGia((b) =>
      b === "suppliers"
        ? { data: null, error: { message: "mất mạng" } }
        : { data: [{ product_id: "p1", qty_on_hand: 5 }, { product_id: "p1", qty_on_hand: 7 }], error: null, count: 2 }
    )
    const kq = await loadPickerExtras(sb as never, HANG)
    expect(kq.p1).toEqual({ supplierName: null, onHand: 12 })
    expect(kq.p2).toEqual({ supplierName: null, onHand: 0 })
  })
})

describe("phiếu trả NCC — nạp dòng + lô của phiếu nhập gốc (`loadReceiptLinesForReturn`)", () => {
  const DONG = [{ product_id: "p1", unit_name: "thùng", quantity: 2, unit_price: 1000, conversion_factor: 24, product: { name: "Sữa", sku: "S1" } }]

  it("đầu phiếu đọc hỏng thì NÉM — không thì không có mã phiếu, danh sách lô trống như phiếu không có lô", async () => {
    const sb = sbGia((b) => (b === "purchase_invoices" ? { data: null, error: { message: "đầu phiếu hỏng" } } : { data: DONG, error: null }))
    await expect(loadReceiptLinesForReturn(sb as never, "pi1")).rejects.toMatchObject({ message: "đầu phiếu hỏng" })
  })

  it("lô của phiếu đọc hỏng thì NÉM", async () => {
    const sb = sbGia((b) =>
      b === "purchase_invoices" ? { data: { id: "pi1", receipt_code: "PN-0001" }, error: null }
        : b === "purchase_invoice_lines" ? { data: DONG, error: null }
          : { data: null, error: { message: "lô hỏng" } }
    )
    await expect(loadReceiptLinesForReturn(sb as never, "pi1")).rejects.toThrow(/Lô của phiếu nhập: lô hỏng/)
  })

  it("đọc được thì trả dòng kèm mã phiếu", async () => {
    const sb = sbGia((b) =>
      b === "purchase_invoices" ? { data: { id: "pi1", receipt_code: "PN-0001" }, error: null }
        : b === "purchase_invoice_lines" ? { data: DONG, error: null }
          : { data: [{ id: "b1", product_id: "p1", batch_code: "PN-0001-1", expires_at: null }], error: null, count: 1 }
    )
    const kq = await loadReceiptLinesForReturn(sb as never, "pi1")
    expect(kq.receiptCode).toBe("PN-0001")
    expect(kq.lines).toHaveLength(1)
    expect(kq.lines[0].lots.map((l) => l.code)).toEqual(["PN-0001-1"])
  })
})
