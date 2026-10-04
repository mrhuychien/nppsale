-- Mig 227: các thao tác HỢP LỆ vẫn chạy sau khi khoá (psql -f trên Postgres ở máy, BEGIN … ROLLBACK).
--   Công nợ NCC: thêm / sửa / đổi trạng thái / xoá khoản chưa trả, nợ đầu kỳ NCC, Ghi trả NCC (RPC),
--   xác nhận phiếu chi, phiếu nhập kho kèm công nợ NCC. Phiếu trả đã hoàn thành: đổi ngày chứng từ
--   (credited_at / revenue_date đi theo). Huỷ phiếu nhập kho thường vẫn được. Sửa HĐ khi không ai
--   nghỉ việc: người giữ nợ = người của HĐ; NV nghỉ mà NPP chưa phân lại: nợ vẫn NPP giữ, giữ mốc cũ.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.ghi(b int, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), COALESCE(g, '')) $f$;
CREATE FUNCTION pg_temp.vai(n int) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-00000000000' || n, true) $f$;
-- Chạy thử một câu, trả lỗi hoặc NULL (không rollback phần đã chạy khi thành công).
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;
-- Lùi mốc "về NPP" của nợ một HĐ (để phân biệt GIỮ mốc cũ với đặt lại now()).
CREATE FUNCTION pg_temp.lui_moc(p_inv uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$
BEGIN
  PERFORM set_config('npp.giao_cong_no', 'on', true);
  UPDATE receivables SET ve_npp_luc = ve_npp_luc - interval '3 day' WHERE invoice_id = p_inv;
  PERFORM set_config('npp.giao_cong_no', '', true);
END $f$;

DO $d$ DECLARE s uuid; BEGIN
  INSERT INTO suppliers (org_id, name, code) VALUES ('a0000000-0000-0000-0000-000000000001', 'NCC thử 227', 'NCC-227')
  RETURNING id INTO s;
  INSERT INTO ctx VALUES ('NCC', s);
  INSERT INTO auth.users (id, email) VALUES ('e2270000-0000-0000-0000-00000000000a', 'nv227@x.vn');
  INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES ('e2270000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'NV 227', 'sales', true, 100); -- giá thử 10.000 > giá bảng 9.500 (mig 229)
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'LO-227', current_date + 300, 100, 100, 3000, 'sale', now());
  FOR i IN 1 .. 2 LOOP
    INSERT INTO customers (org_id, store_name, owner_name, phone, address)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'KH 227-' || i, 'Anh', '0977227' || lpad(i::text, 3, '0'), 'x') RETURNING id INTO s;
    INSERT INTO ctx VALUES ('KH' || i, s);
  END LOOP;
END $d$;
SET LOCAL ROLE authenticated;

