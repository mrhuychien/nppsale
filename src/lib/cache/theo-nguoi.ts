import { resetSellRefData } from "@/lib/sell/ref-store"
import { xoaNhoNen } from "@/lib/cache/nho-nen"

/**
 * ĐỔI NGƯỜI TRÊN CÙNG TAB → XOÁ DANH MỤC NHỚ TRONG RAM (chủ nhà 23/10/2026 "Làm nốt").
 *
 * ⚠ Đăng xuất / đăng nhập là chuyển trang MỀM — bộ nhớ trong RAM còn nguyên. Không xoá thì người đăng nhập sau thấy
 *   danh mục bán (khách, bảng giá theo RLS) và danh sách khách ở ô lọc của người trước, có khi không hỏi lại máy chủ.
 *   Bản lưu IndexedDB đã mang `uid` (xem `cuaNguoiKhac` ở `@/lib/sell/ref-data`).
 */
export function xoaNhoTheoNguoi(): void {
  resetSellRefData()
  xoaNhoNen()
}

/** Có phải đổi người không: `truoc === undefined` = sự kiện phiên đầu của tab (chưa có ai trước để so). */
export function laDoiNguoi(truoc: string | null | undefined, sau: string | null): boolean {
  return truoc !== undefined && truoc !== sau
}
