/**
 * Lỗi "sổ chưa có RPC" — PostgREST báo PGRST202 / 404 / "Could not find the function" / "does not exist" khi màn gọi một
 * hàm mà chủ nhà chưa chạy migration. Màn nào có đường cũ thì lùi về đường cũ, không phải lỗi để báo người dùng.
 * Lỗi khác (quyền, mạng, hết giờ) KHÔNG phải — nuốt là giấu lỗi thật.
 */
export function chuaCoRpc(e: unknown): boolean {
  const x = (e ?? {}) as { message?: unknown; code?: unknown }
  const m = `${String(x.code ?? "")} ${String(x.message ?? "")}`
  return /PGRST202|Could not find the function|does not exist|\b404\b/i.test(m)
}
