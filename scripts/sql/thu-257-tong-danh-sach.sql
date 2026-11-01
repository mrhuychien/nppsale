-- KIỂM MIG 257 — tổng của danh sách cộng trên máy chủ: view `v_hoa_don_con_lai` (tiền còn lại sau hàng trả, luật
-- creditCounted, RLS người gọi) + `ton_ban_theo_hang()` (tồn kho bán theo mặt hàng một câu).
-- Chủ nhà 01/11/2026: "tìm kiếm trong danh sách (đơn hàng, hóa đơn...) nhiều khi còn chậm … ở pos còn chậm".
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-257-tong-danh-sach.sql
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

-- Chạy migration HAI lần: view dựng lại, hàm thay tại chỗ — không lỗi, không nhân đôi.
\o /dev/null
\ir ../../supabase/migrations/257_tong_danh_sach_may_chu.sql
\ir ../../supabase/migrations/257_tong_danh_sach_may_chu.sql
\o

-- ---------------------------------------------------------------- Sổ thử (bỏ trigger nghiệp vụ khi nạp — chỉ để có dòng)
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('d2570000-0000-4000-8000-0000000000b0'), ('d2570000-0000-4000-8000-0000000000b1'),
  ('d2570000-0000-4000-8000-0000000000b2'), ('d2570000-0000-4000-8000-0000000000bf');
INSERT INTO organizations (id, name, slug) VALUES
  ('d2570000-0000-4000-8000-000000000001', 'NPP thử 257', 'npp-thu-257'),
  ('d2570000-0000-4000-8000-000000000002', 'NPP khác 257', 'npp-khac-257');
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2570000-0000-4000-8000-0000000000b0', 'd2570000-0000-4000-8000-000000000001', 'Chủ 257', 'owner', true),
  ('d2570000-0000-4000-8000-0000000000b1', 'd2570000-0000-4000-8000-000000000001', 'NVBH 1', 'sales', true),
  ('d2570000-0000-4000-8000-0000000000b2', 'd2570000-0000-4000-8000-000000000001', 'NVBH 2', 'sales', true),
  ('d2570000-0000-4000-8000-0000000000bf', 'd2570000-0000-4000-8000-000000000002', 'Chủ khác', 'owner', true);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  ('d2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-000000000001', 'Tạp hoá 257', 'Cô Ba', '0900257001', 'HN', 'T1'),
  ('d2570000-0000-4000-8000-0000000000c2', 'd2570000-0000-4000-8000-000000000001', 'Quán 257', 'Anh Tư', '0900257002', 'HN', 'T2'),
  ('d2570000-0000-4000-8000-0000000000cf', 'd2570000-0000-4000-8000-000000000002', 'Khách khác', 'Anh K', '0900257009', 'HN', 'T1');
INSERT INTO products (id, org_id, sku, name, base_unit) VALUES
  ('d2570000-0000-4000-9300-0000000000a1', 'd2570000-0000-4000-8000-000000000001', 'P257-1', 'Sữa 257', 'hộp'),
  ('d2570000-0000-4000-9300-0000000000a2', 'd2570000-0000-4000-8000-000000000001', 'P257-2', 'Mì 257', 'gói'),
  ('d2570000-0000-4000-9300-0000000000af', 'd2570000-0000-4000-8000-000000000002', 'P257-K', 'Hàng NPP khác', 'hộp');
