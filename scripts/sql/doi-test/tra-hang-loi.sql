-- ====================================================================
-- ĐỘI TEST "TRẢ HÀNG" — CÁC LỖI ĐÃ XÁC MINH (để ĐỎ tới khi sửa; sửa xong chạy lại phải xanh).
--   psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tra_hang -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/tra-hang-loi.sql
--   Dựng chung tiện ích với scripts/sql/doi-test/tra-hang.sql (chép nguyên khối đầu).
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
GRANT ALL ON kq TO authenticated;
GRANT ALL ON SEQUENCE kq_stt_seq TO authenticated;

-- ---------------------------------------------------------------------
-- Tiện ích
-- ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;

CREATE FUNCTION pg_temp.ghi(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS
$f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi) $f$;

-- Chạy một câu dưới danh nghĩa user n (1 owner, 2 manager, 3 accountant, 4 sales, 5 warehouse,
-- 6 sales thứ hai), vai Postgres `authenticated` như trình duyệt. Trả mã lỗi hoặc NULL.
CREATE FUNCTION pg_temp.thu(p_n int, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN split_part(SQLERRM, ':', 1);
END $f$;

-- Như thu() nhưng trả uuid do câu lệnh trả về (RPC trả uuid).
CREATE FUNCTION pg_temp.lay(p_n int, p_sql text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO v;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN v;
END $f$;

-- User phụ: sales thứ hai (6).
-- (vai driver đã ngưng — trigger trg_block_driver_role chặn tạo.)
INSERT INTO auth.users (id, email) VALUES (pg_temp.u(6), 'sales2@doi-test.vn');
INSERT INTO users (id, org_id, full_name, role) VALUES
  (pg_temp.u(6), 'a0000000-0000-0000-0000-000000000001', 'NVBH Hai', 'sales');
SELECT set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);

-- Bộ dữ liệu riêng: khách mới, P1 (hop, thung=12), P2 (goi), P3 (chai, không có trên đơn); đơn submitted.
--   Đơn: 5 thùng P1 × 120.000 = 600.000 + 20 gói P2 × 5.000 = 100.000 → 700.000.
--   Tồn sale: P1 1000 hộp (giá vốn 800/hộp), P2 500 gói (3.000), P3 100 chai (5.000).
CREATE TYPE pg_temp.bo AS (cust uuid, p1 uuid, p2 uuid, p3 uuid, ord uuid, l1 uuid, l2 uuid);
CREATE FUNCTION pg_temp.moi(p_tag text, p_nv int DEFAULT 4) RETURNS pg_temp.bo LANGUAGE plpgsql AS $f$
DECLARE cust uuid; p1 uuid; p2 uuid; p3 uuid; ord uuid; l1 uuid; l2 uuid;
  v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_seq int;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES (v_org, 'KH đội trả ' || p_tag, 'Chủ ' || p_tag, '08' || lpad((random()*1e8)::int::text, 8, '0'), 'Đ/c ' || p_tag)
  RETURNING id INTO cust;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT1-' || p_tag, 'Đội trả P1 ' || p_tag, 'hop', 0, 10000, 'active') RETURNING id INTO p1;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT2-' || p_tag, 'Đội trả P2 ' || p_tag, 'goi', 0, 5000, 'active') RETURNING id INTO p2;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT3-' || p_tag, 'Đội trả P3 ' || p_tag, 'chai', 0, 8000, 'active') RETURNING id INTO p3;
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (p1, 'thung', 12);
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, p1, 'DB1-' || p_tag, current_date + 400, 1000, 1000, 800, 'sale', now() - interval '10 day'),
         (v_org, p2, 'DB2-' || p_tag, current_date + 400, 500, 500, 3000, 'sale', now() - interval '10 day'),
         (v_org, p3, 'DB3-' || p_tag, current_date + 400, 100, 100, 5000, 'sale', now() - interval '10 day');
  UPDATE batches SET warehouse_zone = 'sale' WHERE product_id IN (p1, p2, p3);
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq, subtotal, total, payment_terms, order_date)
  VALUES (v_org, 'DTDH-' || p_tag || '-' || v_seq, cust, pg_temp.u(p_nv), 'submitted', v_seq, 700000, 700000, 'COD', current_date)
  RETURNING id INTO ord;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p1, 'thung', 5, 120000, 600000, 12, 0) RETURNING id INTO l1;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p2, 'goi', 20, 5000, 100000, 1, 0) RETURNING id INTO l2;
  RETURN ROW(cust, p1, p2, p3, ord, l1, l2)::pg_temp.bo;
END $f$;