-- 1. Công nợ NCC — màn hình hợp lệ (kế toán)
DO $t$ DECLARE v_e uuid; v_p uuid; v_ob uuid; v_pay uuid; v_err text; BEGIN
  PERFORM pg_temp.vai(5);
  SELECT entry_id, payable_id INTO v_e, v_p FROM post_stock_import(jsonb_build_object('entry_code', 'NK-227-A',
    'supplier_id', pg_temp.c('NCC'), 'payable', jsonb_build_object('amount', 300000, 'invoice_number', 'HD-NCC-1'),
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'base_qty', 10, 'unit_name', 'lon', 'base_cost', 30000))));
  PERFORM pg_temp.ghi(1, 'phiếu nhập kho kèm công nợ NCC (RPC) vẫn sinh khoản nợ', v_p IS NOT NULL, NULL);
  PERFORM pg_temp.vai(3);
  -- payables/new: thêm khoản chưa trả, gắn phiếu nhập
  v_err := pg_temp.thu(format($q$INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status)
    VALUES ('a0000000-0000-0000-0000-000000000001', %L, %L, 'TAY-1', 100000, 0, 'open')$q$, pg_temp.c('NCC'), v_e));
  PERFORM pg_temp.ghi(1, 'thêm công nợ NCC chưa trả (gắn phiếu nhập) được', v_err IS NULL, v_err);
  -- sửa thông tin, đánh dấu quá hạn, mở lại, xoá
  v_err := pg_temp.thu(format($q$UPDATE payables SET invoice_number = 'TAY-1b', due_date = current_date + 5, notes = 'x' WHERE invoice_number = 'TAY-1'$q$));
  PERFORM pg_temp.ghi(1, 'sửa số HĐ / hạn / ghi chú được', v_err IS NULL, v_err);
  v_err := pg_temp.thu($q$UPDATE payables SET status = 'overdue' WHERE invoice_number = 'TAY-1b'$q$);
  PERFORM pg_temp.ghi(1, 'đánh dấu quá hạn được', v_err IS NULL, v_err);
  v_err := pg_temp.thu($q$UPDATE payables SET status = 'open' WHERE invoice_number = 'TAY-1b'$q$);
  PERFORM pg_temp.ghi(1, 'đặt lại mở (chưa trả) được', v_err IS NULL, v_err);
  v_err := pg_temp.thu($q$UPDATE payables SET status = 'paid' WHERE invoice_number = 'TAY-1b'$q$);
  PERFORM pg_temp.ghi(1, 'đặt "đã trả" khi chưa trả đồng nào: bị chặn', v_err = 'NO_NCC_KHOA', v_err);
  v_err := pg_temp.thu($q$DELETE FROM payables WHERE invoice_number = 'TAY-1b'$q$);
  PERFORM pg_temp.ghi(1, 'xoá khoản chưa trả được', v_err IS NULL AND NOT EXISTS (SELECT 1 FROM payables WHERE invoice_number = 'TAY-1b'), v_err);
  -- Nợ đầu kỳ NCC: thêm, sửa số tiền + trạng thái, xoá
  INSERT INTO payables (org_id, supplier_id, amount, paid, status, opening_balance, notes)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('NCC'), 500000, 0, 'open', true, 'đầu kỳ') RETURNING id INTO v_ob;
  v_err := pg_temp.thu(format('UPDATE payables SET amount = 400000, due_date = current_date, notes = %L WHERE id = %L', 'sửa', v_ob));
  PERFORM pg_temp.ghi(1, 'nợ đầu kỳ NCC: sửa số tiền được', v_err IS NULL AND (SELECT amount FROM payables WHERE id = v_ob) = 400000, v_err);
  -- Ghi trả qua RPC rồi xác nhận phiếu chi
  PERFORM record_payable_payment(v_ob, 150000, 'cash', NULL);
  SELECT id INTO v_pay FROM payable_payments WHERE payable_id = v_ob;
  v_err := pg_temp.thu(format('UPDATE payable_payments SET verified_by = auth.uid(), verified_at = now() WHERE id = %L', v_pay));
  PERFORM pg_temp.ghi(1, 'Ghi trả NCC (RPC) + xác nhận phiếu chi được', v_err IS NULL
    AND (SELECT paid FROM payables WHERE id = v_ob) = 150000, v_err);
  v_err := pg_temp.thu(format('UPDATE payable_payments SET amount = 1 WHERE id = %L', v_pay));
  PERFORM pg_temp.ghi(1, 'sửa số tiền phiếu chi: bị chặn', v_err = 'CHI_NCC_KHOA', v_err);
  v_err := pg_temp.thu(format('UPDATE payables SET status = %L WHERE id = %L', 'overdue', v_ob));
  PERFORM pg_temp.ghi(1, 'khoản trả một phần: đánh dấu quá hạn được', v_err IS NULL, v_err);
  v_err := pg_temp.thu(format('UPDATE payables SET status = %L WHERE id = %L', 'open', v_ob));
  PERFORM pg_temp.ghi(1, 'khoản đã trả một phần: "mở" bị chặn', v_err = 'NO_NCC_KHOA', v_err);
  v_err := pg_temp.thu(format('UPDATE payables SET amount = 150000, status = %L WHERE id = %L', 'paid', v_ob));
  PERFORM pg_temp.ghi(1, 'nợ đầu kỳ: hạ số tiền bằng số đã trả + "đã trả" được', v_err IS NULL, v_err);
  v_err := pg_temp.thu(format('DELETE FROM payables WHERE id = %L', v_ob));
  PERFORM pg_temp.ghi(1, 'xoá khoản đã trả: bị chặn', v_err = 'NO_NCC_KHOA', v_err);
  v_err := pg_temp.thu(format('UPDATE payables SET amount = 1 WHERE id = %L', v_p));
  PERFORM pg_temp.ghi(1, 'sửa số tiền khoản của phiếu nhập: bị chặn', v_err = 'NO_NCC_KHOA', v_err);
  -- Xoá khoản của phiếu nhập (chưa trả) rồi huỷ phiếu nhập — đường cancel_stock_entry bảo làm.
  v_err := pg_temp.thu(format('DELETE FROM payables WHERE id = %L', v_p));
  PERFORM pg_temp.vai(5);
  v_err := COALESCE(v_err, pg_temp.thu(format('SELECT cancel_stock_entry(%L, %L)', v_e, 'nhập nhầm')));
  PERFORM pg_temp.ghi(1, 'xoá công nợ NCC chưa trả rồi huỷ phiếu nhập thường: được',
    v_err IS NULL AND (SELECT status FROM stock_entries WHERE id = v_e) = 'cancelled', v_err);
END $t$;

