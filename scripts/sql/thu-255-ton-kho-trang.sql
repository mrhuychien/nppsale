-- KIỂM MIG 255 — RPC tồn kho hiện tại gộp / lọc / tìm / sắp / phân trang trên máy chủ (chủ nhà 23/10/2026 "tốc độ load
-- trang chậm lắm" → đợt 4: màn Kho hàng kéo cả bảng tồn + cả 2.500 mặt hàng về máy).
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-255-ton-kho-trang.sql
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
\ir ../../supabase/migrations/255_ton_kho_trang.sql
\ir ../../supabase/migrations/255_ton_kho_trang.sql
\o

-- ---------------------------------------------------------------- Sổ thử: 2 NPP; NPP 1 có 5 mặt hàng
INSERT INTO auth.users (id) VALUES ('d2550000-0000-4000-8000-0000000000b1');
INSERT INTO organizations (id, name, slug) VALUES
  ('d2550000-0000-4000-8000-000000000001', 'NPP thử 255', 'npp-thu-255'),
  ('d2550000-0000-4000-8000-000000000002', 'NPP khác 255', 'npp-khac-255');
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2550000-0000-4000-8000-0000000000b1', 'd2550000-0000-4000-8000-000000000001', 'Chủ 255', 'owner', true);
-- A: đang bán, kho bán 10 × 1.000 + kho date 5 × 2.000 (tổng 15, 20.000); có đơn vị thùng 24
-- B: đang bán, không lô                       → chỉ hiện khi bỏ "còn tồn"
-- C: NGỪNG BÁN, kho date 3 × 500              → vẫn lên bảng (còn tồn)
-- D: NGỪNG BÁN, không lô                      → không bao giờ lên bảng
-- E: đang bán, lô đã hết (qty 0)              → như B
-- K: hàng của NPP KHÁC, có tồn                → RLS chặn, chủ NPP 1 không thấy
INSERT INTO products (id, org_id, sku, name, base_unit, status, barcode) VALUES
  ('d2550000-0000-4000-9300-00000000000a', 'd2550000-0000-4000-8000-000000000001', 'SP-0012', 'Sữa đặc Ông Thọ', 'hộp', 'active', '8930012'),
  ('d2550000-0000-4000-9300-00000000000b', 'd2550000-0000-4000-8000-000000000001', 'SP-0013', 'Mì Hảo Hảo', 'gói', 'active', NULL),
  ('d2550000-0000-4000-9300-00000000000c', 'd2550000-0000-4000-8000-000000000001', 'SP-0014', 'Bánh đậu xanh', 'hộp', 'inactive', NULL),
  ('d2550000-0000-4000-9300-00000000000d', 'd2550000-0000-4000-8000-000000000001', 'SP-0015', 'Nước ngọt cũ', 'chai', 'inactive', NULL),
  ('d2550000-0000-4000-9300-00000000000e', 'd2550000-0000-4000-8000-000000000001', 'SP-0016', 'Trà xanh', 'chai', 'active', NULL),
  ('d2550000-0000-4000-9300-0000000000aa', 'd2550000-0000-4000-8000-000000000002', 'SP-K', 'Hàng NPP khác', 'hộp', 'active', NULL);
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('d2550000-0000-4000-9300-00000000000a', 'thùng', 24);
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone) VALUES
  ('d2550000-0000-4000-8000-000000000001', 'd2550000-0000-4000-9300-00000000000a', 'L255-A1', current_date + 300, 10, 10, 1000, 'sale'),
  ('d2550000-0000-4000-8000-000000000001', 'd2550000-0000-4000-9300-00000000000a', 'L255-A2', current_date + 30, 5, 5, 2000, 'date'),
  ('d2550000-0000-4000-8000-000000000001', 'd2550000-0000-4000-9300-00000000000c', 'L255-C1', current_date + 30, 3, 3, 500, 'date'),
  ('d2550000-0000-4000-8000-000000000001', 'd2550000-0000-4000-9300-00000000000e', 'L255-E1', current_date + 300, 8, 0, 700, 'sale'),
  ('d2550000-0000-4000-8000-000000000002', 'd2550000-0000-4000-9300-0000000000aa', 'L255-K1', current_date + 300, 9, 9, 100, 'sale');

