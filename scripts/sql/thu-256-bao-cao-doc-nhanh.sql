-- KIỂM MIG 256 — báo cáo đọc nhanh: hàm báo cáo tắt JIT ngay trên hàm; bao_cao_so_ban bỏ dong_don / dong_hd_goc
-- (chủ nhà 29/10/2026: "Đọc số bán hàng hỏng: … Máy chủ chưa trả lời sau 10 giây").
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate:
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-256-bao-cao-doc-nhanh.sql
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

-- Sổ thử có thể đã chạy mig 256 từ trước: gỡ jit=off trên các hàm (trong giao dịch — ROLLBACK cuối tệp) để chính lượt
-- chạy migration dưới đây phải đặt lại; thiếu hàm nào trong danh sách của migration là bài 10 bắt được.
DO $go$
DECLARE
  v regprocedure;
BEGIN
  FOR v IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('bao_cao_so_ban', 'bao_cao_cong_no', 'bao_cao_ton_kho', 'dashboard_summary', 'dashboard_top_customers',
                                'dashboard_channel_revenue', 'finance_pnl', 'finance_cash_flow', 'finance_balance_sheet')
  LOOP
    EXECUTE format('ALTER FUNCTION %s RESET jit', v);
  END LOOP;
END
$go$;

-- Chạy migration HAI lần: vẫn đúng một hàm, cài đặt không nhân đôi.
\o /dev/null
\ir ../../supabase/migrations/256_bao_cao_doc_nhanh.sql
\ir ../../supabase/migrations/256_bao_cao_doc_nhanh.sql
\o

-- ---------------------------------------------------------------- Sổ thử (bỏ trigger nghiệp vụ khi nạp — chỉ để có dòng)
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('d2560000-0000-4000-8000-0000000000b0'), ('d2560000-0000-4000-8000-0000000000b1'),
  ('d2560000-0000-4000-8000-0000000000b2'), ('d2560000-0000-4000-8000-0000000000bf');
INSERT INTO organizations (id, name, slug) VALUES
  ('d2560000-0000-4000-8000-000000000001', 'NPP thử 256', 'npp-thu-256'),
  ('d2560000-0000-4000-8000-000000000002', 'NPP khác 256', 'npp-khac-256');
INSERT INTO users (id, org_id, full_name, role, is_active) VALUES
  ('d2560000-0000-4000-8000-0000000000b0', 'd2560000-0000-4000-8000-000000000001', 'Chủ 256', 'owner', true),
  ('d2560000-0000-4000-8000-0000000000b1', 'd2560000-0000-4000-8000-000000000001', 'NVBH 1', 'sales', true),
  ('d2560000-0000-4000-8000-0000000000b2', 'd2560000-0000-4000-8000-000000000001', 'NVBH 2', 'sales', true),
  ('d2560000-0000-4000-8000-0000000000bf', 'd2560000-0000-4000-8000-000000000002', 'Chủ khác', 'owner', true);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address) VALUES
  ('d2560000-0000-4000-8000-0000000000c1', 'd2560000-0000-4000-8000-000000000001', 'Tạp hoá 256', 'Cô Ba', '0900256001', 'HN'),
  ('d2560000-0000-4000-8000-0000000000cf', 'd2560000-0000-4000-8000-000000000002', 'Khách khác', 'Anh K', '0900256009', 'HN');
INSERT INTO products (id, org_id, sku, name, base_unit) VALUES
  ('d2560000-0000-4000-9300-0000000000a1', 'd2560000-0000-4000-8000-000000000001', 'P256-1', 'Sữa 256', 'hộp'),
  ('d2560000-0000-4000-9300-0000000000a2', 'd2560000-0000-4000-8000-000000000001', 'P256-2', 'Mì 256', 'gói');
