/**
 * Màn DANH SÁCH PHIẾU KHO / CHI TIẾT PHIẾU trên điện thoại (thiết kế "ds-phieu-kho",
 * "chi-tiet-phieu", chủ nhà 30/09/2026) — nhãn, nhóm ngày, cộng số lượng.
 *
 * ⚠ SỐ LƯỢNG CỘNG QUA NHIỀU DÒNG PHẢI VỀ ĐƠN VỊ CƠ SỞ (CLAUDE.md "Quy đổi đơn vị"): ưu tiên
 *   `qty_in_base_uom` chụp trên dòng, không có thì `quantity × conversion_factor_snapshot`.
 *   Dòng kiểm kê: `quantity` là CHÊNH LỆCH có dấu theo đơn vị cơ sở (mig 123: + thừa, − hao hụt).
 */

import { vnDateKey } from "@/lib/orders/status-tone"

export type LoaiPhieu = "import" | "export" | "transfer" | "stocktake"

export interface DongSoLuong {
  quantity?: number | string | null
  qty_in_base_uom?: number | string | null
  conversion_factor_snapshot?: number | string | null
}

/** SL một dòng theo đơn vị cơ sở (không dấu). */
export function slCoSoDong(l: DongSoLuong): number {
  if (l.qty_in_base_uom != null && l.qty_in_base_uom !== "") return Math.abs(Number(l.qty_in_base_uom) || 0)
  const f = Number(l.conversion_factor_snapshot) > 0 ? Number(l.conversion_factor_snapshot) : 1
  return Math.abs(Number(l.quantity) || 0) * f
}

/**
 * Số lượng của cả phiếu, có dấu theo chiều kho: nhập +, xuất −, chuyển kho không dấu (tồn tổng
 * không đổi), kiểm kê = tổng chênh lệch có dấu. `null` khi phiếu chưa có dòng.
 */
export function soLuongPhieu(type: string, lines: readonly DongSoLuong[]): number | null {
  if (lines.length === 0) return null
  if (type === "stocktake") return lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const tong = lines.reduce((s, l) => s + slCoSoDong(l), 0)
  return type === "export" ? -tong : tong
}

/** "+12" · "−15" · "24" (chuyển kho) · "—" (chưa có dòng). */
export function nhanSoLuong(type: string, n: number | null): string {
  if (n == null) return "—"
  const so = Math.abs(Math.round(n * 100) / 100).toLocaleString("vi-VN")
  if (type === "transfer") return so
  if (n > 0) return `+${so}`
  if (n < 0) return `−${so}`
  return "0"
}

const THU = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"]

