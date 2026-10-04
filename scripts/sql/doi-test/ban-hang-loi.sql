-- ====================================================================
-- ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — CÁC LỖI ĐÃ XÁC MINH (đang ĐỎ).
-- Sửa xong sản phẩm thì chạy lại: mọi dòng phải thành ĐẠT.
--
--   psql -h /tmp/pgtest -p 55432 -U postgres -d npp_ban_hang -v ON_ERROR_STOP=1 \
--     -f scripts/sql/doi-test/ban-hang-loi.sql
--
-- L1  Đơn gửi thẳng (INSERT status='submitted' — đường chính của /sell và POS)
--     không có `submitted_at` và không có dòng lịch sử 'submitted': trigger đóng
--     mốc (check_order_status_transition, mig 119/124) chỉ chạy BEFORE UPDATE.
--     src/lib/sell/send-order.ts ghi "Mốc submitted_at do trigger trong migration
--     119 tự đóng"; status-tone.ts buildOrderTimeline đọc mốc này cho bước "Gửi đơn".
-- L2  `sales_orders.order_date` mặc định CURRENT_DATE = ngày UTC (máy chủ Supabase
--     chạy UTC — mig 140), create_order_with_lines không đặt order_date. Đơn tạo
--     00:00–07:00 giờ VN mang ngày HÔM QUA, trong khi màn Tổng quan NVBH
--     (sales-home.tsx "đơn tạo") và báo cáo cuối ngày (man-cuoi-ngay.tsx) so
--     order_date với ngày VN. CLAUDE.md: "so bằng ngày theo giờ VN".
-- L3  Quyền giảm giá (mig 185, CLAUDE.md §Quyền) chỉ chặn ở giao diện: NVBH
--     allow_discount = false vẫn ghi được line_discount qua RPC tạo đơn.
-- L4  NVBH có trần 10% vẫn ghi được giảm 50% qua RPC.
-- L5  Dòng đơn số lượng ÂM / bằng 0 / đơn giá âm được ghi (không CHECK, RPC không
--     kiểm) — dòng âm kéo tổng đơn / số liệu "Đặt hàng" theo đơn xuống; dòng 0 là
--     dòng ma (post_invoice bỏ qua). (Số "đã giữ" — committed_stock_by_product — có
--     kẹp GREATEST(0, …) nên không bị ảnh hưởng.)
-- ====================================================================
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-0000000000b7');
-- NVBH có quyền giảm giá, trần 10%
INSERT INTO users (id, org_id, full_name, role, allow_discount, discount_max_type, discount_max_value)
VALUES ('e0000000-0000-0000-0000-0000000000b7', 'a0000000-0000-0000-0000-000000000001', 'NVBH Trần 10%', 'sales', true, 'pct', 10);
INSERT INTO ctx SELECT 'kh', id FROM customers WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY id LIMIT 1;

CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;
CREATE FUNCTION pg_temp.c(k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM ctx WHERE ctx.k = $1 $f$;
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$;
CREATE FUNCTION pg_temp.tai(crid uuid, lines jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('client_request_id', crid,
    'order', jsonb_build_object('order_code', 'TAM', 'customer_id', (SELECT v FROM ctx WHERE k = 'kh'), 'status', 'submitted',
                                'subtotal', 0, 'vat', 0, 'total', 0),
    'lines', lines) $f$;
CREATE FUNCTION pg_temp.dong(sl numeric, gia numeric, giam numeric DEFAULT 0) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
    'quantity', sl, 'unit_price', gia, 'line_discount', giam, 'line_total', sl * gia - giam, 'conversion_factor', 1)) $f$;
CREATE FUNCTION pg_temp.so_don(crid uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $f$ SELECT count(*) FROM sales_orders WHERE client_request_id = crid $f$;

SET LOCAL ROLE authenticated;

-- L1 ---------------------------------------------------------------------
DO $t$
DECLARE r record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai('22222222-0000-0000-0000-000000000001', pg_temp.dong(1, 10000)));
  PERFORM pg_temp.ghi('L1', 'đơn gửi thẳng có mốc submitted_at (bước "Gửi đơn" có giờ)',
    (SELECT submitted_at IS NOT NULL FROM sales_orders WHERE id = r.order_id),
    format('status=%s submitted_at=%s lịch sử submitted=%s',
      (SELECT status FROM sales_orders WHERE id = r.order_id),
      coalesce((SELECT submitted_at::text FROM sales_orders WHERE id = r.order_id), 'NULL'),
      (SELECT count(*) FROM order_status_history WHERE order_id = r.order_id AND to_status = 'submitted')));