-- HĐ: H1 (NV1, ngày ĐẦU kỳ 01/09) + H2 (NV2, ngày CUỐI kỳ 30/09) ghi sổ; H3 01/10 (ngay sau kỳ); H4 31/08 (ngay trước kỳ);
-- H5 đã huỷ; HK của NPP khác.
INSERT INTO sales_invoices (id, org_id, invoice_code, invoice_seq, order_id, customer_id, status, invoice_date, subtotal, vat, total, sales_user_id, stock_entry_id) VALUES
  ('d2560000-0000-4000-8000-00000000f001', 'd2560000-0000-4000-8000-000000000001', 'HD256-1', 1, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000c1', 'posted', '2026-09-01', 120000, 0, 120000, 'd2560000-0000-4000-8000-0000000000b1', 'd2560000-0000-4000-8000-00000000e001'),
  ('d2560000-0000-4000-8000-00000000f002', 'd2560000-0000-4000-8000-000000000001', 'HD256-2', 2, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000c1', 'posted', '2026-09-30', 50000, 0, 50000, 'd2560000-0000-4000-8000-0000000000b2', 'd2560000-0000-4000-8000-00000000e002'),
  ('d2560000-0000-4000-8000-00000000f003', 'd2560000-0000-4000-8000-000000000001', 'HD256-3', 3, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000c1', 'posted', '2026-10-01', 9000, 0, 9000, 'd2560000-0000-4000-8000-0000000000b1', NULL),
  ('d2560000-0000-4000-8000-00000000f004', 'd2560000-0000-4000-8000-000000000001', 'HD256-4', 4, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000c1', 'posted', '2026-08-31', 7000, 0, 7000, 'd2560000-0000-4000-8000-0000000000b1', NULL),
  ('d2560000-0000-4000-8000-00000000f005', 'd2560000-0000-4000-8000-000000000001', 'HD256-5', 5, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000c1', 'cancelled', '2026-09-12', 40000, 0, 40000, 'd2560000-0000-4000-8000-0000000000b1', 'd2560000-0000-4000-8000-00000000e005'),
  ('d2560000-0000-4000-8000-00000000f0ff', 'd2560000-0000-4000-8000-000000000002', 'HD256-K', 1, gen_random_uuid(), 'd2560000-0000-4000-8000-0000000000cf', 'posted', '2026-09-15', 99000, 0, 99000, 'd2560000-0000-4000-8000-0000000000bf', NULL);
INSERT INTO sales_invoice_lines (id, invoice_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_total, is_exchange) VALUES
  ('d2560000-0000-4000-8000-0000000d0011', 'd2560000-0000-4000-8000-00000000f001', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 4, 20000, 80000, false),
  ('d2560000-0000-4000-8000-0000000d0012', 'd2560000-0000-4000-8000-00000000f001', 'd2560000-0000-4000-9300-0000000000a2', 'gói', 1, 8, 5000, 40000, false),
  ('d2560000-0000-4000-8000-0000000d0021', 'd2560000-0000-4000-8000-00000000f002', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 2, 25000, 50000, false),
  ('d2560000-0000-4000-8000-0000000d0031', 'd2560000-0000-4000-8000-00000000f003', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 1, 9000, 9000, false),
  ('d2560000-0000-4000-8000-0000000d0041', 'd2560000-0000-4000-8000-00000000f004', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 1, 7000, 7000, false);
-- Phiếu xuất: E1 / E2 của H1 / H2 (giá vốn 15.000 / hộp, 4.000 / gói); E3 lúc 00:30 ngày 01/09 giờ VN (17:30Z hôm trước) —
-- TRONG kỳ; E4 lúc 00:30 ngày 01/10 giờ VN — NGOÀI kỳ; E5 của HĐ ĐÃ HUỶ và E6 "Đảo phiếu trả" — không tính.
INSERT INTO stock_entries (id, org_id, entry_code, type, status, posted_at, notes) VALUES
  ('d2560000-0000-4000-8000-00000000e001', 'd2560000-0000-4000-8000-000000000001', 'XK256-1', 'export', 'posted', '2026-09-10T03:00:00Z', 'Xuất bán HD256-1'),
  ('d2560000-0000-4000-8000-00000000e002', 'd2560000-0000-4000-8000-000000000001', 'XK256-2', 'export', 'posted', '2026-09-20T03:00:00Z', 'Xuất bán HD256-2'),
  ('d2560000-0000-4000-8000-00000000e003', 'd2560000-0000-4000-8000-000000000001', 'XK256-3', 'export', 'posted', '2026-08-31T17:30:00Z', 'Xuất bán đầu kỳ'),
  ('d2560000-0000-4000-8000-00000000e004', 'd2560000-0000-4000-8000-000000000001', 'XK256-4', 'export', 'posted', '2026-09-30T17:30:00Z', 'Xuất bán sau kỳ'),
  ('d2560000-0000-4000-8000-00000000e005', 'd2560000-0000-4000-8000-000000000001', 'XK256-5', 'export', 'posted', '2026-09-12T03:00:00Z', 'Xuất bán HD256-5'),
  ('d2560000-0000-4000-8000-00000000e006', 'd2560000-0000-4000-8000-000000000001', 'XK256-6', 'export', 'posted', '2026-09-22T03:00:00Z', 'Đảo phiếu trả d2560000-0000-4000-8000-00000000a001'),
  ('d2560000-0000-4000-8000-00000000e007', 'd2560000-0000-4000-8000-000000000001', 'NK256-7', 'import', 'posted', '2026-09-23T03:00:00Z', 'Nhập lại từ phiếu trả d2560000-0000-4000-8000-00000000a001');
INSERT INTO stock_entry_lines (entry_id, product_id, unit_name, quantity, unit_cost, qty_in_base_uom, conversion_factor_snapshot) VALUES
  ('d2560000-0000-4000-8000-00000000e001', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', -4, 15000, -4, 1),
  ('d2560000-0000-4000-8000-00000000e001', 'd2560000-0000-4000-9300-0000000000a2', 'gói', -8, 4000, -8, 1),
  ('d2560000-0000-4000-8000-00000000e002', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', -2, 15000, -2, 1),
  ('d2560000-0000-4000-8000-00000000e003', 'd2560000-0000-4000-9300-0000000000a2', 'gói', -2, 4000, -2, 1),
  ('d2560000-0000-4000-8000-00000000e004', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', -5, 15000, -5, 1),
  ('d2560000-0000-4000-8000-00000000e005', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', -3, 15000, -3, 1),
  ('d2560000-0000-4000-8000-00000000e006', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', -1, 0, -1, 1),
  ('d2560000-0000-4000-8000-00000000e007', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 15000, 1, 1);
-- Phiếu trả R1 trong kỳ (một dòng trả + một dòng đổi); R2 ngoài kỳ.
INSERT INTO returns (id, org_id, customer_id, requested_by, status, credit_note_amount, invoice_id, sales_user_id, revenue_date, return_code, reason) VALUES
  ('d2560000-0000-4000-8000-00000000a001', 'd2560000-0000-4000-8000-000000000001', 'd2560000-0000-4000-8000-0000000000c1', 'd2560000-0000-4000-8000-0000000000b0', 'completed', 20000, 'd2560000-0000-4000-8000-00000000f001', 'd2560000-0000-4000-8000-0000000000b1', '2026-09-22', 'TH-256-1', 'damaged'),
  ('d2560000-0000-4000-8000-00000000a002', 'd2560000-0000-4000-8000-000000000001', 'd2560000-0000-4000-8000-0000000000c1', 'd2560000-0000-4000-8000-0000000000b0', 'completed', 5000, 'd2560000-0000-4000-8000-00000000f004', 'd2560000-0000-4000-8000-0000000000b1', '2026-08-31', 'TH-256-2', 'damaged');
INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total, is_exchange) VALUES
  ('d2560000-0000-4000-8000-00000000a001', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 20000, 20000, false),
  ('d2560000-0000-4000-8000-00000000a001', 'd2560000-0000-4000-9300-0000000000a2', 'gói', 1, 5000, 5000, true),
  ('d2560000-0000-4000-8000-00000000a002', 'd2560000-0000-4000-9300-0000000000a1', 'hộp', 1, 5000, 5000, false);
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------- Gọi qua RLS
SELECT pg_temp.vao('d2560000-0000-4000-8000-0000000000b0');
CREATE TEMP TABLE so_chu ON COMMIT DROP AS SELECT public.bao_cao_so_ban('2026-09-01', '2026-09-30') AS j;
SET LOCAL jit = on;
SET LOCAL jit_above_cost = 0;
CREATE TEMP TABLE so_chu_jit ON COMMIT DROP AS SELECT public.bao_cao_so_ban('2026-09-01', '2026-09-30') AS j;
RESET jit;
RESET jit_above_cost;
SELECT pg_temp.ra();
SELECT pg_temp.vao('d2560000-0000-4000-8000-0000000000b1');
CREATE TEMP TABLE so_nv1 ON COMMIT DROP AS SELECT public.bao_cao_so_ban('2026-09-01', '2026-09-30') AS j;
SELECT pg_temp.ra();
GRANT SELECT ON so_chu, so_chu_jit, so_nv1 TO authenticated;

INSERT INTO kq SELECT 1, 'Khoá trả về đúng 6 phần app đọc — không còn dong_don / dong_hd_goc',
  (SELECT array_agg(k ORDER BY k) FROM so_chu, jsonb_object_keys(j) k) = ARRAY['dong_hd', 'dong_tra', 'gv', 'gv_tra', 'hd', 'tra'],
  (SELECT string_agg(k, ',' ORDER BY k) FROM so_chu, jsonb_object_keys(j) k);
INSERT INTO kq SELECT 2, 'hd: HĐ ghi sổ trong kỳ của NPP mình, GỒM ngày đầu + ngày cuối kỳ (H1, H2) — không HĐ ngay trước / sau kỳ, không HĐ huỷ, không NPP khác',
  (SELECT array_agg(x ->> 'invoice_code' ORDER BY x ->> 'invoice_code') FROM so_chu, jsonb_array_elements(j -> 'hd') x) = ARRAY['HD256-1', 'HD256-2']
    -- Đủ 12 cột app đọc (fetchRevenueInvoicesDu), như mig 228.
    AND (SELECT array_agg(k ORDER BY k) FROM so_chu, jsonb_object_keys(j -> 'hd' -> 0) k)
        = ARRAY['customer_id', 'id', 'invoice_code', 'invoice_date', 'order_id', 'payment_terms', 'posted_by', 'sales_user_id', 'status', 'subtotal', 'total', 'vat'],
  (SELECT string_agg(x ->> 'invoice_code', ',') FROM so_chu, jsonb_array_elements(j -> 'hd') x);
INSERT INTO kq SELECT 3, 'dong_hd: 3 dòng của H1 + H2, đủ 11 cột như đường đọc cũ, theo id',
  (SELECT jsonb_array_length(j -> 'dong_hd') FROM so_chu) = 3
    AND (SELECT array_agg(k ORDER BY k) FROM so_chu, jsonb_object_keys(j -> 'dong_hd' -> 0) k)
        = ARRAY['conversion_factor', 'id', 'invoice_id', 'is_exchange', 'line_discount', 'line_total', 'order_line_id', 'product_id', 'quantity', 'unit_name', 'unit_price']
    AND (SELECT array_agg(x ->> 'id' ORDER BY x ->> 'id') = array_agg(x ->> 'id') FROM so_chu, jsonb_array_elements(j -> 'dong_hd') x),
  (SELECT string_agg(x ->> 'line_total', ',') FROM so_chu, jsonb_array_elements(j -> 'dong_hd') x);
INSERT INTO kq SELECT 4, 'tra + dong_tra: R1 trong kỳ (mã TH-256-1); dòng ĐỔI không tính',
  (SELECT array_agg(x ->> 'ma') FROM so_chu, jsonb_array_elements(j -> 'tra') x) = ARRAY['TH-256-1']
    AND (SELECT jsonb_array_length(j -> 'dong_tra') FROM so_chu) = 1
    AND (SELECT (j -> 'dong_tra' -> 0 ->> 'line_total')::numeric FROM so_chu) = 20000
    -- Đủ cột như mig 228: phiếu trả 11 cột (kèm số TH- `ma`), dòng trả 6 cột.
    AND (SELECT array_agg(k ORDER BY k) FROM so_chu, jsonb_object_keys(j -> 'tra' -> 0) k)
        = ARRAY['created_at', 'credit_note_amount', 'credit_with_invoice', 'customer_id', 'id', 'invoice_id', 'ma', 'reason', 'revenue_date', 'sales_user_id', 'status']
    AND (SELECT array_agg(k ORDER BY k) FROM so_chu, jsonb_object_keys(j -> 'dong_tra' -> 0) k)
        = ARRAY['line_total', 'product_id', 'quantity', 'return_id', 'unit_name', 'unit_price'], '';
INSERT INTO kq SELECT 5, 'gv: phiếu xuất bán trong kỳ theo giờ VN — Sữa 6 hộp × 15.000, Mì 10 gói × 4.000; bỏ phiếu sau kỳ, phiếu của HĐ huỷ + phiếu "Đảo phiếu trả"',
  (SELECT (x ->> 'sl')::numeric = 6 AND (x ->> 'tien')::numeric = 90000 FROM so_chu, jsonb_array_elements(j -> 'gv') x WHERE x ->> 'product_id' = 'd2560000-0000-4000-9300-0000000000a1')
    AND (SELECT (x ->> 'sl')::numeric = 10 AND (x ->> 'tien')::numeric = 40000 FROM so_chu, jsonb_array_elements(j -> 'gv') x WHERE x ->> 'product_id' = 'd2560000-0000-4000-9300-0000000000a2'),
  (SELECT string_agg(x ->> 'product_id' || ':' || (x ->> 'sl') || '/' || (x ->> 'tien'), ' | ') FROM so_chu, jsonb_array_elements(j -> 'gv') x);
INSERT INTO kq SELECT 6, 'gv_tra: phiếu "Nhập lại từ phiếu trả R1" — 1 hộp × 15.000',
  (SELECT jsonb_array_length(j -> 'gv_tra') FROM so_chu) = 1 AND (SELECT (j -> 'gv_tra' -> 0 ->> 'tien')::numeric FROM so_chu) = 15000, '';
INSERT INTO kq SELECT 7, 'Phiên bật JIT (ngưỡng 0) ra ĐÚNG cùng kết quả — tắt JIT chỉ đổi cách chạy',
  (SELECT a.j = b.j FROM so_chu a, so_chu_jit b), '';
INSERT INTO kq SELECT 8, 'Vẫn SECURITY INVOKER: NVBH 1 chỉ thấy HĐ của mình (H1) và dòng của H1',
  (SELECT array_agg(x ->> 'invoice_code') FROM so_nv1, jsonb_array_elements(j -> 'hd') x) = ARRAY['HD256-1']
    AND (SELECT bool_and(x ->> 'invoice_id' = 'd2560000-0000-4000-8000-00000000f001') FROM so_nv1, jsonb_array_elements(j -> 'dong_hd') x),
  (SELECT string_agg(x ->> 'invoice_code', ',') FROM so_nv1, jsonb_array_elements(j -> 'hd') x);
INSERT INTO kq SELECT 9, 'bao_cao_so_ban: STABLE, không definer, search_path + jit=off trên hàm; authenticated gọi được, anon không; chạy hai lần vẫn một hàm',
  (SELECT provolatile = 's' AND NOT prosecdef AND proconfig @> ARRAY['search_path=public', 'jit=off']
     FROM pg_proc WHERE oid = 'public.bao_cao_so_ban(date, date)'::regprocedure)
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'bao_cao_so_ban') = 1
    AND has_function_privilege('authenticated', 'public.bao_cao_so_ban(date, date)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.bao_cao_so_ban(date, date)', 'EXECUTE'),
  (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.bao_cao_so_ban(date, date)'::regprocedure);
INSERT INTO kq SELECT 10, 'Đủ 8 hàm báo cáo khác, đều jit=off ngay trên hàm (một lần, không nhân đôi khi chạy lại)',
  (SELECT count(*) = 8 AND bool_and('jit=off' = ANY (coalesce(proconfig, '{}')) AND cardinality(array_positions(proconfig, 'jit=off')) = 1)
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('bao_cao_cong_no', 'bao_cao_ton_kho', 'dashboard_summary', 'dashboard_top_customers', 'dashboard_channel_revenue',
                      'finance_pnl', 'finance_cash_flow', 'finance_balance_sheet')),
  (SELECT string_agg(proname || ':' || coalesce(array_to_string(proconfig, ','), '-'), ' | ' ORDER BY proname)
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('bao_cao_cong_no', 'bao_cao_ton_kho', 'dashboard_summary', 'finance_pnl'));

INSERT INTO kq SELECT 99, 'Đủ 10 dòng kiểm', count(*) = 10, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
