-- KIỂM MIG 264 — Điểm bán cần cập nhật: lọc + đếm theo NV chính (chủ nhà 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật
-- thêm lọc theo nhân viên bán hàng để xem nhân viên bán hàng nào còn bao nhiêu điểm chưa cập nhật"). psql -f, BEGIN … ROLLBACK:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-264-diem-ban-theo-nv.sql
-- Sổ mẫu: 10 điểm bán "Thử264 01…10" của NV A / NV B (sales) — chính, phụ, phân công đã thôi, hai NV chính, chưa ai phụ trách,
-- khách ngừng hoạt động, đã duyệt / có yêu cầu đổi. Mọi số đếm theo NV phải BẰNG tổng của danh sách lọc cùng NV.
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set A '''e2640000-0000-0000-0000-00000000000a'''
\set B '''e2640000-0000-0000-0000-00000000000b'''
\set C '''e2640000-0000-0000-0000-00000000000c'''

-- Đọc MỘT số dưới phiên của p (vai authenticated như PostgREST — RLS áp như thật). Lỗi thì ném (ON_ERROR_STOP dừng bộ thử).
CREATE FUNCTION pg_temp.so(p uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE q INTO v;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END $f$;
-- Đọc danh sách tên (theo thứ tự hàm trả) dưới phiên của p.
CREATE FUNCTION pg_temp.ten(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE format('SELECT string_agg(right(x.store_name, 2), %L) FROM (%s) x', ',', q) INTO v;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN coalesce(v, '');
END $f$;
-- Đọc MỘT chuỗi dưới phiên của p.
CREATE FUNCTION pg_temp.chu(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE q INTO v;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN coalesce(v, '');
END $f$;
CREATE TEMP TABLE nhom (nv_id uuid, so_thieu int, so_chua_anh int, so_chua_vi_tri int, so_cho_duyet int) ON COMMIT DROP;
GRANT ALL ON nhom TO authenticated;
-- Lỗi (nếu có) của câu q dưới phiên p; 'OK' = chạy được.
CREATE FUNCTION pg_temp.loi(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', p::text, true);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE q;
    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $f$;

-- ===================================== DỰNG SỔ =====================================
INSERT INTO auth.users (id, email) VALUES (:A, 'a264@x.vn'), (:B, 'b264@x.vn'), (:C, 'c264@x.vn');
INSERT INTO users (id, org_id, full_name, role) VALUES (:A, :ORG, 'NV A 264', 'sales'), (:B, :ORG, 'NV B 264', 'sales'),
  (:C, :ORG, 'NV C 264', 'sales');
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel, status, gps_lat, gps_lng)
SELECT ('c2640000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, :ORG, 'Thử264 ' || lpad(i::text, 2, '0'),
       'Chủ ' || i, '09126400' || lpad(i::text, 2, '0'), i || ' Thử264', 'GT',
       CASE WHEN i = 7 THEN 'suspended' ELSE 'active' END,
       CASE WHEN i IN (3, 4, 6, 9, 10, 11) THEN 20.85 END, CASE WHEN i IN (3, 4, 6, 9, 10, 11) THEN 106.68 END
FROM generate_series(1, 11) i;
-- 01 A chính (thiếu cả hai) · 02 A chính (có ảnh, thiếu vị trí) · 03 A chính (đủ, chưa duyệt) · 04 B chính + A phụ (thiếu ảnh)
-- 05 chưa ai (thiếu cả hai) · 06 A chính ĐÃ THÔI (thiếu ảnh) · 07 khách ngừng hoạt động (A chính) · 08 A + B cùng chính (thiếu
-- vị trí) · 09 A chính (đủ, đã duyệt, có yêu cầu đổi) · 10 A chính (đủ, đã duyệt — xong hẳn) · 11 C chính (đủ, CHỈ chờ duyệt).
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  ('c2640000-0000-0000-0000-000000000001', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000002', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000003', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000004', :B, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000004', :A, 'secondary', 'active'),
  ('c2640000-0000-0000-0000-000000000006', :A, 'primary', 'inactive'),
  ('c2640000-0000-0000-0000-000000000007', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000008', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000008', :B, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000009', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000010', :A, 'primary', 'active'),
  ('c2640000-0000-0000-0000-000000000011', :C, 'primary', 'active');
INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at)
SELECT :ORG, ('c2640000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 1, 'https://x/' || i || '.jpg', now()
FROM unnest(ARRAY[2, 3, 8, 9, 10, 11]) i;
UPDATE customers SET photo_approved_at = now(), photo_approved_by = :CHU
 WHERE id IN ('c2640000-0000-0000-0000-000000000009', 'c2640000-0000-0000-0000-000000000010');
INSERT INTO customer_photo_requests (org_id, customer_id, kind, pin_lat, pin_lng, status, requested_by)
VALUES (:ORG, 'c2640000-0000-0000-0000-000000000009', 'pin_set', 20.86, 106.69, 'pending', :A);

-- ===================================== CHẠY MIGRATION HAI LẦN =====================================
\o /dev/null
\ir ../../supabase/migrations/264_diem_ban_thieu_anh_theo_nv.sql
\ir ../../supabase/migrations/264_diem_ban_thieu_anh_theo_nv.sql
\o

INSERT INTO kq
SELECT 1, 'Chạy hai lần: mỗi hàm đúng MỘT bản, bộ tham số mới (không còn bản 3 / 2 tham số → PostgREST không gặp hai hàm trùng)',
  string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', '; ' ORDER BY proname)
    = 'khach_cho_duyet_anh(p_offset integer, p_limit integer, p_nv text); khach_thieu_anh(p_tab text, p_offset integer, p_limit integer, p_nv text); khach_thieu_anh_theo_nv()',
  string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', '; ' ORDER BY proname)
FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('khach_thieu_anh', 'khach_cho_duyet_anh', 'khach_thieu_anh_theo_nv');

DO $t$ DECLARE chu uuid := 'e0000000-0000-0000-0000-000000000001'; cu bigint; that bigint; BEGIN
  -- App bản cũ gọi ba tham số đặt tên (không p_nv) → vẫn chạy, ra đúng tổng như đếm thẳng trên bảng.
  cu := pg_temp.so(chu, $q$SELECT coalesce(max(total_count), 0) FROM khach_thieu_anh(p_tab := 'all', p_offset := 0, p_limit := 1)$q$);
  SELECT count(*) INTO that FROM customers c
   WHERE c.org_id = 'a0000000-0000-0000-0000-000000000001' AND c.status = 'active'
     AND (NOT EXISTS (SELECT 1 FROM customer_photos p WHERE p.customer_id = c.id) OR c.gps_lat IS NULL OR c.gps_lng IS NULL);
  INSERT INTO kq VALUES (2, 'Gọi kiểu cũ (không p_nv) vẫn chạy, tổng = đếm thẳng trên bảng', cu = that, cu || ' / ' || that);
END $t$;

DO $t$ DECLARE a text; BEGIN
  a := pg_temp.chu('e0000000-0000-0000-0000-000000000001', $q$
    SELECT string_agg(u.full_name || ' = ' || n.so_thieu || '/' || n.so_chua_anh || '/' || n.so_chua_vi_tri || '/' || n.so_cho_duyet,
                      ' | ' ORDER BY u.full_name)
      FROM khach_thieu_anh_theo_nv() n JOIN users u ON u.id = n.nv_id
     WHERE u.full_name IN ('NV A 264', 'NV B 264', 'NV C 264')$q$);
  INSERT INTO kq VALUES (3, 'Đếm theo NV chính (còn thiếu / chưa ảnh / chưa vị trí / chờ duyệt): A = 3/1/3/4 (01, 02, 08 · 01 · 01, 02, 08 · 02, 03, 08, 09), B = 2/1/1/2 (04, 08), C = 0/0/0/1 (chỉ chờ duyệt vẫn có dòng)',
    a = 'NV A 264 = 3/1/3/4 | NV B 264 = 2/1/1/2 | NV C 264 = 0/0/0/1', a);
END $t$;

-- Số đếm đọc DƯỚI PHIÊN chủ NPP (RLS như thật), rồi so từng nhóm với danh sách lọc cùng NV.
SELECT pg_temp.loi(:CHU, 'INSERT INTO nhom SELECT * FROM khach_thieu_anh_theo_nv()') AS doc_nhom \gset
DO $t$ DECLARE chu uuid := 'e0000000-0000-0000-0000-000000000001'; r record; n int := 0; lech text := '';
  t_all bigint; t_np bigint; t_ng bigint; t_cd bigint; nv text; BEGIN
  FOR r IN SELECT * FROM nhom LOOP
    n := n + 1;
    nv := coalesce(r.nv_id::text, '_none');
    t_all := pg_temp.so(chu, format('SELECT coalesce(max(total_count), 0) FROM khach_thieu_anh(%L, 0, 1, %L)', 'all', nv));
    t_np := pg_temp.so(chu, format('SELECT coalesce(max(total_count), 0) FROM khach_thieu_anh(%L, 0, 1, %L)', 'no_photo', nv));
    t_ng := pg_temp.so(chu, format('SELECT coalesce(max(total_count), 0) FROM khach_thieu_anh(%L, 0, 1, %L)', 'no_gps', nv));
    t_cd := pg_temp.so(chu, format('SELECT coalesce(max(total_count), 0) FROM khach_cho_duyet_anh(0, 1, %L)', nv));
    IF (t_all, t_np, t_ng, t_cd) IS DISTINCT FROM (r.so_thieu::bigint, r.so_chua_anh::bigint, r.so_chua_vi_tri::bigint, r.so_cho_duyet::bigint) THEN
      lech := lech || nv || ': đếm ' || r.so_thieu || '/' || r.so_chua_anh || '/' || r.so_chua_vi_tri || '/' || r.so_cho_duyet
                   || ' ≠ danh sách ' || t_all || '/' || t_np || '/' || t_ng || '/' || t_cd || '; ';
    END IF;
  END LOOP;
  INSERT INTO kq VALUES (4, 'Mọi dòng đếm theo NV (kể cả chưa phân công) BẰNG tổng của danh sách lọc cùng NV ở cả 4 tab',
    n >= 4 AND lech = '', n || ' nhóm' || CASE WHEN lech <> '' THEN ' — ' || lech ELSE '' END);
END $t$;

INSERT INTO kq SELECT 5, 'Danh sách NV A (Còn thiếu): đúng 01, 02, 08 theo tên; trang 2 cỡ 1 = 02, tổng vẫn 3; mã NV viết hoa cũng khớp',
  pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 50, 'e2640000-0000-0000-0000-00000000000a')$q$) = '01,02,08'
  AND pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 1, 1, 'e2640000-0000-0000-0000-00000000000a')$q$) = '02'
  AND pg_temp.so(:CHU, $q$SELECT max(total_count) FROM khach_thieu_anh('all', 1, 1, 'e2640000-0000-0000-0000-00000000000a')$q$) = 3
  AND pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 50, 'E2640000-0000-0000-0000-00000000000A')$q$) = '01,02,08',
  pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 50, 'E2640000-0000-0000-0000-00000000000A')$q$) || ' (mã viết hoa)';

