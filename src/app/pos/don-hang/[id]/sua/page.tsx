"use client"

/**
 * MÀN 1b — SỬA ĐƠN HÀNG.
 *
 * ⚠ RENDER ĐÚNG COMPONENT CỦA MÀN 1 (spec §7.1 chốt nguyên văn:
 * "Không tạo layout riêng, không tạo component riêng"). Tệp này chỉ
 * đổi năm prop; mọi thứ khác — bảng hàng, panel tiền, vị trí từng ô —
 * là CÙNG một component, nên không có cách nào hai màn trôi xa nhau.
 *
 * ⚠ ĐƠN CÒN `PHIẾU TẠM` THÌ KHÔNG BANNER, KHÔNG RÀNG BUỘC, KHÔNG BADGE
 * XANH — y hệt màn lập đơn (spec §7.1). Chỉ đơn ĐÃ XUẤT MỘT PHẦN mới
 * có sàn số lượng, vì phần đã xuất là hàng đã rời kho.
 */

import { useParams } from "next/navigation"
import { OrderScreen } from "@/components/pos/order-screen"

export default function PosOrderEditPage() {
  const { id } = useParams<{ id: string }>()
  /**
   * ⚠ CHƯA NỐI TRẠNG THÁI THẬT CỦA ĐƠN — xem `docs/pos-todo.md`. Để
   * mặc định là "phiếu tạm": đó là trạng thái KHÔNG có ràng buộc nào,
   * nên đoán sai theo hướng này chỉ làm mất một lời nhắc, không khoá
   * nhầm một dòng người dùng được phép sửa. Đoán ngược lại thì màn
   * hình chặn một việc hợp lệ và không ai gỡ được.
   */
  return <OrderScreen mode="sua" orderId={id} />
}
