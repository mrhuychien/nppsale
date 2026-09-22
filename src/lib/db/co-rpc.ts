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
