-- ====================================================================
-- 106_owner_login_by_phone
--
-- Chủ NPP cũng đăng nhập bằng số điện thoại. Bỏ nốt nhánh email.
--
-- SAU MIGRATION NÀY CHỈ CÒN MỘT ĐỊNH DANH
--   Không còn "người này đăng nhập bằng gì" nữa: ai cũng gõ số điện thoại.
--   Email trong auth.users trở thành thuần kỹ thuật — Supabase Auth bắt
--   buộc phải có, hệ thống sinh ra từ chính SĐT, và không ai nhìn thấy.
--
-- ⚠ RỦI RO PHẢI CHẶN
--   Bỏ nhánh email nghĩa là tài khoản nào KHÔNG CÓ SĐT sẽ không còn cách
--   nào đăng nhập — kể cả chủ NPP. Nếu đó là tài khoản duy nhất thì mất
--   luôn quyền vào hệ thống, và không có đường sửa từ giao diện.
--
--   Nên migration này DỪNG nếu còn tài khoản đang hoạt động mà thiếu SĐT,
--   và nêu rõ tên. Sửa xong chạy lại.
-- ====================================================================

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(full_name || ' (' || role || ')', '; ')
  INTO missing
  FROM public.users
  WHERE coalesce(is_active, true)
    AND (phone IS NULL OR public.normalize_phone(phone) = '');

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Những tài khoản này chưa có số điện thoại: %. Sau migration này, SĐT là '
      'cách đăng nhập DUY NHẤT — họ sẽ không vào được nữa và không sửa được từ '
      'giao diện. Cập nhật SĐT trước: UPDATE public.users SET phone = ''09xxxxxxxx'' '
      'WHERE id = ''...''; rồi chạy lại migration này.',
      missing;
  END IF;
END $$;

-- --------------------------------------------------------------------
-- RPC đăng nhập: CHỈ còn số điện thoại.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_email_by_identifier(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_id);
  v_email text;
BEGIN
  -- Không phải số thì thôi. Trả NULL chứ không báo lỗi riêng: client hiện
  -- một câu chung "sai số hoặc mật khẩu", để người ngoài không dò được số
  -- nào đang tồn tại trong hệ thống.
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
  'Tra email kỹ thuật từ SĐT để đăng nhập. SĐT là định danh DUY NHẤT (106).';