-- HĐ: H1 (NV1, ghi sổ 100.000), H2 (NV2, ghi sổ 200.000), H3 (NV1, đã huỷ 50.000), HK (NPP khác, 999.000).
INSERT INTO sales_invoices (id, org_id, invoice_code, invoice_seq, order_id, customer_id, status, invoice_date, subtotal, vat, total, sales_user_id) VALUES
  ('d2570000-0000-4000-8000-00000000f001', 'd2570000-0000-4000-8000-000000000001', 'HD257-1', 1, gen_random_uuid(), 'd2570000-0000-4000-8000-0000000000c1', 'posted', '2026-10-01', 100000, 0, 100000, 'd2570000-0000-4000-8000-0000000000b1'),
  ('d2570000-0000-4000-8000-00000000f002', 'd2570000-0000-4000-8000-000000000001', 'HD257-2', 2, gen_random_uuid(), 'd2570000-0000-4000-8000-0000000000c2', 'posted', '2026-10-02', 200000, 0, 200000, 'd2570000-0000-4000-8000-0000000000b2'),
  ('d2570000-0000-4000-8000-00000000f003', 'd2570000-0000-4000-8000-000000000001', 'HD257-3', 3, gen_random_uuid(), 'd2570000-0000-4000-8000-0000000000c1', 'cancelled', '2026-10-03', 50000, 0, 50000, 'd2570000-0000-4000-8000-0000000000b1'),
  ('d2570000-0000-4000-8000-00000000f0ff', 'd2570000-0000-4000-8000-000000000002', 'HD257-K', 1, gen_random_uuid(), 'd2570000-0000-4000-8000-0000000000cf', 'posted', '2026-10-01', 999000, 0, 999000, 'd2570000-0000-4000-8000-0000000000bf');
-- Phiếu trả của H1 — đủ tổ hợp (đi cùng HĐ / độc lập) × trạng thái; một phiếu tiền ÂM (lấy max 0). H2: một phiếu độc lập xong.
--   Trừ vào H1: R1 10.000 (cùng HĐ, submitted) + R3 5.000 (độc lập, completed) + R5 3.000 (cùng HĐ, completed) + R7 0 (âm)
--   = 18.000 → còn 82.000. Không trừ: R2 nháp (cùng HĐ), R4 độc lập mới submitted, R6 đã huỷ, R9 độc lập nháp.
--   H2: R8 20.000 → còn 180.000.
INSERT INTO returns (id, org_id, customer_id, requested_by, status, credit_note_amount, invoice_id, credit_with_invoice, sales_user_id, return_code, reason) VALUES
  ('d2570000-0000-4000-8000-00000000a001', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'submitted', 10000, 'd2570000-0000-4000-8000-00000000f001', true,  'd2570000-0000-4000-8000-0000000000b1', 'TH-257-1', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a002', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'draft',      1000, 'd2570000-0000-4000-8000-00000000f001', true,  'd2570000-0000-4000-8000-0000000000b1', 'TH-257-2', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a003', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'completed',  5000, 'd2570000-0000-4000-8000-00000000f001', false, 'd2570000-0000-4000-8000-0000000000b1', 'TH-257-3', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a004', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'submitted',   700, 'd2570000-0000-4000-8000-00000000f001', false, 'd2570000-0000-4000-8000-0000000000b1', 'TH-257-4', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a005', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'completed',  3000, 'd2570000-0000-4000-8000-00000000f001', true,  'd2570000-0000-4000-8000-0000000000b1', 'TH-257-5', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a006', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'cancelled',  9000, 'd2570000-0000-4000-8000-00000000f001', true,  'd2570000-0000-4000-8000-0000000000b1', 'TH-257-6', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a007', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'completed', -2000, 'd2570000-0000-4000-8000-00000000f001', false, 'd2570000-0000-4000-8000-0000000000b1', 'TH-257-7', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a008', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c2', 'd2570000-0000-4000-8000-0000000000b0', 'completed', 20000, 'd2570000-0000-4000-8000-00000000f002', false, 'd2570000-0000-4000-8000-0000000000b2', 'TH-257-8', 'damaged'),
  ('d2570000-0000-4000-8000-00000000a009', 'd2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-8000-0000000000c1', 'd2570000-0000-4000-8000-0000000000b0', 'draft',       400, 'd2570000-0000-4000-8000-00000000f001', false, 'd2570000-0000-4000-8000-0000000000b1', 'TH-257-9', 'damaged');
