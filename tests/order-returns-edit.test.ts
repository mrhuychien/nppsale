import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  editableReturnOf, returnLinesToCart, syncOrderReturn,
  type PendingReturnRow,
} from "../src/lib/sell/order-edit"
import { fullCustomerAddress, invoiceAddressOf } from "../src/lib/customers/address"

/**
 * HÀNG TRẢ / HÀNG ĐỔI KHI SỬA ĐƠN, VÀ KHI HUỶ HÓA ĐƠN.
 *
 * Ba việc chủ nhà báo cùng một lúc:
 *   1. Sửa đơn thì phần hàng trả / hàng đổi biến mất.
 *   2. Huỷ hóa đơn thì phần đổi trả bị gán chữ "Đã huỷ".
 *   3. Mẫu in thiếu Phường trong địa chỉ khách.
 */

const ret = (o: Partial<PendingReturnRow> = {}): PendingReturnRow => ({
  id: "r1",
  reason: "damaged",
  notes: null,
  status: "draft",
  invoice_id: null,
  lines: [],
  ...o,
})

describe("phiếu trả màn sửa đơn được nắm", () => {
  it("đúng một phiếu nháp chưa gắn hóa đơn thì nắm nó", () => {
    expect(editableReturnOf([ret()])?.id).toBe("r1")
  })

  it("không có phiếu nào thì không nắm gì", () => {
    expect(editableReturnOf([])).toBeNull()
  })

  /**
   * ⚠ PHIẾU ĐÃ GỬI / ĐÃ GẮN HÓA ĐƠN LÀ CHỨNG TỪ ĐANG CÓ HIỆU LỰC. Ghi đè
   * nó từ màn bán hàng là sửa sổ mà không đi qua RPC nào.
   */
  it("không nắm phiếu đã gửi hoặc đã gắn hóa đơn", () => {
    expect(editableReturnOf([ret({ status: "submitted" })])).toBeNull()
    expect(editableReturnOf([ret({ invoice_id: "inv1" })])).toBeNull()
  })

  /**
   * ⚠ HAI PHIẾU NHÁP THÌ KHÔNG NẮM CÁI NÀO. Màn giỏ chỉ có MỘT ô hàng trả
   * với MỘT lý do; nạp hai phiếu vào đó rồi lưu là gộp chúng làm một và
   * xoá mất phiếu kia.
   */
  it("hai phiếu nháp thì không nắm cái nào", () => {
    expect(editableReturnOf([ret(), ret({ id: "r2" })])).toBeNull()
  })
})