-- 2. Phiếu trả đã hoàn thành: đổi ngày chứng từ được, credited_at đi theo
DO $t$ DECLARE v_ret uuid; v_err text; v_c0 timestamptz; BEGIN
  PERFORM pg_temp.vai(1);
  v_ret := save_pos_return(jsonb_build_object('customer_id', (SELECT id FROM customers ORDER BY id LIMIT 1), 'complete', true,
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000))));
  SELECT credited_at INTO v_c0 FROM returns WHERE id = v_ret;
  PERFORM pg_temp.vai(2);
  v_err := pg_temp.thu(format('UPDATE returns SET return_date = return_date - 3, notes = %L WHERE id = %L', 'lùi ngày', v_ret));
  PERFORM pg_temp.ghi(2, 'quản lý đổi ngày chứng từ phiếu trả đã hoàn thành được; ngày trừ doanh số đi theo',
    v_err IS NULL AND (SELECT revenue_date = return_date AND credited_at <> v_c0 FROM returns WHERE id = v_ret),
    COALESCE(v_err, '') || (SELECT format(' return_date %s revenue_date %s', return_date, revenue_date) FROM returns WHERE id = v_ret));
  v_err := pg_temp.thu(format('UPDATE returns SET credited_at = now() - interval %L WHERE id = %L', '400 days', v_ret));
  PERFORM pg_temp.ghi(2, 'ghi thẳng credited_at: bị chặn', v_err = 'PHIEU_TRA_KHOA', v_err);
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', (SELECT id FROM customers ORDER BY id LIMIT 1),
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 0, 'is_exchange', true)))));
  PERFORM pg_temp.ghi(2, 'phiếu trả hàng đổi giá 0 vẫn lập được', v_err IS NULL, v_err);
END $t$;

-- 3. Sửa HĐ: người giữ nợ
DO $t$ DECLARE v_kh uuid; v_o record; v_l uuid; h uuid; h2 uuid; v_nv uuid; v_co timestamptz; v_co0 timestamptz; BEGIN
  FOR i IN 1 .. 2 LOOP
    v_kh := pg_temp.c('KH' || i);
    PERFORM set_config('request.jwt.claim.sub', 'e2270000-0000-0000-0000-00000000000a', true);
    SELECT * INTO v_o FROM create_order_with_lines(jsonb_build_object('client_request_id', gen_random_uuid(),
      'order', jsonb_build_object('customer_id', v_kh, 'status', 'submitted', 'payment_terms', 'NET30', 'subtotal', 100000, 'total', 100000),
      'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 10,
        'unit_price', 10000, 'line_total', 100000, 'conversion_factor', 1))));
    SELECT id INTO v_l FROM sales_order_lines WHERE order_id = v_o.order_id;
    PERFORM pg_temp.vai(1);
    SELECT invoice_id INTO h FROM post_invoice(jsonb_build_object('order_id', v_o.order_id, 'allow_oversell', true,
      'lines', jsonb_build_array(jsonb_build_object('order_line_id', v_l, 'product_id', 'c0000000-0000-0000-0000-000000000002',
        'unit_name', 'lon', 'conversion_factor', 1, 'quantity', 10, 'unit_price', 10000, 'vat_rate', 0))));
    INSERT INTO ctx VALUES ('H' || i, h), ('O' || i, v_o.order_id);
  END LOOP;
  -- 3a. không ai nghỉ: tờ mới do NV 227 giữ
  SELECT invoice_id INTO h2 FROM reissue_invoice(pg_temp.c('H1'), jsonb_build_object('lines', (SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id,
    'product_id', product_id, 'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
    'unit_price', unit_price, 'vat_rate', vat_rate)) FROM sales_invoice_lines WHERE invoice_id = pg_temp.c('H1'))));
  SELECT sales_user_id, ve_npp_luc INTO v_nv, v_co FROM receivables WHERE invoice_id = h2;
  PERFORM pg_temp.ghi(3, 'Sửa HĐ thường: nợ tờ mới vẫn của NV lập, không cờ NPP',
    v_nv = 'e2270000-0000-0000-0000-00000000000a' AND v_co IS NULL, format('%s / %s', v_nv, v_co));
  -- 3b. NV nghỉ, NPP chưa phân lại: Sửa HĐ → nợ vẫn NPP giữ, giữ mốc về NPP cũ
  PERFORM cho_nhan_vien_nghi('e2270000-0000-0000-0000-00000000000a');
  PERFORM pg_temp.lui_moc(pg_temp.c('H2'));
  SELECT ve_npp_luc INTO v_co0 FROM receivables WHERE invoice_id = pg_temp.c('H2');
  SELECT invoice_id INTO h2 FROM reissue_invoice(pg_temp.c('H2'), jsonb_build_object('lines', (SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id,
    'product_id', product_id, 'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', 8,
    'unit_price', unit_price, 'vat_rate', vat_rate)) FROM sales_invoice_lines WHERE invoice_id = pg_temp.c('H2'))));
  SELECT sales_user_id, ve_npp_luc INTO v_nv, v_co FROM receivables WHERE invoice_id = h2;
  PERFORM pg_temp.ghi(3, 'NV nghỉ, NPP chưa phân lại: Sửa HĐ → nợ vẫn NPP giữ (mốc cũ), số mới 80.000',
    v_nv IS NULL AND v_co0 < now() - interval '1 day' AND v_co = v_co0 AND (SELECT amount FROM receivables WHERE invoice_id = h2) = 80000,
    format('nv %s, mốc %s / cũ %s', v_nv, v_co, v_co0));
  PERFORM pg_temp.ghi(3, 'HĐ tờ mới vẫn ghi doanh số cho NV cũ',
    (SELECT sales_user_id FROM sales_invoices WHERE id = h2) = 'e2270000-0000-0000-0000-00000000000a', NULL);
END $t$;

RESET ROLE;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
