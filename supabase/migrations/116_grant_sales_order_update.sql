-- ---------------------------------------------------------------------
-- 116 — Bật quyền `orders.update` cho NVBH trong ma trận phân quyền
-- ---------------------------------------------------------------------
--
-- Migration 115 mở chính sách RLS; đây là công tắc phía ứng dụng.
--
-- ⚠ VÌ SAO KHÔNG CHỈ SỬA MẶC ĐỊNH TRONG MÃ
--   `DEFAULT_PERMISSION_MAP` chỉ là giá trị nền. Tổ chức nào đã từng bấm
--   "Đặt lại" ở /settings/permissions thì có SẴN một dòng
--   (sales, orders, update, allowed=false) trong `role_permissions`, và
--   dòng đó đè lên mặc định mới. Sửa mã mà không chạm bảng thì đúng những
--   tổ chức đã cấu hình lại là những tổ chức không thấy gì thay đổi.
--
-- ⚠ CHỈ ĐỘNG ĐÚNG MỘT Ô. Không đụng tới bất kỳ (vai trò, mô-đun, hành
--   động) nào khác — ai đã tự siết quyền gì thì giữ nguyên quyền đó.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_updated int := 0;
  v_inserted int := 0;
BEGIN
  -- Ô đã có sẵn và đang tắt → bật.
  UPDATE role_permissions
     SET allowed = true, updated_at = now()
   WHERE role = 'sales' AND module = 'orders' AND action = 'update'
     AND allowed IS DISTINCT FROM true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Tổ chức chưa từng lưu ô này → chèn cho khớp mặc định mới, để lần sau
  -- ai mở màn phân quyền cũng thấy đúng trạng thái đang chạy.
  INSERT INTO role_permissions (org_id, role, module, action, allowed)
  SELECT o.id, 'sales', 'orders', 'update', true
    FROM organizations o
   WHERE NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.org_id = o.id AND rp.role = 'sales'
        AND rp.module = 'orders' AND rp.action = 'update'
   );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE '--- Bật quyền sửa đơn cho NVBH: % ô đã bật, % ô mới thêm ---',
    v_updated, v_inserted;
END $$;

NOTIFY pgrst, 'reload schema';
