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
--     • Email:    <số điện thoại>@nppsale.local
--                 Ví dụ SĐT 0909123456 → 0909123456@nppsale.local
--     • Password: đặt mật khẩu
--     • Bật "Auto Confirm User"
--
--   ⚠ Email đó là THUẦN KỸ THUẬT. Supabase Auth bắt buộc phải có email,
--   nhưng chủ NPP sẽ đăng nhập vào app bằng SỐ ĐIỆN THOẠI, không bao giờ
--   gõ chuỗi này. Phải đúng dạng trên thì hệ thống mới nối được.
--
--   Chạy sai dạng cũng không sao: script bên dưới nêu ra đúng chuỗi cần
--   tạo. Băm mật khẩu là việc của Supabase Auth; chèn tay vào auth.users
--   bằng SQL sẽ ra tài khoản không đăng nhập được.
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
  owner_phone text := '0909123456';           -- SĐT chủ NPP, cũng là tên đăng nhập
  org_name    text := 'Nhà phân phối ABC';    -- tên hiển thị trong app
  org_slug    text := 'npp-abc';              -- không dấu, không khoảng trắng

  owner_full_name text := 'Chủ nhà phân phối';
  owner_email text;
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
  --
  -- Email kỹ thuật suy ra từ SĐT — cùng quy tắc với hàm sinh email ở
  -- src/lib/users/phone.ts, để tài khoản chủ và tài khoản nhân viên do
  -- app tạo nằm trên cùng một luật.
  ------------------------------------------------------------------
  IF public.normalize_phone(owner_phone) = '' THEN
    RAISE EXCEPTION 'Số điện thoại "%" không hợp lệ. DỪNG, chưa tạo gì.', owner_phone;
  END IF;

  owner_email := public.normalize_phone(owner_phone) || '@nppsale.local';

  SELECT id INTO owner_id FROM auth.users WHERE lower(email) = lower(owner_email);

  IF owner_id IS NULL THEN
    RAISE EXCEPTION
      'Chưa có tài khoản đăng nhập cho SĐT %. DỪNG, chưa tạo gì. Vào Supabase '
      'Dashboard → Authentication → Users → Add user, điền ĐÚNG email này: %  '
      '(nhớ bật Auto Confirm User), đặt mật khẩu, rồi chạy lại file này. '
      'Chủ NPP sẽ đăng nhập vào app bằng SĐT %, không phải bằng chuỗi email đó.',
      owner_phone, owner_email, owner_phone;
  END IF;

  ------------------------------------------------------------------
  -- 3. Dựng org + chủ NPP. `users.id` DÙNG CHUNG id với `auth.users` —
  --    đó là cách user_org_id() nối phiên đăng nhập với org.
  ------------------------------------------------------------------
  INSERT INTO public.organizations (name, slug)
  VALUES (org_name, org_slug)
  RETURNING id INTO new_org;

  INSERT INTO public.users (id, org_id, full_name, role, phone, is_active)
  VALUES (owner_id, new_org, owner_full_name, 'owner', owner_phone, true);

  RAISE NOTICE 'Xong. org=% (%), chủ NPP đăng nhập bằng SĐT %', org_name, new_org, owner_phone;
  RAISE NOTICE 'Bước tiếp theo: chạy supabase/reset/03_reseed_defaults.sql';
END $$;

COMMIT;

-- Kiểm lại: phải ra đúng 1 dòng.
SELECT o.name AS npp, o.slug, u.phone AS dang_nhap_bang, u.role, u.full_name
FROM public.users u
JOIN public.organizations o ON o.id = u.org_id
JOIN auth.users a ON a.id = u.id;