describe("dòng phiếu trả nạp vào giỏ", () => {
  it("giữ đủ số lượng, đơn giá, thuế, ghi chú", () => {
    const rows = returnLinesToCart(
      ret({
        lines: [
          { product_id: "p1", unit_name: "thùng", quantity: 2, unit_price: 50000, vat_rate: 8, is_exchange: false, note: "móp" },
        ],
      })
    )
    expect(rows).toEqual([
      { productId: "p1", unit: "thùng", qty: 2, price: 50000, vatRate: 8, isExchange: false, note: "móp" },
    ])
  })

  /**
   * ⚠ `is_exchange` THIẾU / NULL THÌ COI LÀ DÒNG TRẢ. Dòng đổi KHÔNG trừ
   * tiền; đoán nhầm thành đổi là âm thầm bỏ mất một khoản giảm công nợ
   * của khách.
   */
  it("thiếu is_exchange thì coi là dòng trả, không phải dòng đổi", () => {
    const rows = returnLinesToCart(
      ret({ lines: [{ product_id: "p1", unit_name: "hộp", quantity: 1, unit_price: 1000 }] })
    )
    expect(rows[0].isExchange).toBe(false)
  })

  it("giữ đúng dòng đổi khi cột nói là đổi", () => {
    const rows = returnLinesToCart(
      ret({ lines: [{ product_id: "p1", unit_name: "hộp", quantity: 1, unit_price: 1000, is_exchange: true }] })
    )
    expect(rows[0].isExchange).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

interface Call { op: string; table: string }

function fakeClient(opts: { linesLeft?: number; delRows?: number; updRows?: number } = {}) {
  const calls: Call[] = []
  const inserted: Array<{ table: string; rows: unknown }> = []
  const client = {
    from(table: string) {
      const api: Record<string, unknown> = {}
      const chain = () => api
      api.select = () => {
        calls.push({ op: "select", table })
        const rows =
          table === "return_lines" && (opts.linesLeft ?? 0) > 0
            ? Array.from({ length: opts.linesLeft ?? 0 }, (_, i) => ({ id: `x${i}` }))
            : []
        // ⚠ MỖI MẮT XÍCH PHẢI VỪA `await` ĐƯỢC VỪA NỐI TIẾP ĐƯỢC. Client
        //   giả trả về một object thường ở giữa chuỗi là `await` ra chính
        //   object ấy, `data` thành `undefined`, và chốt xanh vì lý do sai.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const thenable: any = Object.assign(
          Promise.resolve({ data: rows, error: null }),
          { single: () => Promise.resolve({ data: { id: "new-ret" }, error: null }) }
        )
        thenable.eq = () => thenable
        thenable.limit = () => thenable
        return thenable
      }
      void chain
      api.insert = (rows: unknown) => {
        calls.push({ op: "insert", table })
        inserted.push({ table, rows })
        return Object.assign(Promise.resolve({ data: null, error: null }), {
          select: () => ({ single: () => Promise.resolve({ data: { id: "new-ret" }, error: null }) }),
        })
      }
      api.update = () => {
        calls.push({ op: "update", table })
        return {
          eq: () => ({
            select: () =>
              Promise.resolve({
                data: Array.from({ length: opts.updRows ?? 1 }, () => ({ id: "r1" })),
                error: null,
              }),
          }),
        }
      }
      api.delete = () => {
        calls.push({ op: "delete", table })
        return {
          eq: () =>
            Object.assign(
              Promise.resolve({ data: null, error: null }),
              {
                select: () =>
                  Promise.resolve({
                    data: Array.from({ length: opts.delRows ?? 1 }, () => ({ id: "r1" })),
                    error: null,
                  }),
              }
            ),
        }
      }
      return api
    },
  }
  return { client, calls, inserted }
}

const base = {
  orderId: "o1",
  customerId: "c1",
  orgId: "org1",
  userId: "u1",
  reason: "damaged",
  notes: null,
  lines: [
    {
      product_id: "p1", unit_name: "hộp", quantity: 1, unit_price: 1000,
      vat_rate: 0, line_total: 1000, is_exchange: false,
    },
  ],
}

describe("ghi hàng trả khi lưu bản sửa", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT QUAN TRỌNG NHẤT CỦA CẢ TỆP. `undefined` nghĩa là "đọc
   * hỏng / không nắm được cái nào", KHÔNG phải "đơn không có phiếu trả".
   * Chạy tiếp là màn sửa đơn đẻ thêm một phiếu trả cho cùng số hàng —
   * đúng cái mà bản cũ né bằng cách giấu hẳn phần hàng trả đi.
   */
  it("không biết thì ĐỨNG YÊN, không tạo không xoá", async () => {
    const { client, calls } = fakeClient()
    await syncOrderReturn(client, { ...base, heldReturnId: undefined })
    expect(calls).toEqual([])
  })

  it("đơn chưa có phiếu trả mà vừa nhập vào thì tạo mới", async () => {
    const { client, calls } = fakeClient()
    await syncOrderReturn(client, { ...base, heldReturnId: null })
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "insert:returns",
      "insert:return_lines",
    ])
  })

  it("đang nắm phiếu thì ghi đè chính nó, không tạo phiếu thứ hai", async () => {
    const { client, calls } = fakeClient()
    await syncOrderReturn(client, { ...base, heldReturnId: "r1" })
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "update:returns",
      "delete:return_lines",
      "select:return_lines",
      "insert:return_lines",
    ])
    expect(calls.some((c) => c.op === "insert" && c.table === "returns")).toBe(false)
  })

  /**
   * ⚠ XOÁ BỊ TỪ CHỐI TRONG IM LẶNG (RLS: 0 dòng, HTTP 200, error null) mà
   * vẫn chèn tiếp thì phiếu trả có HAI bộ dòng — công nợ của khách bị trừ
   * gấp đôi lúc phiếu được hoàn thành.
   */
  it("xoá dòng cũ bị từ chối thì DỪNG, không chèn thêm", async () => {
    const { client, calls } = fakeClient({ linesLeft: 2 })
    await expect(
      syncOrderReturn(client, { ...base, heldReturnId: "r1" })
    ).rejects.toThrow(/ghi đôi|dòng hàng trả cũ/i)
    expect(calls.some((c) => c.op === "insert" && c.table === "return_lines")).toBe(false)
  })

  /** ⚠ Sửa đầu phiếu 0 dòng cũng là RLS từ chối — phải đếm, đừng im. */
  it("sửa phiếu trả 0 dòng thì báo lỗi", async () => {
    const { client } = fakeClient({ updRows: 0 })
    await expect(
      syncOrderReturn(client, { ...base, heldReturnId: "r1" })
    ).rejects.toThrow(/không có quyền sửa phiếu trả/i)
  })

  it("bỏ hết dòng hàng trả thì xoá hẳn phiếu", async () => {
    const { client, calls } = fakeClient()
    await syncOrderReturn(client, { ...base, heldReturnId: "r1", lines: [] })
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(["delete:returns"])
  })

  it("xoá phiếu bị từ chối thì nói ra", async () => {
    const { client } = fakeClient({ delRows: 0 })
    await expect(
      syncOrderReturn(client, { ...base, heldReturnId: "r1", lines: [] })
    ).rejects.toThrow(/không xoá được phiếu trả/i)
  })

  /**
   * ⚠ KHÔNG GHI `notes`. `buildOrderPayload` luôn đặt `returns.notes =
   * null` vì màn giỏ không có ô ghi chú cho phiếu trả; ghi nó xuống là mỗi
   * lần sửa đơn lại xoá trắng ghi chú viết ở màn Trả hàng.
   */
  it("không đụng tới ghi chú của phiếu trả", () => {
    const src = readFileSync("src/lib/sell/order-edit.ts", "utf8")
    const fn = src.slice(src.indexOf("export async function syncOrderReturn"))
    expect(fn).toContain('.update({ reason: o.reason })')
    expect(fn).not.toContain("notes: o.notes,\n      })")
  })
})

