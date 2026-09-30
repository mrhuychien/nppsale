-- KIỂM MIG 217 (chủ nhà 30/09/2026): huỷ HĐ = huỷ đơn + phiếu trả chưa nhập kho; một đơn
-- một HĐ; xuất thiếu vẫn Hoàn thành; Sửa HĐ không huỷ đơn; không còn đóng đơn.
-- Mọi RPC gọi dưới vai `authenticated` (chủ NPP). psql -f trên Postgres ở máy; in 'ĐẠT'/'LỖI'.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

-- Dữ liệu: đơn 100 lon Coca × 10.000.
DO $d$
DECLARE v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_kh uuid; v_don uuid; v_dong uuid;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address) VALUES (v_org, 'Khách 217', 'Chị Hai', '0900000217', '2 Đường Thử') RETURNING id INTO v_kh;
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, 'c0000000-0000-0000-0000-000000000001', 'LO-217', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 300, 1000, 1000, 6000, 'sale', now());
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total)
  VALUES (v_org, 'DH-217', v_kh, 'e0000000-0000-0000-0000-000000000004', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1, 'submitted', 'NET30', 1000000, 0, 0, 1000000) RETURNING id INTO v_don;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
  VALUES (v_don, 'c0000000-0000-0000-0000-000000000001', 'lon', 100, 10000, 0, 1000000, 1) RETURNING id INTO v_dong;
  INSERT INTO ctx VALUES ('kh', v_kh), ('don', v_don), ('dong', v_dong);
END $d$;

CREATE OR REPLACE FUNCTION pg_temp.ton() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale' $f$;
CREATE OR REPLACE FUNCTION pg_temp.no_khach() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = (SELECT v FROM ctx WHERE k = 'kh') AND status <> 'paid' $f$;
CREATE OR REPLACE FUNCTION pg_temp.don() RETURNS text LANGUAGE sql AS
  $f$ SELECT status FROM sales_orders WHERE id = (SELECT v FROM ctx WHERE k = 'don') $f$;
CREATE OR REPLACE FUNCTION pg_temp.hd() RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM sales_invoices WHERE order_id = (SELECT v FROM ctx WHERE k = 'don') AND status = 'posted' $f$;
CREATE OR REPLACE FUNCTION pg_temp.tu_sinh() RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM returns WHERE order_id = (SELECT v FROM ctx WHERE k = 'don') ORDER BY created_at LIMIT 1 $f$;
CREATE OR REPLACE FUNCTION pg_temp.ghi(b int, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, ok, g) $f$;
CREATE OR REPLACE FUNCTION pg_temp.dong(sl numeric) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('order_line_id', (SELECT v FROM ctx WHERE k = 'dong'), 'product_id', 'c0000000-0000-0000-0000-000000000001',
         'unit_name', 'lon', 'conversion_factor', 1, 'quantity', sl, 'unit_price', 10000, 'vat_rate', 0)) $f$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE moc AS SELECT pg_temp.ton() AS coca;

-- B1 Xuất THIẾU 80/100 kèm trả 10 Pepsi → đơn Hoàn thành luôn
DO $t$ BEGIN
  PERFORM post_invoice(jsonb_build_object('order_id', (SELECT v FROM ctx WHERE k = 'don'), 'lines', pg_temp.dong(80),
    'return_adds', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon',
       'quantity', 10, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false))));
  PERFORM pg_temp.ghi(1, 'xuất thiếu 80/100 → Hoàn thành', pg_temp.don() = 'completed' AND pg_temp.no_khach() = 750000
      AND (SELECT status FROM returns WHERE id = pg_temp.tu_sinh()) = 'submitted',
    format('đơn %s (completed), nợ %s (750000), phiếu tự sinh %s', pg_temp.don(), pg_temp.no_khach(),
      (SELECT status FROM returns WHERE id = pg_temp.tu_sinh())));
END $t$;

-- B2 Xuất HĐ thứ hai cho cùng đơn → chặn
DO $t$ BEGIN
  BEGIN
    PERFORM post_invoice(jsonb_build_object('order_id', (SELECT v FROM ctx WHERE k = 'don'), 'lines', pg_temp.dong(20)));
    PERFORM pg_temp.ghi(2, 'chặn HĐ thứ hai', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi(2, 'chặn HĐ thứ hai', SQLERRM LIKE 'ORDER_NOT_INVOICEABLE%', left(SQLERRM, 70));
  END;
END $t$;

-- B3 Sửa HĐ (huỷ & lập lại) bán 70 → đơn KHÔNG bị huỷ, phiếu tự sinh theo tờ mới
DO $t$ DECLARE h0 uuid := pg_temp.hd(); BEGIN
  PERFORM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong(70)));
  PERFORM pg_temp.ghi(3, 'Sửa HĐ không huỷ đơn', pg_temp.don() = 'completed' AND pg_temp.hd() IS NOT NULL AND pg_temp.hd() <> h0
      AND (SELECT status FROM returns WHERE id = pg_temp.tu_sinh()) = 'submitted'
      AND (SELECT invoice_id FROM returns WHERE id = pg_temp.tu_sinh()) = pg_temp.hd()
      AND pg_temp.no_khach() = 650000,
    format('đơn %s, phiếu tự sinh %s theo tờ mới %s, nợ %s (650000)', pg_temp.don(),
      (SELECT status FROM returns WHERE id = pg_temp.tu_sinh()),
      (SELECT invoice_id FROM returns WHERE id = pg_temp.tu_sinh()) = pg_temp.hd(), pg_temp.no_khach()));
  -- Phiếu trả TỰ LẬP nháp gắn tờ mới (lập từ xem nhanh HĐ)
  INSERT INTO returns (org_id, invoice_id, customer_id, status, credit_with_invoice, reason, requested_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.hd(), (SELECT v FROM ctx WHERE k = 'kh'), 'draft', false, 'damaged',
          'e0000000-0000-0000-0000-000000000001');
  INSERT INTO ctx SELECT 'tl', id FROM returns WHERE invoice_id = pg_temp.hd() AND order_id IS NULL;
