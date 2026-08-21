import { describe, it, expect, vi } from "vitest"
import {
  createFifoLayer,
  consumeFifoLayers,
  getStockValue,
} from "@/lib/inventory/fifo"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Giá vốn FIFO — sai ở đây là sai giá vốn, tức là sai lãi/lỗ trên mọi báo
 * cáo tài chính. Và vì các hàm này chỉ trả số chứ không hiện gì lên giao
 * diện, sai âm thầm rất lâu mới bị phát hiện.
 *
 * Các hàm đều nhận `supabase` làm tham số nên test được bằng client giả,
 * không cần database thật.
 */

/** Client giả cho `getStockValue`: chuỗi .eq/.is/.gt trả về chính nó. */
function fakeSelectClient(result: { data?: unknown; error?: unknown }) {
  const calls: Array<[string, unknown]> = []
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => (calls.push(["eq", `${col}=${val}`]), chain),
    is: (col: string, val: unknown) => (calls.push(["is", `${col}=${val}`]), chain),
    gt: (col: string, val: unknown) => (calls.push(["gt", `${col}=${val}`]), chain),
    // Được `await` → phải là thenable trả về { data, error }.
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve),
  }
  return {
    client: { from: () => chain } as unknown as SupabaseClient,
    calls,
  }
}

const layer = (product_id: string, warehouse_zone: string, qty: number, cost: number) => ({
  product_id,
  warehouse_zone,
  qty_in_base_uom_remaining: qty,
  unit_cost: cost,
})

describe("getStockValue — gộp tồn và giá trị theo sản phẩm + kho", () => {
  it("cộng dồn nhiều lớp của cùng sản phẩm và cùng kho", async () => {
    const { client } = fakeSelectClient({
      data: [layer("p1", "sale", 10, 1000), layer("p1", "sale", 5, 2000)],
    })
    const r = await getStockValue(client, "org1")
    expect(r).toHaveLength(1)
    expect(r[0].qty).toBe(15)
    // 10×1000 + 5×2000 — giá vốn bình quân KHÁC nhau giữa các lớp, đây
    // chính là điểm cốt lõi của FIFO: không được nhân tổng qty với 1 giá.
    expect(r[0].value).toBe(20000)
  })

  it("tách riêng khi khác kho, dù cùng sản phẩm", async () => {
    const { client } = fakeSelectClient({
      data: [layer("p1", "sale", 10, 1000), layer("p1", "date", 3, 1000)],
    })
    const r = await getStockValue(client, "org1")
    expect(r).toHaveLength(2)
    expect(r.find((x) => x.warehouseZone === "sale")?.qty).toBe(10)
    expect(r.find((x) => x.warehouseZone === "date")?.qty).toBe(3)
  })

  it("tách riêng khi khác sản phẩm", async () => {
    const { client } = fakeSelectClient({
      data: [layer("p1", "sale", 1, 100), layer("p2", "sale", 2, 100)],
    })
    expect(await getStockValue(client, "org1")).toHaveLength(2)
  })

  it("không có lớp nào thì trả mảng rỗng, không lỗi", async () => {
    const { client } = fakeSelectClient({ data: [] })
    expect(await getStockValue(client, "org1")).toEqual([])
  })

  it("data null (truy vấn không trả gì) cũng không làm vỡ hàm", async () => {
    const { client } = fakeSelectClient({ data: null })
    expect(await getStockValue(client, "org1")).toEqual([])
  })

  it("qty/cost null được coi là 0 thay vì thành NaN", async () => {
    const { client } = fakeSelectClient({
      data: [
        { product_id: "p1", warehouse_zone: "sale", qty_in_base_uom_remaining: null, unit_cost: null },
      ],
    })
    const r = await getStockValue(client, "org1")
    expect(r[0].qty).toBe(0)
    expect(r[0].value).toBe(0)
    expect(Number.isNaN(r[0].value)).toBe(false)
  })

  it("truy vấn lỗi thì NÉM, không trả 0 — giá trị tồn 0 giả là sai nguy hiểm", async () => {
    const { client } = fakeSelectClient({ error: { message: "permission denied" } })
    await expect(getStockValue(client, "org1")).rejects.toBeTruthy()
  })

  it("chỉ lấy lớp chưa đóng và còn hàng", async () => {
    const { client, calls } = fakeSelectClient({ data: [] })
    await getStockValue(client, "org1")
    expect(calls).toContainEqual(["is", "closed_at=null"])
    expect(calls).toContainEqual(["gt", "qty_in_base_uom_remaining=0"])
    expect(calls).toContainEqual(["eq", "org_id=org1"])
  })

  it("chỉ thêm điều kiện lọc khi có truyền vào", async () => {
    const a = fakeSelectClient({ data: [] })
    await getStockValue(a.client, "org1")
    expect(a.calls.some(([, v]) => String(v).startsWith("product_id="))).toBe(false)

    const b = fakeSelectClient({ data: [] })
    await getStockValue(b.client, "org1", { productId: "p1", warehouseZone: "date" })
    expect(b.calls).toContainEqual(["eq", "product_id=p1"])
    expect(b.calls).toContainEqual(["eq", "warehouse_zone=date"])
  })
})

