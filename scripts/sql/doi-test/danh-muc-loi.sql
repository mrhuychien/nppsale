-- ĐỘI TEST "Danh mục, Quyền & Tạo nhanh" — LỖI ĐÃ XÁC MINH (để ĐỎ tới khi sửa xong).
--
-- LỖI 1 — MÃ ĐƠN UNIQUE TOÀN BẢNG NHƯNG SỐ CHẠY THEO TỪNG NPP → NPP thứ hai không tạo được đơn.
--   mig 130: `order_seq` "Số chạy của đơn trong phạm vi tổ chức" (`_next_order_seq(p_org)` lấy max theo org_id,
--   chỉ mục `idx_sales_orders_seq (org_id, order_seq)`), mã = `DH-` || lpad(seq) — NHƯNG ràng buộc gốc của
--   mig 001 `order_code text UNIQUE` (sales_orders_order_code_key) vẫn là toàn bảng. NPP A đã có DH-0001 thì
--   đơn đầu tiên của NPP B cũng được cấp DH-0001 → "duplicate key … sales_orders_order_code_key".
--   Mọi chứng từ khác đã cô lập mã theo NPP (idx_sales_invoices_code (org_id, invoice_code), uq_returns_org_seq,
--   cash_receipts_org_id_receipt_code_key) — mig 166 "vá … chéo NPP" coi nhiều NPP chung một sổ là có thật.
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_danh_muc -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/danh-muc-loi.sql
\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'ownerb@test.local'),
  ('f0000000-0000-0000-0000-000000000002', 'salesb@test.local');
INSERT INTO organizations (id, name, slug) VALUES ('b0000000-0000-0000-0000-000000000001', 'NPP Khac', 'npp-khac-test');
INSERT INTO users (id, org_id, full_name, role, phone, is_active) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Chu NPP B', 'owner', '0977000101', true),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'NVBH NPP B', 'sales', '0977000102', true);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  ('cb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Khach NPP B', 'B', '0988000002', 'Q1', 'GT');
INSERT INTO customer_assignments (customer_id, user_id, role) VALUES
  ('cb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'primary');
INSERT INTO products (id, org_id, sku, name, base_unit, sell_price) VALUES
  ('bb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'B-SP-1', 'SP NPP B', 'Cái', 10000);

-- NPP A (seed) có đơn đầu tiên → DH-0001 (người tạo: NVBH Dung, qua RPC tạo đơn như màn bán hàng).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
SELECT order_code AS ma_don_npp_a FROM public.create_order_with_lines(jsonb_build_object(
  'client_request_id', 'aaaa0000-0000-0000-0000-000000000001',
  'order', jsonb_build_object('customer_id', 'd0000000-0000-0000-0000-000000000001', 'total', 10000, 'status', 'draft'),
  'lines', jsonb_build_array(jsonb_build_object('product_id', (SELECT id FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY sku LIMIT 1),
                                                'unit_name', 'Thùng', 'quantity', 1, 'unit_price', 10000, 'line_total', 10000))));
RESET ROLE;

-- NVBH NPP B tạo đơn ĐẦU TIÊN của NPP B (cùng RPC).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);
DO $t$
DECLARE v_ma text; v_loi text;
BEGIN
  BEGIN
    SELECT order_code INTO v_ma FROM public.create_order_with_lines(jsonb_build_object(
      'client_request_id', 'bbbb0000-0000-0000-0000-000000000001',
      'order', jsonb_build_object('customer_id', 'cb000000-0000-0000-0000-000000000001', 'total', 10000, 'status', 'draft'),
      'lines', jsonb_build_array(jsonb_build_object('product_id', 'bb000000-0000-0000-0000-000000000001',
                                                    'unit_name', 'Cái', 'quantity', 1, 'unit_price', 10000, 'line_total', 10000))));
    v_loi := NULL;
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM;
  END;
  INSERT INTO kq VALUES ('L1.1', 'NPP B tạo được đơn đầu tiên (số chạy riêng của NPP B: DH-0001) dù NPP A đã có DH-0001',
    v_loi IS NULL AND v_ma = 'DH-0001', COALESCE(v_loi, v_ma));
END $t$;
RESET ROLE;

-- Ràng buộc nên là (org_id, order_code) như hoá đơn / phiếu trả / phiếu thu.
INSERT INTO kq
SELECT 'L1.2', 'Không còn UNIQUE toàn bảng trên sales_orders.order_code (phải theo org_id)',
       NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'sales_orders' AND indexdef ~ 'UNIQUE' AND indexdef ~ '\(order_code\)'),
       (SELECT string_agg(indexname, ', ') FROM pg_indexes WHERE tablename = 'sales_orders' AND indexdef ~ 'UNIQUE' AND indexdef ~ 'order_code');

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
