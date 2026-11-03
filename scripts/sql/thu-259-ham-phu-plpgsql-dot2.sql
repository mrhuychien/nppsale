-- KIỂM MIG 259 — đợt 2: 11 hàm phụ (quyền giảm giá, giảm giá đơn, thuế, mã chứng từ, điều khoản, hôm nay, vai trình duyệt)
-- viết lại bằng plpgsql phải ra Y HỆT bản SQL đang chạy trên sổ thật. Chủ nhà 03/11/2026: "làm cả 2".
-- psql -f, BEGIN … ROLLBACK. Dựng lại bản SQL (mig 125 / 140 / 183 / 214 / 226 / 237), tính kết quả cũ trên kho mẫu, chạy
-- CHÍNH tệp migration hai lần, so từng kết quả kể cả LỖI báo ra; trigger đặt mã đơn / phiếu trả chạy thật. Dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-259-ham-phu-plpgsql-dot2.sql
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o

BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;

-- ---------------------------------------------------------------- 0. Bản SQL của sổ thật hôm nay
CREATE OR REPLACE FUNCTION public._quyen_giam_cua(p_uid uuid)
RETURNS TABLE(toan_quyen boolean, duoc_giam boolean, loai_tran text, tran numeric)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT COALESCE(u.role IN ('owner', 'accountant'), true) OR p_uid IS NULL,
         COALESCE(u.allow_discount, false),
         COALESCE(u.discount_max_type, 'pct'),
         u.discount_max_value
  FROM (SELECT 1) x
  LEFT JOIN users u ON u.id = p_uid
