/**
 * PHIẾU SOẠN HÀNG — GỘP NHIỀU ĐƠN THÀNH TỔNG LƯỢNG HÀNG CẦN XUẤT.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Phát triển tính năng soạn đơn hàng, Cho phép gộp nhiều
 *   đơn hàng vào -> lượng hàng tổng cần xuất. Người dùng chỉ cần chọn đơn hàng
 *   cần gộp, máy sẽ tổng hợp và in ra."
 *
 * ⚠ CHỈ ĐỌC, KHÔNG GHI SỔ. Đây là tờ giấy cho kho nhặt hàng — không phải phiếu
 *   xuất. Luồng "Xuất kho & Gộp đơn" cũ (`inventory/stock-out`) ghi phiếu kho và
 *   chuyển đơn sang `picking`; bước ấy ĐÃ BỎ. Trừ kho vẫn đi qua Xuất hàng /
 *   `post_invoice` của từng đơn.
 *
 * ⚠ LƯỢNG CẦN XUẤT = PHẦN CÒN LẠI (`get_invoiceable_lines.remaining_qty`), không
 *   phải số đặt: đơn đã xuất một phần thì chỉ còn phần chưa xuất. Hàng ĐỔI của
 *   phiếu trả kèm đơn cũng phải rời kho → tính vào, đánh dấu riêng.
 *
 * ⚠ CỘNG QUA NHIỀU DÒNG PHẢI QUY VỀ ĐƠN VỊ CƠ SỞ TRƯỚC (luật báo cáo 24/09/2026):
 *   3 thùng + 5 hộp không phải "8". Hệ số lấy trên dòng (`conversion_factor`).
 */

import type { InvoiceableLine } from "@/lib/orders/post-invoice"

export interface PickOrder {
  id: string
  code: string
  customerName: string
}

export interface PickDetail {
  orderId: string
  orderCode: string
  customerName: string
  unitName: string
  qty: number
  isExchange: boolean
}

export interface PickRow {
  productId: string
  name: string
  sku: string | null
  baseUnit: string
  /** Tổng cần xuất, ĐƠN VỊ CƠ SỞ. */
  totalBase: number
  /** Cộng theo đúng đơn vị đã đặt ("thùng" → 3, "hộp" → 5). */
  byUnit: Array<{ unitName: string; qty: number }>
  /** Cách lấy hàng theo đơn vị lớn nhất trước — "3 thùng 5 hộp". */
  pick: Array<{ unitName: string; qty: number }>
  orderCount: number
  /** Có phần là hàng ĐỔI (giao cho khách thay hàng trả). */
  hasExchange: boolean
  /** Tồn kho bán, đơn vị cơ sở. `null` = không đọc được. */
  availableBase: number | null
  /** Thiếu bao nhiêu (đơn vị cơ sở) so với tồn; 0 = đủ. */
  shortBase: number
  details: PickDetail[]
}

export interface ProductUnits {
  base_unit: string
  units?: ReadonlyArray<{ unit_name: string; conversion: number | string }> | null
}

/** Tách tổng (đơn vị cơ sở) thành các đơn vị lớn → nhỏ: 77 hộp, thùng=24 → 3 thùng 5 hộp. */
export function tachDonVi(totalBase: number, p: ProductUnits | null | undefined, baseUnit: string): Array<{ unitName: string; qty: number }> {
  const lon = (p?.units ?? [])
    .map((u) => ({ unitName: u.unit_name, conv: Number(u.conversion) || 0 }))
    .filter((u) => u.conv > 1 && u.unitName && u.unitName !== baseUnit)
    .sort((a, b) => b.conv - a.conv)
  const out: Array<{ unitName: string; qty: number }> = []
  let con = Math.round(totalBase * 1e6) / 1e6
  for (const u of lon) {
    const n = Math.floor(con / u.conv + 1e-9)
    if (n > 0) {
      out.push({ unitName: u.unitName, qty: n })
      con = Math.round((con - n * u.conv) * 1e6) / 1e6
    }
  }
  if (con > 0 || out.length === 0) out.push({ unitName: baseUnit, qty: con })
  return out
}