CREATE FUNCTION pg_temp.dong_don(d pg_temp.bo) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(
    jsonb_build_object('order_line_id', d.l1, 'product_id', d.p1, 'unit_name', 'thung', 'quantity', 5, 'unit_price', 120000, 'vat_rate', 0),
    jsonb_build_object('order_line_id', d.l2, 'product_id', d.p2, 'unit_name', 'goi', 'quantity', 20, 'unit_price', 5000, 'vat_rate', 0))
$f$;
CREATE FUNCTION pg_temp.dong_hd(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'is_exchange', is_exchange, 'vat_rate', vat_rate) ORDER BY sort_order)
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;
CREATE FUNCTION pg_temp.xuat(p_ord uuid, p_lines jsonb, p_adds jsonb DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  SELECT * INTO r FROM post_invoice(jsonb_strip_nulls(jsonb_build_object(
    'order_id', p_ord, 'lines', p_lines, 'return_adds', p_adds, 'invoice_date', p_date, 'allow_oversell', true)));
  RETURN r.invoice_id;
END $f$;
CREATE FUNCTION pg_temp.tra(d pg_temp.bo, p_qty numeric DEFAULT 1, p_unit text DEFAULT 'thung', p_price numeric DEFAULT 120000, p_vat numeric DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', p_unit, 'quantity', p_qty, 'unit_price', p_price, 'vat_rate', p_vat))
$f$;
-- Nợ màn hình (loadCustomerDebt): Σ(amount − paid) các dòng status <> 'paid'.
CREATE FUNCTION pg_temp.no(c uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = c AND status <> 'paid' $f$;
CREATE FUNCTION pg_temp.no_hd(p_inv uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT amount FROM receivables WHERE invoice_id = p_inv $f$;
CREATE FUNCTION pg_temp.ton(p uuid, z text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND (z IS NULL OR warehouse_zone = z) $f$;
CREATE FUNCTION pg_temp.st(p_ret uuid) RETURNS text LANGUAGE sql AS $f$ SELECT status FROM returns WHERE id = p_ret $f$;
CREATE FUNCTION pg_temp.cr(p_ret uuid) RETURNS numeric LANGUAGE sql AS $f$ SELECT COALESCE(credit_note_amount, 0) FROM returns WHERE id = p_ret $f$;
CREATE FUNCTION pg_temp.rd(p_ret uuid) RETURNS date LANGUAGE sql AS $f$ SELECT revenue_date FROM returns WHERE id = p_ret $f$;
-- Dòng công nợ âm của phiếu tự lập độc lập.
CREATE FUNCTION pg_temp.no_tra(p_ret uuid) RETURNS numeric LANGUAGE sql AS $f$ SELECT amount FROM receivables WHERE return_id = p_ret $f$;
CREATE FUNCTION pg_temp.thu_tien(c uuid, p_rc uuid, p_amt numeric, p_use numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN create_cash_receipt(jsonb_build_object('customer_id', c, 'method', 'cash', 'use_credit', p_use,
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', p_rc, 'amount', p_amt))));
END $f$;
CREATE FUNCTION pg_temp.hom_nay() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
-- Số phiếu nhập còn hiệu lực (chưa đảo) của một phiếu trả.
CREATE FUNCTION pg_temp.so_nhap(p_ret uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || p_ret $f$;


-- ====================================================================
-- L1. Trình duyệt (owner/manager) ghi thẳng returns.credited_at của phiếu TỰ LẬP đã hoàn thành
--     → revenue_date (ngày trừ doanh số thuần) nhảy sang kỳ khác, không qua RPC, ngày chứng từ
--     và hạn dòng công nợ âm vẫn như cũ.
--   Luật: CLAUDE.md "Tiền, tồn kho, trạng thái chứng từ chỉ đổi qua RPC"; "phiếu tự lập trừ vào
--     ngày hoàn thành … một luật khớp công nợ"; mig 214: "Phiếu đã qua nháp: chỉ ghi chú / lý do /
--     ngày chứng từ / người đứng tên".
--   Nghi: mig 214 dòng 127 cho `credited_at`, `revenue_date` vào danh sách chừa (v_cho), và
--     sync_return_credited_at (mig 188) giữ nguyên credited_at đã có khi return_date không đổi.
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_err text; v_rd date;
BEGIN
  d := pg_temp.moi('L1');
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 1), 'complete', true)));
  v_rd := pg_temp.rd(v_ret);
  v_err := pg_temp.thu(2, format('UPDATE returns SET credited_at = %L WHERE id = %L', '2025-01-15 10:00+07', v_ret));
  PERFORM pg_temp.ghi('L1', 'quản lý ghi thẳng credited_at phiếu đã hoàn thành: bị chặn HOẶC revenue_date giữ ngày hoàn thành',
    v_err IS NOT NULL OR pg_temp.rd(v_ret) = v_rd,
    format('lỗi %s; revenue_date trước %s → sau %s; return_date %s; hạn công nợ âm %s', COALESCE(v_err, 'không'), v_rd, pg_temp.rd(v_ret),
      (SELECT return_date FROM returns WHERE id = v_ret), (SELECT due_date FROM receivables WHERE return_id = v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- L2. Phiếu trả nhận ĐƠN GIÁ ÂM / THUẾ ÂM → credit âm → "trả hàng" lại TĂNG nợ khách.
--   Luật: CLAUDE.md "Tự lập: hoàn thành = nhập kho và trừ nợ … không gắn → dòng công nợ ÂM
--     receivables.return_id"; "Tiền … chỉ đổi qua RPC" (RPC là chốt kiểm).
--   Nghi: save_pos_return (mig 190/191) chỉ lọc quantity > 0, không kiểm unit_price / vat_rate;
--     bảng return_lines không có CHECK; _apply_return_adds (post_invoice) cũng vậy.
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_err text;
BEGIN
  d := pg_temp.moi('L2');
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
             'lines', pg_temp.tra(d, 1, 'thung', -500000), 'complete', true)));
  SELECT id INTO v_ret FROM returns WHERE customer_id = d.cust;
  PERFORM pg_temp.ghi('L2', 'phiếu tự lập đơn giá −500.000: bị từ chối, nợ khách không tăng',
    v_err IS NOT NULL AND pg_temp.no(d.cust) <= 0,
    format('lỗi %s; credit %s; dòng công nợ của phiếu %s; nợ khách %s', COALESCE(v_err, 'không'), pg_temp.cr(v_ret), pg_temp.no_tra(v_ret), pg_temp.no(d.cust)));
  BEGIN
    v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
               'lines', pg_temp.tra(d, 1, 'thung', 100000, -2))));
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := split_part(SQLERRM, ':', 1); v_ret := NULL;
  END;
  PERFORM pg_temp.ghi('L2', 'phiếu tự lập thuế −200%: bị từ chối (credit không được âm)',
    v_err IS NOT NULL,
    format('lỗi %s; credit phiếu %s', COALESCE(v_err, 'không'), pg_temp.cr(v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2', 'NỔ', false, SQLERRM);
END $t$;

DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_err text;
BEGIN
  d := pg_temp.moi('L2b');
  BEGIN
    v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 1, 'thung', -120000));
  EXCEPTION WHEN OTHERS THEN v_err := split_part(SQLERRM, ':', 1);
  END;
  PERFORM pg_temp.ghi('L2', 'xuất HĐ kèm hàng trả đơn giá −120.000: bị từ chối (không cộng nợ quá tổng HĐ)',
    v_err IS NOT NULL OR pg_temp.no_hd(v_inv) <= 700000,
    format('lỗi %s; tổng HĐ %s; nợ HĐ %s', COALESCE(v_err, 'không'), (SELECT total FROM sales_invoices WHERE id = v_inv), pg_temp.no_hd(v_inv)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- L3. Huỷ phiếu trả số lẻ: dòng ĐẢO ghi qty_in_transaction_uom = SL đã làm tròn (2 thùng) trong khi
--     dòng nhập ghi 1,5 thùng → thẻ kho (stock-history-drawer đọc qty_in_transaction_uom) hiện
--     "nhập 1,5 / xuất 2". Tồn cơ sở vẫn đúng (18 hộp).
--   Luật: CLAUDE.md "Quy đổi đơn vị … Cộng / hiện số lượng … quy về đơn vị cơ sở … ưu tiên hệ số chụp".
--   Nghi: cancel_return (mig 191 dòng ~230): VALUES (… l.quantity, l.quantity, …) — lấy cột int
--     `quantity` (round) thay vì `qty_in_transaction_uom` của dòng nhập.
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_nhap numeric; v_dao numeric;
BEGIN
  d := pg_temp.moi('L3');
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 1.5), 'complete', true)));
  PERFORM pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  SELECT sum(sel.qty_in_transaction_uom) FILTER (WHERE se.type = 'import'), sum(sel.qty_in_transaction_uom) FILTER (WHERE se.type = 'export')
    INTO v_nhap, v_dao
  FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes LIKE '%' || v_ret || '%';
  PERFORM pg_temp.ghi('L3', 'huỷ phiếu 1,5 thùng: SL giao dịch dòng đảo = dòng nhập (1,5)',
    v_nhap = v_dao, format('nhập %s thùng, đảo %s thùng; tồn P1 %s (1000 đúng)', v_nhap, v_dao, pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L3', 'NỔ', false, SQLERRM);
END $t$;

SELECT stt, buoc, ok, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS xanh, count(*) FILTER (WHERE NOT ok) AS do FROM kq;
ROLLBACK;
