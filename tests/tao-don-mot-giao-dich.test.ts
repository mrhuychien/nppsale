import { describe, it, expect } from "vitest"
import {
  createOrderRecords,
  thieuHamTaoDon,
  tachTaiTrongRpc,
  type OfflineOrderPayload,
} from "../src/lib/orders/create"
import { fakeOrderDb } from "./helpers/fake-order-db"

/**
 * MIG 169 — TẠO ĐƠN TRONG MỘT GIAO DỊCH.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026), đăng nhập NVBH:
 *     lần 1                          → DH-0007, already_existed = f
 *     thử lại cùng client_request_id → DH-0007, already_existed = t, vẫn 1 dòng
 *     dòng 2 hỏng (sản phẩm lạ)      → 0 đơn nằm lại
 *     đơn ma có sẵn (0 dòng)         → gọi lại thì được ghi bù 1 dòng
 *     NVBH đặt đơn tên người khác    → DON_HO_KHONG_DUOC_PHEP (trigger mig 153 vẫn canh)
 */

const CTX = { userId: "u1", orgId: "g1" }
const P: OfflineOrderPayload = {
  clientRequestId: "22222222-2222-2222-2222-222222222222",
  order: {
    order_code: "TMP-1", customer_id: "c1", payment_terms: "", expected_delivery: null,
    subtotal: 100, vat: 0, total: 100, notes: null,
  },
  lines: [{ product_id: "p1", unit_name: "hộp", quantity: 2, unit_price: 50, line_discount: 0, line_total: 100, conversion_factor: 1 }],
  targetStatus: "submitted",
  returns: { reason: "damaged", notes: null },
  returnLines: [{ product_id: "p1", unit_name: "hộp", quantity: 1, unit_price: 50, vat_rate: 0, line_total: 50, is_exchange: false }],
  meta: { customerName: "", total: 100, createdAt: "", lineCount: 1 },
}

describe("đường mới: một RPC", () => {
  it("chỉ MỘT lệnh ghi, không lệnh rời nào", async () => {
    const db = fakeOrderDb({ rpc: { data: [{ order_id: "o1", order_code: "DH-1", already_existed: false }], error: null } })
    await createOrderRecords(db as never, P, CTX)
    expect(db.log.map((x) => x.op)).toEqual(["rpc"])
    expect(db.log[0].table).toBe("create_order_with_lines")
  })

  it("tải trọng mang đủ đầu đơn, dòng hàng, phiếu trả", () => {
    const t = tachTaiTrongRpc(P) as {
      client_request_id: string
      order: Record<string, unknown>
      lines: unknown[]
      returns: unknown
      return_lines: unknown[]
    }
    expect(t.client_request_id).toBe(P.clientRequestId)
    expect(t.order.status).toBe("submitted")
    expect(t.order.payment_terms).toBe("COD")
    expect(t.order.approval_reason).toMatch(/Tạo offline/)
    expect(t.lines).toHaveLength(1)
    expect(t.returns).toEqual({ reason: "damaged", notes: null })
    expect(t.return_lines).toHaveLength(1)
  })

  /**
   * ⚠ LỖI THẬT THÌ NÉM, KHÔNG THỬ ĐƯỜNG KHÁC. Rơi về đường cũ khi RLS
   *   từ chối là ghi lại đúng cái đơn ma mà mig 169 đi vá.
   */
  it("RLS / trigger từ chối thì ném, không rơi về đường cũ", async () => {
    const db = fakeOrderDb({ rpc: { data: null, error: { code: "P0001", message: "DON_HO_KHONG_DUOC_PHEP: …" } } })
    await expect(createOrderRecords(db as never, P, CTX)).rejects.toMatchObject({ code: "P0001" })
    expect(db.log.filter((x) => x.op === "insert")).toHaveLength(0)
  })
})

describe("máy chủ chưa có mig 169: đường cũ", () => {
  it.each([
    [{ code: "PGRST202", message: "Could not find the function public.create_order_with_lines(p) in the schema cache" }, true],
    [{ code: "42883", message: "function public.create_order_with_lines(jsonb) does not exist" }, true],
    [{ code: "42501", message: "permission denied" }, false],
    [{ code: "P0001", message: "BAD_PAYLOAD" }, false],
  ])("thiếu hàm? %j → %s", (err, can) => {
    expect(thieuHamTaoDon(err)).toBe(can)
  })

  it("thiếu hàm thì vẫn tạo được đơn", async () => {
    const db = fakeOrderDb({ insertOrder: { data: { id: "o2", order_code: "DH-2" }, error: null } })
    const r = await createOrderRecords(db as never, P, CTX)
    expect(r.orderCode).toBe("DH-2")
    expect(db.log.filter((x) => x.op === "insert").map((x) => x.table)).toEqual([
      "sales_orders", "sales_order_lines", "returns", "return_lines",
    ])
  })

  /**
   * ⚠ ĐƠN MA. Lần trước ghi xong đầu đơn rồi rớt mạng; thử lại vấp 23505.
   *   Bản cũ trả "đã có đơn" và màn báo "Đã gửi đơn" cho một đơn 0 dòng.
   */
  it("23505 mà đơn cũ 0 dòng → ghi bù dòng và phiếu trả", async () => {
    const db = fakeOrderDb({
      insertOrder: { data: null, error: { code: "23505", message: "duplicate key" } },
      existing: { id: "o3", order_code: "DH-3" },
      existingLineCount: 0,
    })
    const r = await createOrderRecords(db as never, P, CTX)
    expect(r).toEqual({ orderId: "o3", orderCode: "DH-3", alreadyExisted: true })
    const chen = db.log.filter((x) => x.op === "insert").map((x) => x.table)
    expect(chen).toContain("sales_order_lines")
    expect(chen).toContain("returns")
  })

  it("23505 mà đơn cũ đã đủ dòng → không ghi thêm gì", async () => {
    const db = fakeOrderDb({
      insertOrder: { data: null, error: { code: "23505", message: "duplicate key" } },
      existing: { id: "o4", order_code: "DH-4" },
      existingLineCount: 1,
    })
    await createOrderRecords(db as never, P, CTX)
    expect(db.log.filter((x) => x.op === "insert").map((x) => x.table)).toEqual(["sales_orders"])
  })
})

describe("mã chống lặp ở /sell/cart", async () => {
  const { layMaChongLap } = await import("../src/lib/sell/request-id")
  let n = 0
  const sinh = () => `id-${++n}`

  it("bấm lại cùng nội dung → cùng mã", () => {
    const a = layMaChongLap(null, "giỏ-A", sinh)
    const b = layMaChongLap(a, "giỏ-A", sinh)
    expect(b.id).toBe(a.id)
  })

  it("sửa giỏ rồi gửi → mã mới (không nuốt thay đổi)", () => {
    const a = layMaChongLap(null, "giỏ-A", sinh)
    const b = layMaChongLap(a, "giỏ-B", sinh)
    expect(b.id).not.toBe(a.id)
  })

  it("màn giỏ hàng dùng mã giữ qua các lần bấm", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const s = readFileSync(resolve(__dirname, "..", "src/app/(dashboard)/sell/cart/page.tsx"), "utf-8")
    expect(s).toContain("clientRequestId: maChongLap.current.id")
    expect(s).not.toMatch(/clientRequestId:\s*\n?\s*typeof crypto/)
  })
})