-- Lô: Sữa 10 + 5 ở kho bán (tính), 7 ở kho date (không), 0 và −6 (tồn âm) ở kho bán (không — như `docLoBan` gt 0); Mì 3 ở kho
--   bán; NPP khác 50 (không thấy).
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, warehouse_zone) VALUES
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a1', 'L257-1', '2027-12-31', 10, 10, 'sale'),
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a1', 'L257-2', '2027-12-31', 5, 5, 'sale'),
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a1', 'L257-3', '2026-11-30', 7, 7, 'date'),
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a1', 'L257-4', '2027-12-31', 4, 0, 'sale'),
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a1', 'L257-6', '2027-12-31', 2, -6, 'sale'),
  ('d2570000-0000-4000-8000-000000000001', 'd2570000-0000-4000-9300-0000000000a2', 'L257-5', '2027-12-31', 3, 3, 'sale'),
  ('d2570000-0000-4000-8000-000000000002', 'd2570000-0000-4000-9300-0000000000af', 'L257-K', '2027-12-31', 50, 50, 'sale');
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------- Gọi qua RLS
SELECT pg_temp.vao('d2570000-0000-4000-8000-0000000000b0');
CREATE TEMP TABLE v_chu ON COMMIT DROP AS SELECT invoice_code, status, total, con_lai FROM public.v_hoa_don_con_lai;
CREATE TEMP TABLE ton_chu ON COMMIT DROP AS SELECT public.ton_ban_theo_hang() AS j;
CREATE TEMP TABLE ton_truc_tiep ON COMMIT DROP AS
  SELECT product_id, sum(qty_on_hand) AS sl FROM public.batches WHERE qty_on_hand > 0 AND warehouse_zone = 'sale' GROUP BY product_id;
SELECT pg_temp.ra();
SELECT pg_temp.vao('d2570000-0000-4000-8000-0000000000b1');
CREATE TEMP TABLE v_nv1 ON COMMIT DROP AS SELECT invoice_code, con_lai FROM public.v_hoa_don_con_lai;
SELECT pg_temp.ra();
SELECT pg_temp.vao('d2570000-0000-4000-8000-0000000000bf');
CREATE TEMP TABLE v_khac ON COMMIT DROP AS SELECT invoice_code, con_lai FROM public.v_hoa_don_con_lai;
CREATE TEMP TABLE ton_khac ON COMMIT DROP AS SELECT public.ton_ban_theo_hang() AS j;
SELECT pg_temp.ra();
GRANT SELECT ON v_chu, v_nv1, v_khac, ton_chu, ton_truc_tiep, ton_khac TO authenticated;

INSERT INTO kq SELECT 1, 'Còn lại từng HĐ đúng luật creditCounted: H1 82.000 (trừ R1+R3+R5, R7 âm tính 0), H2 180.000, H3 huỷ 50.000',
  (SELECT array_agg(invoice_code || '=' || con_lai::bigint ORDER BY invoice_code) FROM v_chu)
    = ARRAY['HD257-1=82000', 'HD257-2=180000', 'HD257-3=50000'],
  (SELECT string_agg(invoice_code || '=' || con_lai::bigint, ',' ORDER BY invoice_code) FROM v_chu);
INSERT INTO kq SELECT 2, 'Không trừ phiếu nháp (cùng HĐ / độc lập) / độc lập mới submitted / đã huỷ — đổi sang trừ cả bốn là lệch đúng 11.100',
  (SELECT total - con_lai FROM v_chu WHERE invoice_code = 'HD257-1') = 18000, '';
INSERT INTO kq SELECT 3, 'Tổng còn lại của HĐ ghi sổ (như dải Tổng tiền) = 262.000; tổng gộp vẫn giữ nguyên tiền HĐ (total)',
  (SELECT sum(con_lai) FROM v_chu WHERE status = 'posted') = 262000
    AND (SELECT sum(total) FROM v_chu WHERE status = 'posted') = 300000, '';
