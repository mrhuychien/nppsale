-- KIỂM MIG 254 — số phiên sổ khách bán hàng (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4: POS / bán hàng mở
-- là kéo cả sổ khách ≈570 KB về máy dù khách chưa đổi; nay máy so số phiên khách như đã so số phiên hàng của mig 209).
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-254-phien-khach-ban.sql
\set ON_ERROR_STOP on
-- ⚠ XẾP HÀNG: vitest chạy các bộ thử song song trên CÙNG một sổ thử — khoá tư vấn giữ tới hết phiên.
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
-- auth.uid() đúng bản Supabase: PostgREST ≥ v10 chỉ đặt request.jwt.claims (JSON).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
CREATE FUNCTION pg_temp.vao(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $f$;
CREATE FUNCTION pg_temp.ra() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN EXECUTE 'RESET ROLE'; END $f$;

-- Mốc hai số phiên (khách / hàng) sau từng bước.
CREATE TEMP TABLE moc (ten text PRIMARY KEY, pk bigint, ph bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ghi_moc(p text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO moc (ten, pk, ph) SELECT p, phien_khach, phien FROM public.danh_muc_ban_phien WHERE id = 1;
END $f$;
-- Từ mốc a sang mốc b: số phiên KHÁCH tăng đúng 1, số phiên HÀNG đứng yên.
CREATE FUNCTION pg_temp.tang(a text, b text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT (SELECT pk FROM moc WHERE ten = b) = (SELECT pk FROM moc WHERE ten = a) + 1
     AND (SELECT ph FROM moc WHERE ten = b) = (SELECT ph FROM moc WHERE ten = a)
$f$;
CREATE FUNCTION pg_temp.ghi(a text, b text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT format('khách %s→%s · hàng %s→%s',
    (SELECT pk FROM moc WHERE ten = a), (SELECT pk FROM moc WHERE ten = b),
    (SELECT ph FROM moc WHERE ten = a), (SELECT ph FROM moc WHERE ten = b))
$f$;

\o /dev/null
\ir ../../supabase/migrations/209_phien_danh_muc_ban.sql
\ir ../../supabase/migrations/254_phien_khach_ban.sql
\o

-- ---------------------------------------------------------------- Sổ thử: 1 NPP, chủ + NVBH
INSERT INTO auth.users (id) VALUES ('d2540000-0000-4000-8000-0000000000b1'), ('d2540000-0000-4000-8000-0000000000b2');
INSERT INTO organizations (id, name, slug) VALUES ('d2540000-0000-4000-8000-000000000001', 'NPP thử 254', 'npp-thu-254');
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2540000-0000-4000-8000-0000000000b1', 'd2540000-0000-4000-8000-000000000001', 'Chủ 254', 'owner', true),
  ('d2540000-0000-4000-8000-0000000000b2', 'd2540000-0000-4000-8000-000000000001', 'NVBH 254', 'sales', true);
SELECT pg_temp.ghi_moc('dau');

-- 1. Thêm 3 khách trong MỘT câu → +1 đúng một lần
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, status, created_by) VALUES
  ('d2540000-0000-4000-9100-00000000000a', 'd2540000-0000-4000-8000-000000000001', 'Khách A', 'A', '0901000001', '1 A', 'active', 'd2540000-0000-4000-8000-0000000000b1'),
  ('d2540000-0000-4000-9100-00000000000b', 'd2540000-0000-4000-8000-000000000001', 'Khách B', 'B', '0901000002', '2 B', 'active', 'd2540000-0000-4000-8000-0000000000b1'),
  ('d2540000-0000-4000-9100-00000000000c', 'd2540000-0000-4000-8000-000000000001', 'Khách C', 'C', '0901000003', '3 C', 'active', 'd2540000-0000-4000-8000-0000000000b1');
SELECT pg_temp.ghi_moc('them');
INSERT INTO kq SELECT 1, 'Thêm 3 khách một câu → số phiên khách +1 đúng MỘT lần, số phiên hàng giữ nguyên',
  pg_temp.tang('dau', 'them'), pg_temp.ghi('dau', 'them');

-- 2. Chủ NPP (vai authenticated, qua RLS) sửa khách → +1 — hàm trigger SECURITY DEFINER ghi hộ vào bảng khoá ghi
SELECT pg_temp.vao('d2540000-0000-4000-8000-0000000000b1');
UPDATE customers SET address = '1 A mới' WHERE id = 'd2540000-0000-4000-9100-00000000000a';
SELECT pg_temp.ra();
SELECT pg_temp.ghi_moc('sua');
INSERT INTO kq SELECT 2, 'Người dùng (authenticated, qua RLS) sửa khách → +1',
  pg_temp.tang('them', 'sua'), pg_temp.ghi('them', 'sua');

-- 3. Xoá khách → tăng (+1 ở customers, +1 nữa do cascade sang customer_assignments — câu xoá dây chuyền cũng nổ trigger mức câu)
DELETE FROM customers WHERE id = 'd2540000-0000-4000-9100-00000000000c';
SELECT pg_temp.ghi_moc('xoa');
INSERT INTO kq SELECT 3, 'Xoá khách → số phiên khách tăng (1–2 lần: cascade sang customer_assignments), số phiên hàng giữ nguyên',
  (SELECT pk FROM moc WHERE ten = 'xoa') - (SELECT pk FROM moc WHERE ten = 'sua') BETWEEN 1 AND 2
    AND (SELECT ph FROM moc WHERE ten = 'xoa') = (SELECT ph FROM moc WHERE ten = 'sua'),
  pg_temp.ghi('sua', 'xoa');

-- 4. Nhóm khách (tên nhóm nằm trong sổ khách POS, nhóm = bảng giá) → +1
INSERT INTO customer_groups (id, org_id, name) VALUES ('d2540000-0000-4000-9200-000000000001', 'd2540000-0000-4000-8000-000000000001', 'Nhóm 254');
SELECT pg_temp.ghi_moc('nhom');
INSERT INTO kq SELECT 4, 'Thêm nhóm khách → +1', pg_temp.tang('xoa', 'nhom'), pg_temp.ghi('xoa', 'nhom');

-- 5. Phân công (NVBH thấy khách theo phân công): thêm +1, gỡ +1
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  ('d2540000-0000-4000-9100-00000000000a', 'd2540000-0000-4000-8000-0000000000b2', 'primary', 'active');
SELECT pg_temp.ghi_moc('pc');
DELETE FROM customer_assignments WHERE customer_id = 'd2540000-0000-4000-9100-00000000000a' AND user_id = 'd2540000-0000-4000-8000-0000000000b2';
SELECT pg_temp.ghi_moc('pc2');
INSERT INTO kq SELECT 5, 'Phân công khách cho NVBH: thêm +1, gỡ +1',
  pg_temp.tang('nhom', 'pc') AND pg_temp.tang('pc', 'pc2'), pg_temp.ghi('nhom', 'pc2');

-- 6. Quyền riêng customer.view_all (mở cả sổ cho một người) → +1
INSERT INTO user_permission_overrides (user_id, permission_key, granted, org_id) VALUES
  ('d2540000-0000-4000-8000-0000000000b2', 'customer.view_all', true, 'd2540000-0000-4000-8000-000000000001');
SELECT pg_temp.ghi_moc('quyen');
INSERT INTO kq SELECT 6, 'Cấp quyền riêng customer.view_all → +1', pg_temp.tang('pc2', 'quyen'), pg_temp.ghi('pc2', 'quyen');

-- 7. Hàng đổi → số phiên HÀNG tăng (mig 209), số phiên KHÁCH đứng yên
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('d2540000-0000-4000-9300-000000000001', 'd2540000-0000-4000-8000-000000000001', 'SP254', 'Hàng thử 254', 'hộp', 'active');
SELECT pg_temp.ghi_moc('hang');
INSERT INTO kq SELECT 7, 'Thêm hàng → số phiên hàng +1, số phiên khách KHÔNG đổi',
  (SELECT ph FROM moc WHERE ten = 'hang') = (SELECT ph FROM moc WHERE ten = 'quyen') + 1
    AND (SELECT pk FROM moc WHERE ten = 'hang') = (SELECT pk FROM moc WHERE ten = 'quyen'),
  pg_temp.ghi('quyen', 'hang');

-- 8. Chạy lại migration → hai số giữ nguyên, trigger không nhân đôi (đúng 5 bảng)
SELECT pg_temp.ghi_moc('truoc_mig');
\o /dev/null
\ir ../../supabase/migrations/254_phien_khach_ban.sql
\o
SELECT pg_temp.ghi_moc('sau_mig');
INSERT INTO kq SELECT 8, 'Chạy lại mig 254 → hai số giữ nguyên, đúng 5 trigger (customers, customer_groups, customer_assignments, user_permission_overrides, role_permissions)',
  (SELECT pk FROM moc WHERE ten = 'sau_mig') = (SELECT pk FROM moc WHERE ten = 'truoc_mig')
    AND (SELECT ph FROM moc WHERE ten = 'sau_mig') = (SELECT ph FROM moc WHERE ten = 'truoc_mig')
    AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_phien_khach_ban' AND NOT tgisinternal) = 5
    AND (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname = 'trg_phien_khach_ban' AND NOT t.tgisinternal)
        = ARRAY['customer_assignments', 'customer_groups', 'customers', 'role_permissions', 'user_permission_overrides'],
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_phien_khach_ban' AND NOT tgisinternal)::text || ' trigger';

-- 9 + 10. NVBH đọc được CẢ HAI số trong một dòng; không ghi thẳng được
SELECT pg_temp.vao('d2540000-0000-4000-8000-0000000000b2');
INSERT INTO kq SELECT 9, 'authenticated đọc được phien + phien_khach cùng một dòng',
  (SELECT phien IS NOT NULL AND phien_khach IS NOT NULL FROM public.danh_muc_ban_phien WHERE id = 1), '';
DO $d$
BEGIN
  BEGIN
    UPDATE public.danh_muc_ban_phien SET phien_khach = 999999 WHERE id = 1;
    INSERT INTO kq SELECT 10, 'authenticated KHÔNG ghi thẳng được số phiên khách', false, 'ghi được!';
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO kq SELECT 10, 'authenticated KHÔNG ghi thẳng được số phiên khách', true, SQLERRM;
  END;
END $d$;
SELECT pg_temp.ra();

-- 11. Hàm trigger không gọi thẳng được qua API
INSERT INTO kq SELECT 11, 'Hàm trigger _tang_phien_khach_ban không cho authenticated / anon gọi thẳng',
  NOT has_function_privilege('authenticated', 'public._tang_phien_khach_ban()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._tang_phien_khach_ban()', 'EXECUTE'), '';

INSERT INTO kq SELECT 99, 'Đủ 11 dòng kiểm', count(*) = 11, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