describe("màn sửa đơn nạp hàng trả lên", () => {
  const page = readFileSync("src/app/(dashboard)/sell/edit/[id]/page.tsx", "utf8")

  /**
   * ⚠ ĐÂY LÀ LỖI CHỦ NHÀ BÁO. Bản cũ nạp `returnLines: []` kèm chú thích
   * "không kéo vào giỏ" — người sửa đơn thấy trống rỗng nên tưởng hàng trả
   * mất, rồi nhập lại, thành hai phiếu.
   */
  it("nạp dòng hàng trả vào giỏ chứ không để rỗng", () => {
    expect(page).toContain("heldReturn ? returnLinesToCart(heldReturn) : []")
    expect(page).not.toMatch(/returnLines: \[\],\s*\n\s*editing:/)
  })

  /** ⚠ Lý do trả cũng phải nạp lại, không ép về "damaged". */
  it("nạp lại đúng lý do trả đã lưu", () => {
    expect(page).toContain('heldReturn?.reason || "damaged"')
  })

  /**
   * ⚠ BA TRẠNG THÁI, KHÔNG PHẢI HAI. `?? null` ở đây là biến "không biết"
   * thành "không có", và lần lưu sau đẻ thêm một phiếu trả.
   */
  it("giữ nguyên ba trạng thái của heldReturnId", () => {
    expect(page).toContain("heldReturn === undefined ? undefined : (heldReturn?.id ?? null)")
    expect(page).toContain("holdable.length === 0 ? null : undefined")
  })

  /** ⚠ Đọc phiếu trả hỏng thì không chặn màn, nhưng cũng không im. */
  it("đọc phiếu trả hỏng thì báo và đứng yên", () => {
    expect(page).toContain("Chưa đọc được hàng trả kèm đơn")
    expect(page).toContain("KHÔNG bị thay đổi khi bạn lưu")
  })

  it("màn giỏ truyền heldReturnId xuống, không ép null", () => {
    const cart = readFileSync("src/app/(dashboard)/sell/cart/page.tsx", "utf8")
    expect(cart).toContain("heldReturnId: editing.heldReturnId,")
    expect(cart).not.toContain("heldReturnId: editing.heldReturnId ?? null")
  })
})