/** Client giả cho `consumeFifoLayers`: chỉ cần `rpc`. */
function fakeRpcClient(result: { data?: unknown; error?: { message: string } }) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("consumeFifoLayers — trừ tồn theo lớp", () => {
  it("đọc kết quả khi RPC trả về mảng một dòng", async () => {
    const { client } = fakeRpcClient({ data: [{ total_cost: 45000, layers_used: 2 }] })
    const r = await consumeFifoLayers(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 10, outLineId: "line1",
    })
    expect(r).toEqual({ totalCost: 45000, layersUsed: 2, skipped: false })
  })

  it("đọc được cả khi RPC trả về object đơn thay vì mảng", async () => {
    const { client } = fakeRpcClient({ data: { total_cost: 1000, layers_used: 1 } })
    const r = await consumeFifoLayers(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 1, outLineId: "line1",
    })
    expect(r.totalCost).toBe(1000)
  })

  it("truyền đúng tên tham số cho hàm SQL", async () => {
    const { client, rpc } = fakeRpcClient({ data: [{ total_cost: 0, layers_used: 0 }] })
    await consumeFifoLayers(client, {
      orgId: "org1", productId: "p1", warehouseZone: "date",
      qtyInBaseUom: 7, outLineId: "line9",
    })
    expect(rpc).toHaveBeenCalledWith("fifo_consume", {
      p_org_id: "org1",
      p_product_id: "p1",
      p_warehouse_zone: "date",
      p_qty_needed: 7,
      p_out_line_id: "line9",
    })
  })

  it("DB chưa chạy migration 040 → bỏ qua chứ không làm hỏng luồng xuất kho", async () => {
    const { client } = fakeRpcClient({
      error: { message: 'function public.fifo_consume(...) does not exist' },
    })
    const r = await consumeFifoLayers(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 5, outLineId: "line1",
    })
    expect(r).toEqual({ totalCost: 0, layersUsed: 0, skipped: true })
  })

  it("thiếu tồn thì NÉM lỗi — tuyệt đối không được lặng lẽ trả 0", async () => {
    const { client } = fakeRpcClient({ error: { message: "FIFO_INSUFFICIENT_STOCK" } })
    await expect(
      consumeFifoLayers(client, {
        orgId: "org1", productId: "p1", warehouseZone: "sale",
        qtyInBaseUom: 999, outLineId: "line1",
      })
    ).rejects.toBeTruthy()
  })

  it("lỗi khác (mất mạng, RLS chặn) cũng phải ném, không nhầm với thiếu migration", async () => {
    const { client } = fakeRpcClient({ error: { message: "permission denied for table fifo_layers" } })
    await expect(
      consumeFifoLayers(client, {
        orgId: "org1", productId: "p1", warehouseZone: "sale",
        qtyInBaseUom: 1, outLineId: "line1",
      })
    ).rejects.toBeTruthy()
  })

  it("RPC trả rỗng thì quy về 0, không thành NaN", async () => {
    const { client } = fakeRpcClient({ data: [] })
    const r = await consumeFifoLayers(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 1, outLineId: "line1",
    })
    expect(r.totalCost).toBe(0)
    expect(Number.isNaN(r.totalCost)).toBe(false)
  })
})

/** Client giả cho `createFifoLayer`: .insert().select().single() */
function fakeInsertClient(result: { data?: unknown; error?: unknown }) {
  const insert = vi.fn()
  const chain = {
    insert: (row: unknown) => (insert(row), chain),
    select: () => chain,
    single: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  }
  return { client: { from: () => chain } as unknown as SupabaseClient, insert }
}

describe("createFifoLayer — tạo lớp giá vốn khi nhập kho", () => {
  it("trả về id lớp vừa tạo", async () => {
    const { client } = fakeInsertClient({ data: { id: "layer-1" } })
    const r = await createFifoLayer(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 100, unitCost: 12000,
    })
    expect(r.layerId).toBe("layer-1")
  })

  it("ghi đúng số lượng và giá vốn, mặc định source_line_id là null", async () => {
    const { client, insert } = fakeInsertClient({ data: { id: "layer-1" } })
    await createFifoLayer(client, {
      orgId: "org1", productId: "p1", warehouseZone: "date",
      qtyInBaseUom: 100, unitCost: 12000,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org1",
        product_id: "p1",
        warehouse_zone: "date",
        qty_in_base_uom_remaining: 100,
        unit_cost: 12000,
        source_line_id: null,
      })
    )
  })

  it("dùng thời điểm ghi sổ được truyền vào thay vì thời điểm hiện tại", async () => {
    const { client, insert } = fakeInsertClient({ data: { id: "layer-1" } })
    const postingAt = new Date("2026-01-15T03:00:00.000Z")
    await createFifoLayer(client, {
      orgId: "org1", productId: "p1", warehouseZone: "sale",
      qtyInBaseUom: 1, unitCost: 1, postingAt,
    })
    expect(insert.mock.calls[0][0]).toMatchObject({
      posting_at: "2026-01-15T03:00:00.000Z",
    })
  })

  it("insert lỗi thì ném — không được trả về id rỗng rồi đi tiếp", async () => {
    const { client } = fakeInsertClient({ error: { message: "violates not-null" } })
    await expect(
      createFifoLayer(client, {
        orgId: "org1", productId: "p1", warehouseZone: "sale",
        qtyInBaseUom: 1, unitCost: 1,
      })
    ).rejects.toBeTruthy()
  })

  it("không lỗi nhưng cũng không trả dòng nào → vẫn phải ném", async () => {
    const { client } = fakeInsertClient({ data: null })
    await expect(
      createFifoLayer(client, {
        orgId: "org1", productId: "p1", warehouseZone: "sale",
        qtyInBaseUom: 1, unitCost: 1,
      })
    ).rejects.toBeTruthy()
  })
})
