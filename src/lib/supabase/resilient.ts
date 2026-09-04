/**
 * Truy vấn Supabase có khả năng chịu lỗi — dùng cho các trang danh sách.
 *
 * Giải quyết 2 chế độ hỏng đã gặp trên production:
 *
 * 1. LỆCH SCHEMA. Sau khi chuyển từ select('*') sang liệt kê cột tường
 *    minh, nếu DB production thiếu dù chỉ 1 cột (migration chưa chạy đủ)
 *    thì PostgREST trả 400 và toàn bộ danh sách rỗng. Helper tự thử lại
 *    bằng select dự phòng ('*') nên trang vẫn dùng được.
 *
 * 2. RỖNG IM LẶNG. Nhiều trang viết `const { data } = await q` — bỏ qua
 *    `error` → người dùng thấy "không có dữ liệu" thay vì thấy lỗi thật.
 *    Helper luôn trả `error` để trang hiển thị nguyên nhân.
 */

interface QueryResult {
  data: unknown
  error: { message?: string; code?: string } | null
  count?: number | null
}

export interface ResilientResult<T> {
  data: T[]
  count: number | null
  /** Thông báo lỗi thân thiện (tiếng Việt) — null nếu thành công. */
  error: string | null
  /** True khi đã phải dùng select dự phòng vì DB thiếu cột. */
  usedFallback: boolean
  /**
   * True khi request bị HUỶ (người dùng điều hướng đi chỗ khác).
   *
   * Đây KHÔNG phải lỗi: không có gì hỏng, chỉ là câu hỏi không còn ai cần
   * câu trả lời. Trang gọi phải `return` sớm khi thấy cờ này — vừa để
   * không hiện thẻ đỏ "signal is aborted without reason" vào mặt người
   * dùng, vừa để không ghi mảng rỗng đè lên danh sách đang hiển thị.
   */
  aborted?: boolean
}

/** Lỗi do huỷ request, không phải hỏng hóc. */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { name?: unknown; message?: unknown }
  if (e.name === "AbortError") return true
  return typeof e.message === "string" && e.message.includes("aborted")
}

/** Lỗi do DB thiếu cột / quan hệ (lệch schema) — đáng thử lại với '*'. */
function isSchemaMismatch(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const code = err.code || ""
  const msg = (err.message || "").toLowerCase()
  return (
    code === "42703" || // undefined_column
    code === "42P01" || // undefined_table
    code === "PGRST204" || // column not found in schema cache
    code === "PGRST200" || // quan hệ embed không tìm thấy
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("schema cache")
  )
}

function friendlyError(err: { message?: string; code?: string }): string {
  const msg = err.message || "Lỗi không xác định"
  if (isSchemaMismatch(err)) {
    return `Cơ sở dữ liệu thiếu cột/quan hệ so với phiên bản ứng dụng (${msg}). Cần chạy migration còn thiếu.`
  }
  return msg
}

/**
 * Chạy `build(select)` với chuỗi cột tường minh; nếu lỗi do lệch schema
 * thì chạy lại với `fallbackSelect`.
 *
 * @param build          Hàm dựng query hoàn chỉnh từ chuỗi select (đặt
 *                       mọi filter/order/range bên trong).
 * @param select         Chuỗi cột tường minh (đường đi chính).
 * @param fallbackSelect Chuỗi dự phòng, thường là "*, embed(...)".
 */
export async function selectResilient<T>(
  build: (select: string) => PromiseLike<QueryResult>,
  select: string,
  fallbackSelect: string
): Promise<ResilientResult<T>> {
  let res: QueryResult
  try {
    res = await build(select)
  } catch (err) {
    if (isAbortError(err)) {
      return { data: [], count: null, error: null, usedFallback: false, aborted: true }
    }
    return {
      data: [],
      count: null,
      error: err instanceof Error ? err.message : "Lỗi kết nối",
      usedFallback: false,
    }
  }

  if (res.error && isSchemaMismatch(res.error)) {
    console.error("[selectResilient] schema mismatch, retrying with fallback:", res.error.message)
    try {
      const retry = await build(fallbackSelect)
      if (!retry.error) {
        return {
          data: (retry.data as T[]) || [],
          count: retry.count ?? null,
          error: null,
          usedFallback: true,
        }
      }
      return {
        data: [],
        count: null,
        error: friendlyError(retry.error),
        usedFallback: true,
      }
    } catch (err) {
      return {
        data: [],
        count: null,
        error: err instanceof Error ? err.message : "Lỗi kết nối",
        usedFallback: true,
      }
    }
  }

  if (res.error) {
    return { data: [], count: null, error: friendlyError(res.error), usedFallback: false }
  }

  return {
    data: (res.data as T[]) || [],
    count: res.count ?? null,
    error: null,
    usedFallback: false,
  }
}
