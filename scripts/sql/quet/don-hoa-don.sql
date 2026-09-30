-- QUÉT LUỒNG ĐƠN HÀNG ↔ HOÁ ĐƠN (xuôi + ngược) và ảnh hưởng lên CÔNG NỢ / KHO.
-- Chạy trên bản sao DB cục bộ (KHÔNG chạy trên Supabase thật — mỗi kịch bản BEGIN … ROLLBACK
-- nhưng vẫn đụng dữ liệu thật trong giao dịch):
--   PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres psql -d q_don -f scripts/sql/quet/don-hoa-don.sql
-- Mỗi kịch bản in NOTICE 'OK Sxx …' hoặc 'LỖI Sxx …' (hoặc 'CHẶN Sxx …' = bị chặn đúng thiết kế).
-- Bất biến kiểm sau mỗi bước:
--   INV-1 mỗi HĐ posted có đúng 1 công nợ = total − Σ khoản có phiếu trả tính cho nó; HĐ huỷ không còn công nợ.
--   INV-2 Δ Σ batches.qty_on_hand = Δ Σ dòng phiếu kho posted (nhập − xuất, đơn vị cơ sở).
--   INV-3 trạng thái đơn khớp hoá đơn (mig 217: có HĐ posted = completed, không còn xuất một phần /
--         đóng đơn); invoiced_qty = Σ SL hoá đơn posted (quy đơn vị dòng đơn); một đơn tối đa 1 HĐ posted.
--   INV-4 nợ khách = Σ HĐ posted − Σ khoản có − Σ tiền đã thu (+ đầu kỳ / dòng âm phiếu trả).
--   INV-5 doanh thu = Σ total HĐ posted theo invoice_date; tờ bị thay không đếm hai lần.
\set ON_ERROR_STOP off
SET client_min_messages = notice;

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA extensions TO authenticated;

-- ============================ HÀM PHỤ (pg_temp) ============================
CREATE OR REPLACE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;
CREATE OR REPLACE FUNCTION pg_temp.p(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$f$ SELECT ('c0000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $f$;

CREATE OR REPLACE FUNCTION pg_temp.la(p_n int) RETURNS void LANGUAGE sql AS
$f$ SELECT set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $f$;

-- Ghi nhận lỗi của kịch bản đang chạy.
CREATE OR REPLACE FUNCTION pg_temp.dat(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    PERFORM set_config('q.loi', current_setting('q.loi', true) || ' | ' || p_msg, false);
  END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.bat_dau() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('q.loi', '', false);
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.ket(p_id text, p_note text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
DECLARE e text := COALESCE(current_setting('q.loi', true), '');
BEGIN
  IF e = '' THEN RAISE NOTICE 'OK % %', p_id, p_note;
  ELSE RAISE NOTICE 'LỖI % % %', p_id, p_note, e; END IF;
END $f$;
-- Chạy một câu lệnh, trả mã lỗi (NULL = chạy được).
CREATE OR REPLACE FUNCTION pg_temp.thu(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;

-- Dữ liệu dựng cho mỗi kịch bản: một khách mới + lô hàng. Lô P02 có 2 lô (30 cũ, 1000 mới) để FIFO chẻ lô.
CREATE OR REPLACE FUNCTION pg_temp.dung() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_c uuid; ORG uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  PERFORM pg_temp.la(1);
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, payment_terms, credit_limit)
  VALUES (ORG, 'Quét ' || left(gen_random_uuid()::text, 6), 'Chủ', '09' || floor(random() * 1e8)::text, 'HN', 'NET30', 0)
  RETURNING id INTO v_c;
  IF NOT EXISTS (SELECT 1 FROM batches WHERE batch_code = 'Q-02A') THEN
    INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at) VALUES
      (ORG, pg_temp.p(2), 'Q-02A', current_date + 400, 30, 30, 4000, 'sale', now() - interval '3 days'),
      (ORG, pg_temp.p(2), 'Q-02B', current_date + 500, 1000, 1000, 4500, 'sale', now() - interval '1 days'),
      (ORG, pg_temp.p(3), 'Q-03A', current_date + 500, 1000, 1000, 7000, 'sale', now() - interval '1 days'),
      (ORG, pg_temp.p(6), 'Q-06A', current_date + 500, 3000, 3000, 3000, 'sale', now() - interval '1 days'),
      (ORG, pg_temp.p(3), 'Q-03D', current_date + 500, 0, 0, 7000, 'date', now() - interval '1 days');
    UPDATE batches SET qty_on_hand = qty_on_hand + 1000 WHERE product_id = pg_temp.p(1) AND warehouse_zone = 'sale';
  END IF;
  PERFORM set_config('q.ton0', (SELECT sum(qty_on_hand)::text FROM batches), false);
  PERFORM set_config('q.sk0', pg_temp.so_kho()::text, false);
  RETURN v_c;
END $f$;

-- Σ có dấu của dòng phiếu kho đã ghi sổ (đơn vị cơ sở).
CREATE OR REPLACE FUNCTION pg_temp.so_kho() RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(CASE se.type WHEN 'import' THEN sel.qty_in_base_uom
                                   WHEN 'export' THEN -sel.qty_in_base_uom ELSE 0 END), 0)
  FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
  WHERE se.status = 'posted'
$f$;
CREATE OR REPLACE FUNCTION pg_temp.lo() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_object_agg(id::text, qty_on_hand::numeric) FROM batches
$f$;

-- Một dòng đơn: số SP, đơn vị, SL, giá, VAT.
CREATE OR REPLACE FUNCTION pg_temp.dl(p_sp int, p_dv text, p_sl numeric, p_gia numeric, p_vat numeric DEFAULT 0, p_ck numeric DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('product_id', pg_temp.p(p_sp), 'unit_name', p_dv, 'quantity', p_sl,
    'unit_price', p_gia, 'line_discount', p_ck, 'line_total', p_sl * p_gia, 'vat_rate', p_vat,
    'conversion_factor', COALESCE((SELECT conversion FROM product_units WHERE product_id = pg_temp.p(p_sp) AND unit_name = p_dv), 1))
$f$;

-- Tạo đơn (nháp) rồi gửi duyệt ('submitted') nếu p_gui.
CREATE OR REPLACE FUNCTION pg_temp.don(p_kh uuid, p_lines jsonb, p_gui boolean DEFAULT true, p_tra jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  PERFORM pg_temp.la(1);
  SELECT order_id INTO v FROM create_order_with_lines(jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('customer_id', p_kh, 'payment_terms', 'NET30', 'sales_user_id', pg_temp.u(4)),
    'lines', p_lines) ||
    CASE WHEN p_tra IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object('returns', jsonb_build_object('reason', 'damaged'), 'return_lines', p_tra) END);
  IF p_gui THEN UPDATE sales_orders SET status = 'submitted' WHERE id = v; END IF;
  RETURN v;
END $f$;

-- Dòng hoá đơn dựng từ dòng đơn (thứ tự theo sku, đơn vị); p_sl[i] NULL = phần còn lại, 0 = bỏ.
CREATE OR REPLACE FUNCTION pg_temp.dong_hd(p_don uuid, p_sl numeric[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('order_line_id', x.id, 'product_id', x.product_id, 'unit_name', x.unit_name,
     'conversion_factor', x.conversion_factor, 'quantity', COALESCE(p_sl[x.i], x.quantity - x.invoiced_qty),
     'unit_price', x.unit_price, 'line_discount', x.line_discount, 'vat_rate', COALESCE(x.vat_rate, 0), 'is_exchange', false)
     ORDER BY x.i), '[]'::jsonb)
  FROM (SELECT sol.*, row_number() OVER (ORDER BY pr.sku, sol.unit_name) AS i
        FROM sales_order_lines sol JOIN products pr ON pr.id = sol.product_id WHERE sol.order_id = p_don) x
$f$;
-- Dòng của một hoá đơn hiện có (để lập lại).
CREATE OR REPLACE FUNCTION pg_temp.dong_cua_hd(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id, 'unit_name', unit_name,
     'conversion_factor', conversion_factor, 'quantity', quantity, 'unit_price', unit_price,
     'line_discount', line_discount, 'vat_rate', vat_rate, 'is_exchange', is_exchange) ORDER BY sort_order)
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;

CREATE OR REPLACE FUNCTION pg_temp.hd(p_don uuid, p_lines jsonb, p_them jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT invoice_id INTO v FROM post_invoice(jsonb_build_object('order_id', p_don, 'lines', p_lines) || p_them);
  RETURN v;
END $f$;

-- ---------------- BẤT BIẾN ----------------
-- INV-1 + INV-3 cho một đơn.
CREATE OR REPLACE FUNCTION pg_temp.kiem_don(p_don uuid, p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE i record; l record; v_n int; v_amt numeric; v_cr numeric; v_st text; v_cur text; v_open int; v_inv int;
BEGIN
  FOR i IN SELECT * FROM sales_invoices WHERE order_id = p_don LOOP
    SELECT count(*), max(amount) INTO v_n, v_amt FROM receivables WHERE invoice_id = i.id;
    IF i.status = 'posted' THEN
      SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_cr FROM returns r
      WHERE r.invoice_id = i.id AND r.applied_receipt_id IS NULL
        AND ((r.credit_with_invoice AND r.status IN ('submitted', 'completed')) OR (NOT r.credit_with_invoice AND r.status = 'completed'));
      PERFORM pg_temp.dat(v_n = 1, format('%s INV-1 HĐ %s có %s công nợ', p_tag, i.invoice_code, v_n));
      PERFORM pg_temp.dat(v_amt = i.total - v_cr, format('%s INV-1 HĐ %s công nợ %s ≠ %s − %s', p_tag, i.invoice_code, v_amt, i.total, v_cr));
      PERFORM pg_temp.dat(abs(i.subtotal + i.vat - i.total) <= 1 OR i.total = 0,
        format('%s HĐ %s subtotal %s + vat %s ≠ total %s', p_tag, i.invoice_code, i.subtotal, i.vat, i.total));
      PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM sales_invoice_lines WHERE invoice_id = i.id AND line_total <> quantity * unit_price),
        format('%s HĐ %s line_total ≠ SL × giá', p_tag, i.invoice_code));
    ELSE
      PERFORM pg_temp.dat(v_n = 0, format('%s INV-1 HĐ huỷ %s còn %s công nợ (amount %s)', p_tag, i.invoice_code, v_n, v_amt));
      PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM returns r WHERE r.invoice_id = i.id AND r.status IN ('submitted', 'completed')),
        format('%s phiếu trả còn bám HĐ huỷ %s', p_tag, i.invoice_code));
    END IF;
  END LOOP;
  FOR l IN SELECT sol.id, sol.invoiced_qty, sol.quantity,
      COALESCE((SELECT sum(sil.quantity * COALESCE(NULLIF(sil.conversion_factor, 0), 1)) FROM sales_invoice_lines sil
                JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'
                WHERE sil.order_line_id = sol.id), 0) / COALESCE(NULLIF(sol.conversion_factor, 0), 1) AS mong
      FROM sales_order_lines sol WHERE sol.order_id = p_don LOOP
    PERFORM pg_temp.dat(l.invoiced_qty = l.mong, format('%s INV-3 invoiced_qty %s ≠ %s', p_tag, l.invoiced_qty, l.mong));
  END LOOP;
  SELECT status INTO v_cur FROM sales_orders WHERE id = p_don;
  SELECT count(*) INTO v_inv FROM sales_invoices WHERE order_id = p_don AND status = 'posted';
  SELECT count(*) INTO v_open FROM sales_order_lines WHERE order_id = p_don AND invoiced_qty < quantity;
  -- (mig 217) Xuất thiếu cũng là xong.
  v_st := CASE WHEN v_cur IN ('draft', 'cancelled') THEN v_cur
               WHEN v_inv = 0 THEN 'submitted' ELSE 'completed' END;
  PERFORM pg_temp.dat(v_inv <= 1, format('%s đơn có %s HĐ posted (mig 217: tối đa 1)', p_tag, v_inv));
  PERFORM pg_temp.dat(v_cur = v_st, format('%s INV-3 đơn %s, mong %s', p_tag, v_cur, v_st));
  PERFORM pg_temp.dat(NOT (v_cur = 'cancelled' AND v_inv > 0), format('%s đơn huỷ còn HĐ posted', p_tag));
