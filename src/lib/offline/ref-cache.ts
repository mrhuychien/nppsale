"use client"

import { idbGet, idbSet } from "./idb"

const KEY = "order-ref-data"

/**
 * Khoá của phần SẢN PHẨM trong bản lưu — xem `dungLaiSanPham` (`@/lib/sell/ref-data`). Ghi CÙNG MỘT LẦN với dữ liệu:
 * để riêng chỗ khác (localStorage) thì ghi IndexedDB hỏng mà khoá vẫn mới là giữ nhầm bản cũ.
 */
export interface KhoaSanPham {
  /** Số phiên danh mục (mig 209) đọc TRƯỚC sản phẩm. */
  phien: number
  uid: string
  vai: string
  /** Công ty được làm (NVBH chỉ thấy hàng công ty mình — RLS mig 081); vai khác "*". */
  ncc: string
}

export interface OrderRefData<C = unknown, P = unknown> extends Partial<KhoaSanPham> {
  customers: C[]
  products: P[]
  stockByProduct: Record<string, number>
  cachedAt: string
}

/** Lưu dữ liệu tham chiếu (KH + SP + tồn) sau mỗi lần tải form online,
 *  để lần sau mở form lúc mất mạng vẫn tạo đơn được. `khoa` = phần sản phẩm dùng lại được (thiếu = không). */
export async function cacheOrderRefData<C, P>(
  data: {
    customers: C[]
    products: P[]
    stockByProduct: Record<string, number>
  },
  khoa?: KhoaSanPham | null
): Promise<void> {
  await idbSet<OrderRefData<C, P>>(KEY, { ...data, ...(khoa ?? {}), cachedAt: new Date().toISOString() })
}

export async function getCachedOrderRefData<C, P>(): Promise<OrderRefData<C, P> | null> {
  return idbGet<OrderRefData<C, P>>(KEY)
}
