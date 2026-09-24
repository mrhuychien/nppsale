-- ====================================================================
-- QUYỀN GIẢM GIÁ THEO TỪNG NHÂN VIÊN
--
-- Chủ nhà chốt 24/09/2026: "Cho phép giảm giá, set tối đa theo % hoặc giá
-- trị (nếu để trống, ko giới hạn) chức năng này có thể bật/tắt tuỳ chỉnh cho
-- từng nhân viên bán hàng. Đặt dưới phần bật/tắt chức năng sửa giá trong tuỳ
-- chỉnh từng nhân viên. Mặc định là tắt, khi chức năng này tắt, phần giảm giá
-- ở từng dòng và cả đơn ẩn đi với nhân viên bán hàng. Nhà phân phối thì toàn
-- quyền giảm giá dòng và giảm giá đơn."
--
-- BA CỘT, CÙNG CHỖ VỚI QUYỀN SỬA GIÁ (mig 027):
--   allow_discount      — bật/tắt, MẶC ĐỊNH TẮT.
--   discount_max_type   — 'pct' | 'vnd': mức trần tính theo % hay theo đồng.
--   discount_max_value  — NULL = KHÔNG GIỚI HẠN (đúng "để trống").
--   Trần áp riêng cho MỖI dòng (so với tiền hàng của dòng) và cho giảm giá cả
--   đơn (so với tiền hàng của đơn).
--
-- ⚠ CHỈ CHỦ NPP SỬA ĐƯỢC. Chính sách "Owner update users" (mig 008) đã khoá
--   UPDATE bảng users cho chủ NPP — nhân viên không tự bật quyền cho mình.
-- ⚠ CHỦ NPP / KẾ TOÁN KHÔNG CẦN CỜ: ứng dụng coi họ là toàn quyền
--   (`userPriceRulesFrom`), y như quyền sửa giá.
-- ====================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS allow_discount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount_max_type text NOT NULL DEFAULT 'pct',
  ADD COLUMN IF NOT EXISTS discount_max_value numeric;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_discount_max_type_check') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_discount_max_type_check CHECK (discount_max_type IN ('pct', 'vnd'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_discount_max_value_check') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_discount_max_value_check CHECK (
        discount_max_value IS NULL
        OR (discount_max_value >= 0 AND (discount_max_type <> 'pct' OR discount_max_value <= 100))
      );
  END IF;
END;
$chk$;

COMMENT ON COLUMN public.users.allow_discount IS
  'Nhân viên được giảm giá dòng / giảm giá đơn (mig 185). Mặc định tắt: ô giảm giá ẩn với NVBH. Chủ NPP / kế toán luôn toàn quyền.';
COMMENT ON COLUMN public.users.discount_max_type IS
  'Đơn vị trần giảm giá: pct = % tiền hàng, vnd = số đồng. Áp riêng cho mỗi dòng và cho cả đơn (mig 185).';
COMMENT ON COLUMN public.users.discount_max_value IS
  'Trần giảm giá theo discount_max_type. NULL = không giới hạn (mig 185).';

NOTIFY pgrst, 'reload schema';

SELECT c.column_name AS cot, c.data_type AS kieu, c.column_default AS mac_dinh
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'users'
  AND c.column_name IN ('allow_discount', 'discount_max_type', 'discount_max_value')
ORDER BY c.column_name;