END $t$;

-- B4 Đã thu tiền → huỷ HĐ bị chặn, đơn giữ nguyên
DO $t$ BEGIN
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', (SELECT v FROM ctx WHERE k = 'kh'), 'client_key', 't217',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = pg_temp.hd()), 'amount', 100000))));
  BEGIN
    PERFORM cancel_invoice(pg_temp.hd(), 'thử');
    PERFORM pg_temp.ghi(4, 'đã thu tiền: chặn huỷ HĐ', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi(4, 'đã thu tiền: chặn huỷ HĐ', SQLERRM LIKE 'LOCKED_HAS_PAYMENT%' AND pg_temp.don() = 'completed',
      left(SQLERRM, 50) || ' · đơn ' || pg_temp.don());
  END;
  PERFORM void_cash_receipt((SELECT id FROM cash_receipts WHERE client_key = 't217'), 'thu nhầm');
END $t$;

-- B5 Huỷ HĐ → đơn Đã huỷ, cả hai phiếu trả Đã huỷ, kho về đủ, hết nợ
DO $t$ DECLARE m record; h uuid := pg_temp.hd(); BEGIN
  SELECT * INTO m FROM moc;
  PERFORM cancel_invoice(h, 'khách không lấy nữa');
  PERFORM pg_temp.ghi(5, 'huỷ HĐ = huỷ đơn', pg_temp.don() = 'cancelled' AND pg_temp.hd() IS NULL
      AND (SELECT status FROM sales_invoices WHERE id = h) = 'cancelled'
      AND (SELECT status FROM returns WHERE id = pg_temp.tu_sinh()) = 'cancelled'
      AND (SELECT status FROM returns WHERE id = (SELECT v FROM ctx WHERE k = 'tl')) = 'cancelled'
      AND pg_temp.no_khach() = 0 AND pg_temp.ton() = m.coca
      AND (SELECT cancel_reason FROM sales_orders WHERE id = (SELECT v FROM ctx WHERE k = 'don')) LIKE 'Huỷ theo hóa đơn%khách không lấy nữa'
      AND EXISTS (SELECT 1 FROM order_activity_log WHERE order_id = (SELECT v FROM ctx WHERE k = 'don') AND action = 'cancel_after_complete'),
    format('đơn %s; HĐ %s; phiếu tự sinh %s; tự lập %s; nợ %s; Coca về đủ %s; lý do "%s"', pg_temp.don(),
      (SELECT status FROM sales_invoices WHERE id = h), (SELECT status FROM returns WHERE id = pg_temp.tu_sinh()),
      (SELECT status FROM returns WHERE id = (SELECT v FROM ctx WHERE k = 'tl')), pg_temp.no_khach(), pg_temp.ton() = m.coca,
      (SELECT cancel_reason FROM sales_orders WHERE id = (SELECT v FROM ctx WHERE k = 'don'))));
  -- Đơn đã huỷ: không xuất lại được
  BEGIN
    PERFORM post_invoice(jsonb_build_object('order_id', (SELECT v FROM ctx WHERE k = 'don'), 'lines', pg_temp.dong(10)));
    PERFORM pg_temp.ghi(5, 'đơn đã huỷ không xuất lại', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi(5, 'đơn đã huỷ không xuất lại', SQLERRM LIKE 'ORDER_NOT_INVOICEABLE%', left(SQLERRM, 60));
  END;
END $t$;

-- B6 Đóng đơn không còn
DO $t$ BEGIN
  BEGIN
    PERFORM close_order((SELECT v FROM ctx WHERE k = 'don'), 'thử');
    PERFORM pg_temp.ghi(6, 'không còn đóng đơn', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ghi(6, 'không còn đóng đơn', SQLERRM LIKE 'ORDER_CLOSE_REMOVED%', left(SQLERRM, 60));
  END;
END $t$;

RESET ROLE;
-- B7 Không còn đơn Xuất một phần / Đã đóng; chỉ mục một đơn một HĐ có mặt
DO $t$ BEGIN
  PERFORM pg_temp.ghi(7, 'dữ liệu cũ về Hoàn thành + chỉ mục',
    NOT EXISTS (SELECT 1 FROM sales_orders WHERE status IN ('partially_invoiced', 'closed'))
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_sales_invoices_mot_don_mot_hd'),
    format('còn %s đơn partial/closed', (SELECT count(*) FROM sales_orders WHERE status IN ('partially_invoiced', 'closed'))));
END $t$;

SELECT buoc AS "B", CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc, ten;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
