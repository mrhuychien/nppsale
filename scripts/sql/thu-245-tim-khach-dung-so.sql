-- KIỂM MIG 245 — tìm khách đã có trước khi tạo: CHỈ khớp ĐÚNG số điện thoại (chủ nhà 15/10/2026: "ở máy tính tao chỉ cho
-- tìm kiếm chính xác, nghĩa là nhập đúng số điện thoại của khách thì khách mới hiện ra"). psql -f, BEGIN … ROLLBACK.
-- Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-245-tim-khach-dung-so.sql
-- Người: chủ NPP e..01 · NVBH e..04 (phụ trách K2). K1 do quản lý e..02 phụ trách chính. Gọi dưới vai `authenticated`.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

-- Danh sách cửa hàng tìm ra (theo tên) dưới tên một người.
CREATE FUNCTION pg_temp.tim(p_uid text, p_q text) RETURNS text LANGUAGE plpgsql AS $t$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  SELECT coalesce(string_agg(store_name, ',' ORDER BY store_name), '') INTO v FROM public.search_customer_dupes(p_q);
  RETURN v;
END $t$;
CREATE FUNCTION pg_temp.tim_dong(p_uid text, p_q text) RETURNS TABLE (primary_user_name text, has_my_assignment boolean)
LANGUAGE plpgsql AS $t$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  RETURN QUERY SELECT d.primary_user_name, d.has_my_assignment FROM public.search_customer_dupes(p_q) d;
END $t$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set ORG2 '''a2450000-0000-0000-0000-000000000002'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set QL '''e0000000-0000-0000-0000-000000000002'''
\set NV '''e0000000-0000-0000-0000-000000000004'''
\set K1 '''c2450000-0000-0000-0000-000000000001'''
\set K2 '''c2450000-0000-0000-0000-000000000002'''

INSERT INTO organizations (id, name, slug) VALUES (:ORG2, 'NPP khác 245', 'npp-khac-245');
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address) VALUES
  (:K1, :ORG, 'Thử245 Cô Ba', 'Ba', '0912450001', '1 Lê Lợi Thử245'),
  (:K2, :ORG, 'Thử245 Bà Hai', 'Hai', '+84 912 450 002', '2 Lê Lợi Thử245'),
  ('c2450000-0000-0000-0000-000000000003', :ORG2, 'Thử245 Đơn vị khác', 'X', '0912450001', '9 Thử245'),
  -- Dữ liệu xấu (nhập file cũ): số ngắn — gõ đúng số ngắn ấy cũng KHÔNG được ra (chỉ số đủ mới tìm).
  ('c2450000-0000-0000-0000-000000000004', :ORG, 'Thử245 Số ngắn', 'Y', '0912 45', '4 Thử245');
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  (:K1, :QL, 'primary', 'active'), (:K2, :NV, 'primary', 'active');

SET LOCAL ROLE authenticated;

-- 1–3. Nhập ĐÚNG số → ra đúng khách (viết liền, có cách, +84 đều được); khách ĐƠN VỊ KHÁC cùng số không ra.
INSERT INTO kq SELECT 1, 'Đúng số 0912450001 → ra Cô Ba (khách NV khác phụ trách), không ra khách đơn vị khác',
  pg_temp.tim(:NV, '0912450001') = 'Thử245 Cô Ba', pg_temp.tim(:NV, '0912450001');
INSERT INTO kq SELECT 2, 'Số có dấu cách / chấm / +84 cũng khớp ("0912 450 001", "0912.450.001", "+84 912 450 001")',
  pg_temp.tim(:NV, '0912 450 001') = 'Thử245 Cô Ba' AND pg_temp.tim(:NV, '0912.450.001') = 'Thử245 Cô Ba'
  AND pg_temp.tim(:NV, '+84 912 450 001') = 'Thử245 Cô Ba', '';
INSERT INTO kq SELECT 3, 'Khách lưu số dạng "+84 912 450 002" vẫn khớp khi nhập 0912450002',
  pg_temp.tim(:NV, '0912450002') = 'Thử245 Bà Hai', pg_temp.tim(:NV, '0912450002');

-- 4–6. KHÔNG khớp từng phần: số dở, tên, địa chỉ → không ra gì.
INSERT INTO kq SELECT 4, 'Số chưa đủ ("0912", "091245000", "912450001", cả số ngắn đã lưu "091245") → không ra khách nào',
  pg_temp.tim(:NV, '0912') = '' AND pg_temp.tim(:NV, '091245000') = '' AND pg_temp.tim(:NV, '912450001') = ''
  AND pg_temp.tim(:CHU, '091245') = '' AND pg_temp.tim(:CHU, '0912 45') = '', pg_temp.tim(:CHU, '091245');
INSERT INTO kq SELECT 5, 'Gõ TÊN ("Cô Ba", "Thử245") → không ra khách nào',
  pg_temp.tim(:NV, 'Cô Ba') = '' AND pg_temp.tim(:NV, 'Thử245') = '' AND pg_temp.tim(:CHU, 'Thử245') = '', '';
INSERT INTO kq SELECT 6, 'Gõ ĐỊA CHỈ ("Lê Lợi Thử245") → không ra khách nào',
  pg_temp.tim(:NV, 'Lê Lợi Thử245') = '', pg_temp.tim(:NV, 'Lê Lợi Thử245');
INSERT INTO kq SELECT 7, 'Số đủ nhưng khác một chữ số (0912450009) → không ra',
  pg_temp.tim(:NV, '0912450009') = '', '';

-- 8. Thông tin cho nút "Thêm vào DS của tôi": phụ trách chính + đã trong DS chưa.
INSERT INTO kq SELECT 8, 'Cột trả về: phụ trách chính của K1 có tên; NVBH chưa có K1 (false), đã có K2 (true)',
  (SELECT primary_user_name IS NOT NULL AND NOT has_my_assignment FROM pg_temp.tim_dong(:NV, '0912450001'))
  AND (SELECT has_my_assignment FROM pg_temp.tim_dong(:NV, '0912450002')),
  (SELECT primary_user_name FROM pg_temp.tim_dong(:NV, '0912450001'));
RESET ROLE;

-- 9. Quyền: anon không gọi được; authenticated gọi được.
INSERT INTO kq SELECT 9, 'Quyền: anon KHÔNG gọi được, authenticated gọi được',
  NOT has_function_privilege('anon', 'public.search_customer_dupes(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.search_customer_dupes(text)', 'EXECUTE'), '';

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 9 bước kiểm', count(*) = 9, count(*) || ' bước' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