END $f$;

-- INV-2 kho.
CREATE OR REPLACE FUNCTION pg_temp.kiem_kho(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d_ton numeric; d_so numeric;
BEGIN
  d_ton := (SELECT sum(qty_on_hand) FROM batches) - current_setting('q.ton0')::numeric;
  d_so  := pg_temp.so_kho() - current_setting('q.sk0')::numeric;
  PERFORM pg_temp.dat(d_ton = d_so, format('%s INV-2 Δtồn %s ≠ Δsổ kho %s', p_tag, d_ton, d_so));
  PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM batches WHERE qty_on_hand < 0), format('%s tồn âm', p_tag));
END $f$;

-- INV-4 nợ khách (+ trả về số nợ).
CREATE OR REPLACE FUNCTION pg_temp.no_kh(p_kh uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = p_kh AND status <> 'paid'
$f$;
CREATE OR REPLACE FUNCTION pg_temp.kiem_kh(p_kh uuid, p_tag text, p_mong numeric DEFAULT NULL) RETURNS numeric LANGUAGE plpgsql AS $f$
DECLARE v_no numeric; v_hd numeric; v_cr numeric; v_khac numeric; v_thu numeric; v_mong numeric;
BEGIN
  v_no := pg_temp.no_kh(p_kh);
  SELECT COALESCE(sum(total), 0) INTO v_hd FROM sales_invoices WHERE customer_id = p_kh AND status = 'posted';
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_cr FROM returns r
    JOIN sales_invoices si ON si.id = r.invoice_id AND si.status = 'posted'
    WHERE r.customer_id = p_kh AND r.applied_receipt_id IS NULL
      AND ((r.credit_with_invoice AND r.status IN ('submitted', 'completed')) OR (NOT r.credit_with_invoice AND r.status = 'completed'));
  SELECT COALESCE(sum(amount), 0) INTO v_khac FROM receivables WHERE customer_id = p_kh AND invoice_id IS NULL;
  SELECT COALESCE(sum(pm.amount), 0) INTO v_thu FROM payments pm JOIN receivables rc ON rc.id = pm.receivable_id WHERE rc.customer_id = p_kh;
  v_mong := v_hd - v_cr + v_khac - v_thu;
  PERFORM pg_temp.dat(v_no = v_mong, format('%s INV-4 nợ khách %s ≠ HĐ %s − có %s + khác %s − thu %s = %s', p_tag, v_no, v_hd, v_cr, v_khac, v_thu, v_mong));
  IF p_mong IS NOT NULL THEN
    PERFORM pg_temp.dat(v_no = p_mong, format('%s nợ khách %s ≠ mong %s', p_tag, v_no, p_mong));
  END IF;
  -- Σ paid khớp Σ payments
  PERFORM pg_temp.dat((SELECT COALESCE(sum(paid), 0) FROM receivables WHERE customer_id = p_kh) = v_thu,
    format('%s Σ receivables.paid %s ≠ Σ payments %s', p_tag, (SELECT COALESCE(sum(paid), 0) FROM receivables WHERE customer_id = p_kh), v_thu));
  RETURN v_no;
END $f$;

-- INV-5 doanh thu của khách (Σ total HĐ posted), theo ngày.
CREATE OR REPLACE FUNCTION pg_temp.dt(p_kh uuid, p_ngay date DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(total), 0) FROM sales_invoices
  WHERE customer_id = p_kh AND public.is_revenue_invoice_status(status) AND (p_ngay IS NULL OR invoice_date = p_ngay)
$f$;

CREATE OR REPLACE FUNCTION pg_temp.kiem(p_kh uuid, p_don uuid, p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_don IS NOT NULL THEN PERFORM pg_temp.kiem_don(p_don, p_tag); END IF;
  PERFORM pg_temp.kiem_kho(p_tag);
  PERFORM pg_temp.kiem_kh(p_kh, p_tag);
  -- INV-5: mỗi chuỗi lập lại chỉ một tờ posted
  PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM sales_invoices WHERE customer_id = p_kh AND status = 'posted' AND replaced_by IS NOT NULL),
    format('%s INV-5 tờ đã bị thay vẫn posted', p_tag));
END $f$;

-- ================================ KỊCH BẢN ================================

