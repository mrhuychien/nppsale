/**
 * ĐẾM THEO TRẠNG THÁI TRONG MỘT LƯỢT (chủ nhà 27/09/2026 — log Supabase vượt gói: danh sách đơn
 * gửi 7 lượt HEAD, hoá đơn 3–6 lượt, chỉ để đếm số trên các chip trạng thái).
 *
 * PostgREST gom nhóm được: `select=status,count()` trả `[{ status, count }]` với ĐÚNG bộ lọc của
 * câu hỏi. Tính năng tắt sẵn trên Supabase — mig 206 bật (`pgrst.db_aggregates_enabled`). Chưa
 * bật thì PostgREST báo lỗi → trả `null` để nơi gọi đếm kiểu cũ (từng trạng thái một).
 */
export type DemNhom = Record<string, number>

/**
 * Đọc kết quả `select=<cot>,count()` gom theo một cột bất kỳ (trạng thái, lý do trả…). `null` = máy chủ chưa gom
 * nhóm được (lùi về cách cũ). `nullLa`: dòng có cột NULL gom vào khoá này (lý do trả bỏ trống); không truyền thì
 * NULL là dữ liệu lạ → `null`.
 */
export function docDemNhomTheo(cot: string, kq: { data: unknown; error: unknown }, nullLa?: string): DemNhom | null {
  if (kq.error || !Array.isArray(kq.data)) return null
  const out: DemNhom = {}
  for (const r of kq.data as Array<Record<string, unknown> | null>) {
    const n = Number(r?.count)
    if (r == null || r.count == null || !Number.isFinite(n)) return null
    const k = r[cot]
    const khoa = typeof k === "string" ? k : k == null && nullLa !== undefined ? nullLa : null
    if (khoa === null) return null
    out[khoa] = (out[khoa] ?? 0) + n
  }
  return out
}

/** Đọc kết quả `select=status,count()`. `null` = máy chủ chưa gom nhóm được (lùi về cách cũ). */
export function docDemNhom(kq: { data: unknown; error: unknown }): DemNhom | null {
  return docDemNhomTheo("status", kq)
}

/** Tổng mọi trạng thái. */
export const tongDem = (d: DemNhom) => Object.values(d).reduce((s, n) => s + n, 0)