-- ---------------------------------------------------------------- Chủ NPP 1 gọi (qua RLS)
SELECT pg_temp.vao('d2550000-0000-4000-8000-0000000000b1');
CREATE TEMP TABLE kq_ton ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'ten', 0, 50);
CREATE TEMP TABLE kq_het ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, false, 'ten', 0, 50);
CREATE TEMP TABLE kq_tim1 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang('ong tho', false, 'ten', 0, 50);
CREATE TEMP TABLE kq_tim2 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang('sp12', false, 'ten', 0, 50);
CREATE TEMP TABLE kq_tim3 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang('Đậu xanh', true, 'ten', 0, 50);
CREATE TEMP TABLE kq_tim4 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang('xyz', false, 'ten', 0, 50);
CREATE TEMP TABLE kq_tim5 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang('8930012', false, 'ten', 0, 50);
CREATE TEMP TABLE kq_gt ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'gia-tri', 0, 50);
CREATE TEMP TABLE kq_sl ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'so-luong', 0, 50);
CREATE TEMP TABLE kq_t1 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'ten', 0, 1);
CREATE TEMP TABLE kq_t2 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'ten', 1, 1);
CREATE TEMP TABLE kq_t3 ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, true, 'ten', 9, 1);
CREATE TEMP TABLE kq_lim ON COMMIT DROP AS SELECT * FROM public.ton_kho_trang(NULL, false, 'ten', 0, 0);
SELECT pg_temp.ra();

INSERT INTO kq SELECT 1, 'Còn tồn (mặc định): A + C (ngừng bán nhưng còn tồn), sắp theo tên; không B / D / E; hàng NPP khác bị RLS chặn',
  (SELECT array_agg(sku ORDER BY sku) FROM kq_ton) = ARRAY['SP-0012', 'SP-0014']
    AND (SELECT array_agg(name) FROM kq_ton) = ARRAY['Bánh đậu xanh', 'Sữa đặc Ông Thọ'],
  coalesce((SELECT string_agg(sku || ' ' || name, ' | ') FROM kq_ton), '(rỗng)');
INSERT INTO kq SELECT 2, 'Số liệu từng dòng: A kho bán 10/10.000 + kho date 5/10.000 = 15/20.000; C kho date 3/1.500',
  (SELECT sale_qty = 10 AND sale_value = 10000 AND date_qty = 5 AND date_value = 10000 AND total_qty = 15 AND total_value = 20000 FROM kq_ton WHERE sku = 'SP-0012')
    AND (SELECT sale_qty = 0 AND sale_value = 0 AND date_qty = 3 AND date_value = 1500 AND total_qty = 3 AND total_value = 1500 AND status = 'inactive' FROM kq_ton WHERE sku = 'SP-0014'),
  (SELECT string_agg(sku || ':' || total_qty || '/' || total_value, ' | ') FROM kq_ton);
INSERT INTO kq SELECT 3, 'Mỗi dòng mang total_count = 2 và TỔNG CỘNG cả tập: SL 10 / 8 / 18, giá trị 10.000 / 11.500 / 21.500',
  (SELECT bool_and(total_count = 2 AND sum_sale_qty = 10 AND sum_date_qty = 8 AND sum_total_qty = 18
                   AND sum_sale_value = 10000 AND sum_date_value = 11500 AND sum_total_value = 21500) FROM kq_ton),
  (SELECT string_agg(total_count || ':' || sum_total_qty || '/' || sum_total_value, ' | ') FROM kq_ton);
