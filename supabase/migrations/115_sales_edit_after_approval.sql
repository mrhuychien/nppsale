-- ---------------------------------------------------------------------
-- 115 — NVBH được sửa đơn CỦA MÌNH sau khi đơn đã duyệt
-- ---------------------------------------------------------------------
--
-- TRƯỚC KHI SỬA
--   Chính sách "Sales can update own draft orders" (mig 002, vá lại ở 036)
--   chỉ cho NVBH sửa đơn khi `status = 'draft'`. Duyệt xong là hết đường:
--   sai một con số cũng phải nhờ quản lý, hoặc huỷ đơn làm lại từ đầu.
--
-- ⚠ VÌ SAO PHẢI SỬA Ở ĐÂY CHỨ KHÔNG CHỈ Ở MÀN HÌNH
--   RLS không báo lỗi khi từ chối. Lệnh UPDATE không khớp chính sách nào
--   thì Postgres sửa 0 dòng, PostgREST trả HTTP 200, `error` là null.
--   Nới quyền trên màn hình mà quên nới ở đây thì nhân viên bấm Lưu, thấy
--   "Đã cập nhật đơn hàng", rồi tải lại trang và thấy số cũ. Không có chỗ
--   nào trong hệ thống nói cho họ biết vì sao.
--
-- ⚠ LỖ HỔNG ĐÃ CÓ SẴN, SỬA LUÔN
--   Chính sách của `sales_order_lines` là FOR ALL cho cả 'sales', KHÔNG
--   ràng buộc trạng thái và KHÔNG ràng buộc ai phụ trách đơn. Tức là dòng
--   hàng vốn đã sửa được ở mọi trạng thái, chỉ có phần đầu đơn
--   (subtotal/total) là bị chặn. Ai cấp quyền `orders.update` cho NVBH
--   trong /settings/permissions là lập tức có cảnh: dòng hàng đổi, tổng
--   tiền đứng im, và không ai được báo. Siết lại cho khớp phần đầu đơn.
--
-- KHÔNG ĐỔI
--   Owner/manager/warehouse giữ nguyên quyền cũ.
--   `picking` trở đi NVBH vẫn không sửa được: từ lúc thủ kho bắt đầu lấy
--   hàng, đơn trên giấy và hàng trên xe đẩy phải là một.
-- ---------------------------------------------------------------------

-- --- Phần đầu đơn ----------------------------------------------------
DROP POLICY IF EXISTS "Sales can update own draft orders" ON sales_orders;
DROP POLICY IF EXISTS "Sales can update own open orders" ON sales_orders;

CREATE POLICY "Sales can update own open orders" ON sales_orders
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() = 'sales'
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'confirmed')
  )
  -- ⚠ WITH CHECK chặn chiều NGƯỢC LẠI: sửa xong không được đẩy đơn sang
  -- một trạng thái mà chính mình không còn sửa được nữa. Thiếu vế này thì
  -- một lệnh UPDATE có thể vừa sửa vừa tự chuyển đơn sang `picking`, tức
  -- tự bỏ qua bước thủ kho.
  WITH CHECK (
    org_id = public.user_org_id()
    AND sales_user_id = auth.uid()
    AND status IN ('draft', 'confirmed')
  );

COMMENT ON POLICY "Sales can update own open orders" ON sales_orders IS
  'NVBH sửa đơn của chính mình khi đơn còn ở draft hoặc confirmed (đã '
  'duyệt, chưa lấy hàng). Danh sách trạng thái này phải khớp '
  'SALES_EDITABLE_STATUSES trong src/lib/orders/edit-permission.ts.';

-- --- Dòng hàng --------------------------------------------------------
--
-- Tách 'sales' ra khỏi chính sách FOR ALL chung để ràng buộc thêm hai vế
-- mà các vai trò kia không cần: đúng người phụ trách, và đúng trạng thái.
DROP POLICY IF EXISTS "Owner/Manager/Sales can manage order lines" ON sales_order_lines;
DROP POLICY IF EXISTS "Admin roles can manage order lines" ON sales_order_lines;
DROP POLICY IF EXISTS "Sales can manage lines of own open orders" ON sales_order_lines;

CREATE POLICY "Admin roles can manage order lines" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() IN ('owner', 'manager', 'warehouse')
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id AND so.org_id = public.user_org_id()
    )
  );

CREATE POLICY "Sales can manage lines of own open orders" ON sales_order_lines
  FOR ALL
  USING (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'confirmed')
    )
  )
  WITH CHECK (
    public.user_role() = 'sales'
    AND EXISTS (
      SELECT 1 FROM sales_orders so
      WHERE so.id = order_id
        AND so.org_id = public.user_org_id()
        AND so.sales_user_id = auth.uid()
        AND so.status IN ('draft', 'confirmed')
    )
  );

NOTIFY pgrst, 'reload schema';

-- --- Đếm lại để biết vừa mở ra bao nhiêu ------------------------------
DO $$
DECLARE
  v_open int;
BEGIN
  SELECT count(*) INTO v_open
  FROM sales_orders
  WHERE status = 'confirmed';
  RAISE NOTICE '--- Có % đơn đã duyệt, NVBH phụ trách nay sửa được ---', v_open;
END $$;