/** Chữ gọn cho một cách lấy hàng: "3 thùng 5 hộp". */
export function chuDonVi(parts: ReadonlyArray<{ unitName: string; qty: number }>): string {
  return parts.map((x) => `${fmt(x.qty)} ${x.unitName}`).join(" ")
}

function fmt(n: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(n)
}

/**
 * Gộp dòng còn phải xuất của nhiều đơn.
 *
 * ⚠ DÒNG ĐÃ XUẤT HẾT (`remainingQty <= 0`) BỎ QUA — tờ soạn hàng chỉ ghi thứ
 *   còn phải nhặt. Đơn không còn gì thì vẫn đếm là đơn đã chọn (màn nói rõ).
 */
export function gopSoanHang(
  donHang: ReadonlyArray<{ order: PickOrder; lines: ReadonlyArray<InvoiceableLine> }>,
  sanPham: Readonly<Record<string, ProductUnits>> = {}
): PickRow[] {
  const map = new Map<string, PickRow & { _orders: Set<string>; _units: Map<string, number> }>()
  for (const { order, lines } of donHang) {
    for (const l of lines) {
      const qty = Number(l.remainingQty) || 0
      if (qty <= 0 || !l.productId) continue
      const conv = Number(l.conversionFactor) > 0 ? Number(l.conversionFactor) : 1
      const p = sanPham[l.productId]
      let r = map.get(l.productId)
      if (!r) {
        const baseUnit = p?.base_unit || (conv === 1 ? l.unitName : "")
        r = {
          productId: l.productId,
          name: l.productName,
          sku: l.sku,
          baseUnit,
          totalBase: 0,
          byUnit: [],
          pick: [],
          orderCount: 0,
          hasExchange: false,
          availableBase: Number.isFinite(Number(l.availableBase)) ? Number(l.availableBase) : null,
          shortBase: 0,
          details: [],
          _orders: new Set(),
          _units: new Map(),
        }
        map.set(l.productId, r)
      }
      r.totalBase += qty * conv
      r._units.set(l.unitName, (r._units.get(l.unitName) ?? 0) + qty)
      r._orders.add(order.id)
      if (l.isExchange) r.hasExchange = true
      r.details.push({
        orderId: order.id,
        orderCode: order.code,
        customerName: order.customerName,
        unitName: l.unitName,
        qty,
        isExchange: l.isExchange,
      })
    }
  }
  const rows: PickRow[] = []
  for (const r of Array.from(map.values())) {
    const { _orders, _units, ...row } = r
    row.totalBase = Math.round(row.totalBase * 1e6) / 1e6
    row.orderCount = _orders.size
    row.byUnit = Array.from(_units, ([unitName, qty]) => ({ unitName, qty }))
    const baseUnit = row.baseUnit || row.byUnit[0]?.unitName || ""
    row.baseUnit = baseUnit
    row.pick = tachDonVi(row.totalBase, sanPham[row.productId], baseUnit)
    row.shortBase = row.availableBase == null ? 0 : Math.max(0, Math.round((row.totalBase - row.availableBase) * 1e6) / 1e6)
    rows.push(row)
  }
  return rows.sort((a, b) => (a.sku ?? a.name).localeCompare(b.sku ?? b.name, "vi"))
}

/** Trạng thái đơn còn hàng phải xuất — mặc định của ô tìm. */
export const TRANG_THAI_CAN_XUAT = ["submitted", "partially_invoiced"] as const

/** `?ids=a,b,c` → danh sách mã, bỏ trùng / rỗng. */
export function docIds(v: string | null | undefined): string[] {
  const out: string[] = []
  for (const s of (v ?? "").split(",")) {
    const t = s.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export const soanHangHref = (ids: readonly string[]) =>
  ids.length ? `/orders/soan-hang?ids=${ids.map(encodeURIComponent).join(",")}` : "/orders/soan-hang"
