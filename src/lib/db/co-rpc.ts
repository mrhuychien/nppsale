/**
 * Hình dạng tối thiểu của một client gọi được RPC. Nhận cấu trúc chứ không
 * nhận kiểu của thư viện để chốt gọi thẳng được bằng một object giả.
 */
export interface CoRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

/** `RETURNS TABLE` trả về MỘT MẢNG; lấy dòng đầu. */
export function dongDau<T>(data: unknown): T | undefined {
  return (Array.isArray(data) ? data[0] : data) as T | undefined
}

/**
 * Máy chủ báo THIẾU CỘT (42703 từ Postgres, PGRST204 từ PostgREST) — bản
 * web mới lên trước khi chủ nhà chạy migration thêm cột.
 *
 * ⚠ CHỈ DÙNG SAU MỘT RPC MỘT-GIAO-DỊCH. Hàm hỏng thì cả giao dịch lui,
 *   không còn gì nằm lại — nơi gọi rơi về đường cũ (vốn biết bỏ cột lạ)
 *   mà không sợ ghi trùng.
 */
export function mayChuThieuCot(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: string; message?: string }
  if (e.code === "42703" || e.code === "PGRST204") return true
  const m = (e.message || "").toLowerCase()
  return /column .* does not exist/.test(m)
}