-- S01 XUÔI: nháp → gửi → xuất HĐ đủ (VAT 10% + 8%, thùng 24, FIFO chẻ 2 lô).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text; lo0 jsonb; lo1 jsonb; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 2, 240000, 0.1), pg_temp.dl(2, 'lon', 40, 10000, 0.08)), false);
  -- nháp chưa xuất được
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d))));
  PERFORM pg_temp.dat(e LIKE 'ORDER_NOT_INVOICEABLE%', 'S01 xuất đơn nháp không bị chặn: ' || COALESCE(e, 'chạy được'));
  UPDATE sales_orders SET status = 'submitted' WHERE id = d;
  lo0 := pg_temp.lo();
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT * INTO r FROM sales_invoices WHERE id = h;
  PERFORM pg_temp.dat(r.subtotal = 880000 AND r.vat = 80000 AND r.total = 960000, format('S01 tiền HĐ %s/%s/%s ≠ 880000/80000/960000', r.subtotal, r.vat, r.total));
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S01 đơn không completed');
  lo1 := pg_temp.lo();
  PERFORM pg_temp.dat((lo0->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02A'))::numeric - (lo1->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02A'))::numeric = 30
    AND (lo0->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02B'))::numeric - (lo1->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02B'))::numeric = 10, 'S01 FIFO P02 không lấy 30 lô A + 10 lô B');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(1)) = 2000 - 48, 'S01 P01 không trừ 48 lon');
  PERFORM pg_temp.kiem(kh, d, 'S01');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 960000, 'S01 nợ khách ≠ 960000');
  PERFORM pg_temp.dat(pg_temp.dt(kh, current_date) = 960000, 'S01 doanh thu ≠ 960000');
  PERFORM pg_temp.dat((SELECT due_date FROM receivables WHERE invoice_id = h) = current_date + 30, 'S01 hạn nợ ≠ ngày HĐ + 30 (NET30)');
  PERFORM pg_temp.ket('S01', 'nháp→gửi→xuất đủ: HĐ 960.000, nợ 960.000, đơn completed, FIFO 30+10');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S01 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S02 XUÔI (mig 217): xuất THIẾU là xong — đơn completed ngay, không xuất thêm HĐ thứ hai.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h1 uuid; n int; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 2, 240000, 0.1), pg_temp.dl(2, 'lon', 40, 10000, 0.08)));
  h1 := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[1, 20]::numeric[]));
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S02 xuất thiếu: đơn không completed');
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = h1) = 480000, format('S02 HĐ1 total %s ≠ 480000', (SELECT total FROM sales_invoices WHERE id = h1)));
  PERFORM pg_temp.kiem(kh, d, 'S02.1');
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d))));
  PERFORM pg_temp.dat(e LIKE 'ORDER_NOT_INVOICEABLE%', 'S02 HĐ thứ hai không bị chặn: ' || COALESCE(e, 'chạy được'));
  SELECT count(*) INTO n FROM receivables WHERE order_id = d;
  PERFORM pg_temp.dat(n = 1, 'S02 số phiếu công nợ ≠ 1');
  PERFORM pg_temp.kiem(kh, d, 'S02.2');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 480000, 'S02 nợ ≠ 480000');
  PERFORM pg_temp.ket('S02', 'xuất thiếu (480.000) → completed; HĐ thứ hai bị chặn; 1 công nợ');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S02 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S03 XUÔI: xuất vượt số đặt (thiết kế cho phép — PATCH 1), rồi xuất thêm trên đơn đã completed.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 10, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[15]::numeric[]));
  PERFORM pg_temp.dat((SELECT invoiced_qty FROM sales_order_lines WHERE order_id = d) = 15, 'S03 invoiced_qty ≠ 15');
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S03 đơn xuất dư không completed');
  PERFORM pg_temp.dat((SELECT remaining_qty FROM get_invoiceable_lines(d)) = 0, 'S03 phần còn lại âm/không 0');
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[1]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE 'ORDER_NOT_INVOICEABLE%', 'S03 xuất thêm trên đơn completed không bị chặn: ' || COALESCE(e, 'chạy được'));
  -- HĐ rỗng
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', '[]'::jsonb)));
  PERFORM pg_temp.dat(e IS NOT NULL, 'S03 HĐ rỗng chạy được');
  PERFORM pg_temp.kiem(kh, d, 'S03');
  PERFORM pg_temp.ket('S03', 'xuất 15/10 cho phép (thiết kế), đơn completed; xuất tiếp bị chặn');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S03 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S03B: dòng HĐ mang order_line_id của ĐƠN KHÁC (tải trọng giả / màn cũ) → đơn kia bị cộng invoiced_qty?
