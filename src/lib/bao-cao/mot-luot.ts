/**
 * ĐỌC MỘT LƯỢT QUA HÀM MÁY CHỦ (mig 204) — chủ nhà 27/09/2026 "muốn nhanh hơn nữa".
 *
 * Hàm máy chủ trả ĐÚNG CÁC DÒNG THÔ mà trình duyệt vẫn đọc từng bảng; phần tính vẫn là mã cũ,
 * nên số ra y hệt. Sổ CHƯA CHẠY mig 204 thì trả `null` → nơi gọi lùi về cách đọc cũ.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

interface LoiRpc {
  code?: string | null
  message?: string | null
}

/** Lỗi "chưa có hàm" (chưa chạy migration) — khác mọi lỗi khác (lỗi khác phải NÉM). */
export function laThieuHam(e: LoiRpc | null | undefined): boolean {
  if (!e) return false
  if (e.code === "PGRST202" || e.code === "42883") return true
  return /could not find the function|function .* does not exist/i.test(e.message || "")
}

/**
 * Gọi hàm máy chủ. `null` = chưa có hàm (lùi về cách cũ). Lỗi khác thì NÉM — không đổi một lần
 * rớt mạng thành "số 0".
 */
export async function goiMotLuot<T>(sb: SupabaseClient, ham: string, thamSo: Record<string, unknown>, ten: string): Promise<T | null> {
  const { data, error } = await sb.rpc(ham, thamSo)
  if (error) {
    if (laThieuHam(error)) return null
    throw new Error(`${ten}: ${error.message}`)
  }
  if (data == null || typeof data !== "object") return null
  return data as T
}
