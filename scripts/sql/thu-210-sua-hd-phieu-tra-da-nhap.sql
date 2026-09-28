-- Kịch bản thử mig 210 trên Postgres ở máy (psql -f): T0 hỏi khi chưa chọn, T1 Có = huỷ nhập → sửa → nhập lại đúng kho, T2 Không = giữ phiếu nhập gắn tờ mới.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION pg_temp.dung(OUT v_inv uuid, OUT v_ret uuid, OUT v_line uuid) AS $d$
DECLARE OWNER uuid := 'e0000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, false);
  UPDATE batches SET qty_on_hand = qty_on_hand + 10000 WHERE warehouse_zone = 'sale';
  SELECT si.id INTO v_inv FROM sales_invoices si
  WHERE si.status = 'posted' AND NOT EXISTS (SELECT 1 FROM cash_receipt_lines c WHERE c.invoice_id = si.id)
  ORDER BY si.created_at LIMIT 1;
  UPDATE returns SET status = 'cancelled' WHERE invoice_id = v_inv;
  INSERT INTO returns (org_id, customer_id, order_id, invoice_id, requested_by, status, reason, credit_with_invoice)
  SELECT org_id, customer_id, order_id, id, OWNER, 'submitted', 'damaged', true FROM sales_invoices WHERE id = v_inv
  RETURNING id INTO v_ret;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  SELECT v_ret, l.product_id, l.unit_name, 2, 50000, 0, 100000, false FROM sales_invoice_lines l WHERE l.invoice_id = v_inv LIMIT 1
  RETURNING id INTO v_line;
  UPDATE returns SET credit_note_amount = 100000 WHERE id = v_ret;
  PERFORM _wf2b_recompute_receivable(v_inv);
  PERFORM complete_return(v_ret, 'date');
END $d$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.dong(p_inv uuid) RETURNS jsonb AS $d$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'is_exchange', is_exchange))
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$d$ LANGUAGE sql;

-- T0: không chọn → hỏi
BEGIN;
DO $t$
DECLARE d record; r record; ok boolean := false;
BEGIN
  SELECT * INTO d FROM pg_temp.dung();
  BEGIN
    SELECT * INTO r FROM reissue_invoice(d.v_inv, jsonb_build_object('lines', pg_temp.dong(d.v_inv), 'allow_oversell', true));
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM LIKE 'REISSUE_RETURN_STOCKED%';
    RAISE NOTICE 'T0 lỗi: %', SQLERRM;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T0 không hỏi'; END IF;
  RAISE NOTICE '--- T0 đạt ---';
END $t$;
ROLLBACK;

