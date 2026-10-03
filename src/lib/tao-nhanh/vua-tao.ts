/**
 * BẢN GHI VỪA TẠO TẠI CHỖ — đưa vào danh mục của màn đang làm (chủ nhà 03/10/2026, Update 3.10: "tạo xong …
 * quay về phần đang làm … add luôn").
 *
 * ⚠ DANH MỤC Ở MÀN GỌI LÀ BẢN ĐỌC TỪ TRƯỚC — chưa có mã vừa tạo. Tra mã mới trong đó là không thêm được dòng
 * nào (lỗi của phiếu nhập kho bản đầu). Mọi màn ghép mã vừa tạo vào danh mục của mình qua `gopVuaTao`.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** Ghép bản ghi vừa tạo vào cuối danh sách — đã có (cùng `id`) thì giữ nguyên danh sách. */
export function gopVuaTao<T extends { id: string }>(ds: T[], moi: T[]): T[] {
  if (moi.length === 0) return ds
  const co = new Set(ds.map((x) => x.id))
  const them = moi.filter((x) => !co.has(x.id))
  return them.length === 0 ? ds : [...ds, ...them]
}

/**
 * Đọc lại sản phẩm vừa tạo ĐÚNG HÌNH DẠNG danh mục của màn gọi (cùng câu `select`, kèm `units` nếu màn ấy có).
 * `ProductForm` trả về bản ghi chưa có đơn vị quy đổi — thêm dòng từ bản ấy là ô chọn đơn vị chỉ còn đơn vị cơ sở.
 */
export async function docSanPhamVuaTao<T>(supabase: SupabaseClient, id: string, select: string): Promise<T | null> {
  const { data, error } = await supabase.from("products").select(select).eq("id", id).maybeSingle()
  if (error) console.error("[tao-nhanh] đọc sản phẩm vừa tạo lỗi:", error.message)
  return (data as T | null) ?? null
}
