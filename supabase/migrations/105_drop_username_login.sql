-- ====================================================================
-- 105_drop_username_login
--
-- Bỏ hẳn `users.username` — định danh đăng nhập thứ ba, nay thừa.
--
-- VÌ SAO BỎ, KHÔNG PHẢI ĐỂ ĐÓ CHO CHẮC
--   Sau 104, số điện thoại là định danh của nhân viên. `username` làm
--   đúng một việc: thêm một cách nữa để cùng một người đăng nhập. Cái giá
--   thì có thật:
--     • một chỉ mục duy nhất nữa phải giữ đồng bộ
--     • một nhánh nữa trong RPC đăng nhập
--     • một ô nữa trên hai màn tạo người dùng — đúng thứ vừa được yêu cầu
--       làm gọn lại
--     • và một câu hỏi cho người vận hành: "nhân viên này đăng nhập bằng
--       số hay bằng tên tài khoản?" — câu hỏi lẽ ra không nên tồn tại
--
--   Bỏ được vì hệ thống CHƯA BÀN GIAO và database vừa reset: không có
--   dòng nào đang dùng cột này. Đây là lúc rẻ nhất để bỏ; để lâu thì nó
--   thành thứ không ai dám động.
--
-- CÒN LẠI HAI ĐƯỜNG ĐĂNG NHẬP
--   • Số điện thoại — nhân viên, và là đường chính.
--   • Email        — CHỈ dành cho tài khoản chủ NPP tạo từ Supabase
--                    Dashboard (xem supabase/bootstrap_owner.sql).
--                    Bỏ nốt vế này là khoá luôn đường vào đầu tiên của
--                    một bản cài mới, nên nó ở lại có chủ đích.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Chỉ bỏ khi thật sự không còn ai dùng. Có dữ liệu mà vẫn bỏ là xoá
--    âm thầm thứ người ta đang đăng nhập bằng nó.
-- --------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'username'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.users WHERE username IS NOT NULL AND length(trim(username)) > 0'
      INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'Có % tài khoản đang đặt username — bỏ cột này là họ mất một đường '
        'đăng nhập mà không được báo. Kiểm tra: SELECT full_name, username, phone '
        'FROM users WHERE username IS NOT NULL; Đảm bảo ai cũng có SĐT rồi xoá '
        'username thủ công, sau đó chạy lại migration này.',
        n;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_users_username_unique;
ALTER TABLE public.users DROP COLUMN IF EXISTS username;

-- --------------------------------------------------------------------
-- 2. RPC đăng nhập: chỉ còn SĐT và email.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id    text := lower(trim(coalesce(p_id, '')));
  v_phone text := public.normalize_phone(p_id);
  v_email text;
BEGIN
  IF length(v_id) < 2 THEN RETURN NULL; END IF;

  -- Chủ NPP đăng nhập bằng email thật (tài khoản tạo từ Dashboard).
  -- Vẫn kiểm tồn tại để không trả về một địa chỉ bất kỳ.
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- Nhân viên: số điện thoại, so theo dạng chuẩn hoá.
  IF v_phone = '' THEN RETURN NULL; END IF;

  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.phone IS NOT NULL
    AND public.normalize_phone(u.phone) = v_phone
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email đăng nhập từ SĐT (nhân viên) hoặc email (chủ NPP). Username đã bỏ ở 105.';
