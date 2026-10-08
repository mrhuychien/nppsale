import type { SupabaseClient } from "@supabase/supabase-js"

/** Người đứng tên đơn / phiếu trả được. */
export interface NguoiBan {
  id: string
  full_name: string
  role: string
}

/**
 * Nhân viên đứng tên đơn / phiếu trả được — MỘT câu đọc cho POS, `/sell` và các màn phiếu trả (trước đây chép bốn
 * bản; ba bản không kiểm lỗi).
 *
 * ⚠ ĐÚNG BỘ VAI TRÒ TRIGGER CHO PHÉP (mig 153 / 160). Hiện ra một cái tên mà máy chủ sẽ từ chối là bẫy người dùng: họ
 *   chọn, bấm lưu, rồi nhận một câu lỗi cho một việc màn hình vừa mời họ làm.
 * ⚠ BỎ NGƯỜI ĐÃ NGHỈ / TẠM KHOÁ (mig 223) — không gán được. Tên trên chứng từ cũ tra riêng (`DocPeople`).
 * ⚠ ĐỌC HỎNG THÌ NÉM — trả `[]` là ô "Nhân viên bán" trống trơn mà không ai biết vì sao; nơi gọi tự quyết báo / bỏ qua.
 */
export async function docNguoiBan(sb: SupabaseClient, orgId: string): Promise<NguoiBan[]> {
  const { data, error } = await sb
    .from("users")
    .select("id, full_name, role, is_active")
    .eq("org_id", orgId)
    .in("role", ["sales", "manager", "owner"])
    .order("full_name")
  if (error) throw error
  return (((data as unknown) as Array<NguoiBan & { is_active?: boolean | null }>) ?? [])
    .filter((u) => u.is_active !== false)
    .map((u) => ({ id: u.id, full_name: u.full_name, role: u.role }))
}
