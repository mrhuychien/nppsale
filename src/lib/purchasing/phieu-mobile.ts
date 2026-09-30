/**
 * PHIẾU NHẬP HÀNG / TRẢ HÀNG NCC TRÊN ĐIỆN THOẠI — luật của giỏ, tách khỏi giao diện.
 *
 * Chủ nhà 30/09/2026: "Làm màn nhập hàng, trả hàng NCC (vẫn giữ 2 màn riêng nhé) trên di
 * động giống màn làm đơn hàng trên di động". Màn làm đơn (/sell) thêm hàng bằng cách CHẠM
 * THẺ (+1 ở đơn vị đang chọn), bộ − số + trên thẻ, dòng gộp theo (mặt hàng, đơn vị). Ở đây
 * làm y như vậy trên dòng `ReceiptLine` của phiếu nhập / phiếu trả — cùng kiểu dòng với
 * biểu mẫu máy tính và POS, nên lưu xuống vẫn qua `saveReceiptLines` / `saveReturnLines`.
 *
 * ⚠ GIÁ THEO ĐÚNG ĐƠN VỊ. `products.cost_price` là giá mỗi đơn vị CƠ SỞ; dòng tính tiền
 *   = SL × giá, nên thêm 1 thùng 24 thì giá gợi ý là giá lon × 24 (CLAUDE.md: "giá phải
 *   là giá của đúng đơn vị đó").
 */

import { lineFromProduct, unitPatch, type ReceiptLine, type ReceiptProduct } from "./receipt-form"

const so = (s: string | number | null | undefined): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Các đơn vị của một mặt hàng: đơn vị cơ sở trước, rồi đơn vị quy đổi (bỏ trùng). */
export function donViNhap(p: Pick<ReceiptProduct, "base_unit" | "units">): string[] {
  const out = [p.base_unit]
  for (const u of p.units ?? []) {
    if (u.unit_name && !out.includes(u.unit_name)) out.push(u.unit_name)
  }
  return out
}

/** Hệ số quy đổi của đơn vị (đơn vị cơ sở luôn là 1). */
export function heSoDonVi(p: Pick<ReceiptProduct, "base_unit" | "units">, unit: string): number {
  if (unit === p.base_unit) return 1
  const u = (p.units ?? []).find((x) => x.unit_name === unit)
  return u && so(u.conversion) > 0 ? so(u.conversion) : 1
}

/** Giá nhập gợi ý ở đơn vị này = giá vốn đơn vị cơ sở × hệ số; chưa có giá vốn → 0. */
export function giaGoiY(p: Pick<ReceiptProduct, "base_unit" | "units" | "cost_price">, unit: string): number {
  const c = so(p.cost_price)
  return c > 0 ? Math.round(c * heSoDonVi(p, unit)) : 0
}

/** Vị trí dòng của (mặt hàng, đơn vị) trên phiếu, −1 nếu chưa có. */
export function viTriDong(lines: readonly ReceiptLine[], productId: string, unit: string): number {
  return lines.findIndex((l) => l.product_id === productId && l.unit_name === unit)
}

/** Số lượng đang có trên phiếu ở đúng đơn vị (0 nếu chưa có). */
export function soLuongTrenPhieu(lines: readonly ReceiptLine[], productId: string, unit: string): number {
  const i = viTriDong(lines, productId, unit)
  return i < 0 ? 0 : so(lines[i].quantity)
}

/**
 * +1 / −1 (hoặc bước bất kỳ) cho (mặt hàng, đơn vị). Chưa có dòng mà tăng → thêm dòng mới
 * với giá gợi ý của đơn vị; về 0 → bỏ dòng. Trả MẢNG MỚI, không sửa mảng cũ.
 */
export function buocSoLuong(
  lines: readonly ReceiptLine[],
  p: ReceiptProduct,
  unit: string,
  delta: number,
  seq: number
): ReceiptLine[] {
  const i = viTriDong(lines, p.id, unit)
  if (i < 0) {
    if (delta <= 0) return [...lines]
    const moi = lineFromProduct(p, seq)
    const gia = giaGoiY(p, unit)
    return [
      ...lines,
      {
        ...moi,
        ...unitPatch(moi, unit),
        quantity: String(delta),
        unit_price: gia > 0 ? String(gia) : "",
      },
    ]
  }
  const sl = Math.max(0, so(lines[i].quantity) + delta)
  if (sl <= 0) return lines.filter((_, k) => k !== i)
  return lines.map((l, k) => (k === i ? { ...l, quantity: String(sl) } : l))
}

/** Đặt thẳng số lượng của một dòng; ≤ 0 là bỏ dòng. */
export function datSoLuong(lines: readonly ReceiptLine[], i: number, sl: number): ReceiptLine[] {
  if (!(sl > 0)) return lines.filter((_, k) => k !== i)
  return lines.map((l, k) => (k === i ? { ...l, quantity: String(sl) } : l))
}

/**
 * Đổi đơn vị của một dòng từ sheet sửa dòng.
 *
 * ⚠ GIÁ ĐANG LÀ GIÁ GỢI Ý CỦA ĐƠN VỊ CŨ thì đổi theo sang đơn vị mới; người dùng đã gõ giá
 *   theo hoá đơn NCC thì GIỮ NGUYÊN — đổi âm thầm là ghi sai giá vốn.
 * ⚠ ĐÃ CÓ DÒNG CÙNG (mặt hàng, đơn vị mới) thì GỘP số lượng vào dòng đó — hai dòng cùng
 *   khoá thì bộ − số + trên thẻ không biết sửa dòng nào.
 */
export function doiDonViDong(lines: readonly ReceiptLine[], i: number, p: ReceiptProduct, unit: string): ReceiptLine[] {
  const l = lines[i]
  if (!l || l.unit_name === unit) return [...lines]
  const giaCu = giaGoiY(p, l.unit_name)
  const theoGoiY = l.unit_price === "" || (giaCu > 0 && so(l.unit_price) === giaCu)
  const giaMoi = giaGoiY(p, unit)
  const trung = viTriDong(lines, l.product_id, unit)
  if (trung >= 0) {
    const cong = so(lines[trung].quantity) + so(l.quantity)
    return lines
      .map((x, k) => (k === trung ? { ...x, quantity: String(cong) } : x))
      .filter((_, k) => k !== i)
  }
  return lines.map((x, k) =>
    k === i
      ? { ...x, ...unitPatch(x, unit), unit_price: theoGoiY ? (giaMoi > 0 ? String(giaMoi) : "") : x.unit_price }
      : x
  )
}

/** Tổng số đơn vị trên phiếu (đếm theo đơn vị của từng dòng, như thanh đáy /sell). */
export function tongSoLuong(lines: readonly ReceiptLine[]): number {
  return lines.reduce((s, l) => s + so(l.quantity), 0)
}

/** Dòng chưa có giá — phiếu nhập hoàn thành với giá 0 là ghi giá vốn 0. */
export function dongChuaCoGia(lines: readonly ReceiptLine[]): number {
  return lines.filter((l) => so(l.quantity) > 0 && !(so(l.unit_price) > 0)).length
}
