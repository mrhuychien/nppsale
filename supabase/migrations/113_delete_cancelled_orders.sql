-- ====================================================================
-- 113 — Cho phép xoá đơn hàng đã huỷ / còn nháp
-- ====================================================================
--
-- TRIỆU CHỨNG: bấm "Xoá đơn hàng" trên một đơn ĐÃ HUỶ, màn hình báo "Đã
-- xóa đơn hàng", quay về danh sách — và đơn vẫn nằm đó.
--
-- NGUYÊN NHÂN: `sales_orders` bật RLS nhưng KHÔNG CÓ policy DELETE nào.
-- Rà cả 112 migration: có policy SELECT, INSERT, UPDATE, không có DELETE.
-- Khi RLS bật mà không có policy cho một thao tác thì thao tác đó khớp
-- KHÔNG dòng nào — PostgREST trả về 200, mảng rỗng, KHÔNG có lỗi. Mã
-- nguồn chỉ kiểm `error`, thấy rỗng nên báo thành công.
--
-- Đây là kiểu hỏng khó thấy nhất: không phải "xoá rồi báo lỗi", mà "không
-- xoá gì và báo đã xoá".
--
-- PHẠM VI CỐ Ý HẸP
--
--   • Chỉ `draft` và `cancelled`. Đơn đã giao gắn với công nợ, phiếu xuất
--     kho, hoá đơn điện tử — xoá là thủng sổ. Trạng thái khác thì huỷ
--     trước, xoá sau; ĐÚNG như nút trên màn hình vẫn đang gài.
--   • Chỉ owner/manager, khớp với policy UPDATE sẵn có.
--
-- KHÔNG NỚI KHOÁ NGOẠI. Vài bảng trỏ vào `sales_orders` bằng REFERENCES
-- trần (công nợ, phiếu thu, bàn giao tài xế) nên Postgres sẽ CHẶN nếu đơn
-- còn dính chứng từ — và chặn ở đó là đúng. Lúc ấy lỗi khoá ngoại có nội
-- dung thật, hiện thẳng lên màn hình, khác hẳn cái im lặng cũ.
-- ====================================================================

DROP POLICY IF EXISTS "Owner/Manager can delete draft or cancelled orders" ON sales_orders;
CREATE POLICY "Owner/Manager can delete draft or cancelled orders"
  ON sales_orders FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
    AND status IN ('draft', 'cancelled')
  );

COMMENT ON TABLE sales_orders IS
  'Đơn bán. Chỉ xoá được khi status là draft hoặc cancelled (mig 113); '
  'đơn đã giao phải huỷ trước, và vẫn bị khoá ngoại chặn nếu còn dính '
  'công nợ hay phiếu thu.';