BEGIN;
DO $s$
DECLARE kh uuid; d1 uuid; d2 uuid; e text; v_line uuid;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d1 := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 10, 10000)));
  d2 := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(3, 'chai', 5, 20000)));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d2, 'lines', pg_temp.dong_hd(d1))));
  IF e IS NULL THEN
    PERFORM pg_temp.dat(false, format('S03B post_invoice(đơn 2) nhận dòng của đơn 1: đơn 1 → %s, invoiced_qty %s; đơn 2 → %s',
      (SELECT status FROM sales_orders WHERE id = d1), (SELECT invoiced_qty FROM sales_order_lines WHERE order_id = d1),
      (SELECT status FROM sales_orders WHERE id = d2)));
  END IF;
  -- sản phẩm khác với dòng đơn
  SELECT id INTO v_line FROM sales_order_lines WHERE order_id = d2;
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d2, 'lines',
        jsonb_build_array(jsonb_build_object('order_line_id', v_line, 'product_id', pg_temp.p(2), 'unit_name', 'lon', 'quantity', 5, 'unit_price', 1)))));
  IF e IS NULL THEN
    PERFORM pg_temp.dat(false, format('S03B dòng HĐ P02 gắn vào dòng đơn P03: invoiced_qty dòng P03 = %s (không xuất P03 nào)',
      (SELECT invoiced_qty FROM sales_order_lines WHERE id = v_line)));
  END IF;
  PERFORM pg_temp.ket('S03B', 'post_invoice phải kiểm order_line_id thuộc đơn & cùng sản phẩm');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S03B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S03C: xuất đổi đơn vị so với đơn (đơn 2 thùng; HĐ 24 lon) → invoiced_qty = 1 thùng, đơn completed (mig 217).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; v_line uuid;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 2, 240000)));
  SELECT id INTO v_line FROM sales_order_lines WHERE order_id = d;
  h := pg_temp.hd(d, jsonb_build_array(jsonb_build_object('order_line_id', v_line, 'product_id', pg_temp.p(1), 'unit_name', 'lon',
        'conversion_factor', 999, 'quantity', 24, 'unit_price', 10000)));
  PERFORM pg_temp.dat((SELECT conversion_factor FROM sales_invoice_lines WHERE invoice_id = h) = 1, 'S03C hệ số tải trọng (999) không bị máy chủ ghi đè');
  PERFORM pg_temp.dat((SELECT invoiced_qty FROM sales_order_lines WHERE id = v_line) = 1, format('S03C invoiced_qty %s ≠ 1 thùng', (SELECT invoiced_qty FROM sales_order_lines WHERE id = v_line)));
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S03C đơn không completed');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(1)) = 2000 - 24, 'S03C kho P01 không trừ 24');
  PERFORM pg_temp.kiem(kh, d, 'S03C');
  PERFORM pg_temp.ket('S03C', 'HĐ lon cho dòng đơn thùng: quy đổi đúng, hệ số do máy chủ tra');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S03C (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S04 NGƯỢC: huỷ HĐ → đơn ĐÃ HUỶ (mig 217), kho về ĐÚNG lô, công nợ xoá, doanh thu 0; không xuất lại được.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; lo0 jsonb; lo1 jsonb; r record; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 2, 240000, 0.1), pg_temp.dl(2, 'lon', 40, 10000, 0.08)));
  lo0 := pg_temp.lo();
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, '  '));
  PERFORM pg_temp.dat(e LIKE 'REASON_REQUIRED%', 'S04 huỷ không lý do không bị chặn');
  SELECT * INTO r FROM cancel_invoice(h, 'khách không nhận');
  lo1 := pg_temp.lo();
  PERFORM pg_temp.dat(lo0 = lo1, 'S04 tồn từng lô sau huỷ ≠ trước khi xuất');
  PERFORM pg_temp.dat(r.order_status = 'cancelled' AND (SELECT status FROM sales_orders WHERE id = d) = 'cancelled', 'S04 đơn không bị huỷ theo HĐ');
  PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM receivables WHERE invoice_id = h), 'S04 còn công nợ');
  PERFORM pg_temp.dat((SELECT sum(invoiced_qty) FROM sales_order_lines WHERE order_id = d) = 0, 'S04 invoiced_qty không về 0');
  PERFORM pg_temp.dat(pg_temp.dt(kh) = 0, 'S04 doanh thu ≠ 0');
  PERFORM pg_temp.dat((SELECT count(*) FROM sales_invoice_lines WHERE invoice_id = h AND order_line_id IS NOT NULL) = 0, 'S04 dòng HĐ huỷ còn móc dòng đơn');
  PERFORM pg_temp.kiem(kh, d, 'S04');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 0, 'S04 nợ ≠ 0');
  -- huỷ lần 2
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'lần 2'));
  PERFORM pg_temp.dat(e LIKE 'INVOICE_NOT_POSTED%', 'S04 huỷ lần 2 không bị chặn');
  -- đơn đã huỷ: không xuất lại
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[2, 40]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE 'ORDER_NOT_INVOICEABLE%', 'S04 xuất lại đơn đã huỷ không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM pg_temp.ket('S04', 'huỷ HĐ: lô về đúng chỗ, nợ 0, đơn Đã huỷ; huỷ lần 2 chặn; không xuất lại');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S04 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S05 (mig 217): một đơn một HĐ — chỉ mục duy nhất chặn HĐ posted thứ hai kể cả khi lách trạng thái đơn.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h1 uuid; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h1 := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[20]::numeric[]));
  -- giả một đơn bị kẹt ở submitted (dữ liệu hỏng) rồi xuất tiếp → chỉ mục phải chặn
  PERFORM set_config('npp.via_rpc', 'on', false);
  UPDATE sales_orders SET status = 'submitted' WHERE id = d;
  PERFORM set_config('npp.via_rpc', '', false);
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[20]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE '%uq_sales_invoices_mot_don_mot_hd%', 'S05 HĐ posted thứ hai không bị chỉ mục chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM pg_temp.dat((SELECT count(*) FROM sales_invoices WHERE order_id = d AND status = 'posted') = 1, 'S05 > 1 HĐ posted');
  PERFORM pg_temp.ket('S05', 'một đơn một HĐ posted — chỉ mục chặn cả khi trạng thái đơn bị lách');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S05 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S05B NGƯỢC: huỷ HĐ đã có phiếu thu (chặn) / phiếu thu đã huỷ (được).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; rc uuid; pt uuid; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT id INTO rc FROM receivables WHERE invoice_id = h;
  pt := create_cash_receipt(jsonb_build_object('customer_id', kh, 'method', 'cash', 'lines', jsonb_build_array(jsonb_build_object('receivable_id', rc, 'amount', 150000))));
  PERFORM pg_temp.kiem(kh, d, 'S05B.thu');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 250000, 'S05B nợ sau thu ≠ 250000');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'LOCKED_HAS_PAYMENT%', 'S05B huỷ HĐ đã thu tiền không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM void_cash_receipt(pt, 'nhầm');
  PERFORM pg_temp.kiem(kh, d, 'S05B.huỷ-thu');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e IS NULL, 'S05B huỷ HĐ sau khi huỷ phiếu thu vẫn lỗi: ' || COALESCE(e, ''));
  PERFORM pg_temp.kiem(kh, d, 'S05B');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 0, 'S05B nợ ≠ 0');
  PERFORM pg_temp.ket('S05B', 'HĐ có thu → chặn huỷ; huỷ phiếu thu → huỷ HĐ được, nợ 0');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S05B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S05C NGƯỢC: huỷ HĐ có phiếu trả kèm đơn đang Chờ xử lý → phiếu HUỶ theo đơn (mig 217); có phiếu đã nhập kho → chặn.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; ret uuid; e text; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 5, 'unit_price', 20000, 'line_total', 100000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT * INTO r FROM returns WHERE order_id = d;
  ret := r.id;
  PERFORM pg_temp.dat(r.status = 'submitted' AND r.invoice_id = h AND r.credit_with_invoice AND r.credit_note_amount = 100000,
    format('S05C phiếu trả sau xuất: %s/%s/%s/%s', r.status, r.invoice_id = h, r.credit_with_invoice, r.credit_note_amount));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = h) = 300000, 'S05C công nợ ≠ 400000 − 100000');
  PERFORM pg_temp.kiem(kh, d, 'S05C.1');
  PERFORM complete_return(ret, 'sale');
  PERFORM pg_temp.kiem(kh, d, 'S05C.nhập');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'LOCKED_RETURN_DONE%', 'S05C huỷ HĐ có phiếu trả đã nhập không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM cancel_return(ret, 'đảo nhập');   -- tự sinh: đảo kho, về Chờ xử lý
  PERFORM pg_temp.dat((SELECT status FROM returns WHERE id = ret) = 'submitted', 'S05C huỷ nhập không về submitted');
  PERFORM cancel_invoice(h, 'x');
  SELECT * INTO r FROM returns WHERE id = ret;
  PERFORM pg_temp.dat(r.status = 'cancelled' AND r.invoice_id IS NULL, format('S05C phiếu sau huỷ HĐ: %s/%s', r.status, r.invoice_id));
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'cancelled', 'S05C đơn không huỷ theo HĐ');
  PERFORM pg_temp.kiem(kh, d, 'S05C.2');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 0, 'S05C nợ ≠ 0');
  PERFORM pg_temp.ket('S05C', 'phiếu trả tự sinh: chờ → trừ nợ 100k; đã nhập → chặn huỷ HĐ; huỷ nhập → huỷ HĐ → đơn + phiếu Đã huỷ');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S05C (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S06 NGƯỢC: SỬA HĐ (lập lại) — đổi SL, đổi giá, thêm dòng, bỏ dòng, đổi ngày.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; r record; v_lines jsonb; lo0 jsonb; l3 uuid; d_old date := current_date - 5; d_new date := current_date - 2;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 2, 240000, 0.1), pg_temp.dl(2, 'lon', 40, 10000, 0.08), pg_temp.dl(3, 'chai', 10, 20000)));
  lo0 := pg_temp.lo();
  -- HĐ gốc: 2 thùng + 40 lon (chưa xuất P03), ngày lùi 5 ngày
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[2, 40, 0]::numeric[]), jsonb_build_object('invoice_date', d_old));
  PERFORM pg_temp.dat(pg_temp.dt(kh, d_old) = 960000, 'S06 doanh thu ngày cũ ≠ 960000');
  PERFORM pg_temp.kiem(kh, d, 'S06.0');
  -- Sửa: P01 1 thùng giá 230000; bỏ P02; thêm P03 10 chai; đổi ngày
  SELECT id INTO l3 FROM sales_order_lines WHERE order_id = d AND product_id = pg_temp.p(3);
  v_lines := jsonb_build_array(
    (SELECT e || jsonb_build_object('quantity', 1, 'unit_price', 230000) FROM jsonb_array_elements(pg_temp.dong_cua_hd(h)) e WHERE e->>'product_id' = pg_temp.p(1)::text),
    jsonb_build_object('order_line_id', l3, 'product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 10, 'unit_price', 20000, 'vat_rate', 0));
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', v_lines, 'invoice_date', d_new));
  PERFORM pg_temp.dat((SELECT status FROM sales_invoices WHERE id = h) = 'cancelled' AND (SELECT replaced_by FROM sales_invoices WHERE id = h) = r.invoice_id
     AND (SELECT replaced_from FROM sales_invoices WHERE id = r.invoice_id) = h, 'S06 móc nối replaced_by/from sai');
  PERFORM pg_temp.dat(r.invoice_code = (SELECT invoice_code FROM sales_invoices WHERE id = h) || '-1' OR r.invoice_code LIKE '%-1', 'S06 mã tờ mới không -1: ' || r.invoice_code);
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = r.invoice_id) = 253000 + 200000, format('S06 total tờ mới %s ≠ 453000', (SELECT total FROM sales_invoices WHERE id = r.invoice_id)));
  PERFORM pg_temp.dat(pg_temp.dt(kh, d_old) = 0 AND pg_temp.dt(kh, d_new) = 453000, format('S06 doanh thu: ngày cũ %s (mong 0), ngày mới %s (mong 453000)', pg_temp.dt(kh, d_old), pg_temp.dt(kh, d_new)));
  PERFORM pg_temp.dat((SELECT due_date FROM receivables WHERE invoice_id = r.invoice_id) = d_new + 30, 'S06 hạn nợ không theo ngày mới');
  PERFORM pg_temp.dat(r.order_status = 'completed', 'S06 đơn sau sửa ' || r.order_status || ' (xuất thiếu vẫn completed — mig 217)');
  -- kho: so với trước khi xuất, P01 −24, P02 0, P03 −10; lô P02 về đúng
  PERFORM pg_temp.dat((pg_temp.lo()->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02A')) = (lo0->>(SELECT id::text FROM batches WHERE batch_code = 'Q-02A')), 'S06 lô A P02 không về đủ');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(1)) = 2000 - 24 AND (SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(3) AND warehouse_zone = 'sale') = 990, 'S06 kho P01/P03 sai');
  PERFORM pg_temp.kiem(kh, d, 'S06');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 453000, 'S06 nợ ≠ 453000');
  PERFORM pg_temp.ket('S06', 'sửa HĐ: giá/SL/thêm/bỏ/ngày → tờ -1 453.000, doanh thu dời ngày, kho & nợ đúng');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S06 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S06B NGƯỢC: sửa HĐ hai lần liên tiếp; sửa tờ đã bị thay (phải chặn); sửa HĐ không truyền ngày (ngày tờ mới?).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h0 uuid; h1 uuid; h2 uuid; e text; r record; d_old date := current_date - 7;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h0 := pg_temp.hd(d, pg_temp.dong_hd(d), jsonb_build_object('invoice_date', d_old));
  SELECT invoice_id INTO h1 FROM reissue_invoice(h0, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h0), '{0,quantity}', '30'), 'invoice_date', d_old));
  SELECT invoice_id INTO h2 FROM reissue_invoice(h1, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h1), '{0,quantity}', '35'), 'invoice_date', d_old));
  PERFORM pg_temp.dat((SELECT invoice_code FROM sales_invoices WHERE id = h2) LIKE '%-2', 'S06B mã lần 2 không -2');
  PERFORM pg_temp.dat((SELECT count(*) FROM sales_invoices WHERE order_id = d AND status = 'posted') = 1, 'S06B > 1 tờ posted');
  PERFORM pg_temp.dat(pg_temp.dt(kh) = 350000, 'S06B doanh thu ≠ 350000');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(2)) = 1030 - 35, 'S06B kho P02 ≠ −35');
  PERFORM pg_temp.kiem(kh, d, 'S06B.2');
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h0, jsonb_build_object('lines', pg_temp.dong_cua_hd(h0))));
  PERFORM pg_temp.dat(e LIKE 'INVOICE_NOT_POSTED%', 'S06B sửa tờ đã bị thay không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM pg_temp.kiem(kh, d, 'S06B.3');
  -- Sửa không truyền invoice_date (màn /sales-invoices/[id]/edit — InvoiceEditor không gửi ngày)
  SELECT * INTO r FROM reissue_invoice(h2, jsonb_build_object('lines', pg_temp.dong_cua_hd(h2)));
  PERFORM pg_temp.dat((SELECT invoice_date FROM sales_invoices WHERE id = r.invoice_id) = d_old,
    format('S06B sửa HĐ không gửi ngày: tờ mới ngày %s, tờ gốc %s → doanh thu %s dời sang hôm nay', (SELECT invoice_date FROM sales_invoices WHERE id = r.invoice_id), d_old, pg_temp.dt(kh)));
  PERFORM pg_temp.ket('S06B', 'lập lại 2 lần (-1, -2), tờ bị thay không sửa được; không gửi ngày → giữ ngày gốc?');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S06B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S06C: sửa HĐ có GIẢM GIÁ ĐƠN mà không gửi lại 'discount' (InvoiceEditor không gửi) → mất giảm giá?
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d), jsonb_build_object('discount', 50000));
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = h) = 350000, 'S06C HĐ có giảm 50k total ≠ 350000');
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h), 'invoice_date', current_date));
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = r.invoice_id) = 350000,
    format('S06C sửa HĐ không đổi gì nhưng không gửi discount: total %s ≠ 350000 (giảm giá đơn không lưu trên HĐ để giữ lại)', (SELECT total FROM sales_invoices WHERE id = r.invoice_id)));
  PERFORM pg_temp.kiem(kh, d, 'S06C');
  PERFORM pg_temp.ket('S06C', 'sửa HĐ có giảm giá đơn — tải trọng thiếu discount');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S06C (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S07 NGƯỢC: sửa HĐ đã thu MỘT PHẦN (mig 184 chuyển tiền thu sang tờ mới).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; rc uuid; pt uuid; r record; rc2 record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT id INTO rc FROM receivables WHERE invoice_id = h;
  pt := create_cash_receipt(jsonb_build_object('customer_id', kh, 'method', 'cash', 'lines', jsonb_build_array(jsonb_build_object('receivable_id', rc, 'amount', 150000))));
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '30'), 'invoice_date', current_date));
  SELECT * INTO rc2 FROM receivables WHERE invoice_id = r.invoice_id;
  PERFORM pg_temp.dat(rc2.amount = 300000 AND rc2.paid = 150000 AND rc2.status = 'partial', format('S07 công nợ tờ mới %s/%s/%s ≠ 300000/150000/partial', rc2.amount, rc2.paid, rc2.status));
  PERFORM pg_temp.dat((SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = pt AND invoice_id = r.invoice_id AND receivable_id = rc2.id) = 1, 'S07 dòng phiếu thu không trỏ sang tờ mới');
  PERFORM pg_temp.dat((SELECT count(*) FROM payments WHERE receivable_id = rc2.id) = 1, 'S07 payments không dựng lại');
  PERFORM pg_temp.kiem(kh, d, 'S07');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 150000, 'S07 nợ ≠ 150000');
  -- huỷ phiếu thu sau khi sửa → nợ tờ mới về 300000
  PERFORM void_cash_receipt(pt, 'nhầm');
  PERFORM pg_temp.kiem(kh, d, 'S07.huỷ-thu');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 300000, format('S07 huỷ phiếu thu sau sửa HĐ: nợ %s ≠ 300000', pg_temp.no_kh(kh)));
  PERFORM pg_temp.ket('S07', 'sửa HĐ đã thu 150k: tiền thu theo sang tờ mới, nợ 150k; huỷ phiếu thu → 300k');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S07 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S07B NGƯỢC: sửa HĐ đã thu ĐỦ xuống thấp hơn số đã thu → khách dư có (phải hiện nợ âm).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; rc uuid; pt uuid; r record; rc2 record; v_no numeric;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT id INTO rc FROM receivables WHERE invoice_id = h;
  pt := create_cash_receipt(jsonb_build_object('customer_id', kh, 'method', 'cash', 'lines', jsonb_build_array(jsonb_build_object('receivable_id', rc, 'amount', 400000))));
  PERFORM pg_temp.dat((SELECT status FROM receivables WHERE id = rc) = 'paid', 'S07B chưa paid');
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '25'), 'invoice_date', current_date));
  SELECT * INTO rc2 FROM receivables WHERE invoice_id = r.invoice_id;
  v_no := pg_temp.no_kh(kh);
  PERFORM pg_temp.dat(v_no = -150000, format('S07B HĐ 250k đã thu 400k: công nợ tờ mới amount %s paid %s status %s → nợ khách %s (mong −150000 dư có)', rc2.amount, rc2.paid, rc2.status, v_no));
  PERFORM pg_temp.kiem(kh, d, 'S07B');
  PERFORM pg_temp.ket('S07B', 'sửa HĐ xuống dưới số đã thu');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S07B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S08 NGƯỢC: sửa HĐ có phiếu trả tự sinh đang CHỜ XỬ LÝ — sửa SL trả 5 → 3; thêm hàng trả; bỏ hết dòng trả.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; ret uuid; rl uuid; r record; rr record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 5, 'unit_price', 20000, 'line_total', 100000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT id INTO ret FROM returns WHERE order_id = d;
  SELECT id INTO rl FROM return_lines WHERE return_id = ret;
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h), 'invoice_date', current_date,
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', rl, 'quantity', 3))));
  SELECT * INTO rr FROM returns WHERE id = ret;
  PERFORM pg_temp.dat(rr.invoice_id = r.invoice_id AND rr.status = 'submitted' AND rr.credit_note_amount = 60000, format('S08 phiếu trả: bám tờ mới %s, %s, %s', rr.invoice_id = r.invoice_id, rr.status, rr.credit_note_amount));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 340000, 'S08 công nợ ≠ 400000 − 60000');
  PERFORM pg_temp.kiem(kh, d, 'S08.1');
  -- thêm 1 dòng trả 2 chai × 20000 + 1 dòng đổi (không trừ nợ)
  h := r.invoice_id;
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h), 'invoice_date', current_date,
     'return_adds', jsonb_build_array(
        jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 2, 'unit_price', 20000, 'vat_rate', 0, 'is_exchange', false),
        jsonb_build_object('product_id', pg_temp.p(2), 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000, 'vat_rate', 0, 'is_exchange', true))));
  PERFORM pg_temp.dat((SELECT credit_note_amount FROM returns WHERE id = ret) = 100000 OR
     (SELECT sum(credit_note_amount) FROM returns WHERE invoice_id = r.invoice_id AND status <> 'cancelled') = 100000,
     format('S08 khoản có sau thêm = %s (mong 60000 + 40000)', (SELECT sum(credit_note_amount) FROM returns WHERE invoice_id = r.invoice_id AND status <> 'cancelled')));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 300000, format('S08 công nợ sau thêm %s ≠ 300000', (SELECT amount FROM receivables WHERE invoice_id = r.invoice_id)));
  PERFORM pg_temp.kiem(kh, d, 'S08.2');
  -- bỏ hết dòng trả → phiếu về nháp, gỡ HĐ; công nợ = total
  h := r.invoice_id;
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h), 'invoice_date', current_date,
     'return_edits', (SELECT jsonb_agg(jsonb_build_object('line_id', id, 'quantity', 0)) FROM return_lines WHERE return_id IN (SELECT id FROM returns WHERE invoice_id = h))));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = (SELECT total FROM sales_invoices WHERE id = r.invoice_id),
     format('S08 bỏ hết hàng trả: công nợ %s ≠ total %s', (SELECT amount FROM receivables WHERE invoice_id = r.invoice_id), (SELECT total FROM sales_invoices WHERE id = r.invoice_id)));
  PERFORM pg_temp.dat((SELECT status FROM returns WHERE id = ret) = 'draft', 'S08 phiếu rỗng không về nháp: ' || (SELECT status FROM returns WHERE id = ret));
  PERFORM pg_temp.kiem(kh, d, 'S08.3');
  PERFORM pg_temp.ket('S08', 'sửa HĐ có phiếu trả chờ: sửa SL, thêm dòng trả + đổi, bỏ hết');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S08 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S09 NGƯỢC: sửa HĐ có phiếu trả tự sinh ĐÃ NHẬP KHO — không chọn (hỏi), lam_lai, giu; kiểm kho INV-2.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; ret uuid; rl uuid; r record; e text; t0 numeric;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 5, 'unit_price', 20000, 'line_total', 100000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT id INTO ret FROM returns WHERE order_id = d;
  SELECT id INTO rl FROM return_lines WHERE return_id = ret;
  PERFORM complete_return(ret, 'date');
  t0 := (SELECT qty_on_hand FROM batches WHERE batch_code = 'Q-03D');
  PERFORM pg_temp.kiem(kh, d, 'S09.0');
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h))));
  PERFORM pg_temp.dat(e LIKE 'REISSUE_RETURN_STOCKED%', 'S09 không hỏi: ' || COALESCE(e, 'chạy được'));
  -- lam_lai: SL trả 5 → 2
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h), 'invoice_date', current_date, 'tra_da_nhap', 'lam_lai',
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', rl, 'quantity', 2))));
  -- (mig 216) phiếu về Chờ xử lý theo tờ mới, kho đã đảo; thủ kho nhập kho lại sau.
  PERFORM pg_temp.dat((SELECT status FROM returns WHERE id = ret) = 'submitted' AND (SELECT invoice_id FROM returns WHERE id = ret) = r.invoice_id, 'S09 lam_lai: phiếu không về Chờ xử lý / không bám tờ mới');
  PERFORM pg_temp.dat(COALESCE((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(3) AND warehouse_zone = 'date'), 0) = 0, format('S09 lam_lai: tồn kho date P03 = %s ≠ 0 (chưa nhập lại)', (SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(3) AND warehouse_zone = 'date')));
  PERFORM complete_return(ret, 'date');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(3) AND warehouse_zone = 'date') = 2, format('S09 nhập kho lại: tồn kho date P03 = %s ≠ 2', (SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(3) AND warehouse_zone = 'date')));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 360000, 'S09 lam_lai: công nợ ≠ 400000 − 40000');
  PERFORM pg_temp.kiem(kh, d, 'S09.1');
  -- giu: đổi SL bán 40 → 35, giữ phiếu nhập
  h := r.invoice_id;
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '35'), 'invoice_date', current_date, 'tra_da_nhap', 'giu'));
  PERFORM pg_temp.dat((SELECT status FROM returns WHERE id = ret) = 'completed' AND (SELECT invoice_id FROM returns WHERE id = ret) = r.invoice_id, 'S09 giu: phiếu không bám tờ mới');
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 310000, 'S09 giu: công nợ ≠ 350000 − 40000');
  PERFORM pg_temp.kiem(kh, d, 'S09.2');
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', r.invoice_id, jsonb_build_object('lines', pg_temp.dong_cua_hd(r.invoice_id), 'tra_da_nhap', 'bay')));
  PERFORM pg_temp.dat(e LIKE 'BAD_TRA_DA_NHAP%', 'S09 giá trị tra_da_nhap lạ không bị chặn');
  PERFORM pg_temp.ket('S09', 'phiếu trả tự sinh đã nhập: hỏi / lam_lai (kho date 2, nợ 360k) / giu (nợ 310k)');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S09 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S10 NGƯỢC (mig 217): huỷ đơn khi còn HĐ (chặn) → huỷ HĐ = đơn tự huỷ, phiếu trả kèm đơn huỷ theo.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h1 uuid; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 1, 'unit_price', 20000, 'line_total', 20000)));
  h1 := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e LIKE 'HAS_INVOICE%', 'S10 huỷ đơn có HĐ không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM cancel_invoice(h1, 'khách bỏ');
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'cancelled', 'S10 huỷ HĐ: đơn không huỷ theo');
  PERFORM pg_temp.dat(NOT EXISTS (SELECT 1 FROM returns WHERE order_id = d AND status <> 'cancelled'), 'S10 phiếu trả kèm đơn còn sống: ' || (SELECT string_agg(status, ',') FROM returns WHERE order_id = d));
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e IS NULL, 'S10 huỷ đơn đã huỷ không êm: ' || COALESCE(e, ''));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[1]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE 'ORDER_NOT_INVOICEABLE%', 'S10 xuất HĐ cho đơn huỷ không bị chặn');
  PERFORM pg_temp.kiem(kh, d, 'S10');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 0 AND pg_temp.dt(kh) = 0, 'S10 nợ/doanh thu ≠ 0');
  PERFORM pg_temp.ket('S10', 'huỷ đơn: chặn khi còn HĐ; huỷ HĐ → đơn + phiếu trả kèm đơn Đã huỷ');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S10 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S11 (mig 217): không còn đóng đơn.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  e := pg_temp.thu(format('SELECT close_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e LIKE 'ORDER_CLOSE_REMOVED%', 'S11 đóng đơn không bị chặn: ' || COALESCE(e, 'chạy được'));
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S11 đơn không completed');
  PERFORM pg_temp.kiem(kh, d, 'S11');
  PERFORM pg_temp.ket('S11', 'đóng đơn ngừng dùng; xuất thiếu đã là completed');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S11 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S12 NGƯỢC: sửa dòng đơn sau khi đã xuất (từ trình duyệt, vai authenticated) → chặn; đơn chưa xuất → sửa được.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; d2 uuid; h uuid; e text; v_line uuid;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  d2 := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  -- ⚠ mỗi RPC ở PostgREST là một giao dịch riêng: xoá cờ npp.via_rpc mà post_invoice để lại trong giao dịch này.
  PERFORM set_config('npp.via_rpc', '', true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.la(1);
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 5 WHERE order_id = %L', d));
  -- (mig 217) đơn xuất thiếu là 'completed': RLS có thể lọc mất dòng (0 dòng đổi) thay vì nổ ORDER_LOCKED — kiểm cả số liệu.
  PERFORM pg_temp.dat(e LIKE 'ORDER_LOCKED%' OR (SELECT quantity FROM sales_order_lines WHERE order_id = d) = 40,
    'S12 sửa dòng đơn đã xuất không bị chặn: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('DELETE FROM sales_order_lines WHERE order_id = %L', d));
  PERFORM pg_temp.dat(e LIKE 'ORDER_LOCKED%' OR EXISTS (SELECT 1 FROM sales_order_lines WHERE order_id = d), 'S12 xoá dòng đơn đã xuất không bị chặn');
  e := pg_temp.thu(format('UPDATE sales_orders SET status = %L WHERE id = %L', 'submitted', d));
  PERFORM pg_temp.dat(e LIKE 'USE_RPC%' OR (SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S12 đổi trạng thái đơn thẳng không bị chặn: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 30 WHERE order_id = %L', d2));
  PERFORM pg_temp.dat(e IS NULL, 'S12 sửa dòng đơn chưa xuất bị lỗi: ' || COALESCE(e, ''));
  e := pg_temp.thu(format('UPDATE sales_order_lines SET invoiced_qty = 30 WHERE order_id = %L', d2));
  PERFORM pg_temp.dat(e IS NOT NULL, format('S12 ghi thẳng invoiced_qty=30 trên đơn chưa xuất được phép (từ trình duyệt): đơn còn xuất được %s', (SELECT remaining_qty FROM get_invoiceable_lines(d2))));
  RESET ROLE;
  PERFORM pg_temp.kiem(kh, d, 'S12');
  PERFORM pg_temp.ket('S12', 'sửa dòng đơn sau xuất: chặn; đơn chưa xuất: sửa được; invoiced_qty có ghi thẳng được?');
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE NOTICE 'LỖI S12 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S13 XUÔI: giảm giá đơn + giá dòng đã chiết khấu + VAT 10%/5% + thùng 24 / thùng 30; kèm phiếu trả tự sinh.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; r record; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(1, 'Thung 24', 3, 230000, 0.1, 10000), pg_temp.dl(6, 'Thung 30', 1, 150000, 0.05)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 2, 'unit_price', 20000, 'line_total', 40000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d), jsonb_build_object('discount', 50000));
  SELECT * INTO r FROM sales_invoices WHERE id = h;
  -- tiền hàng 690000 + 150000 = 840000; giảm 50000 → 790000; VAT 69000 + 7500 = 76500 (trên giá dòng, trước giảm đơn)
  PERFORM pg_temp.dat(r.subtotal = 790000 AND r.vat = 76500 AND r.total = 866500, format('S13 HĐ %s/%s/%s ≠ 790000/76500/866500', r.subtotal, r.vat, r.total));
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = h) = 866500 - 40000, 'S13 công nợ ≠ total − 40000 hàng trả');
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(1)) = 2000 - 72 AND (SELECT qty_on_hand FROM batches WHERE batch_code = 'Q-06A') = 3000 - 30, 'S13 kho quy đổi sai');
  PERFORM pg_temp.kiem(kh, d, 'S13');
  PERFORM pg_temp.dat(pg_temp.dt(kh) = 866500, 'S13 doanh thu (gộp) ≠ 866500');
  PERFORM pg_temp.ket('S13', 'giảm giá đơn 50k + VAT 10%/5% + thùng: 790.000 + 76.500 = 866.500; nợ 826.500');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S13 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S13B: giảm giá đơn lớn hơn tiền hàng / chuỗi rác / số âm; làm tròn VAT lẻ.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 3, 3333, 0.08)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[1]::numeric[]), jsonb_build_object('discount', 999999));
  SELECT * INTO r FROM sales_invoices WHERE id = h;
  PERFORM pg_temp.dat(r.subtotal = 0 AND r.total = 267, format('S13B giảm > tiền hàng: %s/%s/%s (mong 0/267/267 — VAT vẫn tính trên giá dòng)', r.subtotal, r.vat, r.total));
  -- (mig 217) một đơn một HĐ: mỗi phép thử một đơn riêng
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 3, 3333, 0.08)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[1]::numeric[]), jsonb_build_object('discount', 'abc'));
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = h) = 3600, 'S13B giảm "abc" không về 0: ' || (SELECT total FROM sales_invoices WHERE id = h));
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 3, 3333, 0.08)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[1]::numeric[]), jsonb_build_object('discount', -5000));
  PERFORM pg_temp.dat((SELECT total FROM sales_invoices WHERE id = h) = 3600, 'S13B giảm âm làm tăng tiền: ' || (SELECT total FROM sales_invoices WHERE id = h));
  PERFORM pg_temp.kiem(kh, d, 'S13B');
  PERFORM pg_temp.ket('S13B', 'giảm kẹp [0, tiền hàng]; rác/âm → 0; VAT 266,64 → 267');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S13B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S13C: hàng trả tự sinh LỚN HƠN tiền HĐ → công nợ ÂM (mig 186), không kẹp 0.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; rc record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 5, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 5, 'unit_price', 20000, 'line_total', 100000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT * INTO rc FROM receivables WHERE invoice_id = h;
  PERFORM pg_temp.dat(rc.amount = -50000 AND rc.status = 'open', format('S13C công nợ %s/%s ≠ −50000/open', rc.amount, rc.status));
  PERFORM pg_temp.kiem(kh, d, 'S13C');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = -50000, 'S13C nợ khách ≠ −50000');
  PERFORM pg_temp.ket('S13C', 'trả 100k > HĐ 50k → công nợ −50.000 open');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S13C (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S14 QUYỀN: nhân viên bán / kế toán / kho gọi xuất, huỷ, sửa HĐ, đóng đơn; chạy dưới vai authenticated.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text; v_lines jsonb;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  v_lines := pg_temp.dong_cua_hd(h);
  PERFORM set_config('npp.via_rpc', '', true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.la(4);  -- sales
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'FORBIDDEN%', 'S14 sales huỷ HĐ: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', v_lines)));
  PERFORM pg_temp.dat(e LIKE 'FORBIDDEN%', 'S14 sales sửa HĐ: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[1]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE 'FORBIDDEN%', 'S14 sales xuất HĐ: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT close_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e LIKE 'ORDER_CLOSE_REMOVED%', 'S14 sales đóng đơn (mig 217 ngừng dùng): ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT public._wf2b_recompute_receivable(%L)', h));
  PERFORM pg_temp.dat(e LIKE 'permission denied%', 'S14 sales gọi hàm nội bộ _wf2b_recompute_receivable: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT public._wf2b_sync_order_status(%L)', d));
  PERFORM pg_temp.dat(e LIKE 'permission denied%', 'S14 sales gọi hàm nội bộ _wf2b_sync_order_status: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('UPDATE sales_invoices SET total = 1 WHERE id = %L', h));
  PERFORM pg_temp.dat(e IS NOT NULL OR (SELECT total FROM sales_invoices WHERE id = h) <> 1, 'S14 sales sửa thẳng total HĐ');
  PERFORM pg_temp.la(3);  -- accountant
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'FORBIDDEN%', 'S14 kế toán huỷ HĐ: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('UPDATE receivables SET amount = 0 WHERE invoice_id = %L', h));
  PERFORM pg_temp.dat(e IS NOT NULL OR (SELECT amount FROM receivables WHERE invoice_id = h) <> 0,
    'S14 kế toán ghi THẲNG receivables.amount = 0 từ trình duyệt (RLS "Accountant/Owner can update receivables", không trigger chặn)');
  PERFORM pg_temp.la(1);  -- owner
  e := pg_temp.thu(format('UPDATE sales_invoices SET total = 1 WHERE id = %L', h));
  PERFORM pg_temp.dat(e IS NOT NULL OR (SELECT total FROM sales_invoices WHERE id = h) <> 1, 'S14 chủ sửa thẳng total HĐ');
  e := pg_temp.thu(format('UPDATE sales_invoices SET status = %L WHERE id = %L', 'cancelled', h));
  PERFORM pg_temp.dat(e IS NOT NULL OR (SELECT status FROM sales_invoices WHERE id = h) = 'posted', 'S14 chủ đổi thẳng trạng thái HĐ');
  PERFORM pg_temp.la(2);  -- manager: được huỷ
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e IS NULL OR e LIKE '%permission denied%', 'S14 quản lý huỷ HĐ lỗi: ' || COALESCE(e, ''));
  RESET ROLE;
  PERFORM pg_temp.ket('S14', 'phân quyền xuất/huỷ/sửa/đóng; ghi thẳng bảng');
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE NOTICE 'LỖI S14 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S14B QUYỀN: khác tổ chức.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text; ORG2 uuid := 'a0000000-0000-0000-0000-0000000000f2'; U2 uuid := 'e0000000-0000-0000-0000-0000000000f2';
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  INSERT INTO organizations (id, name, slug) VALUES (ORG2, 'NPP khác', 'npp-khac-quet');
  INSERT INTO auth.users (id, email) VALUES (U2, 'khac@quet.local') ON CONFLICT DO NOTHING;
  INSERT INTO users (id, org_id, role, full_name) VALUES (U2, ORG2, 'owner', 'Chủ khác')
    ON CONFLICT (id) DO UPDATE SET org_id = ORG2, role = 'owner';
  PERFORM set_config('request.jwt.claim.sub', U2::text, false);
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'ORG_MISMATCH%', 'S14B huỷ HĐ tổ chức khác: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', pg_temp.dong_cua_hd(h))));
  PERFORM pg_temp.dat(e LIKE 'ORG_MISMATCH%', 'S14B sửa HĐ tổ chức khác: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[1]::numeric[]))));
  PERFORM pg_temp.dat(e LIKE 'ORG_MISMATCH%', 'S14B xuất HĐ tổ chức khác: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT get_invoiceable_lines(%L)', d));
  PERFORM pg_temp.dat(e LIKE 'ORG_MISMATCH%', 'S14B đọc dòng xuất tổ chức khác');
  e := pg_temp.thu(format('SELECT close_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e LIKE 'ORDER_CLOSE_REMOVED%', 'S14B đóng đơn tổ chức khác (mig 217 ngừng dùng)');
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', d, 'x'));
  PERFORM pg_temp.dat(e LIKE 'ORG_MISMATCH%', 'S14B huỷ đơn tổ chức khác');
  PERFORM pg_temp.ket('S14B', 'khác tổ chức: mọi RPC trả ORG_MISMATCH');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S14B (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S15 XUÔI+NGƯỢC: hàng ĐỔI kèm đơn, đơn xuất HAI đợt — dòng đổi có bị mời xuất lần nữa ở đợt 2 không?
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h1 uuid; x record; v_lines jsonb;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)), true,
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(3), 'unit_name', 'chai', 'quantity', 2, 'unit_price', 20000, 'line_total', 40000, 'is_exchange', true)));
  -- đợt 1: 20 lon + đủ hàng đổi (như màn Xuất hàng dựng từ get_invoiceable_lines)
  SELECT jsonb_agg(jsonb_build_object('order_line_id', g.order_line_id, 'product_id', g.product_id, 'unit_name', g.unit_name,
           'quantity', CASE WHEN g.is_exchange THEN g.remaining_qty ELSE 20 END, 'unit_price', g.unit_price, 'is_exchange', g.is_exchange))
    INTO v_lines FROM get_invoiceable_lines(d) g;
  h1 := pg_temp.hd(d, v_lines);
  PERFORM pg_temp.dat((SELECT qty_on_hand FROM batches WHERE batch_code = 'Q-03A') = 998, 'S15 hàng đổi không trừ kho đợt 1');
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = h1) = 200000, format('S15 hàng đổi làm đổi công nợ: %s ≠ 200000', (SELECT amount FROM receivables WHERE invoice_id = h1)));
  SELECT * INTO x FROM get_invoiceable_lines(d) g WHERE g.is_exchange;
  PERFORM pg_temp.dat(x IS NULL OR x.remaining_qty = 0,
    format('S15 sau đợt 1 get_invoiceable_lines vẫn mời xuất hàng đổi %s chai (đã xuất ở HĐ1) — đợt 2 dựng theo remaining_qty sẽ trừ kho lần nữa', x.remaining_qty));
  -- (mig 217) đợt 2 không còn: xuất thiếu là xong
  PERFORM pg_temp.dat((SELECT status FROM sales_orders WHERE id = d) = 'completed', 'S15 xuất thiếu kèm hàng đổi: đơn không completed');
  PERFORM pg_temp.dat(pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', d, 'lines', pg_temp.dong_hd(d, ARRAY[1]::numeric[])))) LIKE 'ORDER_NOT_INVOICEABLE%',
    'S15 đợt 2 không bị chặn');
  PERFORM pg_temp.dat((SELECT qty_on_hand FROM batches WHERE batch_code = 'Q-03A') = 998, format('S15 hàng đổi trừ kho %s (mong 998)', (SELECT qty_on_hand FROM batches WHERE batch_code = 'Q-03A')));
  PERFORM pg_temp.kiem(kh, d, 'S15');
  PERFORM pg_temp.ket('S15', 'hàng đổi kèm đơn: trừ kho một lần, không có đợt 2');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S15 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S16 NGƯỢC: sửa HĐ thất bại giữa chừng (thiếu tồn / bỏ hết dòng) → tờ cũ còn nguyên (không mất HĐ, không mất nợ).
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; e text; lo0 jsonb;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  lo0 := pg_temp.lo();
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '999999'))));
  PERFORM pg_temp.dat(e LIKE 'INSUFFICIENT_STOCK%', 'S16 sửa vượt tồn: ' || COALESCE(e, 'chạy được'));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '0'))));
  PERFORM pg_temp.dat(e LIKE 'NO_LINES%', 'S16 sửa bỏ hết dòng: ' || COALESCE(e, 'chạy được'));
  PERFORM pg_temp.dat((SELECT status FROM sales_invoices WHERE id = h) = 'posted' AND pg_temp.lo() = lo0, 'S16 tờ cũ / kho bị đụng sau lần sửa hỏng');
  PERFORM pg_temp.kiem(kh, d, 'S16');
  PERFORM pg_temp.ket('S16', 'sửa hỏng (thiếu tồn / rỗng) → rollback, tờ cũ nguyên');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S16 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S17 NGƯỢC: phiếu thu 2 dòng (HĐ A + HĐ B của 2 đơn) → sửa HĐ A → dòng thu B không đụng; huỷ phiếu thu → nợ đúng.