END $t$;

-- L2 ---------------------------------------------------------------------
-- Máy chủ Supabase chạy UTC (mig 140). Kiểm tĩnh (chạy giờ nào cũng ra cùng kết
-- quả): ngày đơn phải lấy theo lịch VN — mặc định cột dùng vn_today() HOẶC RPC
-- tạo đơn tự đặt order_date. Kèm kiểm động khi đang ở khung 00:00–07:00 VN.
SET LOCAL TIME ZONE 'UTC';
DO $t$
DECLARE mac_dinh text; rpc text; r record;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO mac_dinh
  FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.sales_orders'::regclass AND a.attname = 'order_date';
  SELECT prosrc INTO rpc FROM pg_proc WHERE oid = 'public.create_order_with_lines(jsonb)'::regprocedure;
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai('22222222-0000-0000-0000-000000000002', pg_temp.dong(1, 10000)));
  PERFORM pg_temp.ghi('L2', 'ngày đặt đơn theo lịch VN, không theo ngày UTC',
    (mac_dinh ILIKE '%vn_today%' OR rpc ILIKE '%order_date%')
      AND (SELECT order_date FROM sales_orders WHERE id = r.order_id) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    format('mặc định cột = %s; RPC đặt order_date: %s; ví dụ 2026-10-05 01:30 giờ VN → CURRENT_DATE(UTC) = %s',
      mac_dinh, rpc ILIKE '%order_date%', (timestamptz '2026-10-05 01:30+07' AT TIME ZONE 'UTC')::date));
END $t$;

-- L3 ---------------------------------------------------------------------
DO $t$
DECLARE e text;
BEGIN
  -- e…04: allow_discount = false (mặc định, 003_seed)
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)',
        pg_temp.tai('22222222-0000-0000-0000-000000000003', pg_temp.dong(10, 100000, 300000))));
  PERFORM pg_temp.ghi('L3', 'NVBH KHÔNG có quyền giảm giá: máy chủ chặn dòng giảm 300.000 / 1.000.000',
    e <> 'OK' AND pg_temp.so_don('22222222-0000-0000-0000-000000000003') = 0,
    format('kết quả: %s; số đơn ghi được = %s', left(e, 60), pg_temp.so_don('22222222-0000-0000-0000-000000000003')));
END $t$;

-- L4 ---------------------------------------------------------------------
DO $t$
DECLARE e text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000b7', true);
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)',
        pg_temp.tai('22222222-0000-0000-0000-000000000004', pg_temp.dong(10, 100000, 500000))));
  PERFORM pg_temp.ghi('L4', 'NVBH trần 10%: máy chủ chặn giảm 50%',
    e <> 'OK' AND pg_temp.so_don('22222222-0000-0000-0000-000000000004') = 0,
    format('kết quả: %s; số đơn ghi được = %s', left(e, 60), pg_temp.so_don('22222222-0000-0000-0000-000000000004')));
END $t$;

-- L5 ---------------------------------------------------------------------
DO $t$
DECLARE e text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai('22222222-0000-0000-0000-000000000005', pg_temp.dong(-5, 10000))));
  PERFORM pg_temp.ghi('L5a', 'dòng đơn số lượng âm (−5) bị chặn', e <> 'OK' AND pg_temp.so_don('22222222-0000-0000-0000-000000000005') = 0, left(e, 60));
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai('22222222-0000-0000-0000-000000000006', pg_temp.dong(0, 10000))));
  PERFORM pg_temp.ghi('L5b', 'dòng đơn số lượng 0 bị chặn', e <> 'OK' AND pg_temp.so_don('22222222-0000-0000-0000-000000000006') = 0, left(e, 60));
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai('22222222-0000-0000-0000-000000000007', pg_temp.dong(1, -10000))));
  PERFORM pg_temp.ghi('L5c', 'dòng đơn đơn giá âm bị chặn', e <> 'OK' AND pg_temp.so_don('22222222-0000-0000-0000-000000000007') = 0, left(e, 60));
END $t$;

RESET ROLE;
SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) AS tong FROM kq;
ROLLBACK;