$fn$;
CREATE OR REPLACE FUNCTION public._giam_don_hien_tai(p_order uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH d AS (
    SELECT round(COALESCE(sum(l.quantity * l.unit_price), 0)) AS tien, count(*) AS n
    FROM sales_order_lines l WHERE l.order_id = p_order AND l.quantity > 0
  )
  SELECT CASE WHEN d.tien - round(COALESCE(so.subtotal, 0)) > GREATEST(1, d.n)
              THEN d.tien - round(COALESCE(so.subtotal, 0)) ELSE 0 END
  FROM sales_orders so, d
  WHERE so.id = p_order
$fn$;
CREATE OR REPLACE FUNCTION public._thue_hop_le(v text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT CASE WHEN v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND v::numeric BETWEEN 0 AND 1
              THEN round(v::numeric, 4) END
$fn$;
CREATE OR REPLACE FUNCTION public._la_trinh_duyet()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT current_user IN ('authenticated', 'anon')
$fn$;
CREATE OR REPLACE FUNCTION public._giam_gia_don(p jsonb, p_tien_hang numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT LEAST(
    GREATEST(COALESCE(CASE WHEN (p->>'discount') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                           THEN (p->>'discount')::numeric END, 0), 0),
    GREATEST(COALESCE(p_tien_hang, 0), 0)
  )
$fn$;
CREATE OR REPLACE FUNCTION public._wf2b_payment_terms_days(p_terms text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT COALESCE(
    (substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)'))::int, 0);
$fn$;
CREATE OR REPLACE FUNCTION public._so_chung_tu(p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT lpad(COALESCE(p_n, 0)::text, GREATEST(4, length(COALESCE(p_n, 0)::text)), '0')
$fn$;
CREATE OR REPLACE FUNCTION public._order_code(p_seq integer, p_edit integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT 'DH-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_edit, 0) > 0
                 THEN '-' || p_edit::text ELSE '' END;
$fn$;
CREATE OR REPLACE FUNCTION public._inv_code(p_seq integer, p_reissue integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT 'HD-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_reissue, 0) > 0
                 THEN '-' || p_reissue::text ELSE '' END;
$fn$;
CREATE OR REPLACE FUNCTION public._ma_phieu_tra(p_seq integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $fn$
  SELECT 'PT-' || public._so_chung_tu(p_seq)
$fn$;
CREATE OR REPLACE FUNCTION public.vn_today()
RETURNS date LANGUAGE sql STABLE SET search_path = public
AS $fn$
  SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
$fn$;

-- Tính chất + quyền của bản cũ (phải giữ nguyên sau migration).
CREATE TEMP TABLE ten_ham (sig regprocedure) ON COMMIT DROP;
INSERT INTO ten_ham VALUES ('public._quyen_giam_cua(uuid)'), ('public._giam_don_hien_tai(uuid)'), ('public._thue_hop_le(text)'),
  ('public._la_trinh_duyet()'), ('public._giam_gia_don(jsonb, numeric)'), ('public._wf2b_payment_terms_days(text)'),
  ('public._so_chung_tu(integer)'), ('public._order_code(integer, integer)'), ('public._inv_code(integer, integer)'),
  ('public._ma_phieu_tra(integer)'), ('public.vn_today()');
CREATE TEMP TABLE cu_tinh_chat ON COMMIT DROP AS
  SELECT t.sig, p.provolatile, p.proparallel, p.proisstrict, p.prosecdef, p.proretset, p.prorettype, p.prorows, p.procost,
         p.proconfig, p.proacl, pg_get_function_result(p.oid) AS kq
    FROM ten_ham t JOIN pg_proc p ON p.oid = t.sig;

-- ---------------------------------------------------------------- Sổ thử
SET LOCAL session_replication_role = replica;
INSERT INTO organizations (id, name, slug) VALUES ('d2590000-0000-4000-9000-000000000001', 'NPP thử 259', 'npp-thu-259');
INSERT INTO auth.users (id) VALUES ('d2590000-0000-4000-9500-000000000001'), ('d2590000-0000-4000-9500-000000000002'),
  ('d2590000-0000-4000-9500-000000000003'), ('d2590000-0000-4000-9500-000000000004');
INSERT INTO users (id, org_id, full_name, role, allow_discount, discount_max_type, discount_max_value) VALUES
  ('d2590000-0000-4000-9500-000000000001', 'd2590000-0000-4000-9000-000000000001', 'Chủ 259', 'owner', false, 'pct', NULL),
  ('d2590000-0000-4000-9500-000000000002', 'd2590000-0000-4000-9000-000000000001', 'NVBH giảm % 259', 'sales', true, 'pct', 5),
  ('d2590000-0000-4000-9500-000000000003', 'd2590000-0000-4000-9000-000000000001', 'NVBH giảm tiền 259', 'sales', true, 'vnd', 20000),
  ('d2590000-0000-4000-9500-000000000004', 'd2590000-0000-4000-9000-000000000001', 'Kế toán 259', 'accountant', false, 'vnd', NULL);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address) VALUES
  ('d2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9000-000000000001', 'Tạp hoá 259', 'Chủ 259', '0902590001', '259 Đường Thử');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('d2590000-0000-4000-9100-000000000001', 'd2590000-0000-4000-9000-000000000001', 'SP259', 'Hàng 259', 'hộp', 'active');
-- Đơn: có giảm giá cả đơn (tiền dòng 100.000, tiền đơn 90.000), không giảm (có dòng lẻ 0,4đ), chênh làm tròn ≤ số dòng, đơn rỗng.
INSERT INTO sales_orders (id, org_id, order_code, order_seq, status, customer_id, sales_user_id, subtotal) VALUES
  ('d2590000-0000-4000-9200-000000000001', 'd2590000-0000-4000-9000-000000000001', 'DH259-1', 1, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', 90000),
  ('d2590000-0000-4000-9200-000000000002', 'd2590000-0000-4000-9000-000000000001', 'DH259-2', 2, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', 100000),
  ('d2590000-0000-4000-9200-000000000003', 'd2590000-0000-4000-9000-000000000001', 'DH259-3', 3, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', 100000),
  ('d2590000-0000-4000-9200-000000000004', 'd2590000-0000-4000-9000-000000000001', 'DH259-4', 4, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', NULL),
  ('d2590000-0000-4000-9200-000000000005', 'd2590000-0000-4000-9000-000000000001', 'DH259-5', 5, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', 99999);
INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total) VALUES
  ('d2590000-0000-4000-9200-000000000001', 'd2590000-0000-4000-9100-000000000001', 'hộp', 10, 10000, 100000),
  ('d2590000-0000-4000-9200-000000000002', 'd2590000-0000-4000-9100-000000000001', 'hộp', 10, 10000, 100000),
  ('d2590000-0000-4000-9200-000000000002', 'd2590000-0000-4000-9100-000000000001', 'hộp', 1, 0.4, 0.4),
  ('d2590000-0000-4000-9200-000000000003', 'd2590000-0000-4000-9100-000000000001', 'hộp', 3, 33333.67, 100001),
  ('d2590000-0000-4000-9200-000000000005', 'd2590000-0000-4000-9100-000000000001', 'hộp', 3, 33333.67, 100001);
-- Dòng SL 0 của sổ cũ (trước ràng buộc số lượng dương): gỡ ràng buộc trong giao dịch này (ROLLBACK cuối tệp trả lại).
ALTER TABLE sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_quantity_duong_check;
INSERT INTO sales_orders (id, org_id, order_code, order_seq, status, customer_id, sales_user_id, subtotal) VALUES
  ('d2590000-0000-4000-9200-000000000006', 'd2590000-0000-4000-9000-000000000001', 'DH259-6', 6, 'draft', 'd2590000-0000-4000-9600-000000000001', 'd2590000-0000-4000-9500-000000000002', 99998);
INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total) VALUES
  ('d2590000-0000-4000-9200-000000000006', 'd2590000-0000-4000-9100-000000000001', 'hộp', 10, 10000, 100000),
  ('d2590000-0000-4000-9200-000000000006', 'd2590000-0000-4000-9100-000000000001', 'hộp', 0, 99999, 0);
SET LOCAL session_replication_role = origin;

-- Kho mẫu.
CREATE TEMP TABLE mau_thue (v text) ON COMMIT DROP;
INSERT INTO mau_thue SELECT unnest(ARRAY[NULL, '', ' ', '0', '1', '0.1', '0.08', ' 0.10 ', '1.0', '1.00001', '0.99995', '0.12345',
  '2', '-0.1', 'abc', '0.', '.5', '1e-1', '0,1', E'0.1\n', E'\t0.05\t', '00.5', '10', '99999999999999999999', '0.000049', '0.00005']);
INSERT INTO mau_thue SELECT DISTINCT vat_rate::text FROM sales_order_lines WHERE vat_rate IS NOT NULL
  UNION SELECT DISTINCT vat_rate::text FROM sales_invoice_lines WHERE vat_rate IS NOT NULL;
CREATE TEMP TABLE mau_giam (p jsonb, t numeric) ON COMMIT DROP;
INSERT INTO mau_giam SELECT p, t FROM unnest(ARRAY['{}', '{"discount": null}', '{"discount": 0}', '{"discount": 5000}', '{"discount": "5000"}',
  '{"discount": " 5000.5 "}', '{"discount": -100}', '{"discount": "-100"}', '{"discount": "abc"}', '{"discount": 1e9}',
  '{"discount": [1]}', '{"discount": {"x": 1}}', '{"discount": true}', '[]', 'null', '"5000"']::jsonb[]) p,
  unnest(ARRAY[NULL, -1, 0, 3000, 5000, 5000.4, 1e12]::numeric[]) t;
INSERT INTO mau_giam VALUES (NULL, 100), (NULL, NULL);
CREATE TEMP TABLE mau_dk (v text) ON COMMIT DROP;
INSERT INTO mau_dk SELECT unnest(ARRAY[NULL, '', 'COD', 'NET30', 'net15', 'Net 7', 'NET0', 'NET', 'xNET45y', 'NET007', 'NET2147483647',
  'NET30NET60', 'ngay NET 30', 'NETFLIX', 'nét30']);
CREATE TEMP TABLE mau_so (n int) ON COMMIT DROP;
INSERT INTO mau_so SELECT unnest(ARRAY[NULL, 0, 1, 7, 12, 123, 1234, 9999, 10000, 12345, 99999999, 2147483647, -1, -7, -12345, -2147483648]);
CREATE TEMP TABLE mau_lan (n int) ON COMMIT DROP;
INSERT INTO mau_lan SELECT unnest(ARRAY[NULL, -2, -1, 0, 1, 2, 9, 10, 123]);

-- ---------------------------------------------------------------- Kết quả của bản SQL (cũ)
CREATE TEMP TABLE cu_thue ON COMMIT DROP AS SELECT v, public._thue_hop_le(v) AS r FROM mau_thue;
CREATE TEMP TABLE cu_giam ON COMMIT DROP AS SELECT p, t, public._giam_gia_don(p, t) AS r FROM mau_giam;
CREATE TEMP TABLE cu_dk ON COMMIT DROP AS SELECT v, public._wf2b_payment_terms_days(v) AS r FROM mau_dk;
CREATE TEMP TABLE cu_so ON COMMIT DROP AS
  SELECT s.n, l.n AS lan, public._so_chung_tu(s.n) AS so, public._order_code(s.n, l.n) AS dh, public._inv_code(s.n, l.n) AS hd,
         public._ma_phieu_tra(s.n) AS pt
    FROM mau_so s, mau_lan l;
CREATE TEMP TABLE cu_quyen ON COMMIT DROP AS
  SELECT u, (SELECT array_agg(q::text) FROM public._quyen_giam_cua(u) q) AS r
    FROM (SELECT id FROM users UNION ALL SELECT NULL UNION ALL SELECT 'd2590000-0000-4000-95ff-000000000000') x(u);
CREATE TEMP TABLE cu_giam_don ON COMMIT DROP AS
  SELECT o, public._giam_don_hien_tai(o) AS r
    FROM (SELECT id FROM sales_orders UNION ALL SELECT NULL UNION ALL SELECT 'd2590000-0000-4000-92ff-000000000000') x(o);
CREATE TEMP TABLE cu_khac ON COMMIT DROP AS SELECT public.vn_today() AS hom_nay, public._la_trinh_duyet() AS postgres_td;
CREATE TEMP TABLE cu_loi (ca text, loi text) ON COMMIT DROP;
-- Vai trình duyệt + lỗi báo ra (tràn số nguyên ở điều khoản; số không ép được ở thuế — nếu có).
CREATE FUNCTION pg_temp.thu_loi(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  EXECUTE q INTO v;
  RETURN 'không lỗi: ' || coalesce(v, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.vai(r text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v boolean;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', r);
  v := public._la_trinh_duyet();
  EXECUTE 'RESET ROLE';
  RETURN r || '=' || v;
END $f$;
INSERT INTO cu_loi VALUES
  ('dk tràn', pg_temp.thu_loi($q$SELECT public._wf2b_payment_terms_days('NET99999999999')::text$q$)),
  ('dk tràn chữ thường', pg_temp.thu_loi($q$SELECT public._wf2b_payment_terms_days('net2147483648')::text$q$)),
  ('vai', pg_temp.vai('authenticated') || ' ' || pg_temp.vai('anon'));

-- Đo bản cũ: mỗi lần một câu, như trigger / RPC gọi.
CREATE TEMP TABLE do_tg (ban text, ms numeric) ON COMMIT DROP;
CREATE FUNCTION pg_temp.do_lan() RETURNS numeric LANGUAGE plpgsql AS $f$
DECLARE t0 timestamptz := clock_timestamp(); i int; v text;
BEGIN
  FOR i IN 1 .. 200 LOOP
    EXECUTE 'SELECT q.toan_quyen::text FROM public._quyen_giam_cua($1) q' INTO v USING 'd2590000-0000-4000-9500-000000000002'::uuid;
    EXECUTE 'SELECT public._giam_don_hien_tai($1)::text' INTO v USING 'd2590000-0000-4000-9200-000000000001'::uuid;
    EXECUTE 'SELECT public._order_code($1, 0)' INTO v USING i;
  END LOOP;
  RETURN extract(epoch FROM clock_timestamp() - t0) * 1000;
END $f$;
INSERT INTO do_tg VALUES ('cu', pg_temp.do_lan());

-- ---------------------------------------------------------------- Chạy migration HAI lần
\o /dev/null
\ir ../../supabase/migrations/259_ham_phu_plpgsql_dot2.sql
\ir ../../supabase/migrations/259_ham_phu_plpgsql_dot2.sql
\o
INSERT INTO do_tg VALUES ('moi', pg_temp.do_lan());

-- ---------------------------------------------------------------- So
INSERT INTO kq SELECT 1, '_thue_hop_le: y hệt trên mọi mẫu (số trong [0, 1], làm tròn 4 chữ số, chữ lạ / âm / > 1 → NULL)',
  count(*) FILTER (WHERE public._thue_hop_le(v) IS DISTINCT FROM r) = 0 AND count(*) >= 26,
  count(*) FILTER (WHERE public._thue_hop_le(v) IS DISTINCT FROM r) || ' lệch / ' || count(*) FROM cu_thue;
INSERT INTO kq SELECT 2, '_giam_gia_don: y hệt trên mọi cặp (kẹp [0, tiền hàng], chữ lạ / âm → 0)',
  count(*) FILTER (WHERE public._giam_gia_don(p, t) IS DISTINCT FROM r) = 0 AND count(*) > 100,
  count(*) FILTER (WHERE public._giam_gia_don(p, t) IS DISTINCT FROM r) || ' lệch / ' || count(*) FROM cu_giam;
INSERT INTO kq SELECT 3, '_wf2b_payment_terms_days: y hệt (NETn, chữ thường, có cách / không có → 0)',
  count(*) FILTER (WHERE public._wf2b_payment_terms_days(v) IS DISTINCT FROM r) = 0
    AND (SELECT r FROM cu_dk WHERE v = 'net15') = 15 AND (SELECT r FROM cu_dk WHERE v = 'NET007') = 7
    AND (SELECT r FROM cu_dk WHERE v = 'Net 7') = 0 AND (SELECT r FROM cu_dk WHERE v IS NULL) = 0,
  count(*) FILTER (WHERE public._wf2b_payment_terms_days(v) IS DISTINCT FROM r) || ' lệch / ' || count(*) FROM cu_dk;
INSERT INTO kq SELECT 4, 'Mã chứng từ: _so_chung_tu / _order_code / _inv_code / _ma_phieu_tra y hệt (số âm, NULL, lần sửa âm / 0)',
  count(*) FILTER (WHERE public._so_chung_tu(n) IS DISTINCT FROM so OR public._order_code(n, lan) IS DISTINCT FROM dh
                      OR public._inv_code(n, lan) IS DISTINCT FROM hd OR public._ma_phieu_tra(n) IS DISTINCT FROM pt) = 0,
  count(*) FILTER (WHERE public._so_chung_tu(n) IS DISTINCT FROM so OR public._order_code(n, lan) IS DISTINCT FROM dh
                      OR public._inv_code(n, lan) IS DISTINCT FROM hd OR public._ma_phieu_tra(n) IS DISTINCT FROM pt) || ' lệch / ' || count(*)
  FROM cu_so;
INSERT INTO kq SELECT 5, '_quyen_giam_cua: y hệt cho mọi người dùng + NULL + id lạ (một dòng, đúng 4 cột)',
  count(*) FILTER (WHERE (SELECT array_agg(q::text) FROM public._quyen_giam_cua(u) q) IS DISTINCT FROM r) = 0
    AND (SELECT r FROM cu_quyen WHERE u = 'd2590000-0000-4000-9500-000000000002') = ARRAY['(f,t,pct,5)']
    AND (SELECT r FROM cu_quyen WHERE u IS NULL) = ARRAY['(t,f,pct,)']
    AND (SELECT r FROM cu_quyen WHERE u = 'd2590000-0000-4000-95ff-000000000000') = ARRAY['(t,f,pct,)'],
  count(*) FILTER (WHERE (SELECT array_agg(q::text) FROM public._quyen_giam_cua(u) q) IS DISTINCT FROM r) || ' lệch / ' || count(*)
  FROM cu_quyen;
INSERT INTO kq SELECT 6, '_giam_don_hien_tai: y hệt cho mọi đơn (giảm 10.000; chênh làm tròn ≤ số dòng = 0, 2đ trên 1 dòng = 2; đơn rỗng 0; đơn lạ NULL)',
  count(*) FILTER (WHERE public._giam_don_hien_tai(o) IS DISTINCT FROM r) = 0
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000001') = 10000
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000002') = 0
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000003') = 0
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000005') = 2
    -- Dòng SL 0 không tính vào số dòng: chênh 2đ trên 1 dòng thật = 2 (tính cả dòng 0 thì ngưỡng thành 2 → 0).
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000006') = 2
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-9200-000000000004') = 0
    AND (SELECT r FROM cu_giam_don WHERE o = 'd2590000-0000-4000-92ff-000000000000') IS NULL,
  count(*) FILTER (WHERE public._giam_don_hien_tai(o) IS DISTINCT FROM r) || ' lệch / ' || count(*) FROM cu_giam_don;
INSERT INTO kq SELECT 7, 'vn_today / _la_trinh_duyet: y hệt (hôm nay giờ VN; postgres không phải trình duyệt; authenticated / anon là)',
  public.vn_today() = hom_nay AND public._la_trinh_duyet() = postgres_td AND NOT postgres_td
    AND (SELECT loi FROM cu_loi WHERE ca = 'vai') = pg_temp.vai('authenticated') || ' ' || pg_temp.vai('anon')
    AND (SELECT loi FROM cu_loi WHERE ca = 'vai') = 'authenticated=true anon=true',
  hom_nay::text || ' · ' || (SELECT loi FROM cu_loi WHERE ca = 'vai') FROM cu_khac;
INSERT INTO kq SELECT 8, 'Lỗi báo ra y hệt: điều khoản tràn số nguyên',
  (SELECT loi FROM cu_loi WHERE ca = 'dk tràn') = pg_temp.thu_loi($q$SELECT public._wf2b_payment_terms_days('NET99999999999')::text$q$)
    AND (SELECT loi FROM cu_loi WHERE ca = 'dk tràn chữ thường') = pg_temp.thu_loi($q$SELECT public._wf2b_payment_terms_days('net2147483648')::text$q$)
    AND (SELECT loi FROM cu_loi WHERE ca = 'dk tràn') LIKE '22003 %',
  (SELECT loi FROM cu_loi WHERE ca = 'dk tràn');

-- Trigger thật: đặt mã đơn mới (_order_code) + mã phiếu trả (_ma_phieu_tra), chốt giảm giá đơn (_giam_don_hien_tai).
INSERT INTO sales_orders (id, org_id, customer_id, sales_user_id, status)
VALUES ('d2590000-0000-4000-9200-000000000009', 'd2590000-0000-4000-9000-000000000001', 'd2590000-0000-4000-9600-000000000001',
        'd2590000-0000-4000-9500-000000000002', 'draft');
INSERT INTO returns (id, org_id, customer_id, requested_by, reason, status)
VALUES ('d2590000-0000-4000-9700-000000000001', 'd2590000-0000-4000-9000-000000000001', 'd2590000-0000-4000-9600-000000000001',
        'd2590000-0000-4000-9500-000000000002', 'damaged', 'draft');
INSERT INTO kq SELECT 9, 'Trigger: đơn mới đặt mã DH-0007 (số kế tiếp của NPP), phiếu trả mới PT-0001',
  (SELECT order_code FROM sales_orders WHERE id = 'd2590000-0000-4000-9200-000000000009') = 'DH-0007'
    AND (SELECT return_code FROM returns WHERE id = 'd2590000-0000-4000-9700-000000000001') = 'PT-0001',
  (SELECT order_code FROM sales_orders WHERE id = 'd2590000-0000-4000-9200-000000000009') || ' · '
    || (SELECT return_code FROM returns WHERE id = 'd2590000-0000-4000-9700-000000000001');

INSERT INTO kq SELECT 10, 'Cả 11 hàm plpgsql; giữ nguyên IMMUTABLE/STABLE, PARALLEL, STRICT, invoker, kiểu trả về, search_path, QUYỀN',
  count(*) = 11 AND bool_and(l.lanname = 'plpgsql')
    AND bool_and(p.provolatile = c.provolatile AND p.proparallel = c.proparallel AND p.proisstrict = c.proisstrict
                 AND p.prosecdef = c.prosecdef AND p.proretset = c.proretset AND p.prorettype = c.prorettype
                 AND p.prorows = c.prorows AND p.procost = c.procost AND p.proconfig IS NOT DISTINCT FROM c.proconfig
                 AND p.proacl IS NOT DISTINCT FROM c.proacl AND pg_get_function_result(p.oid) = c.kq),
  string_agg(CASE WHEN l.lanname <> 'plpgsql' OR p.proacl IS DISTINCT FROM c.proacl OR p.proconfig IS DISTINCT FROM c.proconfig
                  THEN c.sig::text END, ', ')
  FROM cu_tinh_chat c JOIN pg_proc p ON p.oid = c.sig JOIN pg_language l ON l.oid = p.prolang;
INSERT INTO kq SELECT 11, 'Nhanh hơn: 200 lượt (quyền giảm giá + giảm giá đơn + mã đơn, mỗi lần một câu) — bản mới nhanh hơn ít nhất 1,5 lần',
  (SELECT ms FROM do_tg WHERE ban = 'cu') > 1.5 * (SELECT ms FROM do_tg WHERE ban = 'moi'),
  'cũ ' || round((SELECT ms FROM do_tg WHERE ban = 'cu'), 1) || ' ms · mới ' || round((SELECT ms FROM do_tg WHERE ban = 'moi'), 1) || ' ms';

INSERT INTO kq SELECT 99, 'Đủ 11 dòng kiểm', count(*) = 11, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
