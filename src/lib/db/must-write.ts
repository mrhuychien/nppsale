/**
 * Ghi xuống database và KHÔNG tin vào sự im lặng.
 *
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` NULL. Đây là cái bẫy lớn
 *   nhất của PostgREST và dự án này đã dính nhiều lần. Chính sách RLS
 *   không ném lỗi — nó LỌC. Lệnh xoá một dòng mình không được phép đụng
 *   chạy xong "thành công" với 0 dòng bị xoá, và đoạn mã điển hình
 *
 *     const { error } = await sb.from("x").delete().eq("id", id)
 *     if (error) throw error
 *     toast({ title: "Đã xoá" })
 *
 *   báo cho người dùng rằng việc đã xong. Họ quay lại danh sách và thứ
 *   vừa "xoá" vẫn nằm đó. Không có lỗi nào để mà tra.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 THẬT (22/09/2026), đăng nhập bằng chủ NPP,
 *   xoá một công nợ mà chính sách không cho:
 *
 *     CHỦ NPP xoá: DELETE trả về 0 dòng, KHÔNG ném lỗi
 *     công nợ còn trong sổ? 1
 *
 * ⚠ KHÔNG PHẢI CHỖ NÀO 0 DÒNG CŨNG LÀ TỪ CHỐI. Lệnh dọn theo cha
 *   ("xoá hết dòng của hóa đơn này rồi chèn lại") có thể đúng là không
 *   có dòng nào để xoá. Hàm này dành cho lệnh nhắm vào MỘT bản ghi đã
 *   biết là có — ở đó 0 dòng chỉ có thể là từ chối. Dùng bừa cho lệnh
 *   dọn là dựng ra lỗi giả.
 */

/** Câu mặc định khi database từ chối trong im lặng. */
export const GHI_BI_TU_CHOI =
  "Database từ chối thao tác này — nhiều khả năng bạn không có quyền với bản ghi này, " +
  "hoặc nó vừa bị người khác đổi. Tải lại trang để xem trạng thái mới."

/**
 * Hình dạng tối thiểu của một câu lệnh Supabase đã gắn đủ điều kiện,
 * còn chờ `.select()`. Nhận cấu trúc chứ không nhận kiểu của thư viện
 * để chốt gọi thẳng được bằng một object giả.
 */
export interface ChoSelect {
  select: (cols: string) => PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Chạy một lệnh ghi/xoá và ném khi database đụng vào 0 dòng.
 *
 * @example
 *   await ghiPhaiTrungDong(sb.from("customers").delete().eq("id", id))
 */
export async function ghiPhaiTrungDong(q: ChoSelect, thongBao = GHI_BI_TU_CHOI): Promise<void> {
  const { data, error } = await q.select("id")
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) throw new Error(thongBao)
}
