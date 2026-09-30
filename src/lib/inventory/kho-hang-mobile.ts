/**
 * Màn KHO HÀNG trên điện thoại (thiết kế "quan-ly-kho", chủ nhà 30/09/2026) — phần tính thuần.
 * Số lượng đều là ĐƠN VỊ CƠ SỞ (`batches.qty_on_hand`, `v_stock_balance_by_zone.qty_in_base_uom`);
 * giá trị = SL cơ sở × `unit_cost` (giá mỗi đơn vị cơ sở) — không đổi cách tính của trang.
 */

/** "257 SKU · 15.402 đơn vị": đếm mã còn tồn và cộng SL cơ sở trên các lô còn hàng. */
export function tomTatTonKho(
  lo: ReadonlyArray<{ product_id?: string | null; qty_on_hand?: number | string | null }>
): { soSku: number; soDonVi: number } {
  const ma = new Set<string>()
  let soDonVi = 0
  for (const b of lo) {
    const q = Number(b.qty_on_hand) || 0
    if (q <= 0) continue
    soDonVi += q
    if (b.product_id) ma.add(b.product_id)
  }
  return { soSku: ma.size, soDonVi }
}

/** Dòng cảnh báo dưới thẻ giá trị — `null` khi không có lô nào phải lo. */
export function canhBaoLo(sapHetHan: number, canDay: number): string | null {
  const phan: string[] = []
  if (sapHetHan > 0) phan.push(`${sapHetHan} lô sắp hết hạn`)
  if (canDay > 0) phan.push(`${canDay} lô cần đẩy hàng`)
  return phan.length ? phan.join(" · ") : null
}

export type SapXepTon = "ten" | "gia-tri" | "so-luong"

export const SAP_XEP_TON: ReadonlyArray<{ key: SapXepTon; label: string }> = [
  { key: "ten", label: "Tên A–Z" },
  { key: "gia-tri", label: "Giá trị cao" },
  { key: "so-luong", label: "Tồn nhiều" },
]

/** Bấm chip "Sắp xếp" → sang cách kế tiếp (vòng lại). */
export function sapXepKeTiep(k: SapXepTon): SapXepTon {
  const i = SAP_XEP_TON.findIndex((x) => x.key === k)
  return SAP_XEP_TON[(i + 1) % SAP_XEP_TON.length].key
}

export function nhanSapXep(k: SapXepTon): string {
  return SAP_XEP_TON.find((x) => x.key === k)?.label ?? SAP_XEP_TON[0].label
}

/** Sắp danh sách tồn — tên theo `localeCompare("vi")`, số lớn trước; trùng thì theo tên. Không đổi mảng gốc. */
export function sapXepTon<T extends { product: { name: string }; totalQty: number; totalValue: number }>(
  rows: readonly T[],
  k: SapXepTon
): T[] {
  const theoTen = (a: T, b: T) => a.product.name.localeCompare(b.product.name, "vi")
  const arr = [...rows]
  if (k === "gia-tri") return arr.sort((a, b) => b.totalValue - a.totalValue || theoTen(a, b))
  if (k === "so-luong") return arr.sort((a, b) => b.totalQty - a.totalQty || theoTen(a, b))
  return arr.sort(theoTen)
}
