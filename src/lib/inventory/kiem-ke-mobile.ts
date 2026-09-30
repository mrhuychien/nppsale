/**
 * LOGIC THUẦN CHO HAI MÀN KIỂM KÊ TRÊN ĐIỆN THOẠI — chủ nhà 30/09/2026 gửi thiết kế "Kiểm kê" và
 * "Duyệt điều chỉnh". Hai màn máy tính dùng chung các hàm này, nên số trên điện thoại và máy tính
 * là MỘT phép tính (không đổi cách tính cũ: chênh × giá vốn lô, `unit_cost` là giá mỗi đơn vị cơ sở).
 */

/** Một dòng đang đếm ở màn Kiểm kê (`/inventory/stocktake-adjust`). */
export interface DongKiemKe {
  systemQty: number
  /** Chuỗi người dùng gõ; "" = chưa đếm. */
  actualQty: string
  /** Giá vốn lô chính (mỗi đơn vị cơ sở). */
  batchCost: number
}

/** Chênh của một dòng (thực tế − hệ thống); `null` = chưa đếm / gõ sai. */
export function chenhCuaDong(r: Pick<DongKiemKe, "systemQty" | "actualQty">): number | null {
  if (r.actualQty.trim() === "") return null
  const actual = parseFloat(r.actualQty)
  if (isNaN(actual)) return null
  return actual - r.systemQty
}

export interface TomTatKiemKe {
  shrinkageQty: number
  shrinkageValue: number
  surplusQty: number
  surplusValue: number
  totalDiffValue: number
  rowsWithDiff: number
  /** Số dòng đã nhập số đếm hợp lệ (kể cả khớp). */
  daDem: number
  tongDong: number
}

export function tomTatKiemKe(rows: DongKiemKe[]): TomTatKiemKe {
  let shrinkageQty = 0
  let shrinkageValue = 0
  let surplusQty = 0
  let surplusValue = 0
  let totalDiffValue = 0
  let rowsWithDiff = 0
  let daDem = 0
  for (const r of rows) {
    const diff = chenhCuaDong(r)
    if (diff === null) continue
    daDem += 1
    const diffValue = diff * r.batchCost
    if (diff !== 0) rowsWithDiff += 1
    if (diff < 0) {
      shrinkageQty += -diff
      shrinkageValue += -diffValue
    } else if (diff > 0) {
      surplusQty += diff
      surplusValue += diffValue
    }
    totalDiffValue += diffValue
  }
  return { shrinkageQty, shrinkageValue, surplusQty, surplusValue, totalDiffValue, rowsWithDiff, daDem, tongDong: rows.length }
}

/** Nhãn + khoá của nút chính ở thanh đáy màn Kiểm kê. */
export function nutGuiKiemKe(t: Pick<TomTatKiemKe, "daDem" | "rowsWithDiff" | "tongDong">, saving: boolean): {
  nhan: string
  khoa: boolean
} {
  if (saving) return { nhan: "Đang gửi…", khoa: true }
  if (t.tongDong === 0) return { nhan: "Thêm sản phẩm để kiểm", khoa: true }
  if (t.daDem === 0) return { nhan: "Nhập tồn thực tế để gửi", khoa: true }
  if (t.rowsWithDiff === 0) return { nhan: "Không có chênh lệch", khoa: true }
  return { nhan: `Gửi duyệt (${t.rowsWithDiff} chênh lệch)`, khoa: false }
}

/** Dòng của phiếu kiểm kê đã lưu (`stock_entry_lines`). */
export interface DongPhieuDieuChinh {
  quantity: number | string
  unit_cost: number | string | null
}

export interface TomTatPhieuDieuChinh {
  shrinkQty: number
  shrinkValue: number
  surplusQty: number
  surplusValue: number
  netValue: number
}

/** Như `summarize` cũ của màn Duyệt điều chỉnh: |SL| × giá vốn dòng. */
export function tomTatPhieuDieuChinh(lines: DongPhieuDieuChinh[]): TomTatPhieuDieuChinh {
  let shrinkQty = 0
  let shrinkValue = 0
  let surplusQty = 0
  let surplusValue = 0
  for (const l of lines) {
    const qty = Number(l.quantity)
    const cost = Number(l.unit_cost) || 0
    const value = Math.abs(qty) * cost
    if (qty < 0) {
      shrinkQty += -qty
      shrinkValue += value
    } else if (qty > 0) {
      surplusQty += qty
      surplusValue += value
    }
  }
  return { shrinkQty, shrinkValue, surplusQty, surplusValue, netValue: surplusValue - shrinkValue }
}

/** Có dòng THỪA mà chưa có giá vốn → giá trị thừa đang hiện 0đ (cảnh báo vàng). */
export function coThuaChuaGiaVon(lines: DongPhieuDieuChinh[]): boolean {
  return lines.some((l) => Number(l.quantity) > 0 && !(Number(l.unit_cost) > 0))
}

/** "+12" / "-3" / "0" — số lượng có dấu. */
export function soCoDau(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `-${Math.abs(n)}`
  return "0"
}