INSERT INTO kq SELECT 4, 'Bỏ "còn tồn": thêm mã ĐANG BÁN hết tồn (B, E — SL 0), vẫn không có D (ngừng bán, hết tồn)',
  (SELECT array_agg(sku ORDER BY sku) FROM kq_het) = ARRAY['SP-0012', 'SP-0013', 'SP-0014', 'SP-0016']
    AND (SELECT bool_and(total_qty = 0) FROM kq_het WHERE sku IN ('SP-0013', 'SP-0016'))
    AND (SELECT bool_and(total_count = 4 AND sum_total_value = 21500) FROM kq_het),
  coalesce((SELECT string_agg(sku, ',' ORDER BY sku) FROM kq_het), '(rỗng)');
INSERT INTO kq SELECT 5, 'Đơn vị kèm dòng: A có thùng ×24; B không có đơn vị phụ → null',
  (SELECT units = '[{"unit_name": "thùng", "conversion": 24}]'::jsonb FROM kq_het WHERE sku = 'SP-0012')
    AND (SELECT units IS NULL FROM kq_het WHERE sku = 'SP-0013'), '';
INSERT INTO kq SELECT 6, 'Tìm: "ong tho" (không dấu, hai từ) → A; "sp12" (mã viết liền bỏ số 0) → A; "Đậu xanh" có dấu → C; mã vạch → A; "xyz" → rỗng',
  (SELECT array_agg(sku) FROM kq_tim1) = ARRAY['SP-0012'] AND (SELECT array_agg(sku) FROM kq_tim2) = ARRAY['SP-0012']
    AND (SELECT array_agg(sku) FROM kq_tim3) = ARRAY['SP-0014'] AND (SELECT array_agg(sku) FROM kq_tim5) = ARRAY['SP-0012']
    AND (SELECT count(*) FROM kq_tim4) = 0,
  format('%s | %s | %s | %s | %s', (SELECT string_agg(sku, ',') FROM kq_tim1), (SELECT string_agg(sku, ',') FROM kq_tim2),
         (SELECT string_agg(sku, ',') FROM kq_tim3), (SELECT string_agg(sku, ',') FROM kq_tim5), (SELECT count(*) FROM kq_tim4));
INSERT INTO kq SELECT 7, 'Sắp: giá trị cao trước → A (20.000) rồi C; tồn nhiều trước → A (15) rồi C; theo tên → C rồi A',
  (SELECT array_agg(sku) FROM kq_gt) = ARRAY['SP-0012', 'SP-0014'] AND (SELECT array_agg(sku) FROM kq_sl) = ARRAY['SP-0012', 'SP-0014']
    AND (SELECT array_agg(sku) FROM kq_ton) = ARRAY['SP-0014', 'SP-0012'], '';
INSERT INTO kq SELECT 8, 'Phân trang: trang 1 dòng = C, trang kế = A (total_count vẫn 2, tổng cộng vẫn của cả tập); offset vượt → rỗng; p_limit 0 → 1 dòng',
  (SELECT array_agg(sku) FROM kq_t1) = ARRAY['SP-0014'] AND (SELECT array_agg(sku) FROM kq_t2) = ARRAY['SP-0012']
    AND (SELECT bool_and(total_count = 2 AND sum_total_value = 21500) FROM kq_t2)
    AND (SELECT count(*) FROM kq_t3) = 0 AND (SELECT count(*) FROM kq_lim) = 1, '';
INSERT INTO kq SELECT 9, 'Hàm SECURITY INVOKER (không definer), authenticated gọi được, chạy mig hai lần vẫn một hàm',
  (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ton_kho_trang')
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'ton_kho_trang') = 1
    AND has_function_privilege('authenticated', 'public.ton_kho_trang(text, boolean, text, integer, integer)', 'EXECUTE'), '';

INSERT INTO kq SELECT 99, 'Đủ 9 dòng kiểm', count(*) = 9, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