describe("migration 131 — huỷ hóa đơn không huỷ phiếu trả kèm đơn", () => {
  const mig = readFileSync("supabase/migrations/131_cancel_invoice_keeps_returns.sql", "utf8")

  /**
   * ⚠ PHIẾU TRẢ KÈM ĐƠN CHỈ GỠ LIÊN KẾT. Nó có từ lúc lên đơn, trước khi
   * có hóa đơn nào; huỷ theo là ghi vào sổ rằng khách chưa từng trả hàng.
   */
  it("phiếu có gắn đơn thì gỡ invoice_id, không đổi trạng thái", () => {
    expect(mig).toContain("SET invoice_id = NULL")
    expect(mig).toContain("AND order_id IS NOT NULL")
  })

  /** ⚠ Phiếu ĐỘC LẬP thì mất chỗ bám thật — vẫn phải huỷ. */
  it("phiếu không gắn đơn thì vẫn huỷ", () => {
    expect(mig).toContain("AND order_id IS NULL")
    expect(mig).toContain("cancelled_at = now()")
  })

  /** ⚠ Chạy lại migration không được đổi gì thêm. */
  it("chạy lại thì đứng yên", () => {
    expect(mig).toContain("đã vá từ trước")
  })

  /**
   * ⚠ HÌNH DẠNG KHÔNG KHỚP THÌ DỪNG VÀ IN RA THỨ TÌM THẤY — bài học của
   * mig 126: báo "sai hình dạng" mà không nói hình dạng hiện tại là gì thì
   * người chạy migration không có đường nào sửa tay.
   */
  it("không khớp hình dạng thì dừng và in thân hàm ra", () => {
    expect(mig).toContain("CANCEL_INVOICE_SHAPE")
    expect(mig).toContain("v_n, E'\\n' || v_src")
    expect(mig).toContain("ERRCODE = 'P0001'")
  })

  /** ⚠ Backfill chỉ nhận đúng dấu vết của lỗi này, không quét rộng. */
  it("dựng lại chỉ những phiếu mang đủ bốn dấu vết", () => {
    const fix = mig.slice(mig.indexOf("DO $fix$"))
    expect(fix).toContain("ret.status = 'cancelled'")
    expect(fix).toContain("ret.order_id IS NOT NULL")
    expect(fix).toContain("si.status = 'cancelled'")
    expect(fix).toContain("ret.cancel_reason LIKE 'Hóa đơn % bị huỷ'")
    // ⚠ Đơn đã huỷ / đã đóng thì phiếu trả huỷ vẫn là đúng.
    expect(fix).toContain("so.status NOT IN ('cancelled', 'closed')")
  })

  /** ⚠ Hai hóa đơn trở lên thì KHÔNG ĐOÁN — gắn nhầm là giảm nợ sai tờ. */
  it("đơn có nhiều hóa đơn thì để nguyên và nêu tên", () => {
    expect(mig).toContain("phải chọn tay")
    expect(mig).toMatch(/ELSIF v_posted = 1 THEN/)
  })

  it("kết thúc bằng reload schema và đếm số dòng", () => {
    expect(mig).toContain("NOTIFY pgrst, 'reload schema'")
    expect(mig).toMatch(/RAISE NOTICE '131: dựng lại %/)
  })
})

describe("địa chỉ khách trên mẫu in", () => {
  /** ⚠ Chủ nhà chốt: mẫu in phải có Phường. */
  it("ghép đủ số nhà, phường, quận, tỉnh", () => {
    expect(
      fullCustomerAddress({
        address: "47 Cẩm", ward: "Phường Trần Nguyên Hãn",
        district: "Quận Lê Chân", province: "Hải Phòng",
      })
    ).toBe("47 Cẩm, Phường Trần Nguyên Hãn, Quận Lê Chân, Hải Phòng")
  })

  /**
   * ⚠ BỎ PHẦN ĐÃ NẰM SẴN TRONG `address`. Nhiều khách gõ cả phường vào ô
   * địa chỉ rồi mới chọn phường ở ô riêng; nối thẳng là in ra một địa chỉ
   * lặp hai lần cùng một cái tên.
   */
  it("không lặp phần đã có sẵn trong ô địa chỉ", () => {
    expect(
      fullCustomerAddress({ address: "47 Cẩm, Phường Trần Nguyên Hãn", ward: "Trần Nguyên Hãn" })
    ).toBe("47 Cẩm, Phường Trần Nguyên Hãn")
  })

  /** ⚠ So không dấu, không phân biệt hoa thường. */
  it("bắt trùng cả khi khác dấu và khác hoa thường", () => {
    expect(fullCustomerAddress({ address: "47 tran nguyen han", ward: "Trần Nguyên Hãn" }))
      .toBe("47 tran nguyen han")
  })

  it("thiếu cột nào thì bỏ cột đó, không để dấu phẩy thừa", () => {
    expect(fullCustomerAddress({ address: "47 Cẩm", ward: null, province: "Hải Phòng" }))
      .toBe("47 Cẩm, Hải Phòng")
    expect(fullCustomerAddress({})).toBe("")
  })

  /**
   * ⚠ CÓ `billing_address` THÌ DÙNG NGUYÊN VĂN. Đó là địa chỉ xuất hóa
   * đơn kế toán gõ tay để khớp đăng ký thuế; nối thêm phường vào là sửa
   * một địa chỉ pháp lý, và tờ in lệch với hóa đơn điện tử đã gửi thuế.
   */
  it("hóa đơn có địa chỉ xuất hóa đơn thì giữ nguyên văn", () => {
    expect(
      invoiceAddressOf({
        billing_address: "Số 1 Đại Cồ Việt, Hà Nội",
        address: "47 Cẩm", ward: "Trần Nguyên Hãn",
      })
    ).toBe("Số 1 Đại Cồ Việt, Hà Nội")
  })

  it("không có địa chỉ xuất hóa đơn thì ghép đủ bốn cột", () => {
    expect(invoiceAddressOf({ address: "47 Cẩm", ward: "Trần Nguyên Hãn" }))
      .toBe("47 Cẩm, Trần Nguyên Hãn")
  })

  /** ⚠ Câu `select` phải kéo về đủ cột, nếu không hàm ghép không có gì để ghép. */
  it("màn in hóa đơn có hỏi ward/district/province", () => {
    const page = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
    expect(page).toContain("billing_address, address, ward, district, province, phone")
    expect(page).toContain("invoiceAddressOf(inv.customer ?? {})")
  })

  /** ⚠ Phiếu giao hàng đi cùng chuyến phải ghép y hệt. */
  it("phiếu giao hàng dùng chung hàm ghép", () => {
    const slip = readFileSync("src/components/printing/delivery-slip.tsx", "utf8")
    expect(slip).toContain("fullCustomerAddress(o.customer ?? {})")
  })
})

describe("xem nhanh có hàng đổi / trả", () => {
  const order = readFileSync("src/components/orders/order-drawer.tsx", "utf8")
  const invoice = readFileSync("src/components/sales-invoices/invoice-drawer.tsx", "utf8")
  const comp = readFileSync("src/components/orders/return-summary.tsx", "utf8")

  it("cả hai ngăn xem nhanh đều vẽ khối hàng đổi / trả", () => {
    expect(order).toContain("<ReturnSummary returns={returns} />")
    expect(invoice).toContain("<ReturnSummary returns={returns} />")
  })

  /** ⚠ Một câu select dùng chung — hai màn hỏi khác nhau thì vẽ khác nhau. */
  it("hai màn hỏi cùng một bộ cột", () => {
    expect(order).toContain("RETURN_SUMMARY_SELECT")
    expect(invoice).toContain("RETURN_SUMMARY_SELECT")
  })

  /**
   * ⚠ HÓA ĐƠN HỎI THEO `invoice_id`, KHÔNG THEO `order_id`. Một đơn nay có
   * thể có nhiều hóa đơn; hỏi theo đơn là tờ này hiện cả hàng trả của tờ
   * khác.
   */
  it("ngăn hóa đơn lọc theo invoice_id, ngăn đơn lọc theo order_id", () => {
    expect(invoice).toContain('.eq("invoice_id", invoiceId)\n        .neq("status", "cancelled")')
    expect(order).toContain('.eq("order_id", orderId)\n        .neq("status", "cancelled")')
  })

  /** ⚠ Chỉ phiếu ĐÃ HOÀN THÀNH mới thật sự trừ công nợ — phải nói rõ. */
  it("nói rõ khoản trừ đã vào công nợ hay chưa", () => {
    expect(comp).toContain('const counted = r.status === "completed"')
    expect(comp).toContain('counted ? "đã trừ công nợ" : "chưa trừ"')
  })

  /** ⚠ Dòng ĐỔI không trừ tiền — trộn chung với dòng TRẢ là cộng nhầm nợ. */
  it("phân biệt dòng đổi và dòng trả", () => {
    expect(comp).toContain('l.is_exchange ? "ĐỔI" : "TRẢ"')
    expect(comp).toContain('l.is_exchange ? "không trừ"')
  })
})

describe("hai màn chi tiết dựng cùng một lưới", () => {
  /**
   * ⚠ CHỦ NHÀ BÁO: chi tiết đơn hàng không giống chi tiết hóa đơn. Màn hóa
   * đơn dựng bằng `DetailColumns` (có `items-start` + `self-start`); màn
   * đơn tự dựng lưới và thiếu cả hai, nên ô lưới kéo thẻ "Chi tiết sản
   * phẩm" cao bằng cả cột phải.
   */
  it("lưới màn chi tiết đơn có items-start và cột phải self-start", () => {
    const page = readFileSync("src/app/(dashboard)/orders/[id]/page.tsx", "utf8")
    expect(page).toContain('className="grid items-start gap-5 lg:grid-cols-3"')
    expect(page).toContain('className="space-y-5 self-start lg:sticky lg:top-4"')
    expect(page).not.toContain('className="grid gap-4 lg:grid-cols-3"')
  })

  it("khối dựng chung vẫn giữ items-start", () => {
    const chrome = readFileSync("src/components/detail/detail-chrome.tsx", "utf8")
    expect(chrome).toContain('className="grid items-start gap-5 lg:grid-cols-3"')
  })
})
