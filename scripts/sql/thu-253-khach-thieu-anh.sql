-- KIỂM MIG 253 — RPC điểm bán thiếu ảnh / chờ duyệt (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm": màn Điểm bán cần
-- cập nhật kéo cả sổ khách + cả bảng ảnh về máy, điện thoại 5,9 giây).
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-253-khach-thieu-anh.sql
\set ON_ERROR_STOP on
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

\o /dev/null
\ir ../../supabase/migrations/253_khach_thieu_anh_rpc.sql
\ir ../../supabase/migrations/253_khach_thieu_anh_rpc.sql
\o

-- ---------------------------------------------------------------- Sổ thử: 1 NPP, chủ + NVBH, 6 điểm bán
INSERT INTO auth.users (id) VALUES ('d2530000-0000-4000-8000-0000000000b1'), ('d2530000-0000-4000-8000-0000000000b2');
INSERT INTO organizations (id, name, slug) VALUES ('d2530000-0000-4000-8000-000000000001', 'NPP thử 253', 'npp-thu-253');
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2530000-0000-4000-8000-0000000000b1', 'd2530000-0000-4000-8000-000000000001', 'Chủ 253', 'owner', true),
  ('d2530000-0000-4000-8000-0000000000b2', 'd2530000-0000-4000-8000-000000000001', 'NVBH 253', 'sales', true);
-- A: không ảnh, không vị trí · B: 2 ảnh + vị trí (đủ) · C: 1 ảnh, không vị trí · D: ngừng hoạt động (suspended — không tính)
-- E: khách của NVBH — không ảnh, có vị trí · F: đủ ảnh + vị trí, ĐÃ DUYỆT, có 1 yêu cầu đổi đang chờ
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, status, gps_lat, gps_lng, created_by) VALUES
  ('d2530000-0000-4000-9100-00000000000a', 'd2530000-0000-4000-8000-000000000001', 'A thiếu cả hai', 'A', '0900000001', '1 A', 'active', NULL, NULL, 'd2530000-0000-4000-8000-0000000000b1'),
  ('d2530000-0000-4000-9100-00000000000b', 'd2530000-0000-4000-8000-000000000001', 'B đủ', 'B', '0900000002', '2 B', 'active', 20.8, 106.7, 'd2530000-0000-4000-8000-0000000000b1'),
  ('d2530000-0000-4000-9100-00000000000c', 'd2530000-0000-4000-8000-000000000001', 'C thiếu vị trí', 'C', '0900000003', '3 C', 'active', NULL, NULL, 'd2530000-0000-4000-8000-0000000000b1'),
  ('d2530000-0000-4000-9100-00000000000d', 'd2530000-0000-4000-8000-000000000001', 'D ngừng', 'D', '0900000004', '4 D', 'suspended', NULL, NULL, 'd2530000-0000-4000-8000-0000000000b1'),
  ('d2530000-0000-4000-9100-00000000000e', 'd2530000-0000-4000-8000-000000000001', 'E của NVBH thiếu ảnh', 'E', '0900000005', '5 E', 'active', 20.9, 106.6, 'd2530000-0000-4000-8000-0000000000b1'),
  ('d2530000-0000-4000-9100-00000000000f', 'd2530000-0000-4000-8000-000000000001', 'F đã duyệt có yêu cầu', 'F', '0900000006', '6 F', 'active', 21.0, 106.5, 'd2530000-0000-4000-8000-0000000000b1');
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  ('d2530000-0000-4000-9100-00000000000e', 'd2530000-0000-4000-8000-0000000000b2', 'primary', 'active');
INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at) VALUES
  ('d2530000-0000-4000-8000-000000000001', 'd2530000-0000-4000-9100-00000000000b', 1, 'b1.jpg', now()),
  ('d2530000-0000-4000-8000-000000000001', 'd2530000-0000-4000-9100-00000000000b', 2, 'b2.jpg', now()),
  ('d2530000-0000-4000-8000-000000000001', 'd2530000-0000-4000-9100-00000000000c', 1, 'c1.jpg', now()),
  ('d2530000-0000-4000-8000-000000000001', 'd2530000-0000-4000-9100-00000000000f', 1, 'f1.jpg', now());
UPDATE customers SET photo_approved_at = now(), photo_approved_by = 'd2530000-0000-4000-8000-0000000000b1' WHERE id = 'd2530000-0000-4000-9100-00000000000f';
INSERT INTO customer_photo_requests (org_id, customer_id, kind, status, requested_by, requested_at) VALUES
  ('d2530000-0000-4000-8000-000000000001', 'd2530000-0000-4000-9100-00000000000f', 'pin_clear', 'pending', 'd2530000-0000-4000-8000-0000000000b2', now());

