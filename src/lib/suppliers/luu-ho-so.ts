/**
 * GHI HỒ SƠ NHÀ CUNG CẤP ĐÃ SỬA — MỘT đường cho tấm "Sửa thông tin" ở chi tiết NCC (`SupplierEditSheet`) và modal
 * thông tin NCC ở POS (chủ nhà 21/10/2026). Hai chỗ tự ghi là hai luật: thêm cột mới ở một chỗ, chỗ kia lặng lẽ xoá.
 *
 * ⚠ DATABASE TỪ CHỐI TRONG IM LẶNG THÌ NÉM (`ghiPhaiTrungDong`): RLS lọc ra 0 dòng vẫn là HTTP 200 — không ném là
 *   màn báo "Đã cập nhật" cho một lần lưu không ghi gì.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import { nccPayload, type NccForm } from "@/lib/suppliers/form"

/** Lỗi NHẬP (tên trống, hạn mức âm, ngày sai) — hiện thành tiêu đề thông báo, form còn nguyên để sửa. */
export class LoiNhapNcc extends Error {}

/** Ghi bản sửa của NCC `id` (`goc` = bản lúc mở form). Trả tải trọng đã ghi. */
export async function luuHoSoNcc(
  sb: SupabaseClient,
  id: string,
  form: NccForm,
  goc: NccForm
): Promise<Record<string, unknown>> {
  const { payload, loi } = nccPayload(form, goc)
  if (loi) throw new LoiNhapNcc(loi)
  await ghiPhaiTrungDong(sb.from("suppliers").update(payload).eq("id", id))
  return payload
}
