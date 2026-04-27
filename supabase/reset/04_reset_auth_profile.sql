-- =====================================================================
-- 04_reset_auth_profile.sql — xóa users KHÔNG phải owner (tùy chọn)
-- =====================================================================
-- CHỈ CHẠY KHI bạn muốn bàn giao với 1 tài khoản owner duy nhất và
-- xóa mọi user còn lại (sales, driver, accountant, warehouse...).
--
-- ⚠️ BƯỚC NÀY ẢNH HƯỞNG auth.users (trong schema auth của Supabase).
-- ⚠️ Users bị xóa sẽ MẤT quyền đăng nhập vĩnh viễn.
--
-- Chạy bước này sau 01 (và 02 nếu áp dụng). Nếu còn bất kỳ tham chiếu
-- nào tới user_id trong transaction chưa xóa, FK sẽ chặn.
--
-- CÁCH DÙNG:
--   1. Đổi tên email owner ở dòng WHERE đầu để GIỮ LẠI 1 tài khoản
--   2. Chạy toàn bộ

DO $$
DECLARE
  keep_email text := 'owner@example.com'; -- ← đổi thành email owner cần giữ
  to_delete uuid[];
BEGIN
  -- Tập hợp uuid cần xóa
  SELECT array_agg(id) INTO to_delete
  FROM users
  WHERE email <> keep_email OR email IS NULL;

  -- Xóa ở bảng users trước (public schema)
  IF to_delete IS NOT NULL THEN
    DELETE FROM users WHERE id = ANY(to_delete);
    -- Supabase auth mirror
    DELETE FROM auth.users WHERE id = ANY(to_delete);
  END IF;
END $$;

-- Double-check
SELECT id, email, role, full_name FROM users;
