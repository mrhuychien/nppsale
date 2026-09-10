-- ====================================================================
-- 104_login_by_phone
--
-- Số điện thoại thành ĐỊNH DANH CHÍNH của nhân viên, thay cho email.
--
-- VÌ SAO
--   Nhân viên bán hàng phần lớn không có email. Bắt họ có một cái chỉ để
--   đăng nhập là dựng thêm một rào cản cho đúng nhóm người dùng nhiều
--   nhất. Số điện thoại thì ai cũng có, và chính họ nhớ.
--
-- VẤN ĐỀ ĐÃ CÓ TỪ 085
--   085 cho phép đăng nhập bằng phone, nhưng so khớp chỉ BỎ KHOẢNG TRẮNG:
--       regexp_replace(u.phone, '\s+', '', 'g') = <người dùng gõ>
--   Nên cùng một số nhập khác dạng là KHÔNG khớp:
--       tạo "0909 123 456"  →  gõ "0909123456"   ✓ (may mắn khớp)
--       tạo "0909.123.456"  →  gõ "0909123456"   ✗ KHÔNG khớp
--       tạo "0909123456"    →  gõ "+84909123456" ✗ KHÔNG khớp
--   Người dùng gõ đúng số của mình mà bị báo sai tài khoản, và không có
--   cách nào tự hiểu vì sao.
--
-- CÁCH LÀM: chuẩn hoá KHI SO, giữ nguyên KHI LƯU
--   `users.phone` vẫn lưu đúng những gì người nhập — để hiển thị, để bấm
--   gọi. Việc so khớp đi qua public.normalize_phone(), và ĐÚNG MỘT hàm đó
--   được dùng cho CẢ chỉ mục duy nhất LẪN RPC đăng nhập. Một định nghĩa,
--   không có bản sao để lệch.
--
--   Bản TS tương ứng: src/lib/users/phone.ts
--   Bộ ca kiểm dùng chung: tests/fixtures/phone-cases.json
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Chuẩn hoá: chỉ chữ số, luôn bắt đầu bằng '0'.
--    IMMUTABLE để dùng được trong chỉ mục.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d = ''                                  THEN ''
    -- Mã quốc gia: 84909123456 → 0909123456
    WHEN d LIKE '84%' AND length(d) >= 11         THEN '0' || substr(d, 3)
    WHEN d LIKE '0%'                              THEN d
    -- Thiếu số 0 đầu: 909123456 → 0909123456
    WHEN length(d) = 9                            THEN '0' || d
    ELSE d
  END
  FROM (
    SELECT regexp_replace(
             -- Bỏ tiền tố quay số quốc tế trước, rồi mới xét mã quốc gia:
             -- 0084909123456 → 84909123456 → 0909123456
             regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^00', ''),
             '', ''
           ) AS d
  ) t;
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
  'Quy SĐT về một dạng để SO KHỚP (chỉ chữ số, bắt đầu bằng 0). Bản TS: src/lib/users/phone.ts';

-- --------------------------------------------------------------------
-- 2. Trước khi siết chỉ mục: nếu dữ liệu hiện có bị trùng sau khi chuẩn
--    hoá thì DỪNG và NÊU RÕ số nào, thay vì để Postgres ném một lỗi
--    "duplicate key" không nói được ai trùng ai.
-- --------------------------------------------------------------------
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(x, '; ') INTO dup FROM (
    SELECT public.normalize_phone(phone) || ' (' || count(*) || ' người)' AS x
    FROM public.users
    WHERE phone IS NOT NULL AND length(trim(phone)) > 0
    GROUP BY public.normalize_phone(phone)
    HAVING count(*) > 1
  ) t;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION
      'Có SĐT trùng nhau sau khi chuẩn hoá: %. Số điện thoại nay là định danh '
      'đăng nhập nên phải duy nhất — sửa dữ liệu trước rồi chạy lại migration này. '
      'Xem chi tiết: SELECT public.normalize_phone(phone), full_name, role FROM users '
      'WHERE phone IS NOT NULL ORDER BY 1;',
      dup;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 3. Chỉ mục duy nhất theo DẠNG CHUẨN HOÁ.
--    Chỉ mục cũ (085) chỉ bỏ khoảng trắng nên "0909.123.456" và
--    "0909123456" lọt qua như hai người khác nhau.
-- --------------------------------------------------------------------
DROP INDEX IF EXISTS idx_users_phone_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON public.users (public.normalize_phone(phone))
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

-- --------------------------------------------------------------------
-- 4. RPC đăng nhập: so bằng CÙNG hàm chuẩn hoá đó.
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

  -- Đã là email thì trả thẳng (vẫn kiểm tồn tại để không trả bừa).
  IF v_id LIKE '%@%' THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE lower(au.email) = v_id
    LIMIT 1;
    RETURN v_email;
  END IF;

  -- SĐT trước — đây là đường đăng nhập chính của nhân viên.
  IF v_phone <> '' THEN
    SELECT au.email INTO v_email
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
    WHERE u.phone IS NOT NULL
      AND public.normalize_phone(u.phone) = v_phone
    LIMIT 1;
    IF v_email IS NOT NULL THEN RETURN v_email; END IF;
  END IF;

  -- Còn lại: tên tài khoản.
  SELECT au.email INTO v_email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.username IS NOT NULL AND lower(u.username) = v_id
  LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_email_by_identifier(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_email_by_identifier(text) IS
  'Tra email từ SĐT / tên tài khoản / email để đăng nhập. SĐT so theo dạng chuẩn hoá.';
