/**
 * Khoá các nút GHI của luồng cũ (P7).
 *
 * ⚠ ẨN KHỎI MENU LÀ CHƯA ĐỦ, và để nguyên thì tệ hơn là báo lỗi.
 *
 * Ba màn của luồng cũ ghi dữ liệu theo NHIỀU BƯỚC rời nhau từ trình
 * duyệt, và bước ĐỔI TRẠNG THÁI ĐƠN nằm ở CUỐI:
 *
 *   · `/inventory/stock-out` dựng phiếu kho và bút toán tồn xong xuôi,
 *     rồi mới `status = 'picking'`;
 *   · `/inventory/entries/[id]` trừ kho thật xong, rồi mới `'delivering'`;
 *   · màn thu tiền theo phiếu xuất ghi phiếu thu và trừ công nợ xong,
 *     rồi mới `'delivered'`.
 *
 * Sau migration 119, `trg_check_order_status` từ chối cả ba giá trị đó.
 * Nghĩa là người dùng KHÔNG nhận được "bấm vào thì báo lỗi" — họ nhận
 * được GHI DỞ: kho đã trừ, tiền đã ghi, đơn thì không đổi, và không có
 * giao dịch nào cuộn lại. Đó là cách nhanh nhất để sổ sách lệch mà không
 * ai biết.
 *
 * ⚠ Bảng `returns` còn tệ hơn: nó KHÔNG có trigger chặn chuyển trạng
 * thái, và migration 120 đã gỡ trigger nhập kho tự động. Hai màn cũ vẫn
 * đẩy phiếu trả thẳng vào `'completed'` mà hàng không vào kho — cơ sở dữ
 * liệu không cãi một câu nào. Ở đó, giao diện là lớp chặn DUY NHẤT.
 *
 * Vì thế: các nút ghi bị khoá ở giao diện, kèm câu nói rõ phải làm gì
 * thay thế. Màn vẫn MỞ để tra cứu chứng từ cũ — xem `canEnterHref`.
 */

/** Bật lại luồng cũ: đổi hằng này về `false`. Một dòng, có chủ đích. */
export const LEGACY_FLOW_WRITES_LOCKED = true

/**
 * Câu giải thích hiện cạnh nút đã khoá. Nói THAY BẰNG GÌ, không chỉ nói
 * "không dùng được nữa" — người dùng đang có việc cần làm.
 */
export const LEGACY_LOCK_HINT: Record<string, string> = {
  "stock-out":
    "Bước soạn hàng đã bỏ. Nhà phân phối bấm Xuất hàng ngay trên đơn — hệ thống tự dựng phiếu kho và trừ tồn trong một lần.",
  entries:
    "Bước giao hàng đã bỏ. Phiếu kho nay do nút Xuất hàng ở màn đơn hàng tự dựng.",
  collect:
    "Thu tiền theo phiếu xuất đã bỏ. Lập phiếu thu ở Kế toán → Phiếu thu, chọn đúng khoản nợ.",
  handover:
    "Bước bàn giao đã bỏ. Hàng khách trả lập thành phiếu trả rồi bấm Hoàn thành ở màn Trả hàng.",
  pending:
    "Màn này thuộc luồng cũ. Phiếu trả xử lý ở màn Trả hàng, tab Chờ xử lý.",
}