-- T1: Có → huỷ nhập, sửa SL trả 2 → 1, nhập lại đúng kho cũ
BEGIN;
DO $t$
DECLARE d record; r record; v_rec numeric; v_tong numeric; v_ton_truoc numeric; v_ton_sau numeric; v_pid uuid; v_conv numeric;
BEGIN
  SELECT * INTO d FROM pg_temp.dung();
  SELECT rl.product_id INTO v_pid FROM return_lines rl WHERE rl.id = d.v_line;
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_ton_truoc FROM batches WHERE product_id = v_pid AND warehouse_zone = 'date';
  SELECT * INTO r FROM reissue_invoice(d.v_inv, jsonb_build_object('lines', pg_temp.dong(d.v_inv), 'allow_oversell', true,
     'tra_da_nhap', 'lam_lai', 'return_edits', jsonb_build_array(jsonb_build_object('line_id', d.v_line, 'quantity', 1))));
  IF (SELECT status FROM returns WHERE id = d.v_ret) <> 'completed' THEN RAISE EXCEPTION 'T1 phiếu không hoàn thành lại: %', (SELECT status FROM returns WHERE id = d.v_ret); END IF;
  IF (SELECT invoice_id FROM returns WHERE id = d.v_ret) IS DISTINCT FROM r.invoice_id THEN RAISE EXCEPTION 'T1 phiếu không bám tờ mới'; END IF;
  IF (SELECT destination_zone FROM returns WHERE id = d.v_ret) <> 'date' THEN RAISE EXCEPTION 'T1 sai kho'; END IF;
  IF (SELECT credit_note_amount FROM returns WHERE id = d.v_ret) <> 50000 THEN RAISE EXCEPTION 'T1 tiền phiếu %', (SELECT credit_note_amount FROM returns WHERE id = d.v_ret); END IF;
  SELECT COALESCE(sum(qty_on_hand),0) INTO v_ton_sau FROM batches WHERE product_id = v_pid AND warehouse_zone = 'date';
  SELECT COALESCE((SELECT pu.conversion FROM product_units pu JOIN return_lines rl ON rl.product_id = pu.product_id AND rl.unit_name = pu.unit_name WHERE rl.id = d.v_line), 1) INTO v_conv;
  -- trước: đã nhập 2; sau: đảo 2, nhập 1 → giảm đúng 1 đơn vị dòng
  IF v_ton_truoc - v_ton_sau <> v_conv THEN RAISE EXCEPTION 'T1 tồn kho date lệch: trước % sau % (hệ số %)', v_ton_truoc, v_ton_sau, v_conv; END IF;
  SELECT amount INTO v_rec FROM receivables WHERE invoice_id = r.invoice_id;
  SELECT total INTO v_tong FROM sales_invoices WHERE id = r.invoice_id;
  IF v_rec <> v_tong - 50000 THEN RAISE EXCEPTION 'T1 công nợ % ≠ % − 50000', v_rec, v_tong; END IF;
  IF (SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || d.v_ret) <> 1 THEN RAISE EXCEPTION 'T1 số phiếu nhập còn hiệu lực ≠ 1'; END IF;
  RAISE NOTICE '--- T1 đạt (công nợ %, tồn date giảm %) ---', v_rec, v_ton_truoc - v_ton_sau;
END $t$;
ROLLBACK;

-- T2: Không → giữ phiếu nhập, gắn tờ mới
BEGIN;
DO $t$
DECLARE d record; r record; v_rec numeric; v_tong numeric; v_nhap int;
BEGIN
  SELECT * INTO d FROM pg_temp.dung();
  SELECT count(*) INTO v_nhap FROM stock_entries WHERE notes LIKE '%' || d.v_ret || '%';
  SELECT * INTO r FROM reissue_invoice(d.v_inv, jsonb_build_object('lines', pg_temp.dong(d.v_inv), 'allow_oversell', true, 'tra_da_nhap', 'giu'));
  IF (SELECT status FROM returns WHERE id = d.v_ret) <> 'completed' THEN RAISE EXCEPTION 'T2 phiếu đổi trạng thái'; END IF;
  IF (SELECT invoice_id FROM returns WHERE id = d.v_ret) IS DISTINCT FROM r.invoice_id THEN RAISE EXCEPTION 'T2 phiếu không bám tờ mới'; END IF;
  IF NOT (SELECT credit_with_invoice FROM returns WHERE id = d.v_ret) THEN RAISE EXCEPTION 'T2 mất dấu tự sinh'; END IF;
  IF (SELECT count(*) FROM stock_entries WHERE notes LIKE '%' || d.v_ret || '%') <> v_nhap THEN RAISE EXCEPTION 'T2 đụng phiếu kho'; END IF;
  SELECT amount INTO v_rec FROM receivables WHERE invoice_id = r.invoice_id;
  SELECT total INTO v_tong FROM sales_invoices WHERE id = r.invoice_id;
  IF v_rec <> v_tong - 100000 THEN RAISE EXCEPTION 'T2 công nợ % ≠ % − 100000', v_rec, v_tong; END IF;
  RAISE NOTICE '--- T2 đạt (công nợ %) ---', v_rec;
END $t$;
ROLLBACK;
