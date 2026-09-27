/**
 * ĐẾM THEO TRẠNG THÁI TRONG MỘT LƯỢT (chủ nhà 27/09/2026 — log Supabase vượt gói: danh sách đơn
 * gửi 7 lượt HEAD, hoá đơn 3–6 lượt, chỉ để đếm số trên các chip trạng thái).
 *
 * PostgREST gom nhóm được: `select=status,count()` trả `[{ status, count }]` với ĐÚNG bộ lọc của
 * câu hỏi. Tính năng tắt sẵn trên Supabase — mig 206 bật (`pgrst.db_aggregates_enabled`). Chưa
 * bật thì PostgREST báo lỗi → trả `null` để nơi gọi đếm kiểu cũ (từng trạng thái một).
 */
export type DemNhom = Record<string, number>

/** Đọc kết quả `select=status,count()`. `null` = máy chủ chưa gom nhóm được (lùi về cách cũ). */
export function docDemNhom(kq: { data: unknown; error: unknown }): DemNhom | null {
  if (kq.error || !Array.isArray(kq.data)) return null
  const out: DemNhom = {}
  for (const r of kq.data as Array<{ status?: unknown; count?: unknown }>) {
    const n = Number(r?.count)
    if (r == null || typeof r.status !== "string" || r.count == null || !Number.isFinite(n)) return null
    out[r.status] = (out[r.status] ?? 0) + n
  }
  return out
}

/** Tổng mọi trạng thái. */
export const tongDem = (d: DemNhom) => Object.values(d).reduce((s, n) => s + n, 0)
