-- ====================================================================
-- 092_rls_hardening
--
-- Vá 3 lỗ hổng RLS đã được KIỂM CHỨNG TỪNG CÁI trên mã nguồn.
--
-- Bối cảnh: triển khai 1 TỔ CHỨC / 1 DATABASE. Vì vậy các sửa đổi dưới
-- đây gần như KHÔNG đổi hành vi hiện tại — chúng là phòng vệ chiều sâu,
-- chặn sự cố nếu sau này có tổ chức thứ hai dùng chung database.
--
-- ĐÃ LOẠI BỎ SAU KHI KIỂM CHỨNG (đừng "sửa" lại, không phải lỗi):
--   • Bảng users: migration 008 ĐÃ siết org_id
--     (USING org_id = user_org_id() OR id = auth.uid()). Cảnh báo trước
--     đây dựa vào migration 004 vốn đã bị 008 thay thế.
--     Điều này cũng chứng minh nỗi lo "đệ quy khi policy trên users gọi
--     user_org_id()" là KHÔNG có cơ sở — nó đang chạy tốt trên production.
--   • Bảng customers (042): tưởng khoá warehouse/driver, nhưng policy có
--     nhánh user_has_permission(auth.uid(), 'customer.view_all') nên hai
--     vai trò này vẫn xem được. Chủ sở hữu đã xác nhận thực tế đúng vậy.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. suppliers — thêm lọc org_id.
--
-- Policy cũ (migration 006) dùng USING (true): MỌI người đã đăng nhập
-- thấy nhà cung cấp của MỌI tổ chức. Với 1 tổ chức/1 DB thì không rò rỉ
-- gì, nhưng đây là quả bom hẹn giờ nếu gộp nhiều tổ chức về sau.
--
-- KHÔNG ĐỔI HÀNH VI: mọi dòng đều cùng một org_id.
-- Không có nguy cơ đệ quy: user_org_id() truy vấn bảng users, khác bảng.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view suppliers" ON suppliers;
CREATE POLICY "Authenticated can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (org_id = public.user_org_id());


-- --------------------------------------------------------------------
-- 2. Bật security_invoker cho 4 view.
--
-- Postgres 15+ mặc định chạy view bằng quyền CHỦ SỞ HỮU view, nghĩa là
-- chúng BỎ QUA HOÀN TOÀN RLS của các bảng bên dưới. Bật security_invoker
-- khiến view chạy bằng quyền người gọi → RLS được áp dụng đúng.
--
-- ĐÃ KIỂM TÁC ĐỘNG TỪNG VIEW trước khi bật (đây là chỗ dễ gây sự cố
-- ngầm nhất: view luôn trả 200 + [] nên nếu vỡ thì KHÔNG BAO GIỜ có lỗi
-- để hiển thị):
--   • v_stock_balance_by_zone, v_stock_movements → đọc bảng batches.
--     Policy SELECT của batches là `org_id = user_org_id()`, KHÔNG giới
--     hạn vai trò → mọi vai trò vẫn thấy đủ như trước.
--   • v_sales_order_line_picked → đọc sales_order_lines/stock_entry_lines.
--     Chỉ dùng trong trang chi tiết đơn, nơi người dùng vốn đã xem được
--     đơn đó, nên RLS cho qua.
--   • v_uom_audit → không được dùng ở bất kỳ đâu trong src/.
--
-- HOÀN TÁC nếu có trang nào bỗng rỗng (dán vào SQL Editor):
--   ALTER VIEW public.v_stock_balance_by_zone   SET (security_invoker = false);
--   ALTER VIEW public.v_stock_movements         SET (security_invoker = false);
--   ALTER VIEW public.v_sales_order_line_picked SET (security_invoker = false);
--   ALTER VIEW public.v_uom_audit               SET (security_invoker = false);
-- --------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_stock_balance_by_zone',
    'v_stock_movements',
    'v_sales_order_line_picked',
    'v_uom_audit'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = v
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;


-- --------------------------------------------------------------------
-- 3. payments — cho ý đồ siết quyền của migration 033 có hiệu lực.
--
-- 033 tạo policy "Sales see own order payments" nhằm giới hạn nhân viên
-- bán hàng chỉ thấy phiếu thu của đơn mình tạo. Nhưng policy rộng của
-- 002 ("Org members can view payments") KHÔNG bị gỡ, mà nhiều policy
-- SELECT được cộng dồn bằng OR → ý đồ của 033 bị vô hiệu hoàn toàn.
--
-- Cách sửa: policy rộng loại trừ vai trò 'sales'; nhân viên bán hàng đi
-- theo policy riêng của 033.
--
-- ĐÂY LÀ THAY ĐỔI HÀNH VI THẬT (khác mục 1 và 2):
--   • owner / manager / accountant / warehouse / driver: KHÔNG đổi.
--   • sales: từ nay chỉ thấy phiếu thu thuộc đơn DO MÌNH TẠO.
-- Nếu nghiệp vụ cần nhân viên bán hàng xem phiếu thu của đồng nghiệp,
-- HOÀN TÁC bằng cách chạy:
--   DROP POLICY IF EXISTS "Org members can view payments" ON payments;
--   CREATE POLICY "Org members can view payments" ON payments FOR SELECT
--     USING (EXISTS (SELECT 1 FROM receivables r
--                    WHERE r.id = receivable_id AND r.org_id = public.user_org_id()));
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Org members can view payments" ON payments;
CREATE POLICY "Org members can view payments"
  ON payments FOR SELECT
  USING (
    public.user_role() <> 'sales'
    AND EXISTS (
      SELECT 1 FROM receivables r
      WHERE r.id = receivable_id AND r.org_id = public.user_org_id()
    )
  );

-- Đảm bảo policy dành cho sales của 033 thực sự tồn tại (nếu 033 chưa
-- chạy thì nhân viên bán hàng sẽ mất sạch quyền xem phiếu thu).
DROP POLICY IF EXISTS "Sales see own order payments" ON payments;
CREATE POLICY "Sales see own order payments"
  ON payments FOR SELECT
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM receivables r
      JOIN sales_orders so ON so.id = r.order_id
      WHERE r.id = payments.receivable_id
        AND so.sales_user_id = (SELECT auth.uid())
    )
  );


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY
-- ====================================================================
-- 1) Ba thay đổi đã vào chưa — cả 3 phải true:
-- SELECT
--   (SELECT count(*) = 1 FROM pg_policies
--     WHERE tablename='suppliers' AND policyname='Authenticated can view suppliers'
--       AND qual LIKE '%user_org_id%')                        AS suppliers_da_loc_org,
--   (SELECT count(*) = 2 FROM pg_policies
--     WHERE tablename='payments'
--       AND policyname IN ('Org members can view payments','Sales see own order payments'))
--                                                             AS payments_du_2_policy,
--   (SELECT count(*) >= 3 FROM pg_views v
--     JOIN pg_class c ON c.relname = v.viewname
--     WHERE v.schemaname='public' AND v.viewname LIKE 'v_%'
--       AND c.reloptions::text LIKE '%security_invoker=true%') AS view_da_bat_invoker;
--
-- 2) QUAN TRỌNG — sau khi chạy, nhờ một nhân viên MỖI VAI TRÒ mở thử:
--    kho (trang Kho hàng + lịch sử xuất nhập), kế toán (Phiếu thu),
--    bán hàng (Công nợ). Nếu có trang nào bỗng rỗng → dùng lệnh HOÀN TÁC
--    tương ứng ở phần comment phía trên.
