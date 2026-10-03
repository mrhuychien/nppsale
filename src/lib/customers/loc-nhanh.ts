import { docTheoLoId } from "@/lib/supabase/aggregate"

/**
 * THẺ LỌC NHANH (Tuyến hôm nay / Nợ quá hạn / sắp "Nợ nhiều nhất") + BỘ LỌC KHÁC ở màn Khách hàng.
 *
 * ⚠ VÌ SAO (rà soát 03/10/2026): thẻ lọc nhanh cho sẵn một DANH SÁCH MÃ khách (`quickIds`). Bản cũ cắt 20 mã / trang
 *   rồi MỚI áp lọc NV / ô tìm / trạng thái / tuyến trên máy chủ cho 20 mã ấy — trang 1 thường chỉ còn 1–2 khách
 *   (hoặc trống), tổng số vẫn ghi độ dài `quickIds`, "Tải thêm" lật qua những trang rỗng.
 *   Nay: có bộ lọc khác → lọc TRÊN TOÀN BỘ danh sách mã trước (theo lô `docTheoLoId`, chỉ đọc `id`), rồi mới
 *   phân trang + đếm trên danh sách đã lọc. Thứ tự của `quickIds` (thứ tự ghé, nợ giảm dần) GIỮ NGUYÊN.
 */

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

/**
 * Giữ lại các mã của `ids` khớp bộ lọc (theo đúng thứ tự `ids`). `coLoc` false → trả nguyên `ids`, không đọc gì.
 * `dung(lo, from, to)` dựng truy vấn `customers` CHỈ CHỌN `id` (kèm bảng nhúng lọc NV nếu cần), đã gắn mọi bộ lọc,
 * `.in("id", lo)`, `count: "exact"`, `.order("id")` và `.range(from, to)`. Đọc hỏng thì NÉM.
 */
export async function locDanhSachMa(
  ids: readonly string[],
  coLoc: boolean,
  dung: (lo: string[], from: number, to: number) => Trang
): Promise<string[]> {
  if (!coLoc || ids.length === 0) return [...ids]
  const rows = await docTheoLoId<{ id: string }>(ids, dung, "Lọc khách theo thẻ lọc nhanh")
  const khop = new Set(rows.map((r) => r.id))
  return ids.filter((id) => khop.has(id))
}

/** Lát mã của một trang (`from`..`to` gồm cả hai đầu, như `.range`). */
export function catTrangMa(ids: readonly string[], from: number, to: number): string[] {
  return ids.slice(from, to + 1)
}

/** Xếp các dòng theo đúng thứ tự mã (`.in()` trả theo thứ tự của máy chủ, không theo danh sách gửi đi). */
export function xepTheoMa<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const viTri = new Map(ids.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => (viTri.get(a.id) ?? Infinity) - (viTri.get(b.id) ?? Infinity))
}