BEGIN;
DO $s$
DECLARE kh uuid; d1 uuid; d2 uuid; a uuid; b uuid; ra uuid; rb uuid; pt uuid; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d1 := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  d2 := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(3, 'chai', 10, 20000)));
  a := pg_temp.hd(d1, pg_temp.dong_hd(d1)); b := pg_temp.hd(d2, pg_temp.dong_hd(d2));
  SELECT id INTO ra FROM receivables WHERE invoice_id = a; SELECT id INTO rb FROM receivables WHERE invoice_id = b;
  pt := create_cash_receipt(jsonb_build_object('customer_id', kh, 'method', 'cash', 'lines', jsonb_build_array(
          jsonb_build_object('receivable_id', ra, 'amount', 100000), jsonb_build_object('receivable_id', rb, 'amount', 50000))));
  SELECT * INTO r FROM reissue_invoice(a, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(a), '{0,unit_price}', '9000'), 'invoice_date', current_date));
  PERFORM pg_temp.dat((SELECT paid FROM receivables WHERE id = rb) = 50000, 'S17 thu của HĐ B bị đụng');
  PERFORM pg_temp.dat((SELECT paid FROM receivables WHERE invoice_id = r.invoice_id) = 100000, 'S17 thu HĐ A không sang tờ mới');
  PERFORM pg_temp.kiem(kh, d1, 'S17.1'); PERFORM pg_temp.kiem_don(d2, 'S17.1b');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 360000 - 100000 + 200000 - 50000, format('S17 nợ %s ≠ 410000', pg_temp.no_kh(kh)));
  PERFORM void_cash_receipt(pt, 'nhầm');
  PERFORM pg_temp.kiem(kh, d1, 'S17.2');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 560000, format('S17 sau huỷ thu nợ %s ≠ 560000', pg_temp.no_kh(kh)));
  PERFORM pg_temp.ket('S17', 'phiếu thu 2 HĐ; sửa 1 HĐ; huỷ phiếu thu');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S17 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S18 INV-5: doanh thu dashboard_summary so với Σ HĐ posted theo ngày — sau xuất / sửa / huỷ.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; base numeric; v numeric; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  SELECT period_revenue INTO base FROM dashboard_summary(current_date);
  base := COALESCE(base, 0);
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  SELECT COALESCE(period_revenue, 0) INTO v FROM dashboard_summary(current_date);
  PERFORM pg_temp.dat(v - base = 400000, format('S18 dashboard sau xuất +%s ≠ 400000', v - base));
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,quantity}', '30'), 'invoice_date', current_date));
  SELECT COALESCE(period_revenue, 0) INTO v FROM dashboard_summary(current_date);
  PERFORM pg_temp.dat(v - base = 300000, format('S18 dashboard sau sửa +%s ≠ 300000 (đếm hai lần?)', v - base));
  PERFORM cancel_invoice(r.invoice_id, 'x');
  SELECT COALESCE(period_revenue, 0) INTO v FROM dashboard_summary(current_date);
  PERFORM pg_temp.dat(v - base = 0, format('S18 dashboard sau huỷ +%s ≠ 0', v - base));
  PERFORM pg_temp.kiem(kh, d, 'S18');
  PERFORM pg_temp.ket('S18', 'doanh thu dashboard: +400k → sửa +300k → huỷ 0');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S18 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S19 NGƯỢC: HĐ có phiếu trả TỰ LẬP đã hoàn thành (gắn HĐ) → sửa HĐ (không cần hỏi) → khoản có giữ trên tờ mới; huỷ HĐ → chặn.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h uuid; ret uuid; r record; e text;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h := pg_temp.hd(d, pg_temp.dong_hd(d));
  ret := create_return_with_lines(jsonb_build_object('customer_id', kh, 'invoice_id', h, 'order_id', d, 'reason', 'damaged', 'status', 'draft'),
          jsonb_build_array(jsonb_build_object('product_id', pg_temp.p(2), 'unit_name', 'lon', 'quantity', 4, 'unit_price', 10000, 'line_total', 40000)));
  PERFORM complete_return(ret, 'sale');
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = h) = 360000, format('S19 công nợ sau trả tự lập %s ≠ 360000', (SELECT amount FROM receivables WHERE invoice_id = h)));
  PERFORM pg_temp.kiem(kh, d, 'S19.0');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x'));
  PERFORM pg_temp.dat(e LIKE 'LOCKED_RETURN_DONE%', 'S19 huỷ HĐ có phiếu tự lập hoàn thành: ' || COALESCE(e, 'chạy được'));
  SELECT * INTO r FROM reissue_invoice(h, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h), '{0,unit_price}', '9000'), 'invoice_date', current_date));
  PERFORM pg_temp.dat((SELECT invoice_id FROM returns WHERE id = ret) = r.invoice_id AND (SELECT status FROM returns WHERE id = ret) = 'completed', 'S19 phiếu tự lập không bám tờ mới');
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 360000 - 40000, format('S19 công nợ tờ mới %s ≠ 320000', (SELECT amount FROM receivables WHERE invoice_id = r.invoice_id)));
  PERFORM pg_temp.kiem(kh, d, 'S19');
  -- huỷ phiếu tự lập sau khi sửa HĐ → nợ tăng lại
  PERFORM cancel_return(ret, 'nhầm');
  PERFORM pg_temp.dat((SELECT amount FROM receivables WHERE invoice_id = r.invoice_id) = 360000, 'S19 huỷ phiếu trả: nợ không tăng lại');
  PERFORM pg_temp.kiem(kh, d, 'S19.2');
  PERFORM pg_temp.ket('S19', 'phiếu trả tự lập gắn HĐ: chặn huỷ HĐ; sửa HĐ giữ khoản có; huỷ phiếu → nợ tăng lại');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S19 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;

