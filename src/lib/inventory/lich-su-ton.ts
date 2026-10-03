/**
 * Lịch sử tồn kho của một mặt hàng (ngăn kéo "Lịch sử" ở bảng tồn) — phần tính thuần.
 *
 * ⚠ RÀ SOÁT 03/10/2026. Bản cũ đọc 500 giao dịch MỚI NHẤT rồi mới lọc ngày / kho trong trình
 *   duyệt, và cộng cột "Tồn sau" TỪ 0 trên đúng 500 dòng ấy:
 *   - mặt hàng có > 500 lần nhập/xuất: lọc một khoảng cũ ra rỗng (dòng cũ không hề được tải);
 *   - "Tồn sau" không cộng phần tồn TRƯỚC dòng đầu tiên đang hiện → lọc "Từ ngày" là số tồn bắt
 *     đầu lại từ 0, lệch đúng bằng tồn đầu kỳ.
 *   Nay: máy chủ lọc kho + mốc "Đến ngày" (đọc đủ theo trang), "Tồn sau" cộng dồn từ GIAO DỊCH
 *   ĐẦU TIÊN của mặt hàng — các dòng trước "Từ ngày" chỉ góp vào tồn đầu kỳ, không hiện.
 */

/** Mốc giờ Việt Nam của một ngày lịch (`YYYY-MM-DD`) — cùng luật `vnDayRange`. */
export function dauNgayVn(ngay: string): string {
  return `${ngay}T00:00:00+07:00`
}
export function cuoiNgayVn(ngay: string): string {
  return `${ngay}T23:59:59.999+07:00`
}

/**
 * Điều kiện `.or(...)` cho "Đến ngày": phiếu có `posted_at` thì so `posted_at`, phiếu cũ không có
 * `posted_at` thì so `created_at` — đúng mốc ngày mà ngăn kéo vẫn hiện (`posted_at || created_at`).
 */
export function dieuKienDenNgay(ngay: string): string {
  const moc = `"${cuoiNgayVn(ngay)}"`
  return `posted_at.lte.${moc},and(posted_at.is.null,created_at.lte.${moc})`
}

export interface DongBienDong {
  id: string
  warehouse_zone: "sale" | "date"
  posted_at: string | null
  created_at: string
  signed_qty_in_base_uom: number
}

function moc(r: DongBienDong): number {
  return new Date(r.posted_at || r.created_at).getTime()
}

/**
 * @param rows   mọi giao dịch (đã ghi sổ) của mặt hàng tới hết "Đến ngày", thứ tự bất kỳ.
 * @param tuNgay "Từ ngày" (`YYYY-MM-DD`) hoặc rỗng.
 * @returns các dòng TRONG KỲ, MỚI NHẤT TRƯỚC, kèm tồn sau theo đúng kho của dòng; và tồn đầu kỳ.
 */
export function tonSauTheoKho<T extends DongBienDong>(
  rows: readonly T[],
  tuNgay: string
): { dong: Array<T & { tonSau: number }>; dauKy: { sale: number; date: number } } {
  const tu = tuNgay ? new Date(dauNgayVn(tuNgay)).getTime() : -Infinity
  const xep = [...rows].sort((a, b) => moc(a) - moc(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ton = { sale: 0, date: 0 }
  const dauKy = { sale: 0, date: 0 }
  const dong: Array<T & { tonSau: number }> = []
  for (const r of xep) {
    const kho = r.warehouse_zone === "date" ? "date" : "sale"
    ton[kho] += Number(r.signed_qty_in_base_uom) || 0
    if (moc(r) < tu) {
      dauKy[kho] = ton[kho]
      continue
    }
    dong.push({ ...r, tonSau: ton[kho] })
  }
  return { dong: dong.reverse(), dauKy }
}
