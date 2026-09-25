/**
 * PHIẾU SOẠN HÀNG — GỘP NHIỀU HÓA ĐƠN THÀNH MỘT ĐƠN TỔNG CHO KHO NHẶT.
 *
 * ⚠ CHỦ NHÀ 25/09/2026:
 *   · "Phát triển tính năng soạn đơn hàng, Cho phép gộp nhiều đơn hàng vào ->
 *     lượng hàng tổng cần xuất … máy sẽ tổng hợp và in ra."
 *   · "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng > mở ra chọn danh
 *     sách Hoá đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn tổng. Bỏ cái
 *     hiện tại trong đơn hàng đi."
 *
 * ⚠ NGUỒN LÀ DÒNG HÓA ĐƠN (`sales_invoice_lines`), KHÔNG PHẢI DÒNG ĐƠN. Hóa đơn là
 *   thứ thật sự lên xe: đơn xuất hai đợt thì mỗi hóa đơn chỉ mang phần của đợt ấy.
 *   Dòng HÀNG ĐỔI (`is_exchange`, đơn giá 0) cũng rời kho → tính vào, đánh dấu riêng.
 *
 * ⚠ CHỈ ĐỌC, KHÔNG GHI SỔ. Kho đã trừ lúc ghi sổ hóa đơn; tờ này chỉ để nhặt hàng.
 *
 * ⚠ CỘNG QUA NHIỀU DÒNG PHẢI QUY VỀ ĐƠN VỊ CƠ SỞ TRƯỚC (luật báo cáo 24/09/2026):
 *   3 thùng + 5 hộp không phải "8". Hệ số lấy trên dòng (`conversion_factor`).
 */

/** Chứng từ được gộp — ở đây là một hóa đơn. */
export interface PickDoc {
  id: string
  code: string
  customerName: string
}

/** Một dòng hàng của chứng từ, đã đọc sẵn tên / mã hàng. */
export interface PickLine {
  productId: string
  productName: string
  sku: string | null
  unitName: string
  conversionFactor: number
  qty: number
  isExchange: boolean
}

export interface PickDetail {
  docId: string
  docCode: string
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
  /** Tổng cần nhặt, ĐƠN VỊ CƠ SỞ. */
  totalBase: number
  /** Cộng theo đúng đơn vị trên hóa đơn ("thùng" → 3, "hộp" → 5). */
  byUnit: Array<{ unitName: string; qty: number }>
  /** Cách lấy hàng theo đơn vị lớn nhất trước — "3 thùng 5 hộp". */
  pick: Array<{ unitName: string; qty: number }>
  /** Số hóa đơn có mặt hàng này. */
  docCount: number
  /** Có phần là hàng ĐỔI (giao cho khách thay hàng trả). */
  hasExchange: boolean
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

/** Gộp dòng của nhiều hóa đơn thành đơn tổng — một dòng mỗi mặt hàng. */
export function gopSoanHang(
  chungTu: ReadonlyArray<{ doc: PickDoc; lines: ReadonlyArray<PickLine> }>,
  sanPham: Readonly<Record<string, ProductUnits>> = {}
): PickRow[] {
  const map = new Map<string, PickRow & { _docs: Set<string>; _units: Map<string, number> }>()
  for (const { doc, lines } of chungTu) {
    for (const l of lines) {
      const qty = Number(l.qty) || 0
      if (qty <= 0 || !l.productId) continue
      const conv = Number(l.conversionFactor) > 0 ? Number(l.conversionFactor) : 1
      const p = sanPham[l.productId]
      let r = map.get(l.productId)
      if (!r) {
        r = {
          productId: l.productId,
          name: l.productName,
          sku: l.sku,
          baseUnit: p?.base_unit || (conv === 1 ? l.unitName : ""),
          totalBase: 0,
          byUnit: [],
          pick: [],
          docCount: 0,
          hasExchange: false,
          details: [],
          _docs: new Set(),
          _units: new Map(),
        }
        map.set(l.productId, r)
      }
      /* Chưa biết đơn vị cơ sở mà gặp dòng hệ số 1 → đó chính là đơn vị cơ sở. */
      if (!r.baseUnit && conv === 1) r.baseUnit = l.unitName
      r.totalBase += qty * conv
      r._units.set(l.unitName, (r._units.get(l.unitName) ?? 0) + qty)
      r._docs.add(doc.id)
      if (l.isExchange) r.hasExchange = true
      r.details.push({ docId: doc.id, docCode: doc.code, customerName: doc.customerName, unitName: l.unitName, qty, isExchange: l.isExchange })
    }
  }
  const rows: PickRow[] = []
  for (const r of Array.from(map.values())) {
    const { _docs, _units, ...row } = r
    row.totalBase = Math.round(row.totalBase * 1e6) / 1e6
    row.docCount = _docs.size
    row.byUnit = Array.from(_units, ([unitName, qty]) => ({ unitName, qty }))
    /* ⚠ KHÔNG đoán bằng đơn vị của dòng đầu — dòng "thùng" đứng trước là tổng 48
       bị ghi thành "48 thùng". Không rõ thì nói rõ là đơn vị cơ sở. */
    row.baseUnit = row.baseUnit || "đv cơ sở"
    row.pick = tachDonVi(row.totalBase, sanPham[row.productId], row.baseUnit)
    rows.push(row)
  }
  return rows.sort((a, b) => (a.sku ?? a.name).localeCompare(b.sku ?? b.name, "vi"))
}

/** `?ids=a,b,c` → danh sách mã, bỏ trùng / rỗng. */
export function docIds(v: string | null | undefined): string[] {
  const out: string[] = []
  for (const s of (v ?? "").split(",")) {
    const t = s.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export const SOAN_HANG_HREF = "/inventory/soan-hang"
export const soanHangHref = (ids: readonly string[]) =>
  ids.length ? `${SOAN_HANG_HREF}?ids=${ids.map(encodeURIComponent).join(",")}` : SOAN_HANG_HREF
