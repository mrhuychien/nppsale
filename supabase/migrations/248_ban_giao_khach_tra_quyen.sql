-- =====================================================================================================================
-- 248 — Trả quyền "Bàn giao khách" về đúng mặc định (chỉ chủ NPP / quản lý)
-- =====================================================================================================================
-- VÌ SAO — chủ nhà 20/10/2026: "Kiểm tra lại sao tk nhân viên bán hàng lại có bàn giao khách nhỉ".
--   "Bàn giao khách" (khoá `customers.handover`, mig 246) mặc định chỉ chủ NPP / quản lý — một Ô RIÊNG, không thừa hưởng
--   mô-đun Khách hàng. Màn Phân quyền (/settings/permissions) lúc nạp lại chép dòng của mô-đun Khách hàng sang MỌI tính
--   năng con, kể cả ô riêng này: ô mới chưa có dòng riêng nên bảng vẽ NVBH như đã được cấp (NVBH có Khách hàng · Sửa), và
--   lần bấm "Lưu" sau đó ghi thật xuống role_permissions → menu của NVBH có "Bàn giao khách".
--   Màn đã sửa (ô riêng không nhận dòng mô-đun cha — `laORieng` / `macDinhTinhNang` ở src/lib/permissions.ts). Tệp này trả
--   các dòng đã ghi lỡ về đúng mặc định: vai ngoài chủ NPP / quản lý KHÔNG có bàn giao. Ai cần thì chủ NPP cấp lại ở màn
--   Phân quyền (nay bảng vẽ đúng sự thật).
--   Quyền riêng TỪNG NGƯỜI (user_permission_overrides) không đụng — màn từng người chỉ ghi ô chủ NPP tự bấm đổi; câu tóm
--   tắt cuối tệp đếm ra để chủ NPP xem lại.
--   Máy chủ chặn từ đầu: `ban_giao_khach` chỉ cho chủ NPP / quản lý — NVBH thấy mục cũng không bàn giao được.
-- Chạy lại vô hại: lần sau không còn dòng nào để đổi.
-- =====================================================================================================================

UPDATE public.role_permissions
   SET allowed = false,
       updated_at = now()
 WHERE module = 'customers.handover'
   AND role NOT IN ('owner', 'manager')
   AND allowed;

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM public.role_permissions
    WHERE module = 'customers.handover' AND role NOT IN ('owner', 'manager') AND allowed) AS vai_khac_con_ban_giao,
  (SELECT count(*) FROM public.user_permission_overrides o
     JOIN public.users u ON u.id = o.user_id
    WHERE o.permission_key LIKE 'customers.handover.%' AND o.granted
      AND u.role NOT IN ('owner', 'manager')) AS nguoi_duoc_cap_rieng_ban_giao;
