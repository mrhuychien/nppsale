-- Kịch bản thử mig 211 (psql -f trên Postgres ở máy): chọn ngày nhập kho phiếu trả tự sinh.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION pg_temp.dung(p_tu_sinh boolean, OUT v_inv uuid, OUT v_ret uuid) AS $d$
DECLARE OWNER uuid := 'e0000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, false);
  SELECT si.id INTO v_inv FROM sales_invoices si WHERE si.status = 'posted' ORDER BY si.created_at LIMIT 1;
  UPDATE returns SET status = 'cancelled' WHERE invoice_id = v_inv;
  UPDATE sales_invoices SET invoice_date = current_date - 5 WHERE id = v_inv;
  INSERT INTO returns (org_id, customer_id, order_id, invoice_id, requested_by, status, reason, credit_with_invoice)
  SELECT org_id, customer_id, order_id, id, OWNER, 'submitted', 'damaged', p_tu_sinh FROM sales_invoices WHERE id = v_inv
  RETURNING id INTO v_ret;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  SELECT v_ret, l.product_id, l.unit_name, 1, 50000, 0, 50000, false FROM sales_invoice_lines l WHERE l.invoice_id = v_inv LIMIT 1;
END $d$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.loi(p_sql text, p_ma text) RETURNS boolean AS $d$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM LIKE p_ma || '%'; END $d$ LANGUAGE plpgsql;

BEGIN;
DO $t$
DECLARE d record; v_entry uuid; v_post date; v_done date; v_rev date; v_hd date;
BEGIN
  SELECT * INTO d FROM pg_temp.dung(true);
  IF NOT pg_temp.loi(format('SELECT * FROM complete_return(%L, %L, %L)', d.v_ret, 'sale', current_date + 1), 'NGAY_NHAP_TUONG_LAI') THEN RAISE EXCEPTION 'N1 không chặn ngày tương lai'; END IF;
  IF NOT pg_temp.loi(format('SELECT * FROM complete_return(%L, %L, %L)', d.v_ret, 'sale', current_date - 6), 'NGAY_NHAP_TRUOC_HOA_DON') THEN RAISE EXCEPTION 'N2 không chặn trước ngày HĐ'; END IF;
  SELECT entry_id INTO v_entry FROM complete_return(d.v_ret, 'date', current_date - 2);
  SELECT (posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date INTO v_post FROM stock_entries WHERE id = v_entry;
  SELECT (completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, revenue_date INTO v_done, v_rev FROM returns WHERE id = d.v_ret;
  SELECT invoice_date INTO v_hd FROM sales_invoices WHERE id = d.v_inv;
  IF v_post <> current_date - 2 THEN RAISE EXCEPTION 'N3 ngày phiếu nhập %', v_post; END IF;
  IF v_done <> current_date - 2 THEN RAISE EXCEPTION 'N3 ngày hoàn thành %', v_done; END IF;
  IF v_rev <> v_hd THEN RAISE EXCEPTION 'N4 doanh số rời ngày HĐ: % ≠ %', v_rev, v_hd; END IF;
  IF (SELECT destination_zone FROM returns WHERE id = d.v_ret) <> 'date' THEN RAISE EXCEPTION 'N3 sai kho'; END IF;
  RAISE NOTICE '--- N1–N4 đạt (nhập ngày %, doanh số ngày HĐ %) ---', v_post, v_rev;
END $t$;
ROLLBACK;

BEGIN;
DO $t$
DECLARE d record;
BEGIN
  SELECT * INTO d FROM pg_temp.dung(false);
  IF NOT pg_temp.loi(format('SELECT * FROM complete_return(%L, %L, %L)', d.v_ret, 'sale', current_date - 1), 'NGAY_NHAP_CHI_TU_SINH') THEN RAISE EXCEPTION 'N5 phiếu tự lập chọn được ngày'; END IF;
  -- Bản 2 tham số và bản 3 tham số với ngày NULL vẫn chạy như cũ.
  PERFORM complete_return(d.v_ret, 'sale');
  IF (SELECT status FROM returns WHERE id = d.v_ret) <> 'completed' THEN RAISE EXCEPTION 'N6 bản 2 tham số hỏng'; END IF;
  RAISE NOTICE '--- N5–N6 đạt ---';
END $t$;
ROLLBACK;
