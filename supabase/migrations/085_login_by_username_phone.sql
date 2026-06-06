-- ====================================================================
-- 085_login_by_username_phone
--
-- Cho phép đăng nhập bằng username hoặc số điện thoại thay vì email.
-- Supabase Auth dùng email làm key — ta tra ngược identifier → email
-- qua RPC SECURITY DEFINER, rồi client gọi signInWithPassword({email,
-- password}) như cũ.
--
-- Schema:
--   - users.username text: tài khoản đăng nhập (chữ + số), không bắt buộc.
--   - Unique partial index trên LOWER(username), WHERE NOT NULL.
--   - Unique partial index trên phone (đã có cột), WHERE NOT NULL.
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (LOWER(username))
  WHERE username IS NOT NULL AND length(trim(username)) > 0;

-- Phone unique để identifier không ambiguous khi login.
-- Nếu data hiện có trùng phone → migration sẽ fail; cleanup trước khi
-- chạy hoặc tạm bỏ index này và dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users (regexp_replace(phone, '\s+', '', 'g'))
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

COMMENT ON COLUMN users.username IS
  'Tài khoản đăng nhập (alias). Chữ + số + dấu chấm/gạch, không khoảng trắng.';

-- --------------------------------------------------------------------
-- RPC: tra email từ identifier (username | phone | email). Trả NULL
-- nếu không match — client xử lý báo lỗi chung "sai tài khoản hoặc
-- mật khẩu" để không leak chi tiết identifier tồn tại hay không.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_id text := lower(trim(coalesce(p_id, '')));
  v_id_no_space text := regexp_replace(coalesce(p_id, ''), '\s+', '', 'g');
  v_email text;
BEGIN
  IF length(v_id) < 2 THEN RETURN NULL; END IF;

  -- Nếu là email rồi → trả thẳng (vẫn check tồn tại để không trả random).
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- Tra theo username (case-insensitive) hoặc phone (bỏ khoảng trắng).
  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE
    (u.username IS NOT NULL AND lower(u.username) = v_id)
    OR (u.phone IS NOT NULL AND regexp_replace(u.phone, '\s+', '', 'g') = v_id_no_space)
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email từ username hoặc phone để đăng nhập. Public — chỉ trả email khi identifier match.';
