-- Mig 214: các thao tác màn hình HỢP LỆ vẫn chạy dưới vai authenticated (psql -f trên Postgres ở máy).
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_rc uuid; v_ret uuid; v_cust uuid; v_prod uuid; v_lt numeric; v_pay uuid; v_done uuid;
BEGIN
  SELECT id INTO v_cust FROM customers LIMIT 1;
  SELECT id INTO v_prod FROM products LIMIT 1;
  -- Nợ đầu kỳ: thêm, sửa số, xoá
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, opening_balance)
  VALUES (public.user_org_id(), v_cust, 500000, 0, current_date, 'open', true) RETURNING id INTO v_rc;
  UPDATE receivables SET amount = 300000, note = 'sửa' WHERE id = v_rc;
  UPDATE receivables SET status = 'overdue' WHERE id = v_rc;
  DELETE FROM receivables WHERE id = v_rc;
  -- Phiếu trả nháp: lập, dòng (thành tiền máy chủ tự tính), sửa, xoá
  INSERT INTO returns (org_id, customer_id, requested_by, reason, status)
  VALUES (public.user_org_id(), v_cust, auth.uid(), 'damaged', 'draft') RETURNING id INTO v_ret;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  VALUES (v_ret, v_prod, 'hộp', 2, 10000, 0.1, 999999, false);
  SELECT line_total INTO v_lt FROM return_lines WHERE return_id = v_ret;
  IF v_lt <> 22000 THEN RAISE EXCEPTION 'thành tiền không tự tính: %', v_lt; END IF;
  UPDATE returns SET notes = 'x', credit_note_amount = 22000 WHERE id = v_ret;
  DELETE FROM return_lines WHERE return_id = v_ret;
  DELETE FROM returns WHERE id = v_ret;
  -- Phiếu đã hoàn thành: sửa ghi chú được
  SELECT id INTO v_done FROM returns WHERE status = 'completed' LIMIT 1;
  IF v_done IS NOT NULL THEN UPDATE returns SET notes = 'ghi chú' WHERE id = v_done; END IF;
  -- Xác nhận payment
  SELECT id INTO v_pay FROM payments LIMIT 1;
  IF v_pay IS NOT NULL THEN UPDATE payments SET verified_by = auth.uid(), verified_at = now() WHERE id = v_pay; END IF;
  RAISE NOTICE '--- thao tác hợp lệ: đạt (thành tiền tự tính %) ---', v_lt;
END $t$;
ROLLBACK;
