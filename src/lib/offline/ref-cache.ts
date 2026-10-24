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

/**
 * Khoá của phần SỔ KHÁCH trong bản lưu — xem `dungLaiKhach` (`@/lib/sell/ref-data`): số phiên sổ khách (mig 254, tăng khi
 * khách / nhóm khách / phân công / quyền xem khách đổi) đọc TRƯỚC câu khách, đúng người, đúng vai (NVBH chỉ thấy khách
 * mình phụ trách). Tách khỏi khoá sản phẩm: hai phần dùng lại độc lập (hàng đổi mà khách chưa đổi thì chỉ tải lại hàng).
 */
export interface KhoaKhach {
  phien: number
  uid: string
  vai: string
}

export interface OrderRefData<C = unknown, P = unknown> extends Partial<KhoaSanPham> {
  customers: C[]
  products: P[]
  stockByProduct: Record<string, number>
  cachedAt: string
  /** Khoá sổ khách (mig 254) — thiếu = khách trong bản này không dùng lại được, lần sau tải. */
  khach?: KhoaKhach
}

/** Lưu dữ liệu tham chiếu (KH + SP + tồn) sau mỗi lần tải form online,
 *  để lần sau mở form lúc mất mạng vẫn tạo đơn được. `khoa` = phần sản phẩm dùng lại được, `khach` = phần sổ khách
 *  dùng lại được (thiếu = không). */
export async function cacheOrderRefData<C, P>(
  data: {
    customers: C[]
    products: P[]
    stockByProduct: Record<string, number>
  },
  khoa?: KhoaSanPham | null,
  khach?: KhoaKhach | null
): Promise<void> {
  await idbSet<OrderRefData<C, P>>(KEY, {
    ...data, ...(khoa ?? {}), ...(khach ? { khach } : {}), cachedAt: new Date().toISOString(),
  })
}

export async function getCachedOrderRefData<C, P>(): Promise<OrderRefData<C, P> | null> {
  return idbGet<OrderRefData<C, P>>(KEY)
}