INSERT INTO kq SELECT 4, 'RLS người gọi (security_invoker): NVBH 1 chỉ thấy HĐ của mình (H1, H3)',
  (SELECT array_agg(invoice_code ORDER BY invoice_code) FROM v_nv1) = ARRAY['HD257-1', 'HD257-3'],
  (SELECT string_agg(invoice_code, ',' ORDER BY invoice_code) FROM v_nv1);
INSERT INTO kq SELECT 5, 'NPP khác chỉ thấy HĐ của mình — không lọt tiền của NPP thử',
  (SELECT array_agg(invoice_code) FROM v_khac) = ARRAY['HD257-K'], (SELECT string_agg(invoice_code, ',') FROM v_khac);
INSERT INTO kq SELECT 6, 'View security_invoker=true; authenticated đọc được, anon không',
  (SELECT 'security_invoker=true' = ANY (coalesce(reloptions, '{}')) FROM pg_class WHERE oid = 'public.v_hoa_don_con_lai'::regclass)
    AND has_table_privilege('authenticated', 'public.v_hoa_don_con_lai', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.v_hoa_don_con_lai', 'SELECT'),
  (SELECT array_to_string(reloptions, ',') FROM pg_class WHERE oid = 'public.v_hoa_don_con_lai'::regclass);
INSERT INTO kq SELECT 7, 'View có ĐỦ cột của sales_invoices (đúng thứ tự) + con_lai cuối — màn lọc được mọi cột như bảng',
  (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.v_hoa_don_con_lai'::regclass AND attnum > 0 AND NOT attisdropped)
    = (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.sales_invoices'::regclass AND attnum > 0 AND NOT attisdropped) || ARRAY['con_lai'],
  '';
INSERT INTO kq SELECT 8, 'ton_ban_theo_hang: Sữa 15 (bỏ kho date + lô 0 + lô âm), Mì 3; không có hàng NPP khác',
  (SELECT (j ->> 'd2570000-0000-4000-9300-0000000000a1')::numeric = 15 AND (j ->> 'd2570000-0000-4000-9300-0000000000a2')::numeric = 3
          AND NOT j ? 'd2570000-0000-4000-9300-0000000000af' FROM ton_chu),
  (SELECT j::text FROM ton_chu);
INSERT INTO kq SELECT 9, 'ton_ban_theo_hang = đọc lô kho bán còn hàng rồi cộng (đường cũ docLoBan + stockMapFrom)',
  (SELECT count(*) FROM ton_truc_tiep t, ton_chu c WHERE (c.j ->> t.product_id::text)::numeric = t.sl) = (SELECT count(*) FROM ton_truc_tiep)
    AND (SELECT count(*) FROM ton_chu, jsonb_object_keys(j)) = (SELECT count(*) FROM ton_truc_tiep), '';
INSERT INTO kq SELECT 10, 'NPP khác: chỉ tồn của mình (50), RLS lô hàng như cũ',
  (SELECT j = jsonb_build_object('d2570000-0000-4000-9300-0000000000af', 50) FROM ton_khac), (SELECT j::text FROM ton_khac);
INSERT INTO kq SELECT 11, 'ton_ban_theo_hang: STABLE, invoker, search_path + jit=off; authenticated gọi được, anon không',
  (SELECT provolatile = 's' AND NOT prosecdef AND proconfig @> ARRAY['search_path=public', 'jit=off']
     FROM pg_proc WHERE oid = 'public.ton_ban_theo_hang()'::regprocedure)
    AND has_function_privilege('authenticated', 'public.ton_ban_theo_hang()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.ton_ban_theo_hang()', 'EXECUTE'),
  (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.ton_ban_theo_hang()'::regprocedure);

INSERT INTO kq SELECT 99, 'Đủ 11 dòng kiểm', count(*) = 11, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