-- S20 NGƯỢC (mig 217): sửa HĐ tăng SL cho đủ đơn / giảm SL → đơn luôn completed; kho & nợ.
BEGIN;
DO $s$
DECLARE kh uuid; d uuid; h1 uuid; r record;
BEGIN
  PERFORM pg_temp.bat_dau(); kh := pg_temp.dung();
  d := pg_temp.don(kh, jsonb_build_array(pg_temp.dl(2, 'lon', 40, 10000)));
  h1 := pg_temp.hd(d, pg_temp.dong_hd(d, ARRAY[10]::numeric[]));
  SELECT * INTO r FROM reissue_invoice(h1, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(h1), '{0,quantity}', '40'), 'invoice_date', current_date));
  PERFORM pg_temp.dat(r.order_status = 'completed', 'S20 sau sửa tăng đủ: đơn ' || r.order_status);
  PERFORM pg_temp.kiem(kh, d, 'S20.1');
  SELECT * INTO r FROM reissue_invoice(r.invoice_id, jsonb_build_object('lines', jsonb_set(pg_temp.dong_cua_hd(r.invoice_id), '{0,quantity}', '35'), 'invoice_date', current_date));
  PERFORM pg_temp.dat(r.order_status = 'completed', 'S20 sau sửa giảm: đơn ' || r.order_status);
  PERFORM pg_temp.dat((SELECT sum(qty_on_hand) FROM batches WHERE product_id = pg_temp.p(2)) = 1030 - 35, 'S20 kho P02 ≠ −35');
  PERFORM pg_temp.kiem(kh, d, 'S20.2');
  PERFORM pg_temp.dat(pg_temp.no_kh(kh) = 350000, 'S20 nợ ≠ 350000');
  PERFORM pg_temp.ket('S20', 'sửa HĐ tăng / giảm SL: đơn vẫn completed, không huỷ đơn');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S20 (ngoại lệ) %', SQLERRM;
END $s$;
ROLLBACK;
