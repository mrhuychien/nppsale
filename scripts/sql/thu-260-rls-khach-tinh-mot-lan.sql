-- KIỂM MIG 260 — quyền xem khách: bỏ vế information_schema, tập "khách tôi đã bán" tính một lần, vế phân công của chính tôi
-- trước. AI THẤY KHÁCH NÀO / PHÂN CÔNG NÀO PHẢI GIỮ NGUYÊN. Chủ nhà 03/11/2026: "làm cả 2".
-- psql -f, BEGIN … ROLLBACK. Dựng lại chính sách đang chạy trên sổ thật (mig 042 / 154 / 250), ghi tập khách + phân công
-- mà TỪNG người thấy, chạy CHÍNH tệp migration hai lần, so lại. Dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-260-rls-khach-tinh-mot-lan.sql
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
SET LOCAL jit = off;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

-- ---------------------------------------------------------------- 0. Chính sách đang chạy trên sổ thật hôm nay
ALTER POLICY customer_select ON public.customers USING (
  (org_id = ( SELECT user_org_id() AS user_org_id)) AND (
    (( SELECT user_role() AS user_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'accountant'::text]))
    OR ( SELECT user_has_permission(( SELECT auth.uid() AS uid), 'customer.view_all'::text) AS user_has_permission)
    OR (EXISTS ( SELECT 1 FROM customer_assignments ca
                  WHERE ((ca.customer_id = customers.id) AND (ca.user_id = ( SELECT auth.uid() AS uid)) AND (ca.status = 'active'::text))))
    OR ((EXISTS ( SELECT 1 FROM information_schema.columns
                   WHERE (((columns.table_name)::name = 'customers'::name) AND ((columns.column_name)::name = 'created_by'::name))))
        AND (created_by = ( SELECT auth.uid() AS uid)))
    OR user_sells_to_customer(id)));
ALTER POLICY "View assignments in org" ON public.customer_assignments
  USING ((customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)) OR (user_id = ( SELECT auth.uid() AS uid)));
DROP FUNCTION IF EXISTS public.khach_toi_da_ban();

-- ---------------------------------------------------------------- Sổ thử: NPP T (thử) + NPP khác
SET LOCAL session_replication_role = replica;
INSERT INTO organizations (id, name, slug) VALUES
  ('d2600000-0000-4000-9000-000000000001', 'NPP thử 260', 'npp-thu-260'),
  ('d2600000-0000-4000-9000-000000000002', 'NPP khác 260', 'npp-khac-260');
INSERT INTO auth.users (id) SELECT ('d2600000-0000-4000-9500-00000000000' || g)::uuid FROM generate_series(1, 9) g;
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2600000-0000-4000-9500-000000000001', 'd2600000-0000-4000-9000-000000000001', 'Chủ 260', 'owner', true),
  ('d2600000-0000-4000-9500-000000000002', 'd2600000-0000-4000-9000-000000000001', 'Quản lý 260', 'manager', true),
  ('d2600000-0000-4000-9500-000000000003', 'd2600000-0000-4000-9000-000000000001', 'Kế toán 260', 'accountant', true),
  ('d2600000-0000-4000-9500-000000000004', 'd2600000-0000-4000-9000-000000000001', 'Kho 260', 'warehouse', true),
  ('d2600000-0000-4000-9500-000000000005', 'd2600000-0000-4000-9000-000000000001', 'NVBH A 260', 'sales', true),
  ('d2600000-0000-4000-9500-000000000006', 'd2600000-0000-4000-9000-000000000001', 'NVBH B (khoá) 260', 'sales', false),
  ('d2600000-0000-4000-9500-000000000007', 'd2600000-0000-4000-9000-000000000001', 'NVBH C xem hết 260', 'sales', true),
  ('d2600000-0000-4000-9500-000000000008', 'd2600000-0000-4000-9000-000000000001', 'NVBH D 260', 'sales', true),
  ('d2600000-0000-4000-9500-000000000009', 'd2600000-0000-4000-9000-000000000002', 'NVBH NPP khác 260', 'sales', true);
