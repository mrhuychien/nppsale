"use client"

import { idbGet, idbSet } from "./idb"

const KEY = "order-ref-data"

export interface OrderRefData<C = unknown, P = unknown> {
  customers: C[]
  products: P[]
  stockByProduct: Record<string, number>
  cachedAt: string
}

/** Lưu dữ liệu tham chiếu (KH + SP + tồn) sau mỗi lần tải form online,
 *  để lần sau mở form lúc mất mạng vẫn tạo đơn được. */
export async function cacheOrderRefData<C, P>(data: {
  customers: C[]
  products: P[]
  stockByProduct: Record<string, number>
}): Promise<void> {
  await idbSet<OrderRefData<C, P>>(KEY, { ...data, cachedAt: new Date().toISOString() })
}

export async function getCachedOrderRefData<C, P>(): Promise<OrderRefData<C, P> | null> {
  return idbGet<OrderRefData<C, P>>(KEY)
}