INSERT INTO kq SELECT 6, 'Chỉ NV CHÍNH ĐANG LÀM: 04 (A là phụ) không vào A mà vào B; 06 (phân công A đã thôi) không vào A',
  position('04' IN pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 200, 'e2640000-0000-0000-0000-00000000000a')$q$)) = 0
  AND pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 200, 'e2640000-0000-0000-0000-00000000000b')$q$) = '04,08'
  AND position('06' IN pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('no_photo', 0, 200, 'e2640000-0000-0000-0000-00000000000a')$q$)) = 0,
  'B: ' || pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 200, 'e2640000-0000-0000-0000-00000000000b')$q$);

INSERT INTO kq SELECT 7, 'Hai NV chính (08): có trong danh sách của cả A lẫn B — Chờ duyệt cũng vậy',
  pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_cho_duyet_anh(0, 200, 'e2640000-0000-0000-0000-00000000000a') WHERE store_name = 'Thử264 08'$q$) = 1
  AND pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_cho_duyet_anh(0, 200, 'e2640000-0000-0000-0000-00000000000b') WHERE store_name = 'Thử264 08'$q$) = 1,
  'A chờ duyệt: ' || pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_cho_duyet_anh(0, 200, 'e2640000-0000-0000-0000-00000000000a') WHERE store_name LIKE 'Thử264%'$q$);