INSERT INTO user_permission_overrides (user_id, permission_key, granted, org_id) VALUES
  ('d2600000-0000-4000-9500-000000000007', 'customer.view_all', true, 'd2600000-0000-4000-9000-000000000001');
-- K1 giao A · K2 giao A đã ngưng · K3 A tạo · K4 A có đơn · K5 A chỉ có đơn nháp · K6 giao B · K7 không ai · K8 D có đơn xong
-- · K9 B tạo · K10 ở NPP khác (A có đơn + phân công ở đó — vẫn KHÔNG được thấy).
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, created_by, status)
SELECT ('d2600000-0000-4000-9600-0000000000' || lpad(g::text, 2, '0'))::uuid,
       CASE WHEN g = 10 THEN 'd2600000-0000-4000-9000-000000000002' ELSE 'd2600000-0000-4000-9000-000000000001' END::uuid,
       'Khách 260-' || g, 'Chủ', '09026000' || lpad(g::text, 2, '0'), 'Đường 260',
       CASE g WHEN 3 THEN 'd2600000-0000-4000-9500-000000000005' WHEN 9 THEN 'd2600000-0000-4000-9500-000000000006' END::uuid,
       'active'
  FROM generate_series(1, 10) g;
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  ('d2600000-0000-4000-9600-000000000001', 'd2600000-0000-4000-9500-000000000005', 'primary', 'active'),
  ('d2600000-0000-4000-9600-000000000002', 'd2600000-0000-4000-9500-000000000005', 'primary', 'inactive'),
  ('d2600000-0000-4000-9600-000000000006', 'd2600000-0000-4000-9500-000000000006', 'primary', 'active'),
  ('d2600000-0000-4000-9600-000000000010', 'd2600000-0000-4000-9500-000000000005', 'primary', 'active');
INSERT INTO sales_orders (id, org_id, order_code, order_seq, status, customer_id, sales_user_id) VALUES
  ('d2600000-0000-4000-9200-000000000004', 'd2600000-0000-4000-9000-000000000001', 'DH260-4', 4, 'submitted', 'd2600000-0000-4000-9600-000000000004', 'd2600000-0000-4000-9500-000000000005'),
  ('d2600000-0000-4000-9200-000000000005', 'd2600000-0000-4000-9000-000000000001', 'DH260-5', 5, 'draft', 'd2600000-0000-4000-9600-000000000005', 'd2600000-0000-4000-9500-000000000005'),
  ('d2600000-0000-4000-9200-000000000008', 'd2600000-0000-4000-9000-000000000001', 'DH260-8', 8, 'completed', 'd2600000-0000-4000-9600-000000000008', 'd2600000-0000-4000-9500-000000000008'),
  ('d2600000-0000-4000-9200-000000000010', 'd2600000-0000-4000-9000-000000000002', 'DH260-10', 10, 'submitted', 'd2600000-0000-4000-9600-000000000010', 'd2600000-0000-4000-9500-000000000005');
SET LOCAL session_replication_role = origin;

