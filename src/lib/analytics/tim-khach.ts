import { viMatchAllWords } from "@/lib/search"

/** Mã khách hiện ở báo cáo khách hàng: "KH" + 6 ký tự đầu của id. */
export function maKhachBaoCao(id: string): string {
  return `KH${id.slice(0, 6)}`
}

/**
 * Ô tìm của báo cáo khách hàng: khớp SĐT, tên cửa hàng và MÃ ĐANG HIỆN (`maKhachBaoCao`).
 * ⚠ Không khớp cả uuid: uuid có 32 ký tự hex, gõ "ba", "an", "c1"… là trúng chữ ẩn trong uuid của rất nhiều
 *   khách không liên quan (rà báo cáo 09/10/2026 — gõ "ba" ra ~13% số khách).
 */
export function khopTimKhach(search: string, c: { id: string; phone: string | null; store_name: string }): boolean {
  return viMatchAllWords(search, c.phone, c.store_name, maKhachBaoCao(c.id))
}
