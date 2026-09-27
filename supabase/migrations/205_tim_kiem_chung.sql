-- ====================================================================
-- TÌM KIẾM CHUNG: KHÔNG DẤU, TỪNG TỪ, MÃ / SĐT VIẾT LIỀN, CHỈ MỤC TRIGRAM
--
-- VÌ SAO — chủ nhà 27/09/2026: "Xử lý các ô tìm kiếm ở các danh sách (và các
--   chỗ khác sử dụng ô tìm kiếm): tìm kiếm chính xác, linh hoạt hơn, tìm kiếm
--   được không dấu. Xem thuật toán tìm kiếm nào tối ưu nhất hiện nay thì sử dụng."
--
--   Mig 177 cho ba bảng (hàng, khách, NCC) một cột `tim_kd` bỏ dấu, nhưng:
--     · ô tìm so NGUYÊN CỤM: "hop sua" không ra "Sữa hộp";
--     · mã và SĐT phải gõ đúng dấu gạch / dấu cách: "dh0123" không ra
--       "DH-0123", "0912345678" không ra "0912 345 678";
--     · danh sách chứng từ (đơn, hóa đơn, phiếu trả, phiếu thu, phiếu nhập,
--       lô, công nợ NCC, người dùng, HĐ điện tử) không có gì bỏ dấu cả —
--       tìm người lập "tuan" không ra "Tuấn";
--     · `ilike '%x%'` quét cả bảng — không có chỉ mục nào đỡ.
--
-- ⚠ CÁCH LÀM (thuật toán chung với src/lib/search.ts):
--   1. `khoa_tim(text)` — KHOÁ TÌM của một giá trị: bỏ dấu (`khong_dau`),
--      dấu câu thành chỗ ngắt từ, rồi thêm bản VIẾT LIỀN và bản BỎ SỐ 0 ĐẦU:
--        'DH-0123'      → 'dh 0123 dh0123 dh123'
--        '0912 345 678' → '0912 345 678 0912345678 912345678'
--      Trình duyệt tách chữ gõ thành từng từ (viết liền trong từ) và đòi MỌI
--      từ có mặt trong khoá — mỗi từ là một `ilike`, ghép bằng VÀ.
--      ⚠ PHẢI TRÙNG `viValueKey` (src/lib/search.ts) từng ký tự — chốt
--        tests/tim-chung.test.ts giữ cặp mẫu chung.
--   2. Ba bảng có cột `tim_kd` (mig 177): trigger nay ghi khoá mới; điền lại
--      chỉ những dòng lệch.
--   3. Bảng chứng từ: KHÔNG thêm cột, KHÔNG ghi lại dòng nào. `tim_kd` ở đây
--      là CỘT TÍNH (computed field của PostgREST): hàm `public.tim_kd(<bảng>)`.
--      Ghi lại hàng chục nghìn đơn / hóa đơn trên sổ thật (dùng chung preview
--      và production) là chạy mọi trigger của bảng đó — không đáng.
--   4. `pg_trgm` + chỉ mục GIN `gin_trgm_ops` trên đúng biểu thức ấy, để
--      `ilike '%x%'` đi chỉ mục thay vì quét bảng. Hàm cột tính là SQL
--      IMMUTABLE một câu, nên Postgres "mở" nó ra và khớp được chỉ mục biểu
--      thức (đã kiểm bằng EXPLAIN trên Postgres 16).
--
-- ⚠ CHƯA CHẠY MIGRATION NÀY THÌ APP VẪN CHẠY: trình duyệt dò `tim_kd` của
--   bảng chứng từ một lần (`coTimKd`), thiếu thì tìm theo cột cũ như trước.
-- ⚠ CREATE INDEX (không CONCURRENTLY — trình soạn SQL chạy cả tệp trong một
--   giao dịch) khoá GHI bảng trong lúc dựng chỉ mục: vài giây với cỡ sổ hiện
--   tại. Nên chạy lúc vắng.
-- ====================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. Khoá tìm của một giá trị ------------------------------------------
CREATE OR REPLACE FUNCTION public.khoa_tim(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  WITH t AS (
    SELECT array_remove(regexp_split_to_array(public.khong_dau(p), '[^a-z0-9]+'), '') AS tu
  ), l AS (
    SELECT tu,
           array_to_string(tu, '') AS lien,
           array_to_string(ARRAY(
             SELECT regexp_replace(x, '(^|[a-z])0+(?=[0-9])', '\1', 'g')
             FROM unnest(tu) WITH ORDINALITY u(x, i) ORDER BY i
           ), '') AS lien0
    FROM t
  )
  SELECT CASE WHEN cardinality(tu) = 0 THEN ''
    ELSE array_to_string(tu, ' ')
      || CASE WHEN cardinality(tu) > 1 THEN ' ' || lien ELSE '' END
      || CASE WHEN lien0 <> lien THEN ' ' || lien0 ELSE '' END
  END
  FROM l
$fn$;

-- Khoá của nhiều giá trị — ghép các khoá khác rỗng bằng một dấu cách.
CREATE OR REPLACE FUNCTION public.khoa_tim_ds(VARIADIC p text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT array_to_string(ARRAY(
    SELECT k FROM unnest(p) WITH ORDINALITY u(v, i), LATERAL (SELECT public.khoa_tim(v) AS k) z
    WHERE k <> '' ORDER BY i
  ), ' ')
$fn$;

GRANT EXECUTE ON FUNCTION public.khoa_tim(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.khoa_tim_ds(text[]) TO authenticated;

-- 2. Ba bảng có cột tim_kd: trigger ghi khoá mới --------------------------
CREATE OR REPLACE FUNCTION public._trg_tim_kd()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_gt text[] := '{}';
  i int;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_gt := v_gt || COALESCE(v_row->>TG_ARGV[i], '');
  END LOOP;
  NEW.tim_kd := public.khoa_tim_ds(VARIADIC v_gt);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._trg_tim_kd() FROM PUBLIC, anon, authenticated;

-- Điền lại — trigger tự tính; chỉ chạm dòng lệch (chạy lại lần hai: 0 dòng).
UPDATE public.products SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(sku::text, name::text, barcode::text);
UPDATE public.customers SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(store_name::text, owner_name::text, phone::text,
   tax_code::text, address::text, ward::text, district::text, province::text);
UPDATE public.suppliers SET tim_kd = NULL
 WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(name::text, code::text, phone::text, tax_code::text);

-- 3 + 4. Cột tính `tim_kd` cho bảng chứng từ, và chỉ mục trigram ----------
DO $ct$
DECLARE
  v_trgm text;
  r record;
  v_bt text;
  v_thieu int;
BEGIN
  SELECT n.nspname INTO v_trgm
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  -- Chỉ mục cho cột tim_kd thật của ba bảng mig 177.
  FOR r IN SELECT * FROM (VALUES ('products'), ('customers'), ('suppliers')) x(bang) LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (tim_kd %I.gin_trgm_ops)',
      'idx_' || r.bang || '_tim_kd_trgm', r.bang, v_trgm);
  END LOOP;

  -- Bảng → các cột ghép vào khoá, theo thứ tự quan trọng.
  FOR r IN SELECT * FROM (VALUES
    ('sales_orders',   ARRAY['order_code']),
    ('sales_invoices', ARRAY['invoice_code']),
    ('returns',        ARRAY['return_code']),
    ('stock_entries',  ARRAY['entry_code']),
    ('batches',        ARRAY['batch_code']),
    ('payables',       ARRAY['invoice_number']),
    ('cash_receipts',  ARRAY['receipt_code', 'notes']),
    ('users',          ARRAY['full_name', 'phone']),
    ('invoices',       ARRAY['invoice_number', 'customer_name', 'misa_inv_no', 'misa_invoice_id'])
  ) x(bang, cot) LOOP
    -- Bảng / cột chưa có (sổ cài mới dở dang) thì bỏ qua, không làm hỏng cả tệp.
    SELECT count(*) INTO v_thieu FROM unnest(r.cot) c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = r.bang AND column_name = c);
    IF to_regclass('public.' || r.bang) IS NULL OR v_thieu > 0 THEN
      RAISE NOTICE 'Bỏ qua %: thiếu bảng hoặc cột', r.bang;
      CONTINUE;
    END IF;

    -- Biểu thức DÙNG CHUNG cho hàm cột tính và chỉ mục — lệch một ký tự là
    -- Postgres không khớp được chỉ mục nữa.
    SELECT 'public.khoa_tim_ds(VARIADIC ARRAY[' || string_agg(format('(%s).%I::text', '$1', c), ', ') || '])'
      INTO v_bt FROM unnest(r.cot) c;
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.tim_kd(public.%I) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS %L',
      r.bang, 'SELECT ' || v_bt);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.tim_kd(public.%I) TO authenticated', r.bang);

    SELECT 'public.khoa_tim_ds(VARIADIC ARRAY[' || string_agg(format('%I::text', c), ', ') || '])'
      INTO v_bt FROM unnest(r.cot) c;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin ((%s) %I.gin_trgm_ops)',
      'idx_' || r.bang || '_tim_kd_trgm', r.bang, v_bt, v_trgm);
  END LOOP;