INSERT INTO kq SELECT 8, 'Chưa phân công (_none): có 05 + 06 (phân công đã thôi), không có 01 / 04 / 08',
  pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_thieu_anh('all', 0, 200, '_none') WHERE store_name IN ('Thử264 05', 'Thử264 06')$q$) = 2
  AND pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_thieu_anh('all', 0, 200, '_none') WHERE store_name IN ('Thử264 01', 'Thử264 04', 'Thử264 08')$q$) = 0,
  pg_temp.ten(:CHU, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 200, '_none') WHERE store_name LIKE 'Thử264%'$q$);

INSERT INTO kq SELECT 9, 'Khách ngừng hoạt động (07) không vào danh sách / số đếm nào',
  pg_temp.so(:CHU, $q$SELECT count(*) FROM (SELECT store_name FROM khach_thieu_anh('all', 0, 200, 'e2640000-0000-0000-0000-00000000000a')
                                          UNION ALL SELECT store_name FROM khach_thieu_anh('all', 0, 200, '_none')
                                          UNION ALL SELECT store_name FROM khach_thieu_anh('all', 0, 200)) x WHERE store_name = 'Thử264 07'$q$) = 0,
  '';

INSERT INTO kq SELECT 10, 'p_nv rác (chữ thường / mã không có) → 0 dòng, không lỗi',
  pg_temp.loi(:CHU, $q$SELECT * FROM khach_thieu_anh('all', 0, 50, 'abc')$q$) = 'OK'
  AND pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_thieu_anh('all', 0, 50, 'abc')$q$) = 0
  AND pg_temp.so(:CHU, $q$SELECT count(*) FROM khach_cho_duyet_anh(0, 50, 'e9999999-0000-0000-0000-000000000000')$q$) = 0,
  pg_temp.loi(:CHU, $q$SELECT * FROM khach_thieu_anh('all', 0, 50, 'abc')$q$);

