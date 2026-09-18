-- ---------------------------------------------------------------------
-- 122 — Bỏ vai TÀI XẾ: khoá các tài khoản đang mang vai đó, chặn gán
--       mới, và làm cho "khoá tài khoản" THẬT SỰ khoá
-- ---------------------------------------------------------------------
--
-- Workflow v2 bỏ bước lập chuyến giao; P7 ẩn `/deliveries` và khoá mọi
-- nút ghi ở đó. Vai `driver` vì thế không còn việc riêng trên hệ thống.
-- Chủ NPP chọn: KHOÁ tài khoản, KHÔNG đổi vai của ai.
--
-- ⚠ VÌ SAO KHÔNG SIẾT LUÔN `CHECK (role IN (...))`.
--   Chủ NPP cố ý giữ `role = 'driver'` trên các dòng cũ — đó là hồ sơ
--   nhân sự, và `deliveries.driver_id` trỏ thẳng vào những dòng đó.
--   Siết ràng buộc là ALTER TABLE ném lỗi ngay trên chính dữ liệu đang
--   có. Chặn GÁN MỚI phải làm bằng trigger, vì CHECK không phân biệt
--   được dòng cũ với dòng mới.
--
-- =====================================================================
-- ⚠ PHÁT HIỆN KHI LÀM: `is_active = false` TRƯỚC NAY KHÔNG KHOÁ GÌ CẢ
-- =====================================================================
--
-- Đây là lỗ có sẵn, không phải do đợt này sinh ra, nhưng nó làm hỏng
-- đúng thứ chủ NPP vừa chọn.
--
-- Cả kho chỉ có MỘT chỗ đọc `users.is_active` để chặn: đường đăng nhập
-- bằng mã QR (`src/app/qr-login/route.ts`). Đường đăng nhập thường
-- (email + mật khẩu) đọc `is_active` vào hồ sơ rồi... không hỏi tới nó
-- lần nào. Phía cơ sở dữ liệu cũng vậy: `user_org_id()` và `user_role()`
-- chỉ tra `org_id` / `role` theo `auth.uid()`, không nhìn `is_active`,
-- nên MỌI policy RLS vẫn cho qua.
--
-- Nghĩa là: nhân viên đã nghỉ việc, đã bị "Khoá tài khoản" ở màn Cài
-- đặt → Người dùng, VẪN đăng nhập được bằng mật khẩu cũ và vẫn giữ
-- nguyên quyền của vai mình. Nút "Khoá" từ trước tới nay chỉ là một cái
-- nhãn.
--
-- ⚠ CHỮA Ở HAI HÀM HELPER, KHÔNG ĐI SỬA 167 POLICY. Mọi policy RLS đều
--   đi qua `user_org_id()`; trả NULL ở đó là mọi phép so `org_id = NULL`
--   thành NULL → không dòng nào khớp → chặn sạch, một chỗ sửa.
--
-- ⚠ `COALESCE(is_active, true)` LÀ BẮT BUỘC. Cột này NULL được
--   (`is_active boolean DEFAULT true`, mig 001 — không NOT NULL). Dòng
--   nào có NULL mà đọc thành "không hoạt động" là khoá oan một người
--   đang đi làm, và khoá theo kiểu im lặng nhất: app trống trơn, không
--   câu nào giải thích.
--
-- ⚠ RLS TỪ CHỐI LÀ IM LẶNG — 0 dòng, HTTP 200, `error` null. Khoá ở đây
--   chỉ làm app trống, KHÔNG nói vì sao. Câu giải thích và lệnh đăng
--   xuất nằm ở `src/hooks/use-auth.tsx`. Hai lớp phải đi cùng nhau: lớp
--   này để không lách được, lớp kia để người dùng hiểu chuyện gì xảy ra.
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- 1. Xem trước: những tài khoản SẮP bị khoá.
--
-- ⚠ IN RA TRƯỚC KHI ĐỔI. Đây là thao tác hàng loạt lên quyền truy cập
--   của người thật; chủ NPP phải đọc được danh sách để gọi cho họ.
-- --------------------------------------------------------------------
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT u.full_name, u.phone, o.name AS org
    FROM users u LEFT JOIN organizations o ON o.id = u.org_id
    WHERE u.role = 'driver' AND COALESCE(u.is_active, true) = true
    ORDER BY o.name, u.full_name
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '122 — sẽ khoá: % (%) — %', r.full_name, COALESCE(r.phone, 'chưa có SĐT'), r.org;
  END LOOP;
  IF v_n = 0 THEN
    RAISE NOTICE '122 — không có tài khoản tài xế nào đang hoạt động.';
  END IF;
