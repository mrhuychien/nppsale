/**
 * HÀNG ĐỔI TRÊN HÓA ĐƠN — DỰNG TỪ KHỐI HÀNG ĐỔI TRẢ, MỘT NGUỒN.
 *
 * ⚠ CHỦ NHÀ BÁO 23/09/2026: "khi thay đổi hàng đổi, phần hàng đổi tự thêm trên
 *   hoá đơn ko thay đổi cùng (sửa số lượng, sửa quy cách, xoá dòng…)".
 *
 * Hàng đổi nằm ở HAI nơi trong sổ: dòng `return_lines.is_exchange` (khách đổi
 * lấy gì) và dòng `sales_invoice_lines.is_exchange` giá 0 (hàng ấy RỜI KHO
 * trong chuyến này). Màn cũ giữ chúng thành hai bảng rời, sửa bảng này bảng
 * kia đứng yên — và hàng đổi THÊM MỚI chỉ vào phiếu trả, không có dòng hóa
 * đơn nào nên KHÔNG trừ kho.
 *
 * Nay dòng hóa đơn hàng đổi luôn DỰNG LẠI từ khối hàng đổi trả lúc lưu: số
 * lượng, quy cách, xoá dòng đi theo một chỗ.
 */
import type { InvoiceDraftLine } from "@/lib/orders/post-invoice"

export interface NguonHangDoi {
  productId: string
  unit: string
  qty: number
}

/** Dòng hóa đơn giá 0 cho hàng đổi — hệ số tra danh mục (máy chủ tra lại, mig 174). */
export function dongHangDoi(
  src: readonly NguonHangDoi[],
  heSo: (productId: string, unit: string) => number
): InvoiceDraftLine[] {
  return src
    .filter((s) => s.productId && s.qty > 0)
    .map((s) => ({
      orderLineId: null,
      productId: s.productId,
      unitName: s.unit,
      conversionFactor: heSo(s.productId, s.unit) || 1,
      quantity: s.qty,
      unitPrice: 0,
      lineDiscount: 0,
      vatRate: 0,
      isExchange: true,
      note: "[Exchange]",
    }))
}

/**
 * Giá dòng trả khi đổi quy cách — THEO HỆ SỐ, đúng phép máy chủ làm
 * (`_apply_return_edits`, mig 181): giá mới = giá cũ × hệ số mới / hệ số cũ,
 * làm tròn 2 chữ số.
 */
export function giaTheoHeSo(gia: number, heSoCu: number, heSoMoi: number): number {
  if (!(heSoCu > 0) || !(heSoMoi > 0)) return gia
  return Math.round(((gia * heSoMoi) / heSoCu) * 100) / 100
}
