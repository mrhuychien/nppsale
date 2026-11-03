-- KIỂM MIG 258 — năm hàm phụ (khoá tìm + Xuất hàng) viết lại bằng plpgsql phải ra Y HỆT bản SQL đang chạy trên sổ thật.
-- Chủ nhà 03/11/2026 (khách NPP 18:07–18:25: "Loát chậm quá" · "Mất 3 phút"; Xuất hàng TB 1.294 ms trên sổ thật).
-- psql -f, BEGIN … ROLLBACK. Dựng lại bản SQL của sổ thật (trước mig 258), tính kết quả cũ, chạy CHÍNH tệp migration hai
-- lần, rồi so từng kết quả. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-258-ham-phu-plpgsql.sql
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o

BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;

-- ---------------------------------------------------------------- 0. Bản SQL của sổ thật hôm nay (mig 177 / 205 / 179 / 247)
DO $cu$
DECLARE v_sch text;
BEGIN
  SELECT n.nspname INTO v_sch FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent';
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.khong_dau(p text)
    RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
    AS $b$
      SELECT btrim(regexp_replace(lower(
        %1$I.unaccent('%1$I.unaccent'::regdictionary,
          replace(replace(normalize(COALESCE(p, ''), NFC), 'đ', 'd'), 'Đ', 'D'))
      ), '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'))
    $b$
  $f$, v_sch);
