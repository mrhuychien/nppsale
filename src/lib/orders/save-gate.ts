/**
 * Luật lưu đơn nháp.
 *
 * HAI LUẬT KHÁC NHAU GIỮA NHÁP VÀ GỬI ĐI — CÓ LÝ DO
 *
 *   · TỒN KHO: nháp chỉ CẢNH BÁO. Đơn nháp không ra kho hôm nay, mà tồn
 *     kho thì đổi từng giờ — chặn một bản nháp vì tồn của lúc này là chặn
 *     nhầm. Đơn thật vẫn chặn như cũ.
 *
 *   · GIÁ SÀN: nháp vẫn CHẶN y như đơn thật. Thẩm quyền của một NVBH
 *     không đổi theo thời gian, nên nếu nháp cho qua thì "Lưu tạm" trở
 *     thành cách bán dưới giá sàn: lưu nháp giá thấp, rồi nhờ duyệt —
 *     mà bước duyệt KHÔNG kiểm lại giá sàn.
 *
 *   · SẢN PHẨM: nháp cho phép chưa có dòng hàng nào. Đó chính là lúc cần
 *     lưu nháp nhất — đang đứng ở quầy, ghi được tên khách thì khách bận.
 *
 * Hàm `gateForSave` từng gom ba luật trên cho màn tạo đơn cũ. Màn đó đã bị
 * xoá; màn bán hàng thi hành đúng ba luật này bằng điều kiện khoá của hai
 * nút (xem `src/app/(dashboard)/sell/cart/page.tsx`), và `tests/sell-submit`
 * ghim từng luật một.
 */

/**
 * Ghi vào `approval_reason` của đơn lưu nháp.
 *
 * ⚠ KHÔNG để trống. Cột đó trống nghĩa là "đã duyệt, không có gì vướng";
 * đơn nháp chưa ai xem nên phải nói rõ vì sao nó còn nằm đó.
 */
export const DRAFT_APPROVAL_REASON = "Lưu nháp — chưa gửi duyệt"