-- Ghi tập khách + phân công mà TỪNG người thấy (người của sổ thử 260 + mọi người dùng sẵn có của sổ).
CREATE TEMP TABLE thay (ban text, u uuid, khach text[], phan_cong text[]) ON COMMIT DROP;
GRANT ALL ON thay TO authenticated;
CREATE FUNCTION pg_temp.ghi_thay(p_ban text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; k text[]; c text[];
BEGIN
  FOR r IN SELECT id FROM users LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT coalesce(array_agg(id::text ORDER BY id), '{}') INTO k FROM customers;
    SELECT coalesce(array_agg(customer_id::text || '/' || user_id::text ORDER BY customer_id, user_id), '{}') INTO c FROM customer_assignments;
    EXECUTE 'RESET ROLE';
    INSERT INTO thay VALUES (p_ban, r.id, k, c);
  END LOOP;
END $f$;
-- Khách 260-n mà một người thấy, dạng "1,3,4,5".
CREATE FUNCTION pg_temp.so_khach(p_ban text, p_u text) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(string_agg(ltrim(right(x, 2), '0'), ',' ORDER BY right(x, 2)), '')
    FROM thay t, unnest(t.khach) x
   WHERE t.ban = p_ban AND t.u = ('d2600000-0000-4000-9500-00000000000' || p_u)::uuid AND x LIKE 'd2600000-0000-4000-9600-%'
$f$;
-- Thời gian (trung vị 9 lần, lập kế hoạch + chạy) của một câu dưới vai authenticated + JWT.
CREATE FUNCTION pg_temp.do_ms(p_uid uuid, q text) RETURNS numeric LANGUAGE plpgsql AS $f$
DECLARE t0 timestamptz; a numeric[] := '{}'; i int; r record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR i IN 1 .. 9 LOOP
    t0 := clock_timestamp();
    EXECUTE q INTO r;
    a := a || (extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric;
  END LOOP;
  EXECUTE 'RESET ROLE';
  RETURN (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x)::numeric FROM unnest(a) x);
END $f$;
CREATE TEMP TABLE do_tg (ban text, ai text, ms numeric) ON COMMIT DROP;
GRANT ALL ON do_tg TO authenticated;
CREATE FUNCTION pg_temp.do_ca(p_ban text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO do_tg VALUES
    (p_ban, 'NVBH tra một khách', pg_temp.do_ms('d2600000-0000-4000-9500-000000000005', $q$SELECT count(*) FROM customers WHERE id = 'd2600000-0000-4000-9600-000000000001'$q$)),
    (p_ban, 'Chủ tra một khách', pg_temp.do_ms('d2600000-0000-4000-9500-000000000001', $q$SELECT count(*) FROM customers WHERE id = 'd2600000-0000-4000-9600-000000000001'$q$)),
    (p_ban, 'NVBH sổ khách', pg_temp.do_ms('d2600000-0000-4000-9500-000000000005', $q$SELECT count(*), max(store_name) FROM customers WHERE status = 'active'$q$));
END $f$;

SELECT pg_temp.ghi_thay('cu') \g /dev/null
SELECT pg_temp.do_ca('cu') \g /dev/null

-- ---------------------------------------------------------------- Chạy migration HAI lần
\o /dev/null
\ir ../../supabase/migrations/260_rls_khach_tinh_mot_lan.sql
\ir ../../supabase/migrations/260_rls_khach_tinh_mot_lan.sql
\o
SELECT pg_temp.ghi_thay('moi') \g /dev/null
SELECT pg_temp.do_ca('moi') \g /dev/null

-- ---------------------------------------------------------------- So
INSERT INTO kq SELECT 1, 'Bản cũ đúng luật: chủ / QL / KT thấy 9 khách của NPP; kho 0; NVBH A: giao + tự tạo + có đơn (kể cả nháp)',
  pg_temp.so_khach('cu', '1') = '1,2,3,4,5,6,7,8,9' AND pg_temp.so_khach('cu', '2') = '1,2,3,4,5,6,7,8,9'
    AND pg_temp.so_khach('cu', '3') = '1,2,3,4,5,6,7,8,9' AND pg_temp.so_khach('cu', '4') = ''
    AND pg_temp.so_khach('cu', '5') = '1,3,4,5',
  'A thấy ' || pg_temp.so_khach('cu', '5');
INSERT INTO kq SELECT 2, 'Bản cũ đúng luật: B bị khoá 0; C có quyền xem hết 9; D (chỉ có đơn) thấy 8; NPP khác không thấy khách NPP này',
  pg_temp.so_khach('cu', '6') = '' AND pg_temp.so_khach('cu', '7') = '1,2,3,4,5,6,7,8,9' AND pg_temp.so_khach('cu', '8') = '8'
    AND pg_temp.so_khach('cu', '9') = '',
  'B ' || pg_temp.so_khach('cu', '6') || ' · C ' || pg_temp.so_khach('cu', '7') || ' · D ' || pg_temp.so_khach('cu', '8');
INSERT INTO kq SELECT 3, 'Sau mig 260: TỪNG người thấy y hệt tập khách cũ (người của sổ thử + mọi người dùng sẵn có)',
  count(*) FILTER (WHERE b.khach IS DISTINCT FROM a.khach) = 0 AND count(*) >= 9,
  count(*) FILTER (WHERE b.khach IS DISTINCT FROM a.khach) || ' lệch / ' || count(*) || ' người'
  FROM thay a JOIN thay b ON b.u = a.u AND b.ban = 'moi' WHERE a.ban = 'cu';
INSERT INTO kq SELECT 4, 'Sau mig 260: TỪNG người thấy y hệt tập phân công cũ (kể cả phân công của mình ở NPP khác)',
  count(*) FILTER (WHERE b.phan_cong IS DISTINCT FROM a.phan_cong) = 0 AND count(*) >= 9,
  count(*) FILTER (WHERE b.phan_cong IS DISTINCT FROM a.phan_cong) || ' lệch / ' || count(*) || ' người'
  FROM thay a JOIN thay b ON b.u = a.u AND b.ban = 'moi' WHERE a.ban = 'cu';
INSERT INTO kq SELECT 5, 'customer_select mới: hết information_schema + user_sells_to_customer; còn đủ bốn vế (vai, xem hết, phân công, tự tạo) + tập đã bán',
  position('information_schema' IN q) = 0 AND position('user_sells_to_customer' IN q) = 0
    AND position('(id IN ( SELECT khach_toi_da_ban() AS khach_toi_da_ban))' IN q) > 0
    AND position('ARRAY[''owner''::text, ''manager''::text, ''accountant''::text]' IN q) > 0
    AND position('''customer.view_all''::text' IN q) > 0 AND position('FROM customer_assignments ca' IN q) > 0
    AND position('(created_by = ( SELECT auth.uid() AS uid))' IN q) > 0
    AND position('org_id = ( SELECT user_org_id() AS user_org_id)' IN q) = 3,
  regexp_replace(q, '\s+', ' ', 'g')
  FROM (SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polname = 'customer_select' AND polrelid = 'public.customers'::regclass) x;
INSERT INTO kq SELECT 6, 'Phân công: vế "của chính tôi" đứng trước; chính sách quản lý phân công không đổi',
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'View assignments in org' AND polrelid = 'public.customer_assignments'::regclass)
    = '((user_id = ( SELECT auth.uid() AS uid)) OR (customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)))'
    AND (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'Owner/Manager manage assignments' AND polrelid = 'public.customer_assignments'::regclass)
        LIKE '%customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)%', '';
INSERT INTO kq SELECT 7, 'khach_toi_da_ban(): STABLE, SECURITY DEFINER, search_path=public; authenticated gọi được, anon / PUBLIC không',
  (SELECT provolatile = 's' AND prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.khach_toi_da_ban()'::regprocedure)
    AND has_function_privilege('authenticated', 'public.khach_toi_da_ban()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.khach_toi_da_ban()', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.khach_toi_da_ban()'::regprocedure AND a.grantee = 0), '';
DO $g$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'd2600000-0000-4000-9500-000000000005', 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT string_agg(ltrim(right(k::text, 2), '0'), ',' ORDER BY right(k::text, 2)) INTO v
    FROM public.khach_toi_da_ban() k WHERE k::text LIKE 'd2600000-%';
  EXECUTE 'RESET ROLE';
  INSERT INTO kq VALUES (8, 'Gọi thẳng khach_toi_da_ban() chỉ ra khách có đơn của CHÍNH người gọi (A: K4, K5, K10 — không lộ khách người khác)',
                         v IS NOT DISTINCT FROM '4,5,10', 'A: ' || coalesce(v, '∅'));
END $g$;
INSERT INTO kq SELECT 9, 'Nhanh hơn: tra một khách (NVBH, chủ) và sổ khách NVBH — bản mới nhanh hơn ít nhất 2 lần',
  bool_and(c.ms > 2 * m.ms), string_agg(c.ai || ' ' || round(c.ms, 2) || ' → ' || round(m.ms, 2) || ' ms', ' · ')
  FROM do_tg c JOIN do_tg m ON m.ai = c.ai AND m.ban = 'moi' WHERE c.ban = 'cu';

INSERT INTO kq SELECT 99, 'Đủ 9 dòng kiểm', count(*) = 9, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