END;
$ct$;

-- 5. Ô "tìm khách trùng" (mig 082) — cùng luật: từng từ, không dấu, SĐT viết
--    liền; xếp SĐT trùng khớp → đầu SĐT → đầu tên → địa chỉ → còn lại.
--    Giữ nguyên chữ ký và quyền (màn tạo khách gọi thẳng từ trình duyệt).
CREATE OR REPLACE FUNCTION public.search_customer_dupes(p_q text)
RETURNS TABLE (
  id uuid,
  store_name text,
  owner_name text,
  phone text,
  address text,
  ward text,
  primary_user_name text,
  has_my_assignment boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_uid uuid := (SELECT auth.uid());
  v_tu text[];
  v_lien text;
  v_so text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
BEGIN
  -- Từ gõ: bỏ dấu, viết liền trong từ (y như `viQueryWords`).
  SELECT coalesce(array_agg(DISTINCT w), '{}') INTO v_tu
  FROM (
    SELECT regexp_replace(x, '[^a-z0-9]', '', 'g') AS w
    FROM regexp_split_to_table(public.khong_dau(p_q), ' ') x
  ) z
  WHERE w <> '';
  v_lien := array_to_string(v_tu, '');
  IF v_org IS NULL OR length(v_lien) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.store_name,
    c.owner_name,
    c.phone,
    c.address,
    c.ward,
    u.full_name AS primary_user_name,
    EXISTS (
      SELECT 1 FROM customer_assignments
      WHERE customer_id = c.id AND user_id = v_uid AND status = 'active'
    ) AS has_my_assignment
  FROM customers c
  LEFT JOIN customer_assignments ca
    ON ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
  LEFT JOIN users u ON u.id = ca.user_id
  WHERE c.org_id = v_org
    AND NOT EXISTS (SELECT 1 FROM unnest(v_tu) t WHERE position(t IN coalesce(c.tim_kd, '')) = 0)
  ORDER BY
    CASE
      WHEN v_so <> '' AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_so THEN 0
      WHEN length(v_so) >= 3 AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE v_so || '%' THEN 1
      WHEN regexp_replace(public.khong_dau(c.store_name), '[^a-z0-9]', '', 'g') LIKE v_lien || '%' THEN 2
      WHEN position(v_lien IN regexp_replace(public.khong_dau(c.address), '[^a-z0-9]', '', 'g')) > 0 THEN 3
      ELSE 4
    END,
    c.store_name
  LIMIT 20;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_customer_dupes(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: ba dòng "lệch" bằng 0, 9 hàm cột tính,
-- 12 chỉ mục trigram, và dòng thử ra 'dh 0123 dh0123 dh123'.
-- ---------------------------------------------------------------------
SELECT 'Hàng hoá tim_kd lệch khoá mới' AS hang_muc,
       count(*)::text AS gia_tri
FROM products WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(sku::text, name::text, barcode::text)
UNION ALL
SELECT 'Khách hàng tim_kd lệch khoá mới', count(*)::text FROM customers
WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(store_name::text, owner_name::text, phone::text,
  tax_code::text, address::text, ward::text, district::text, province::text)
UNION ALL
SELECT 'NCC tim_kd lệch khoá mới', count(*)::text FROM suppliers
WHERE tim_kd IS DISTINCT FROM public.khoa_tim_ds(name::text, code::text, phone::text, tax_code::text)
UNION ALL
SELECT 'Hàm cột tính tim_kd(<bảng>)', count(*)::text FROM pg_proc
WHERE proname = 'tim_kd' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'Chỉ mục trigram tim_kd', count(*)::text FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx\_%\_tim\_kd\_trgm'
UNION ALL
SELECT 'Thử: khoa_tim(''DH-0123'')', public.khoa_tim('DH-0123');