END $$;

-- --------------------------------------------------------------------
-- 2. Khoá. KHÔNG đổi `role`, KHÔNG xoá dòng nào.
--
-- ⚠ Xoá tài khoản là mất hồ sơ: `deliveries.driver_id` trỏ vào đây, và
--   mọi chuyến giao cũ sẽ mất tên người giao.
-- --------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  UPDATE users
  SET is_active = false
  WHERE role = 'driver' AND COALESCE(is_active, true) = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 122: đã khoá % tài khoản tài xế (vai giữ nguyên, hồ sơ giữ nguyên) ---', v_n;
END $$;

-- --------------------------------------------------------------------
-- 3. Làm cho việc khoá THẬT SỰ có hiệu lực.
--
-- Hai hàm này là cửa ngõ của toàn bộ RLS. Trả NULL cho người đã bị khoá
-- là mọi policy đều không khớp dòng nào.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- ⚠ `COALESCE(is_active, true)`: cột NULL được, và NULL nghĩa là CHƯA
  --   AI KHOÁ — không phải "đã khoá".
  RETURN (
    SELECT org_id FROM public.users
    WHERE id = (SELECT auth.uid())
      AND COALESCE(is_active, true) = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT role FROM public.users
    WHERE id = (SELECT auth.uid())
      AND COALESCE(is_active, true) = true
  );
END;
$$;

COMMENT ON FUNCTION public.user_org_id() IS
  'Đơn vị của người đang đăng nhập, NULL nếu tài khoản đã bị khoá. '
  'Mọi policy RLS đi qua đây, nên đó là chỗ duy nhất cần chặn.';
COMMENT ON FUNCTION public.user_role() IS
  'Vai của người đang đăng nhập, NULL nếu tài khoản đã bị khoá.';

-- --------------------------------------------------------------------
-- 4. Chặn gán vai `driver` cho người mới.
--
-- ⚠ TRIGGER CHỨ KHÔNG PHẢI CHECK. Ràng buộc CHECK áp cho cả dòng cũ, mà
--   dòng cũ cố ý giữ nguyên `role = 'driver'` — siết CHECK là ALTER
--   TABLE hỏng ngay trên dữ liệu đang có.
--
-- ⚠ CHỈ CHẶN KHI GIÁ TRỊ THẬT SỰ ĐỔI THÀNH 'driver'. Dòng tài xế cũ vẫn
--   phải sửa được (đổi số điện thoại, đổi tên, và nhất là ĐỔI SANG VAI
--   KHÁC). Chặn mọi UPDATE chạm vào dòng đó là nhốt luôn chủ NPP ngoài
--   cửa, không còn đường dọn dẹp.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_block_driver_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role = 'driver' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'driver') THEN
    RAISE EXCEPTION
      'ROLE_RETIRED: vai Tài xế đã ngưng dùng — quy trình mới không còn bước lập chuyến giao. Chọn vai khác.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_driver_role ON users;
CREATE TRIGGER trg_block_driver_role
  BEFORE INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_driver_role();

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm phần còn lại để chủ NPP biết còn gì phải dọn tay.
-- --------------------------------------------------------------------
DO $$
DECLARE v_left int; v_deliv int;
BEGIN
  SELECT count(*) INTO v_left FROM users WHERE role = 'driver';
  SELECT count(*) INTO v_deliv FROM deliveries WHERE driver_id IS NOT NULL;
  RAISE NOTICE '--- 122: còn % dòng users mang vai driver (đã khoá, giữ làm hồ sơ) ---', v_left;
  RAISE NOTICE '--- 122: % chuyến giao cũ đang trỏ driver_id — đó là lý do KHÔNG xoá các dòng trên ---', v_deliv;
  IF v_left > 0 THEN
    RAISE NOTICE '--- 122: muốn họ đi làm lại thì vào Cài đặt → Người dùng, đổi sang vai khác rồi mở khoá ---';
  END IF;
END $$;
