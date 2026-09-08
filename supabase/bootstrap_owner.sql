-- =====================================================================
-- bootstrap_owner.sql — dựng NPP đầu tiên + tài khoản chủ, trên DB mới
-- =====================================================================
-- CHẠY KHI: vừa cài xong supabase/schema_full.sql lên một project trống.
--
-- VÌ SAO CẦN FILE NÀY
--   Cài xong schema thì database có đủ 72 bảng nhưng KHÔNG có org nào và
--   KHÔNG có người dùng nào. Và dự án KHÔNG có trigger nào trên
--   `auth.users`, nên tạo tài khoản đăng nhập trong Supabase Dashboard
--   cũng không tự sinh dòng trong `public.users`.
--
--   Hệ quả nếu thiếu bước này: đăng nhập được vào Supabase nhưng app đá
--   ra /login mãi — `user_org_id()` trả NULL nên mọi policy RLS chặn hết.
--   Màn /setup không cứu được, vì nó chỉ CẤU HÌNH một org đã có chứ không
--   dựng org từ số 0.
--
-- LÀM TRƯỚC (bắt buộc, không làm được bằng SQL)
--   Supabase Dashboard → Authentication → Users → "Add user"
--     • Email: điền đúng email dưới đây
--     • Password: đặt mật khẩu
--     • Bật "Auto Confirm User"
--   Băm mật khẩu là việc của Supabase Auth; chèn tay vào auth.users bằng
--   SQL sẽ ra tài khoản không đăng nhập được.
--
-- SAU KHI CHẠY FILE NÀY
--   Chạy tiếp supabase/reset/03_reseed_defaults.sql để có tuyến bán hàng,
--   nhóm chi phí và hạn mức duyệt mặc định. (Để riêng, không chép vào
--   đây — hai bản sao là hai cơ hội để lệch nhau.)
-- =====================================================================

BEGIN;

DO $$
DECLARE
  -- ⚠⚠ SỬA 3 DÒNG NÀY
  owner_email text := 'chu@npp-cua-ban.vn';   -- đúng email vừa tạo ở Dashboard
  org_name    text := 'Nhà phân phối ABC';    -- tên hiển thị trong app
  org_slug    text := 'npp-abc';              -- không dấu, không khoảng trắng

  owner_full_name text := 'Chủ nhà phân phối';
  owner_id  uuid;
  new_org   uuid;
BEGIN
  ------------------------------------------------------------------
  -- 1. Chỉ chạy trên DB CÒN TRỐNG.
  --
  -- Không chặn thì lỡ tay chạy trên database đang hoạt động sẽ đẻ thêm
  -- một org thứ hai — và vì mọi policy RLS lọc theo org_id, cái org lạc
  -- đó vô hình với người dùng hiện tại, rất khó phát hiện.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.users) THEN
    RAISE EXCEPTION
      'Database này ĐÃ có người dùng — file này chỉ dành cho bản cài mới. '
      'DỪNG, chưa tạo gì. Muốn thêm người thì dùng màn Cài đặt → Người dùng trong app.';
  END IF;

  ------------------------------------------------------------------
  -- 2. Tài khoản đăng nhập phải được tạo TRƯỚC ở Dashboard.
  ------------------------------------------------------------------
  SELECT id INTO owner_id FROM auth.users WHERE lower(email) = lower(owner_email);

  IF owner_id IS NULL THEN
    RAISE EXCEPTION
      'Chưa có tài khoản đăng nhập "%". DỪNG, chưa tạo gì. Vào Supabase '
      'Dashboard → Authentication → Users → Add user (nhớ bật Auto Confirm '
      'User), rồi chạy lại file này.',
      owner_email;
  END IF;

  ------------------------------------------------------------------
  -- 3. Dựng org + chủ NPP. `users.id` DÙNG CHUNG id với `auth.users` —
  --    đó là cách user_org_id() nối phiên đăng nhập với org.
  ------------------------------------------------------------------
  INSERT INTO public.organizations (name, slug)
  VALUES (org_name, org_slug)
  RETURNING id INTO new_org;

  INSERT INTO public.users (id, org_id, full_name, role, is_active)
  VALUES (owner_id, new_org, owner_full_name, 'owner', true);

  RAISE NOTICE 'Xong. org=% (%), chủ NPP=% (%)', org_name, new_org, owner_email, owner_id;
  RAISE NOTICE 'Bước tiếp theo: chạy supabase/reset/03_reseed_defaults.sql';
END $$;

COMMIT;

-- Kiểm lại: phải ra đúng 1 dòng.
SELECT o.name AS npp, o.slug, a.email, u.role, u.full_name
FROM public.users u
JOIN public.organizations o ON o.id = u.org_id
JOIN auth.users a ON a.id = u.id;
