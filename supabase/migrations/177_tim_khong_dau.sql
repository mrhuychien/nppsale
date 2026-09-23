-- ====================================================================
-- TÌM KHÔNG DẤU Ở MÁY CHỦ
--
-- Chủ nhà chốt 23/09/2026: "có". Ô tìm trên danh sách (hàng hoá, khách,
-- NCC, và các ô "Theo mã, tên hàng" / "Theo tên khách" của danh sách
-- chứng từ) hỏi máy chủ bằng `ilike` — gõ "banh dau xanh" không ra
-- "Bánh Đậu Xanh". Màn bán hàng thì đã bỏ dấu từ lâu (src/lib/search.ts
-- `viNormalize`) vì nó lọc danh mục trong máy; danh sách phân trang thì
-- không lọc trong máy được.
--
-- ⚠ CÁCH LÀM: mỗi bảng có thêm cột `tim_kd` — các cột tìm được ghép lại,
--   BỎ DẤU, chữ thường, gộp khoảng trắng — đúng y luật `viNormalize`.
--   Ô tìm bỏ dấu chữ gõ bằng `viNormalize` rồi `ilike` vào cột này (kèm
--   các điều kiện cũ). Chốt tests/tim-khong-dau.test.ts và
--   /tmp/pgtest/t177.sql giữ hai bên cùng một luật.
--
-- ⚠ CỘT DO TRIGGER GHI, KHÔNG PHẢI CỘT GENERATED. Cột generated từ chối
--   mọi câu ghi có nhắc tới nó — màn nào đọc `select("*")` rồi ghi lại
--   nguyên dòng là vỡ. Trigger thì ghi đè: trình duyệt gửi gì vào `tim_kd`
--   cũng không sao.
--
-- ⚠ CHUẨN HOÁ NFC TRƯỚC. `unaccent` chỉ biết chữ dựng sẵn ("á" một ký tự);
--   chữ nhập từ Excel trên máy Mac hay ở dạng tách ("a" + dấu sắc) và lọt
--   qua nguyên dấu. `viNormalize` (NFD rồi bỏ dấu) thì xử lý được cả hai.
-- ⚠ KHOẢNG TRẮNG LIỆT KÊ TƯỜNG MINH. `\s` của Postgres (locale C) không
--   nhận dấu cách không ngắt (U+00A0 — hay dính khi dán từ Excel/web);
--   `\s` của JS thì nhận. Danh sách là đúng tập `\s` của JS.
--
-- ⚠ `unaccent` không IMMUTABLE (từ điển có thể đổi), nên bọc trong
--   `khong_dau()` gọi từ điển theo tên đầy đủ. Schema của tiện ích tra lúc
--   chạy: Supabase đặt ở `extensions`, nơi khác có thể là `public`.
-- ====================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

DO $kd$
DECLARE v_sch text;
BEGIN
  SELECT n.nspname INTO v_sch
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.khong_dau(p text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = public
    AS $b$
      SELECT btrim(regexp_replace(lower(
        %1$I.unaccent('%1$I.unaccent'::regdictionary,
          replace(replace(normalize(COALESCE(p, ''), NFC), 'đ', 'd'), 'Đ', 'D'))
      ), '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))
    $b$
  $f$, v_sch);
END;
$kd$;

GRANT EXECUTE ON FUNCTION public.khong_dau(text) TO authenticated;

-- Trigger chung: TG_ARGV là danh sách cột ghép vào `tim_kd`.
CREATE OR REPLACE FUNCTION public._trg_tim_kd()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_txt text := '';
  i int;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_txt := v_txt || ' ' || COALESCE(v_row->>TG_ARGV[i], '');
  END LOOP;
  NEW.tim_kd := public.khong_dau(v_txt);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._trg_tim_kd() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.products  ADD COLUMN IF NOT EXISTS tim_kd text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tim_kd text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tim_kd text;

DROP TRIGGER IF EXISTS trg_tim_kd ON public.products;
CREATE TRIGGER trg_tim_kd BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public._trg_tim_kd('sku', 'name', 'barcode');

DROP TRIGGER IF EXISTS trg_tim_kd ON public.customers;
CREATE TRIGGER trg_tim_kd BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public._trg_tim_kd('store_name', 'owner_name', 'phone', 'tax_code');

DROP TRIGGER IF EXISTS trg_tim_kd ON public.suppliers;
CREATE TRIGGER trg_tim_kd BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public._trg_tim_kd('name', 'code', 'phone', 'tax_code');

-- Điền cho dòng cũ — trigger tự tính; chỉ chạm dòng còn thiếu / lệch.
UPDATE public.products  SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khong_dau(concat_ws(' ', '', sku, name, barcode));
UPDATE public.customers SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khong_dau(concat_ws(' ', '', store_name, owner_name, phone, tax_code));
UPDATE public.suppliers SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khong_dau(concat_ws(' ', '', name, code, phone, tax_code));

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — chỉ đọc. Mong đợi: ba dòng "chưa có" bằng 0, và dòng
-- thử ra "banh dau xanh ha noi".
-- ---------------------------------------------------------------------
SELECT 'Hàng hoá chưa có tim_kd' AS hang_muc, count(*)::text AS gia_tri
FROM products WHERE tim_kd IS NULL
UNION ALL
SELECT 'Khách hàng chưa có tim_kd', count(*)::text FROM customers WHERE tim_kd IS NULL
UNION ALL
SELECT 'Nhà cung cấp chưa có tim_kd', count(*)::text FROM suppliers WHERE tim_kd IS NULL
UNION ALL
SELECT 'Thử: khong_dau(''  Bánh ĐẬU  Xanh Hà Nội '')', public.khong_dau('  Bánh ĐẬU  Xanh Hà Nội ');