/** Nhãn nhóm ngày theo giờ VN: "Hôm nay", "Hôm qua", còn lại "Thứ Hai, 28/09/2026". */
export function nhanNgayPhieu(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "Không rõ ngày"
  const key = vnDateKey(new Date(iso))
  if (key === vnDateKey(now)) return "Hôm nay"
  if (key === vnDateKey(new Date(now.getTime() - 86_400_000))) return "Hôm qua"
  const [y, m, d] = key.split("-").map(Number)
  // Thứ trong tuần của NGÀY VN (dựng bằng UTC để không lệch múi giờ máy).
  const thu = THU[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${thu}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`
}

/** Nhóm theo ngày tạo (giờ VN), giữ nguyên thứ tự đầu vào (đã sắp mới trước). */
export function nhomPhieuTheoNgay<T extends { created_at?: string | null }>(
  rows: readonly T[],
  now: Date = new Date()
): Array<{ key: string; label: string; items: T[] }> {
  const out: Array<{ key: string; label: string; items: T[] }> = []
  const theoKhoa = new Map<string, { key: string; label: string; items: T[] }>()
  for (const r of rows) {
    const key = r.created_at ? vnDateKey(new Date(r.created_at)) : ""
    let g = theoKhoa.get(key)
    if (!g) {
      g = { key, label: nhanNgayPhieu(r.created_at, now), items: [] }
      theoKhoa.set(key, g)
      out.push(g)
    }
    g.items.push(r)
  }
  return out
}

export type TonePhieu = "xanh" | "vang" | "xam" | "do"

/** Nhãn trạng thái một dòng phiếu. "Chờ duyệt" chỉ cho kiểm kê nháp (duyệt ở /inventory/adjustments). */
export function trangThaiPhieu(type: string, status: string | null | undefined): { label: string; tone: TonePhieu } {
  const s = status || "posted"
  if (s === "cancelled") return { label: "Đã huỷ", tone: "do" }
  if (s === "draft") return type === "stocktake" ? { label: "Chờ duyệt", tone: "vang" } : { label: "Nháp", tone: "xam" }
  return type === "stocktake" ? { label: "Đã duyệt", tone: "xanh" } : { label: "Đã ghi sổ", tone: "xanh" }
}

export function nhanKho(zone: string | null | undefined): string {
  return zone === "date" ? "Kho date" : "Kho bán"
}

/** Dòng phụ: chuyển kho "Kho date → Kho bán · 4 SKU"; còn lại ghi chú (hoặc "N dòng") · người tạo. */
export function dongPhuPhieu(e: {
  type: string
  notes?: string | null
  warehouse_zone?: string | null
  dest_warehouse_zone?: string | null
  creator?: { full_name?: string | null } | null
}, soDong: number | null, soSku: number | null): string {
  if (e.type === "transfer") {
    const tuyen = `${nhanKho(e.warehouse_zone)} → ${nhanKho(e.dest_warehouse_zone)}`
    return soSku ? `${tuyen} · ${soSku} SKU` : tuyen
  }
  const dau = e.notes?.trim() || (soDong != null ? `${soDong} dòng` : "")
  return [dau, e.creator?.full_name].filter(Boolean).join(" · ")
}

/** Băng trạng thái đầu màn chi tiết. */
export function bangTrangThai(type: string, status: string | null | undefined): { text: string; tone: TonePhieu } {
  const s = status || "posted"
  if (s === "cancelled") return { text: "Phiếu đã huỷ · kho đã hoàn lại (nếu từng ghi sổ)", tone: "do" }
  if (s === "draft") {
    return type === "stocktake"
      ? { text: "Chờ duyệt · tồn kho chưa cập nhật đến khi duyệt", tone: "vang" }
      : { text: "Nháp · tồn kho chưa đổi", tone: "vang" }
  }
  switch (type) {
    case "export": return { text: "Đã bàn giao cho lái xe · tồn kho đã trừ", tone: "xanh" }
    case "import": return { text: "Đã ghi sổ · tồn kho đã cộng", tone: "xanh" }
    case "transfer": return { text: "Đã ghi sổ · hàng đã chuyển kho", tone: "xanh" }
    default: return { text: "Đã duyệt · tồn kho đã điều chỉnh", tone: "xanh" }
  }
}

export function nhanTongSoLuong(type: string): string {
  switch (type) {
    case "export": return "Tổng xuất"
    case "import": return "Tổng nhập"
    case "transfer": return "Tổng chuyển"
    default: return "Chênh lệch"
  }
}

/**
 * Ô "Sản phẩm N SKU" + "Tổng xuất 15 gói": đếm mã khác nhau, cộng SL cơ sở. Đơn vị chỉ ghi khi
 * mọi dòng CÙNG đơn vị cơ sở — khác nhau thì ghi "đơn vị" (cộng gói với hộp mà ghi "gói" là sai).
 */
export function tomTatDong(
  type: string,
  lines: ReadonlyArray<DongSoLuong & { product_id?: string | null; product?: { base_unit?: string | null } | null }>
): { soSku: number; tong: number; donVi: string } {
  const ma = new Set(lines.map((l) => l.product_id).filter(Boolean) as string[])
  const dv = new Set(lines.map((l) => l.product?.base_unit || ""))
  const tong = type === "stocktake"
    ? lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
    : lines.reduce((s, l) => s + slCoSoDong(l), 0)
  const motDv = dv.size === 1 ? Array.from(dv)[0] : ""
  return { soSku: ma.size, tong, donVi: motDv || "đơn vị" }
}
