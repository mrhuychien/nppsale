/**
 * TỔNG / ĐẾM CỦA CẢ BỘ LỌC, GỘP NGAY TRÊN MÁY CHỦ — chủ nhà 01/11/2026: "tìm kiếm trong danh sách (đơn hàng, hóa đơn...)
 * nhiều khi còn chậm".
 *
 * Bản cũ tải MỌI dòng khớp bộ lọc về máy (1.000 dòng một câu, trần 20.000) rồi cộng: kỳ "Tất cả" là 20 câu rồi chạm trần
 * (dải tổng hiện "—", đếm theo tuyến thiếu), hoá đơn còn tra hàng trả nối đuôi 200 HĐ một câu — NVBH mở danh sách 86 câu /
 * 68 đợt, điện thoại ~10 giây. PostgREST gộp được: `<cột>.sum()`, `count()`, nhóm theo cột bảng nhúng
 * (`customer:customers!inner(channel)`); tiền "còn lại" của hoá đơn qua view `v_hoa_don_con_lai` (mig 257).
 *
 * ⚠ `null` = KHÔNG DÙNG ĐƯỢC KẾT QUẢ GỘP (đọc hỏng, máy chủ chưa bật gộp — mig 206, sổ chưa chạy 257, hình dạng lạ): nơi
 *   gọi LÙI VỀ CÁCH CŨ, không hiện số 0.
 */

interface KqGop {
  data: unknown
  error: { message?: string; code?: string } | null
}

/** `[{ sum, … }]` → tổng của mọi nhóm (`sum` null — không dòng nào khớp — là 0). Hình dạng lạ → `null`. */
export function docTongGop(data: unknown): number | null {
  if (!Array.isArray(data)) return null
  let tong = 0
  for (const r of data) {
    if (!r || typeof r !== "object" || !("sum" in r)) return null
    const v = (r as { sum: unknown }).sum
    if (v == null) continue
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    tong += n
  }
  return tong
}

/** `[{ count, customer: { channel } }]` → số dòng theo tuyến (bỏ nhóm không tuyến). Hình dạng lạ → `null`. */
export function docDemTheoTuyen(data: unknown, alias = "customer"): Record<string, number> | null {
  if (!Array.isArray(data)) return null
  const m: Record<string, number> = {}
  for (const r of data) {
    if (!r || typeof r !== "object" || !("count" in r)) return null
    const n = Number((r as { count: unknown }).count)
    if (!Number.isFinite(n)) return null
    const c = ((r as Record<string, unknown>)[alias] as { channel?: string | null } | null | undefined)?.channel
    if (c) m[c] = (m[c] ?? 0) + n
  }
  return m
}

/** Chạy một câu gộp. Lỗi / câu ném / hình dạng lạ → `null` (kèm ghi log) để nơi gọi lùi về cách cũ. */
export async function gopMayChu<T>(cau: PromiseLike<KqGop>, doc: (data: unknown) => T | null, ten: string): Promise<T | null> {
  try {
    const { data, error } = await cau
    if (error) {
      console.warn(`[${ten}] máy chủ chưa gộp được — đọc theo cách cũ:`, error.message ?? error)
      return null
    }
    const kq = doc(data)
    if (kq === null) console.warn(`[${ten}] kết quả gộp không đúng hình dạng — đọc theo cách cũ`)
    return kq
  } catch (e) {
    console.warn(`[${ten}] câu gộp hỏng — đọc theo cách cũ:`, e)
    return null
  }
}

/** Phần select nhóm theo tuyến của điểm bán — kèm `customer.channel=eq.X` khi đang lọc một tuyến. */
export const NHOM_TUYEN = "customer:customers!inner(channel)"