-- ---------------------------------------------------------------- Chủ NPP
SELECT pg_temp.vao('d2530000-0000-4000-8000-0000000000b1');
CREATE TEMP TABLE kq_all ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('all', 0, 50);
CREATE TEMP TABLE kq_anh ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('no_photo', 0, 50);
CREATE TEMP TABLE kq_vt  ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('no_gps', 0, 50);
CREATE TEMP TABLE kq_t1  ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('all', 0, 2);
CREATE TEMP TABLE kq_t2  ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('all', 2, 2);
CREATE TEMP TABLE kq_duyet ON COMMIT DROP AS SELECT * FROM public.khach_cho_duyet_anh(0, 50);
SELECT pg_temp.ra();

INSERT INTO kq SELECT 1, 'Còn thiếu (all): A, C, E — không có B (đủ), D (ngừng), F (đủ)',
  (SELECT array_agg(store_name ORDER BY store_name) FROM kq_all) = ARRAY['A thiếu cả hai', 'C thiếu vị trí', 'E của NVBH thiếu ảnh'],
  (SELECT string_agg(store_name, ' | ' ORDER BY store_name) FROM kq_all);
INSERT INTO kq SELECT 2, 'total_count = 3 trên mỗi dòng; photo_count đúng (A 0, C 1, E 0)',
  (SELECT bool_and(total_count = 3) FROM kq_all) AND (SELECT photo_count FROM kq_all WHERE store_name LIKE 'C%') = 1
    AND (SELECT bool_and(photo_count = 0) FROM kq_all WHERE store_name NOT LIKE 'C%'), '';
INSERT INTO kq SELECT 3, 'Chưa có ảnh (no_photo): A, E',
  (SELECT array_agg(store_name ORDER BY store_name) FROM kq_anh) = ARRAY['A thiếu cả hai', 'E của NVBH thiếu ảnh'], '';
INSERT INTO kq SELECT 4, 'Chưa có vị trí (no_gps): A, C',
  (SELECT array_agg(store_name ORDER BY store_name) FROM kq_vt) = ARRAY['A thiếu cả hai', 'C thiếu vị trí'], '';
INSERT INTO kq SELECT 5, 'Phân trang: trang 2 dòng rồi trang kế 1 dòng, total_count vẫn 3, không lặp không sót',
  (SELECT count(*) FROM kq_t1) = 2 AND (SELECT count(*) FROM kq_t2) = 1 AND (SELECT bool_and(total_count = 3) FROM kq_t2)
    AND (SELECT array_agg(id ORDER BY store_name) FROM (SELECT * FROM kq_t1 UNION ALL SELECT * FROM kq_t2) x) = (SELECT array_agg(id ORDER BY store_name) FROM kq_all), '';
INSERT INTO kq SELECT 6, 'Chờ duyệt: B (chưa duyệt, có ảnh), C (chưa duyệt, có ảnh), E (chưa duyệt, có vị trí), F (đã duyệt, 1 yêu cầu) — không A',
  (SELECT array_agg(store_name ORDER BY store_name) FROM kq_duyet) = ARRAY['B đủ', 'C thiếu vị trí', 'E của NVBH thiếu ảnh', 'F đã duyệt có yêu cầu']
    AND (SELECT da_duyet AND so_yeu_cau = 1 FROM kq_duyet WHERE store_name LIKE 'F%')
    AND (SELECT bool_and(NOT da_duyet AND so_yeu_cau = 0) FROM kq_duyet WHERE store_name NOT LIKE 'F%'),
  (SELECT string_agg(store_name || ':' || da_duyet || '/' || so_yeu_cau, ' | ' ORDER BY store_name) FROM kq_duyet);

-- ---------------------------------------------------------------- NVBH: RLS tự lọc — chỉ khách mình phụ trách
SELECT pg_temp.vao('d2530000-0000-4000-8000-0000000000b2');
CREATE TEMP TABLE kq_nv ON COMMIT DROP AS SELECT * FROM public.khach_thieu_anh('all', 0, 50);
CREATE TEMP TABLE kq_nv_duyet ON COMMIT DROP AS SELECT * FROM public.khach_cho_duyet_anh(0, 50);
SELECT pg_temp.ra();
INSERT INTO kq SELECT 7, 'NVBH chỉ thấy khách mình phụ trách (E), total_count = 1; chờ duyệt cũng chỉ E',
  (SELECT array_agg(store_name) FROM kq_nv) = ARRAY['E của NVBH thiếu ảnh'] AND (SELECT bool_and(total_count = 1) FROM kq_nv)
    AND (SELECT array_agg(store_name) FROM kq_nv_duyet) = ARRAY['E của NVBH thiếu ảnh'],
  coalesce((SELECT string_agg(store_name, ' | ') FROM kq_nv), '(rỗng)');
INSERT INTO kq SELECT 8, 'Hai hàm SECURITY INVOKER (không definer), authenticated gọi được',
  (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('khach_thieu_anh', 'khach_cho_duyet_anh'))
    AND has_function_privilege('authenticated', 'public.khach_thieu_anh(text, integer, integer)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.khach_cho_duyet_anh(integer, integer)', 'EXECUTE'), '';

INSERT INTO kq SELECT 99, 'Đủ 8 dòng kiểm', count(*) = 8, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
