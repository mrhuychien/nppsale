-- ====================================================================
-- NVBH ĐƯỢC XEM TRẢ HÀNG (của mình)
--
-- VÌ SAO — chủ nhà 27/09/2026: "Mở quyền xem trả hàng vào mẫu" (sau khi làm màn
--   "Trả hàng của tôi" trên điện thoại cho NVBH). Mẫu 26/09 (mig 202) đã tắt ô
--   `sales · returns` — ô đã LƯU trong `role_permissions` thắng mặc định trong mã, nên
--   mở lại ở đây cho mọi NPP.
--   Chỉ XEM: hoàn thành / huỷ phiếu vẫn cần `returns.approve`; tạo phiếu độc lập cần
--   `returns.create` — không mở. Dữ liệu NVBH thấy vẫn do RLS giới hạn (phiếu của mình).
--   Quyền RIÊNG từng người (`user_permission_overrides`) giữ nguyên — chủ NPP cấp đích danh.
--
-- ⚠ Idempotent: chạy lại không đổi gì thêm.
-- ====================================================================

INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, 'sales', 'returns', 'read', true
FROM organizations o
ON CONFLICT (org_id, role, module, action) DO UPDATE SET allowed = true;

NOTIFY pgrst, 'reload schema';

SELECT 'NVBH xem trả hàng' AS hang_muc,
       (SELECT count(*) FROM organizations) AS so_npp,
       (SELECT count(*) FROM role_permissions
         WHERE role = 'sales' AND module = 'returns' AND action = 'read' AND allowed) AS o_da_mo;