INSERT INTO kq SELECT 11, 'NVBH A gọi (RLS — hàm SECURITY INVOKER): không thấy khách chưa ai phụ trách (05); tổng không lọc = 4 (01, 02, 04 phụ, 08)',
  pg_temp.so(:A, $q$SELECT count(*) FROM khach_thieu_anh('all', 0, 200, '_none') WHERE store_name = 'Thử264 05'$q$) = 0
  AND pg_temp.so(:A, $q$SELECT coalesce(max(total_count), 0) FROM khach_thieu_anh('all', 0, 1)$q$) = 4,
  pg_temp.ten(:A, $q$SELECT store_name FROM khach_thieu_anh('all', 0, 200)$q$);

INSERT INTO kq SELECT 12, 'Ba hàm SECURITY INVOKER (RLS tự lọc), vai authenticated gọi được',
  bool_and(NOT p.prosecdef) AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AND count(*) = 3,
  string_agg(p.proname || CASE WHEN p.prosecdef THEN ' DEFINER' ELSE ' invoker' END, ', ' ORDER BY p.proname)
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('khach_thieu_anh', 'khach_cho_duyet_anh', 'khach_thieu_anh_theo_nv');

INSERT INTO kq SELECT 99, 'Đủ 12 dòng kiểm', count(*) = 12, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
