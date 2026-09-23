import { quenGioSuaDon } from "@/lib/sell/cart-storage"

/**
 * Xoá đơn — MỘT chỗ cho ba màn (chi tiết đơn, Đơn tạm, màn sửa đơn).
 *
 * ⚠ AI XOÁ ĐƯỢC GÌ — chép đúng chính sách dưới database, không rộng hơn,
 * không hẹp hơn:
 *   · owner / manager: đơn `draft` hoặc `cancelled` (mig 113), và bảng
 *     phân quyền của đơn vị vẫn phải cho `orders.delete`.
 *   · sales: chỉ `draft`, chỉ đơn CỦA MÌNH (mig 117).
 *
 * VÌ SAO PHẢI CÓ HÀM NÀY. Màn chi tiết đơn gài nút Xoá theo bảng phân
 * quyền — mà bảng đó không cấp `orders.delete` cho NVBH, nên nút không
 * hiện, dù database (mig 117) đã cho họ xoá nháp của mình. Người dùng báo:
 * "NV bán hàng chưa xoá được đơn nháp. Phải có nút xoá trong màn sửa đơn
 * chứ?" — ba màn, ba phép gài khác nhau, và một phép sai.
 */
export interface DeletableOrder {
  status: string
  sales_user_id?: string | null
}

export function canDeleteOrder(
  user: { id: string; role: string } | null | undefined,
  order: DeletableOrder,
  /** Bảng phân quyền của đơn vị có cấp `orders.delete` cho vai trò này không. */
  matrixAllows: boolean
): boolean {
  if (!user) return false
  if (user.role === "owner" || user.role === "manager") {
    return matrixAllows && (order.status === "draft" || order.status === "cancelled")
  }
  if (user.role === "sales") {
    return order.status === "draft" && !!order.sales_user_id && order.sales_user_id === user.id
  }
  return false
}

/** Câu nói ra khi database xoá 0 dòng — RLS từ chối thì không có lỗi nào khác. */
export const DELETE_REFUSED_MSG =
  "Không xoá được đơn này. Chủ NPP / quản lý xoá được đơn nháp hoặc đã huỷ; " +
  "nhân viên bán hàng chỉ xoá được đơn nháp của chính mình. " +
  "Nếu đơn vừa được duyệt thì tải lại để xem trạng thái mới."

interface DeleteClient {
  from: (t: "sales_orders") => {
    delete: () => {
      eq: (
        c: "id",
        v: string
      ) => {
        select: (cols: "id") => PromiseLike<{ data: unknown; error: { message: string } | null }>
      }
    }
  }
}

/**
 * Xoá một đơn. Ném lỗi khi database từ chối — kể cả từ chối IM LẶNG.
 *
 * ⚠ PHẢI LẤY VỀ DÒNG ĐÃ XOÁ, không chỉ kiểm `error`. RLS chặn thì
 * PostgREST trả 200 kèm mảng RỖNG, không lỗi — và màn hình báo "đã xoá"
 * trong khi đơn vẫn nằm đó. Dự án này đã gặp đúng chuyện đó hai lần.
 *
 * Dòng hàng, nhật ký, phiếu trả chưa duyệt đi theo đơn nhờ CASCADE và
 * trigger mig 118; phiếu trả đã duyệt, công nợ, hoá đơn thì database chặn
 * và câu chặn hiện nguyên lên màn hình.
 */
export async function deleteOrder(supabase: unknown, orderId: string): Promise<void> {
  const sb = supabase as DeleteClient
  const { data, error } = await sb.from("sales_orders").delete().eq("id", orderId).select("id")
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) throw new Error(DELETE_REFUSED_MSG)
  // Giỏ đang sửa chính đơn này thì quên đi — xem `quenGioSuaDon`.
  quenGioSuaDon(orderId)
}
