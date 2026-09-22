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
 * Cột xin về sau khi ghi.
 *
 * ⚠ PHẢI LÀ `*`, KHÔNG ĐƯỢC LÀ `id` — và đây là một lỗi tôi đã gây ra
 *   rồi mới thấy. Bản đầu của hàm này xin đúng `id`, thành ra PostgREST
 *   dựng `RETURNING id`, và hai bảng trong repo KHÔNG CÓ cột ấy:
 *
 *     user_permission_overrides — khoá chính (user_id, permission_key)
 *     user_suppliers            — khoá chính (user_id, supplier_id)
 *
 *   Đã đo trên Postgres 16, chạy đúng câu lệnh mã sinh ra:
 *     ERROR: column "id" does not exist
 *
 *   Hậu quả nặng hơn hẳn lỗi nó đi sửa: ở màn Phân quyền, phần cấp/thu
 *   quyền đã `upsert` XONG rồi mới tới lệnh xoá — nên lần lưu nào có
 *   "trả về theo vai trò" là ném giữa chừng, một nửa đã ghi. Ở màn nhân
 *   viên cũng vậy: hồ sơ đã lưu, bỏ nhà cung cấp thì ném, và phần THÊM
 *   nhà cung cấp nằm sau đó bị bỏ qua luôn.
 *
 * ⚠ `*` ĐÚNG VỚI MỌI BẢNG. Hàm này chỉ cần ĐẾM số dòng đụng được, không
 *   cần dữ liệu — nên đừng bắt nó phải biết bảng nào có cột gì.
 */
const COT_XIN_VE = "*"

/**
 * Chạy một lệnh ghi/xoá và ném khi database đụng vào 0 dòng.
 *
 * @example
 *   await ghiPhaiTrungDong(sb.from("customers").delete().eq("id", id))
 */
export async function ghiPhaiTrungDong(q: ChoSelect, thongBao = GHI_BI_TU_CHOI): Promise<void> {
  const { data, error } = await q.select(COT_XIN_VE)
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) throw new Error(thongBao)
}