END $cu$;
CREATE OR REPLACE FUNCTION public.khoa_tim(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
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
CREATE OR REPLACE FUNCTION public.khoa_tim_ds(VARIADIC p text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
AS $fn$
  SELECT array_to_string(ARRAY(
    SELECT k FROM unnest(p) WITH ORDINALITY u(v, i), LATERAL (SELECT public.khoa_tim(v) AS k) z
    WHERE k <> '' ORDER BY i
  ), ' ')
$fn$;
CREATE OR REPLACE FUNCTION public._da_xuat_cua_dong_don(p_order_line_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT COALESCE(
    sum(sil.quantity * COALESCE(NULLIF(sil.conversion_factor, 0), 1))
      / COALESCE(NULLIF(max(sol.conversion_factor), 0), 1),
    0)
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
  JOIN sales_order_lines sol ON sol.id = sil.order_line_id
  WHERE sil.order_line_id = p_order_line_id
$fn$;
CREATE OR REPLACE FUNCTION public._chuan_he_so_dong_hoa_don(p_lines jsonb, p_hd_cu uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(ord.l) = 'object' AND NULLIF(ord.l->>'product_id', '') IS NOT NULL THEN
        ord.l || jsonb_build_object('conversion_factor',
          CASE
            WHEN ord.l->>'unit_name' = p.base_unit THEN 1::numeric
            WHEN cu.he_so IS NOT NULL THEN cu.he_so
            WHEN pu.conversion IS NOT NULL THEN pu.conversion::numeric
            ELSE COALESCE((ord.l->>'conversion_factor')::numeric, 1)
          END)
      ELSE ord.l
    END ORDER BY ord.i), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS ord(l, i)
  LEFT JOIN products p       ON p.id = NULLIF(ord.l->>'product_id', '')::uuid
  LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.unit_name = ord.l->>'unit_name'
  LEFT JOIN LATERAL (
    SELECT max(sil.conversion_factor) AS he_so
      FROM sales_invoice_lines sil
     WHERE p_hd_cu IS NOT NULL
       AND sil.invoice_id = p_hd_cu
       AND sil.product_id = p.id
       AND sil.unit_name = ord.l->>'unit_name'
       AND sil.conversion_factor > 0
  ) cu ON true
$fn$;

-- ---------------------------------------------------------------- Sổ thử (bỏ trigger nghiệp vụ khi nạp — chỉ để có dòng)
SET LOCAL session_replication_role = replica;
INSERT INTO organizations (id, name, slug) VALUES ('d2580000-0000-4000-9000-000000000001', 'NPP thử 258', 'npp-thu-258');
INSERT INTO auth.users (id) VALUES ('d2580000-0000-4000-9500-000000000001');
INSERT INTO users (id, org_id, full_name, role) VALUES
  ('d2580000-0000-4000-9500-000000000001', 'd2580000-0000-4000-9000-000000000001', 'NVBH 258', 'sales');
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address) VALUES
  ('d2580000-0000-4000-9600-000000000001', 'd2580000-0000-4000-9000-000000000001', 'Tạp hoá 258', 'Chủ 258', '0902580001', '258 Đường Thử');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('d2580000-0000-4000-9100-0000000000a1', 'd2580000-0000-4000-9000-000000000001', 'SP258A', 'Sữa hộp 258', 'hộp', 'active'),
  ('d2580000-0000-4000-9100-0000000000a2', 'd2580000-0000-4000-9000-000000000001', 'SP258B', 'Nước chai 258', 'chai', 'active');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES
  ('d2580000-0000-4000-9100-0000000000a1', 'thùng', 24), ('d2580000-0000-4000-9100-0000000000a1', 'lốc', 6);
-- Ba đơn (một đơn một hoá đơn ghi sổ — mig 217): đơn 1 có tờ ghi sổ + tờ đã huỷ, đơn 2 một tờ, đơn 3 để thử trigger.
INSERT INTO sales_orders (id, org_id, order_code, order_seq, status, customer_id, sales_user_id)
SELECT ('d2580000-0000-4000-9200-00000000000' || g)::uuid, 'd2580000-0000-4000-9000-000000000001', 'DH258-' || g, g, 'completed',
       'd2580000-0000-4000-9600-000000000001', 'd2580000-0000-4000-9500-000000000001'
  FROM generate_series(1, 3) g;
-- Dòng đơn: thùng ×24, hộp ×1, lốc ×6, chai hệ số 0 (coi là 1), chai của đơn 2, chai của đơn 3.
INSERT INTO sales_order_lines (id, order_id, product_id, unit_name, quantity, conversion_factor, unit_price, line_total) VALUES
  ('d2580000-0000-4000-9300-000000000001', 'd2580000-0000-4000-9200-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'thùng', 3, 24, 0, 0),
  ('d2580000-0000-4000-9300-000000000002', 'd2580000-0000-4000-9200-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'hộp', 10, 1, 0, 0),
  ('d2580000-0000-4000-9300-000000000003', 'd2580000-0000-4000-9200-000000000002', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 4, 1, 0, 0),
  ('d2580000-0000-4000-9300-000000000004', 'd2580000-0000-4000-9200-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'lốc', 5, 6, 0, 0),
  ('d2580000-0000-4000-9300-000000000005', 'd2580000-0000-4000-9200-000000000001', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 2, 0, 0, 0),
  ('d2580000-0000-4000-9300-000000000006', 'd2580000-0000-4000-9200-000000000003', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 7, 1, 0, 0);
-- Tờ 1 (đơn 1, ghi sổ) chụp hệ số lốc = 12 (danh mục nay là 6) và có dòng hộp cho dòng đơn thùng; tờ 3 (đơn 1) đã huỷ —
-- không tính; tờ 2 (đơn 2, ghi sổ).
INSERT INTO sales_invoices (id, org_id, invoice_code, invoice_seq, order_id, status, subtotal, total, customer_id) VALUES
  ('d2580000-0000-4000-9400-000000000001', 'd2580000-0000-4000-9000-000000000001', 'HD258-1', 1, 'd2580000-0000-4000-9200-000000000001', 'posted', 0, 0, 'd2580000-0000-4000-9600-000000000001'),
  ('d2580000-0000-4000-9400-000000000002', 'd2580000-0000-4000-9000-000000000001', 'HD258-2', 2, 'd2580000-0000-4000-9200-000000000002', 'posted', 0, 0, 'd2580000-0000-4000-9600-000000000001'),
  ('d2580000-0000-4000-9400-000000000003', 'd2580000-0000-4000-9000-000000000001', 'HD258-3', 3, 'd2580000-0000-4000-9200-000000000001', 'cancelled', 0, 0, 'd2580000-0000-4000-9600-000000000001');
INSERT INTO sales_invoice_lines (invoice_id, order_line_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_total, sort_order) VALUES
  ('d2580000-0000-4000-9400-000000000001', 'd2580000-0000-4000-9300-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'thùng', 24, 1, 0, 0, 1),
  ('d2580000-0000-4000-9400-000000000001', 'd2580000-0000-4000-9300-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'hộp', 1, 12, 0, 0, 2),
  ('d2580000-0000-4000-9400-000000000001', 'd2580000-0000-4000-9300-000000000004', 'd2580000-0000-4000-9100-0000000000a1', 'lốc', 12, 2, 0, 0, 3),
  ('d2580000-0000-4000-9400-000000000001', 'd2580000-0000-4000-9300-000000000005', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 0, 2, 0, 0, 4),
  ('d2580000-0000-4000-9400-000000000002', 'd2580000-0000-4000-9300-000000000003', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 1, 3, 0, 0, 1),
  ('d2580000-0000-4000-9400-000000000003', 'd2580000-0000-4000-9300-000000000001', 'd2580000-0000-4000-9100-0000000000a1', 'thùng', 24, 2, 0, 0, 1),
  ('d2580000-0000-4000-9400-000000000003', 'd2580000-0000-4000-9300-000000000002', 'd2580000-0000-4000-9100-0000000000a1', 'hộp', 1, 10, 0, 0, 2);
SET LOCAL session_replication_role = origin;

-- Kho mẫu chữ: ca khó + mọi chữ đang có trong sổ (hàng, khách, mã chứng từ, người dùng).
CREATE TEMP TABLE mau (x text) ON COMMIT DROP;
INSERT INTO mau SELECT unnest(ARRAY[
  NULL, '', ' ', '   ', E'\t\n', 'DH-0123', 'HD-0001-2', 'HD258-1', '0912 345 678', '0912.345.678', '+84 912-345-678',
  'Đường Nguyễn Thị Minh Khai', 'ĐẬU XANH', 'đậu đỏ', normalize('Bánh Đậu Xanh Rồng Vàng', NFD), normalize('Sữa hộp Vinamilk', NFD),
  'Sữa' || chr(160) || 'hộp', 'a' || chr(8195) || 'b', 'x' || chr(65279) || 'y', 'p' || chr(12288) || 'q', 'm' || chr(8232) || 'n',
  'Cà phê 🧋 G7', 'NGÔ ĐỒNG 3 IN 1', '000', '0a0b', 'a00b001', 'x-007-y', '007', 'SP000123', 'sp 0 0 1', '0 0 0', 'A1B2C3',
  'ÀÁẢÃẠ ăắằẳẵặ âấầẩẫậ', 'Ứng Ửng Ừng Ựng', 'ꞌ’‘“”', 'foo_bar-baz.qux/zip', 'Ｆｕｌｌｗｉｄｔｈ １２３', 'ﬁ ligature', 'İstanbul',
  'ß', '½ ¾', '²³', 'Ⅻ', 'ⓐⓑ', repeat('Rất dài ', 120), repeat('0', 40) || '7', E'line1\r\nline2', E'tab\ttab'
]);
INSERT INTO mau SELECT v FROM (
  SELECT sku FROM products UNION ALL SELECT name FROM products UNION ALL SELECT barcode FROM products
  UNION ALL SELECT store_name FROM customers UNION ALL SELECT phone FROM customers UNION ALL SELECT address FROM customers
  UNION ALL SELECT order_code FROM sales_orders UNION ALL SELECT invoice_code FROM sales_invoices UNION ALL SELECT full_name FROM users
) s(v) LIMIT 5000;
CREATE TEMP TABLE bo_ba ON COMMIT DROP AS
  SELECT x, lead(x) OVER (ORDER BY md5(coalesce(x, '∅'))) AS y, lag(x) OVER (ORDER BY md5(coalesce(x, '∅'))) AS z FROM mau;

-- Tải trọng dòng HĐ: cơ sở / danh mục / tờ cũ / đơn vị lạ (có và không có hệ số gửi lên) / hàng không có / dòng lạ.
CREATE TEMP TABLE tai (n int, dong jsonb, hd uuid) ON COMMIT DROP;
INSERT INTO tai VALUES
  (1, '[{"product_id": "d2580000-0000-4000-9100-0000000000a1", "unit_name": "hộp", "quantity": 2, "conversion_factor": 9},
        {"product_id": "d2580000-0000-4000-9100-0000000000a1", "unit_name": "thùng", "quantity": 1},
        {"product_id": "d2580000-0000-4000-9100-0000000000a1", "unit_name": "lốc", "quantity": 3, "conversion_factor": 6},
        {"product_id": "d2580000-0000-4000-9100-0000000000a1", "unit_name": "két", "quantity": 1, "conversion_factor": 10},
        {"product_id": "d2580000-0000-4000-9100-0000000000a2", "unit_name": "két", "quantity": 1},
        {"product_id": "d2580000-0000-4000-9100-0000000000ff", "unit_name": "hộp", "conversion_factor": 5},
        {"product_id": "", "unit_name": "hộp"}, {"unit_name": "hộp"}, 1, "x", null, [1, 2],
        {"product_id": "d2580000-0000-4000-9100-0000000000a1", "unit_name": "thùng", "quantity": 1, "conversion_factor": 99}]', NULL),
  (2, NULL, NULL), (3, '[]', NULL), (4, '[{"product_id": "d2580000-0000-4000-9100-0000000000a1"}]', NULL);
INSERT INTO tai SELECT 10 + n, dong, 'd2580000-0000-4000-9400-000000000001' FROM tai WHERE n <= 4;
INSERT INTO tai SELECT 20 + n, dong, 'd2580000-0000-4000-9400-000000000003' FROM tai WHERE n <= 4;
-- Dòng của mọi tờ đang có trong sổ, có và không có tờ cũ.
INSERT INTO tai
SELECT 1000 + row_number() OVER (), jsonb_agg(jsonb_build_object('product_id', sil.product_id, 'unit_name', sil.unit_name,
         'conversion_factor', sil.conversion_factor, 'quantity', sil.quantity) ORDER BY sil.sort_order), si.id
  FROM sales_invoices si JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
 GROUP BY si.id
 LIMIT 2000;

-- ---------------------------------------------------------------- Kết quả của bản SQL (cũ)
CREATE TEMP TABLE cu_chu ON COMMIT DROP AS
  SELECT x, public.khong_dau(x) AS kd, public.khoa_tim(x) AS kt FROM mau;
CREATE TEMP TABLE cu_ds ON COMMIT DROP AS
  SELECT x, y, z, public.khoa_tim_ds(x, y, z) AS k FROM bo_ba;
CREATE TEMP TABLE cu_ds_le ON COMMIT DROP AS
  SELECT public.khoa_tim_ds(VARIADIC NULL::text[]) AS a, public.khoa_tim_ds(VARIADIC '{}'::text[]) AS b,
         public.khoa_tim_ds(NULL, NULL) AS c, public.khoa_tim_ds('', ' ', 'DH-01') AS d, public.khoa_tim_ds('Bánh Đậu Xanh') AS e;
CREATE TEMP TABLE cu_xuat ON COMMIT DROP AS
  SELECT id, public._da_xuat_cua_dong_don(id) AS v FROM sales_order_lines
  UNION ALL SELECT NULL, public._da_xuat_cua_dong_don(NULL)
  UNION ALL SELECT 'd2580000-0000-4000-93ff-000000000000', public._da_xuat_cua_dong_don('d2580000-0000-4000-93ff-000000000000');
CREATE TEMP TABLE cu_he_so ON COMMIT DROP AS
  SELECT n, public._chuan_he_so_dong_hoa_don(dong, hd) AS j FROM tai;
CREATE TEMP TABLE cu_loi (ca text, loi text) ON COMMIT DROP;
DO $l$
DECLARE v text;
BEGIN
  BEGIN PERFORM public._chuan_he_so_dong_hoa_don('{"x": 1}', NULL); v := 'không lỗi';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  INSERT INTO cu_loi VALUES ('object', v);
  BEGIN PERFORM public._chuan_he_so_dong_hoa_don('[{"product_id": "abc"}]', NULL); v := 'không lỗi';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  INSERT INTO cu_loi VALUES ('uuid', v);
END $l$;

-- Đo bản cũ: MỖI lần một câu (như trigger / RPC gọi) — câu động thì cả hai bản cùng chịu phần lập kế hoạch câu ngoài.
CREATE TEMP TABLE do_tg (ban text, ms numeric) ON COMMIT DROP;
DO $d$
DECLARE a text[] := ARRAY(SELECT coalesce(x, '') FROM mau ORDER BY md5(coalesce(x, '∅')) LIMIT 300);
        t0 timestamptz := clock_timestamp(); i int; k text;
BEGIN
  FOR i IN 1 .. cardinality(a) LOOP
    EXECUTE 'SELECT public.khoa_tim_ds($1, $2, $3)' INTO k USING a[i], a[cardinality(a) + 1 - i], 'HD-' || i;
  END LOOP;
  INSERT INTO do_tg VALUES ('cu', extract(epoch FROM clock_timestamp() - t0) * 1000);
END $d$;

-- ---------------------------------------------------------------- Chạy migration HAI lần
\o /dev/null
\ir ../../supabase/migrations/258_ham_phu_plpgsql.sql
\ir ../../supabase/migrations/258_ham_phu_plpgsql.sql
\o

DO $d$
DECLARE a text[] := ARRAY(SELECT coalesce(x, '') FROM mau ORDER BY md5(coalesce(x, '∅')) LIMIT 300);
        t0 timestamptz := clock_timestamp(); i int; k text;
BEGIN
  FOR i IN 1 .. cardinality(a) LOOP
    EXECUTE 'SELECT public.khoa_tim_ds($1, $2, $3)' INTO k USING a[i], a[cardinality(a) + 1 - i], 'HD-' || i;
  END LOOP;
  INSERT INTO do_tg VALUES ('moi', extract(epoch FROM clock_timestamp() - t0) * 1000);
END $d$;

-- ---------------------------------------------------------------- So
INSERT INTO kq SELECT 1, 'khong_dau: y hệt bản SQL trên mọi mẫu chữ',
  count(*) FILTER (WHERE public.khong_dau(x) IS DISTINCT FROM kd) = 0 AND count(*) > 50,
  count(*) FILTER (WHERE public.khong_dau(x) IS DISTINCT FROM kd) || ' lệch / ' || count(*) || ' mẫu' FROM cu_chu;
INSERT INTO kq SELECT 2, 'khoa_tim: y hệt bản SQL (từ, viết liền, bỏ số 0 đầu — luật viValueKey)',
  count(*) FILTER (WHERE public.khoa_tim(x) IS DISTINCT FROM kt) = 0,
  count(*) FILTER (WHERE public.khoa_tim(x) IS DISTINCT FROM kt) || ' lệch / ' || count(*) || ' mẫu' FROM cu_chu;
INSERT INTO kq SELECT 3, 'khoa_tim_ds: y hệt bản SQL trên bộ ba giá trị (kể cả NULL / rỗng xen giữa)',
  count(*) FILTER (WHERE public.khoa_tim_ds(x, y, z) IS DISTINCT FROM k) = 0,
  count(*) FILTER (WHERE public.khoa_tim_ds(x, y, z) IS DISTINCT FROM k) || ' lệch / ' || count(*) FROM cu_ds;
INSERT INTO kq SELECT 4, 'khoa_tim_ds: mảng NULL / rỗng / toàn NULL / có rỗng — y hệt; mẫu mig 205 đúng',
  a = public.khoa_tim_ds(VARIADIC NULL::text[]) AND b = public.khoa_tim_ds(VARIADIC '{}'::text[])
    AND c = public.khoa_tim_ds(NULL, NULL) AND d = public.khoa_tim_ds('', ' ', 'DH-01') AND e = public.khoa_tim_ds('Bánh Đậu Xanh')
    AND public.khoa_tim('DH-0123') = 'dh 0123 dh0123 dh123'
    AND public.khoa_tim('0912 345 678') = '0912 345 678 0912345678 912345678',
  format('%L %L %L %L %L', a, b, c, d, e) FROM cu_ds_le;
INSERT INTO kq SELECT 5, '_da_xuat_cua_dong_don: y hệt trên mọi dòng đơn (tờ huỷ không tính, hệ số 0 = 1, id lạ / NULL = 0)',
  count(*) FILTER (WHERE public._da_xuat_cua_dong_don(id) IS DISTINCT FROM v) = 0
    -- Tự tính tay: thùng = (1×24 + 12×1) / 24 = 1,5 (tờ huỷ không tính); lốc = 2×12 / 6 = 4; chai hệ số 0 = 2;
    -- hộp chỉ có ở tờ huỷ = 0; chai của đơn 2 = 3.
    AND (SELECT v FROM cu_xuat WHERE id = 'd2580000-0000-4000-9300-000000000001') = 1.5
    AND (SELECT v FROM cu_xuat WHERE id = 'd2580000-0000-4000-9300-000000000004') = 4
    AND (SELECT v FROM cu_xuat WHERE id = 'd2580000-0000-4000-9300-000000000005') = 2
    AND (SELECT v FROM cu_xuat WHERE id = 'd2580000-0000-4000-9300-000000000002') = 0
    AND (SELECT v FROM cu_xuat WHERE id = 'd2580000-0000-4000-9300-000000000003') = 3,
  count(*) FILTER (WHERE public._da_xuat_cua_dong_don(id) IS DISTINCT FROM v) || ' lệch / ' || count(*) FROM cu_xuat;
INSERT INTO kq SELECT 6, '_chuan_he_so_dong_hoa_don: y hệt (jsonb lẫn CHỮ) — cơ sở, danh mục, tờ cũ, đơn vị lạ, dòng lạ, NULL / rỗng',
  count(*) FILTER (WHERE public._chuan_he_so_dong_hoa_don(t.dong, t.hd)::text IS DISTINCT FROM c.j::text) = 0,
  count(*) FILTER (WHERE public._chuan_he_so_dong_hoa_don(t.dong, t.hd)::text IS DISTINCT FROM c.j::text) || ' lệch / ' || count(*)
  FROM tai t JOIN cu_he_so c USING (n);
INSERT INTO kq SELECT 7, '_chuan_he_so_dong_hoa_don: đúng luật (tờ cũ 12 thắng danh mục 6; danh mục 24 thắng số gửi lên 99; két không danh mục giữ 10; hàng không có giữ 5)',
  (SELECT j -> 2 ->> 'conversion_factor' FROM cu_he_so WHERE n = 11) = '12.000000'
    AND (SELECT j -> 2 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '6'
    AND (SELECT j -> 0 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '1'
    AND (SELECT j -> 3 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '10'
    AND (SELECT j -> 4 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '1'
    AND (SELECT j -> 5 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '5'
    AND (SELECT j -> 12 ->> 'conversion_factor' FROM cu_he_so WHERE n = 1) = '24'
    AND (SELECT jsonb_array_length(j) FROM cu_he_so WHERE n = 1) = 13
    AND (SELECT j FROM cu_he_so WHERE n = 2) = '[]' AND (SELECT j FROM cu_he_so WHERE n = 3) = '[]',
  (SELECT j::text FROM cu_he_so WHERE n = 11);
DO $l$
DECLARE v text;
BEGIN
  BEGIN PERFORM public._chuan_he_so_dong_hoa_don('{"x": 1}', NULL); v := 'không lỗi';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  INSERT INTO kq SELECT 8, '_chuan_he_so_dong_hoa_don: dòng không phải mảng — báo lỗi y hệt', v = loi, v FROM cu_loi WHERE ca = 'object';
  BEGIN PERFORM public._chuan_he_so_dong_hoa_don('[{"product_id": "abc"}]', NULL); v := 'không lỗi';
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE || ' ' || SQLERRM; END;
  INSERT INTO kq SELECT 9, '_chuan_he_so_dong_hoa_don: mã hàng không phải uuid — báo lỗi y hệt', v = loi, v FROM cu_loi WHERE ca = 'uuid';
END $l$;

-- Trigger thật dùng hàm mới: khoá tìm của HĐ mới + số đã xuất của dòng đơn khi thêm dòng HĐ.
SET LOCAL session_replication_role = replica;
INSERT INTO sales_invoices (id, org_id, invoice_code, invoice_seq, order_id, status, subtotal, total, customer_id) VALUES
  ('d2580000-0000-4000-9400-000000000009', 'd2580000-0000-4000-9000-000000000001', 'HD258-9', 9, 'd2580000-0000-4000-9200-000000000003', 'posted', 0, 0, 'd2580000-0000-4000-9600-000000000001');
SET LOCAL session_replication_role = origin;
UPDATE sales_invoices SET invoice_code = 'HD-0258-09' WHERE id = 'd2580000-0000-4000-9400-000000000009';
-- Như post_invoice: dòng HĐ chèn trong RPC (npp.via_rpc) — trigger khoá dòng đơn đã xuất cho đi qua.
SELECT set_config('npp.via_rpc', 'on', true) \g /dev/null
INSERT INTO sales_invoice_lines (invoice_id, order_line_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_total, sort_order)
VALUES ('d2580000-0000-4000-9400-000000000009', 'd2580000-0000-4000-9300-000000000006', 'd2580000-0000-4000-9100-0000000000a2', 'chai', 1, 5, 0, 0, 1);
INSERT INTO kq SELECT 10, 'Trigger: khoá tìm HĐ ghi bằng hàm mới; số đã xuất của dòng đơn = 5 (trigger sync_invoiced_qty)',
  (SELECT tim_kd FROM sales_invoices WHERE id = 'd2580000-0000-4000-9400-000000000009') = 'hd 0258 09 hd025809 hd2589'
    AND (SELECT invoiced_qty FROM sales_order_lines WHERE id = 'd2580000-0000-4000-9300-000000000006') = 5,
  (SELECT tim_kd FROM sales_invoices WHERE id = 'd2580000-0000-4000-9400-000000000009') || ' · đã xuất '
    || (SELECT invoiced_qty FROM sales_order_lines WHERE id = 'd2580000-0000-4000-9300-000000000006');

INSERT INTO kq SELECT 11, 'Cả năm hàm: plpgsql, giữ IMMUTABLE/STABLE + PARALLEL SAFE + search_path=public, không definer',
  count(*) = 5 AND bool_and(l.lanname = 'plpgsql') AND bool_and(NOT p.prosecdef)
    AND bool_and(coalesce(p.proconfig, '{}') = ARRAY['search_path=public'])
    AND bool_and(CASE WHEN p.proname IN ('khong_dau', 'khoa_tim', 'khoa_tim_ds') THEN p.provolatile = 'i' AND p.proparallel = 's'
                      ELSE p.provolatile = 's' END),
  string_agg(p.proname || ':' || l.lanname || '/' || p.provolatile::text || p.proparallel::text, ' ' ORDER BY p.proname)
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.oid IN ('public.khong_dau(text)'::regprocedure, 'public.khoa_tim(text)'::regprocedure, 'public.khoa_tim_ds(text[])'::regprocedure,
                 'public._da_xuat_cua_dong_don(uuid)'::regprocedure, 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)'::regprocedure);
INSERT INTO kq SELECT 12, 'Quyền: khoá tìm — authenticated gọi được; hai hàm nội bộ của Xuất hàng — trình duyệt không gọi được',
  has_function_privilege('authenticated', 'public.khong_dau(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.khoa_tim(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.khoa_tim_ds(text[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._da_xuat_cua_dong_don(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._da_xuat_cua_dong_don(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)', 'EXECUTE'), '';
INSERT INTO kq SELECT 13, 'Nhanh hơn: 300 lần khoá tìm (mỗi lần một câu) — bản mới nhanh hơn ít nhất 3 lần',
  (SELECT ms FROM do_tg WHERE ban = 'cu') > 3 * (SELECT ms FROM do_tg WHERE ban = 'moi'),
  'cũ ' || round((SELECT ms FROM do_tg WHERE ban = 'cu'), 1) || ' ms · mới ' || round((SELECT ms FROM do_tg WHERE ban = 'moi'), 1) || ' ms';

INSERT INTO kq SELECT 99, 'Đủ 13 dòng kiểm', count(*) = 13, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
