-- ====================================================================
-- QUÉT NGHIỆP VỤ PHIẾU TRẢ HÀNG (tự sinh theo hóa đơn / tự lập gắn HĐ / tự lập độc lập)
--   Chạy: psql -d q_tra -f scripts/sql/quet/phieu-tra.sql   (DB thử ở máy, KHÔNG chạy trên Supabase)
--   Mỗi kịch bản: BEGIN … DO … ROLLBACK — không để lại dữ liệu. In NOTICE 'OK …' / 'LỖI …' / 'CHẶN …'.
--   Kịch bản nào nổ lỗi bất ngờ thì in 'LỖI <mã>: <thông điệp>' và đi tiếp kịch bản sau.
--
-- Bất biến kiểm sau mỗi bước (pg_temp.kiem):
--   INV-A kho   : Σ tồn (mọi lô) = đầu kỳ − Σ hàng trên HĐ đã ghi sổ (quy cơ sở) + Σ hàng phiếu trả 'completed';
--                 và Σ tồn = đầu kỳ + Σ dòng phiếu nhập − Σ dòng phiếu xuất (sổ kho khớp lô).
--   INV-B nợ    : Σ(amount−paid) các dòng status<>'paid' của khách
--                 = Σ tổng HĐ posted − Σ khoản có đang tính − Σ payments.
--   INV-C       : credit_note_amount = Σ line_total dòng không phải hàng đổi.
--   INV-D       : revenue_date: tự sinh (submitted/completed, HĐ posted) = ngày HĐ; tự lập completed = ngày ghi có; khác = NULL.
--   INV-E       : tự sinh không bao giờ 'cancelled'; tự lập không bao giờ 'submitted'.
-- ====================================================================
\set ON_ERROR_STOP off
\pset pager off
SET client_min_messages = notice;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', false);

-- Quyền cho vai authenticated (để chạy vài bước như trình duyệt) — chỉ DB thử.
GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

-- ---------------------------------------------------------------------
-- Dựng bộ dữ liệu riêng cho một kịch bản: khách mới, 3 mặt hàng mới, 1 đơn 'submitted'.
--   P1: cơ sở 'hop', 'thung' = 12; đơn 5 thùng × 120.000 = 600.000; tồn sale 1000 hộp, giá vốn 800/hộp
--   P2: cơ sở 'goi'; đơn 20 gói × 5.000 = 100.000; tồn sale 500 gói, giá vốn 3.000
--   P3: cơ sở 'chai' (KHÔNG có trên đơn/HĐ); tồn sale 100 chai, giá vốn 5.000
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;

CREATE OR REPLACE FUNCTION pg_temp.la(p_n int) RETURNS void LANGUAGE sql AS
$f$ SELECT set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, false) $f$;

DROP TYPE IF EXISTS pg_temp.bo CASCADE;
CREATE TYPE pg_temp.bo AS (cust uuid, p1 uuid, p2 uuid, p3 uuid, ord uuid, l1 uuid, l2 uuid);

CREATE OR REPLACE FUNCTION pg_temp.moi(p_tag text) RETURNS pg_temp.bo
LANGUAGE plpgsql AS $f$
DECLARE
  cust uuid; p1 uuid; p2 uuid; p3 uuid; ord uuid; l1 uuid; l2 uuid;
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_seq int;
BEGIN
  PERFORM pg_temp.la(1);
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES (v_org, 'KH quét ' || p_tag, 'Chủ ' || p_tag, '09' || lpad((random()*1e8)::int::text, 8, '0'), 'Đ/c ' || p_tag)
  RETURNING id INTO cust;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'QT1-' || p_tag, 'Quét P1 ' || p_tag, 'hop', 0, 10000, 'active') RETURNING id INTO p1;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'QT2-' || p_tag, 'Quét P2 ' || p_tag, 'goi', 0, 5000, 'active') RETURNING id INTO p2;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'QT3-' || p_tag, 'Quét P3 ' || p_tag, 'chai', 0, 8000, 'active') RETURNING id INTO p3;
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (p1, 'thung', 12);
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, p1, 'QB1-' || p_tag, current_date + 400, 1000, 1000, 800, 'sale', now() - interval '10 day'),
         (v_org, p2, 'QB2-' || p_tag, current_date + 400, 500, 500, 3000, 'sale', now() - interval '10 day'),
         (v_org, p3, 'QB3-' || p_tag, current_date + 400, 100, 100, 5000, 'sale', now() - interval '10 day');
  UPDATE batches SET warehouse_zone = 'sale' WHERE product_id IN (p1, p2, p3);
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq,
                            subtotal, total, payment_terms, order_date)
  VALUES (v_org, 'QDH-' || p_tag || '-' || v_seq, cust, pg_temp.u(4), 'submitted', v_seq, 700000, 700000, 'COD', current_date)
  RETURNING id INTO ord;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p1, 'thung', 5, 120000, 600000, 12, 0) RETURNING id INTO l1;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p2, 'goi', 20, 5000, 100000, 1, 0) RETURNING id INTO l2;
  RETURN ROW(cust, p1, p2, p3, ord, l1, l2)::pg_temp.bo;
END $f$;

-- Dòng hóa đơn đầy đủ của đơn (5 thùng P1 + 20 gói P2).
CREATE OR REPLACE FUNCTION pg_temp.dong_don(d pg_temp.bo) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(
    jsonb_build_object('order_line_id', d.l1, 'product_id', d.p1, 'unit_name', 'thung', 'quantity', 5, 'unit_price', 120000, 'vat_rate', 0),
    jsonb_build_object('order_line_id', d.l2, 'product_id', d.p2, 'unit_name', 'goi',   'quantity', 20, 'unit_price', 5000,  'vat_rate', 0))
$f$;

-- Dòng hiện có của một hóa đơn (để lập lại y nguyên).
CREATE OR REPLACE FUNCTION pg_temp.dong_hd(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'is_exchange', is_exchange, 'vat_rate', vat_rate) ORDER BY sort_order)
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;

CREATE OR REPLACE FUNCTION pg_temp.xuat(p_ord uuid, p_lines jsonb, p_adds jsonb DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM post_invoice(jsonb_strip_nulls(jsonb_build_object(
    'order_id', p_ord, 'lines', p_lines, 'return_adds', p_adds, 'invoice_date', p_date, 'allow_oversell', true)));
  RETURN r.invoice_id;
END $f$;

-- Nợ theo luật màn hình (loadCustomerDebt): Σ(amount−paid), status<>'paid'.
CREATE OR REPLACE FUNCTION pg_temp.no(c uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = c AND status <> 'paid'
$f$;
-- Nợ sổ sách (mọi dòng, không lọc trạng thái).
CREATE OR REPLACE FUNCTION pg_temp.no_so(c uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = c
$f$;
-- Nợ kỳ vọng từ chứng từ.
CREATE OR REPLACE FUNCTION pg_temp.no_ky_vong(c uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT
    COALESCE((SELECT sum(total) FROM sales_invoices WHERE customer_id = c AND status = 'posted'), 0)
  - COALESCE((SELECT sum(COALESCE(r.credit_note_amount, 0)) FROM returns r
               LEFT JOIN sales_invoices si ON si.id = r.invoice_id
              WHERE r.customer_id = c AND r.applied_receipt_id IS NULL
                AND ((COALESCE(r.credit_with_invoice, false) AND r.status IN ('submitted', 'completed') AND si.status = 'posted')
                  OR (NOT COALESCE(r.credit_with_invoice, false) AND r.status = 'completed'
                      AND (si.status = 'posted' OR (r.invoice_id IS NULL AND r.order_id IS NULL))))), 0)
  - COALESCE((SELECT sum(pm.amount) FROM payments pm JOIN receivables rc ON rc.id = pm.receivable_id
              WHERE rc.customer_id = c), 0)
$f$;

-- Tồn thực tế của một mặt hàng (mọi lô / theo kho).
CREATE OR REPLACE FUNCTION pg_temp.ton(p uuid, z text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND (z IS NULL OR warehouse_zone = z)
$f$;
-- Tồn kỳ vọng từ chứng từ (đầu kỳ − HĐ posted + phiếu trả completed), quy đơn vị cơ sở.
CREATE OR REPLACE FUNCTION pg_temp.ton_ky_vong(p uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT sum(qty_initial) FROM batches WHERE product_id = p AND batch_code LIKE 'QB%'), 0)
  - COALESCE((SELECT sum(sil.quantity * COALESCE(sil.conversion_factor, 1)) FROM sales_invoice_lines sil
              JOIN sales_invoices si ON si.id = sil.invoice_id
              WHERE sil.product_id = p AND si.status = 'posted'), 0)
  + COALESCE((SELECT sum(rl.quantity * COALESCE((SELECT pu.conversion FROM product_units pu
                  WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1))
              FROM return_lines rl JOIN returns r ON r.id = rl.return_id
              WHERE rl.product_id = p AND r.status = 'completed'), 0)
$f$;
-- Tồn theo sổ kho: đầu kỳ + Σ nhập − Σ xuất (dòng phiếu đã ghi sổ).
CREATE OR REPLACE FUNCTION pg_temp.ton_so_kho(p uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT sum(qty_initial) FROM batches WHERE product_id = p AND batch_code LIKE 'QB%'), 0)
  + COALESCE((SELECT sum(CASE se.type WHEN 'import' THEN sel.qty_in_base_uom WHEN 'export' THEN -sel.qty_in_base_uom ELSE 0 END)
              FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
              WHERE sel.product_id = p AND se.status = 'posted'), 0)
$f$;

-- Kiểm mọi bất biến cho một bộ dữ liệu; trả số lỗi, in chi tiết.
CREATE OR REPLACE FUNCTION pg_temp.kiem(p_buoc text, d pg_temp.bo) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE
  n int := 0; p uuid; x record; v_no numeric; v_kv numeric; v_so numeric;
BEGIN
  FOREACH p IN ARRAY ARRAY[d.p1, d.p2, d.p3] LOOP
    IF pg_temp.ton(p) <> pg_temp.ton_ky_vong(p) THEN
      n := n + 1; RAISE NOTICE '   LỖI INV-A [%] tồn % = % ≠ kỳ vọng chứng từ %', p_buoc,
        (SELECT sku FROM products WHERE id = p), pg_temp.ton(p), pg_temp.ton_ky_vong(p);
    END IF;
    IF pg_temp.ton(p) <> pg_temp.ton_so_kho(p) THEN
      n := n + 1; RAISE NOTICE '   LỖI INV-A [%] tồn % = % ≠ sổ kho %', p_buoc,
        (SELECT sku FROM products WHERE id = p), pg_temp.ton(p), pg_temp.ton_so_kho(p);
    END IF;
  END LOOP;
  v_no := pg_temp.no(d.cust); v_kv := pg_temp.no_ky_vong(d.cust); v_so := pg_temp.no_so(d.cust);
  IF v_no <> v_kv THEN
    n := n + 1; RAISE NOTICE '   LỖI INV-B [%] nợ màn hình % ≠ kỳ vọng % (nợ sổ, không lọc status: %)', p_buoc, v_no, v_kv, v_so;
  END IF;
  FOR x IN SELECT r.id, r.return_code, r.status, COALESCE(r.credit_with_invoice, false) AS ts, r.credit_note_amount,
                  r.revenue_date, r.credited_at, r.invoice_id,
                  (SELECT COALESCE(sum(line_total), 0) FROM return_lines rl WHERE rl.return_id = r.id AND NOT COALESCE(rl.is_exchange, false)) AS sum_l,
                  (SELECT si.invoice_date FROM sales_invoices si WHERE si.id = r.invoice_id AND si.status = 'posted') AS ngay_hd
           FROM returns r WHERE r.customer_id = d.cust
  LOOP
    IF COALESCE(x.credit_note_amount, 0) <> x.sum_l THEN
      n := n + 1; RAISE NOTICE '   LỖI INV-C [%] % credit % ≠ Σ dòng %', p_buoc, x.return_code, x.credit_note_amount, x.sum_l;
    END IF;
    IF x.revenue_date IS DISTINCT FROM (CASE
         WHEN x.ts AND x.status IN ('submitted', 'completed') AND x.invoice_id IS NOT NULL THEN x.ngay_hd
         WHEN x.status = 'completed' THEN (x.credited_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         ELSE NULL END) THEN
      n := n + 1; RAISE NOTICE '   LỖI INV-D [%] % (%/tự sinh=%) revenue_date %', p_buoc, x.return_code, x.status, x.ts, x.revenue_date;
    END IF;
    IF (x.ts AND x.status = 'cancelled') OR (NOT x.ts AND x.status = 'submitted') THEN
      n := n + 1; RAISE NOTICE '   LỖI INV-E [%] % tự sinh=% ở trạng thái %', p_buoc, x.return_code, x.ts, x.status;
    END IF;
  END LOOP;
  RETURN n;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.no_hd(p_inv uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT amount FROM receivables WHERE invoice_id = p_inv
$f$;

-- Gọi một câu lệnh, trả mã lỗi (NULL = chạy được).
CREATE OR REPLACE FUNCTION pg_temp.thu(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN split_part(SQLERRM, ':', 1);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.ket(p_id text, p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok THEN RAISE NOTICE 'OK   % %', p_id, p_msg; ELSE RAISE NOTICE 'LỖI % %', p_id, p_msg; END IF;
END $f$;

-- Đơn thứ hai cho cùng khách: 10 gói P2 × 5.000 = 50.000, xuất luôn hóa đơn.
CREATE OR REPLACE FUNCTION pg_temp.don2(d pg_temp.bo, p_qty numeric DEFAULT 10) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_ord uuid; v_l uuid; v_seq int;
BEGIN
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq, subtotal, total, payment_terms, order_date)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'QDH2-' || v_seq, d.cust, pg_temp.u(4), 'submitted', v_seq, p_qty * 5000, p_qty * 5000, 'COD', current_date)
  RETURNING id INTO v_ord;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (v_ord, d.p2, 'goi', p_qty, 5000, p_qty * 5000, 1, 0) RETURNING id INTO v_l;
  RETURN pg_temp.xuat(v_ord, jsonb_build_array(jsonb_build_object('order_line_id', v_l, 'product_id', d.p2,
           'unit_name', 'goi', 'quantity', p_qty, 'unit_price', 5000, 'vat_rate', 0)));
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.tra1(d pg_temp.bo, p_qty numeric DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', 'thung', 'quantity', p_qty, 'unit_price', 120000, 'vat_rate', 0))
$f$;

-- Thu tiền một hóa đơn (tuỳ chọn rút dư có).
CREATE OR REPLACE FUNCTION pg_temp.thu_tien(d pg_temp.bo, p_inv uuid, p_amt numeric, p_use numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN create_cash_receipt(jsonb_build_object('customer_id', d.cust, 'method', 'cash', 'use_credit', p_use,
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = p_inv), 'amount', p_amt))));
END $f$;

-- ====================================================================
-- NHÓM 1 — PHIẾU TRẢ TỰ SINH (return_adds lúc xuất hóa đơn)
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_err text; v_n int;
BEGIN
  d := pg_temp.moi('S1');
  -- S1.1 xuất HĐ 700.000 kèm trả 1 thùng P1 (120.000)
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  e := pg_temp.kiem('S1.1', d);
  PERFORM pg_temp.ket('S1.1', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'submitted'
      AND (SELECT credit_with_invoice FROM returns WHERE id = v_ret) AND pg_temp.no_hd(v_inv) = 580000
      AND pg_temp.ton(d.p1) = 940 AND (SELECT revenue_date FROM returns WHERE id = v_ret) = current_date,
    format('tự sinh Chờ xử lý: nợ HĐ %s (kỳ vọng 580000), tồn P1 %s (940), revenue_date %s',
      pg_temp.no_hd(v_inv), pg_temp.ton(d.p1), (SELECT revenue_date FROM returns WHERE id = v_ret)));

  -- S1.2 hoàn thành (kho sale): nhập 12 hộp, nợ giữ nguyên
  PERFORM complete_return(v_ret, 'sale');
  e := pg_temp.kiem('S1.2', d);
  PERFORM pg_temp.ket('S1.2', e = 0 AND pg_temp.no_hd(v_inv) = 580000 AND pg_temp.ton(d.p1, 'sale') = 952,
    format('hoàn thành: nợ HĐ %s (580000), tồn sale P1 %s (952)', pg_temp.no_hd(v_inv), pg_temp.ton(d.p1, 'sale')));

  -- S1.5b hoàn thành lần hai khi đã completed → chặn
  v_err := pg_temp.thu(format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ket('S1.2b', v_err = 'RETURN_NOT_SUBMITTED', 'hoàn thành lại phiếu đã nhập kho bị chặn: ' || COALESCE(v_err, 'KHÔNG CHẶN'));

  -- S1.3 huỷ phiếu đã nhập: đảo kho, về Chờ xử lý, nợ giữ
  PERFORM cancel_return(v_ret, 'thử huỷ');
  e := pg_temp.kiem('S1.3', d);
  PERFORM pg_temp.ket('S1.3', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'submitted'
      AND pg_temp.no_hd(v_inv) = 580000 AND pg_temp.ton(d.p1) = 940,
    format('huỷ nhập: trạng thái %s (submitted), nợ HĐ %s, tồn P1 %s (940)',
      (SELECT status FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv), pg_temp.ton(d.p1)));

  -- S1.4 hoàn thành lại vào kho date, rồi huỷ lần 2: chỉ đảo phiếu nhập mới
  PERFORM complete_return(v_ret, 'date');
  e := pg_temp.kiem('S1.4a', d);
  PERFORM pg_temp.ket('S1.4a', e = 0 AND pg_temp.ton(d.p1, 'date') = 12 AND pg_temp.ton(d.p1, 'sale') = 940,
    format('nhập lại kho date: tồn date %s (12), sale %s (940)', pg_temp.ton(d.p1, 'date'), pg_temp.ton(d.p1, 'sale')));
  PERFORM cancel_return(v_ret, 'thử huỷ lần 2');
  e := pg_temp.kiem('S1.4b', d);
  SELECT count(*) INTO v_n FROM stock_entries WHERE notes = 'Đảo phiếu trả ' || v_ret;
  PERFORM pg_temp.ket('S1.4b', e = 0 AND pg_temp.ton(d.p1, 'date') = 0 AND pg_temp.ton(d.p1, 'sale') = 940 AND v_n = 2
      AND (SELECT count(*) FROM stock_entries WHERE notes LIKE 'Nhập lại từ phiếu trả ' || v_ret || ' (đã đảo)') = 2,
    format('huỷ lần 2 không đảo trùng: tồn date %s, sale %s, số phiếu đảo %s (2)', pg_temp.ton(d.p1, 'date'), pg_temp.ton(d.p1, 'sale'), v_n));

  -- S1.5 huỷ khi đang Chờ xử lý → CHẶN
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ket('S1.5', v_err = 'RETURN_FOLLOWS_INVOICE', 'huỷ tự sinh Chờ xử lý → ' || COALESCE(v_err, 'KHÔNG CHẶN'));

  -- S1.6 sửa phiếu tự sinh qua POS → CHẶN
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust,
            'invoice_id', v_inv, 'lines', pg_temp.tra1(d, 3))));
  PERFORM pg_temp.ket('S1.6', v_err = 'RETURN_FOLLOWS_INVOICE', 'save_pos_return trên phiếu tự sinh → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S1.6b: ghi thẳng từ trình duyệt (vai authenticated) vào phiếu tự sinh → trigger chặn
BEGIN;
CREATE TEMP TABLE _s16 AS SELECT NULL::uuid AS ret, NULL::uuid AS line;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid;
BEGIN
  d := pg_temp.moi('S16');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  UPDATE _s16 SET ret = (SELECT id FROM returns WHERE invoice_id = v_inv),
                  line = (SELECT rl.id FROM return_lines rl JOIN returns r ON r.id = rl.return_id WHERE r.invoice_id = v_inv);
END $t$;
GRANT SELECT, UPDATE ON _s16 TO authenticated;
SET ROLE authenticated;
DO $t$
DECLARE v_err text; v_err2 text; v_err3 text;
BEGIN
  v_err := pg_temp.thu(format('UPDATE returns SET status = %L WHERE id = %L', 'cancelled', (SELECT ret FROM _s16)));
  v_err2 := pg_temp.thu(format('UPDATE return_lines SET quantity = 9, line_total = 1080000 WHERE id = %L', (SELECT line FROM _s16)));
  v_err3 := pg_temp.thu(format('DELETE FROM returns WHERE id = %L', (SELECT ret FROM _s16)));
  -- RLS có thể lọc im lặng (0 dòng) — coi như chặn nếu phiếu vẫn còn.
  IF v_err3 IS NULL AND EXISTS (SELECT 1 FROM returns WHERE id = (SELECT ret FROM _s16)) THEN v_err3 := 'RETURN_FOLLOWS_INVOICE'; END IF;
  PERFORM pg_temp.ket('S1.6b', v_err IN ('RETURN_FOLLOWS_INVOICE', 'PHIEU_TRA_KHOA') AND v_err2 IN ('RETURN_FOLLOWS_INVOICE', 'PHIEU_TRA_KHOA') AND v_err3 IN ('RETURN_FOLLOWS_INVOICE', 'PHIEU_TRA_KHOA'),
    format('ghi thẳng (authenticated) vào phiếu tự sinh: đổi trạng thái → %s; sửa dòng → %s; xoá → %s', COALESCE(v_err, 'LỌT'), COALESCE(v_err2, 'LỌT'), COALESCE(v_err3, 'LỌT')));
END $t$;
RESET ROLE;
ROLLBACK;

-- S1.7–S1.9: sửa hàng trả từ hóa đơn (reissue return_edits), bỏ hết dòng, huỷ hóa đơn
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_inv2 uuid; v_inv3 uuid; v_inv4 uuid; v_ret uuid; v_line uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S17');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  SELECT id INTO v_line FROM return_lines WHERE return_id = v_ret;

  -- S1.7 sửa SL trả 1 → 2 thùng
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true,
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 2))));
  v_inv2 := r.invoice_id;
  e := pg_temp.kiem('S1.7', d);
  PERFORM pg_temp.ket('S1.7', e = 0 AND (SELECT invoice_id FROM returns WHERE id = v_ret) = v_inv2
      AND (SELECT status FROM returns WHERE id = v_ret) = 'submitted' AND (SELECT credit_note_amount FROM returns WHERE id = v_ret) = 240000
      AND pg_temp.no_hd(v_inv2) = 460000 AND pg_temp.no_hd(v_inv) IS NULL AND pg_temp.ton(d.p1) = 940,
    format('reissue sửa SL trả: credit %s (240000), nợ tờ mới %s (460000), tờ cũ còn công nợ? %s, tồn P1 %s (940)',
      (SELECT credit_note_amount FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv2), pg_temp.no_hd(v_inv) IS NOT NULL, pg_temp.ton(d.p1)));

  -- S1.7b thêm dòng trả mới khi sửa (return_adds) → gộp vào CÙNG phiếu, không nhân đôi
  SELECT * INTO r FROM reissue_invoice(v_inv2, jsonb_build_object('lines', pg_temp.dong_hd(v_inv2), 'allow_oversell', true,
     'return_adds', jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi', 'quantity', 4, 'unit_price', 5000, 'vat_rate', 0))));
  v_inv3 := r.invoice_id;
  e := pg_temp.kiem('S1.7b', d);
  PERFORM pg_temp.ket('S1.7b', e = 0 AND (SELECT count(*) FROM returns WHERE customer_id = d.cust) = 1
      AND (SELECT count(*) FROM return_lines WHERE return_id = v_ret) = 2
      AND (SELECT credit_note_amount FROM returns WHERE id = v_ret) = 260000 AND pg_temp.no_hd(v_inv3) = 440000,
    format('reissue thêm dòng trả: số phiếu %s (1), số dòng %s (2), credit %s (260000), nợ %s (440000)',
      (SELECT count(*) FROM returns WHERE customer_id = d.cust), (SELECT count(*) FROM return_lines WHERE return_id = v_ret),
      (SELECT credit_note_amount FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv3)));

  -- S1.8 bỏ hết dòng trả → phiếu về Nháp, gỡ khỏi HĐ, nợ đủ 700.000
  SELECT * INTO r FROM reissue_invoice(v_inv3, jsonb_build_object('lines', pg_temp.dong_hd(v_inv3), 'allow_oversell', true,
     'return_edits', (SELECT jsonb_agg(jsonb_build_object('line_id', id, 'quantity', 0)) FROM return_lines WHERE return_id = v_ret)));
  v_inv4 := r.invoice_id;
  e := pg_temp.kiem('S1.8', d);
  PERFORM pg_temp.ket('S1.8', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'draft'
      AND (SELECT invoice_id FROM returns WHERE id = v_ret) IS NULL AND pg_temp.no_hd(v_inv4) = 700000
      AND COALESCE((SELECT credit_note_amount FROM returns WHERE id = v_ret), 0) = 0,
    format('bỏ hết dòng trả: trạng thái %s (draft), invoice %s (NULL), credit %s (0), nợ %s (700000), cwi %s',
      (SELECT status FROM returns WHERE id = v_ret), (SELECT invoice_id FROM returns WHERE id = v_ret),
      (SELECT credit_note_amount FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv4), (SELECT credit_with_invoice FROM returns WHERE id = v_ret)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1.7-8 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S1.9 huỷ hóa đơn có phiếu tự sinh Chờ xử lý → phiếu về Nháp, gỡ HĐ, công nợ HĐ xoá; xuất lại → phiếu bám lại
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_inv2 uuid; v_ret uuid; e int; v_err text;
BEGIN
  d := pg_temp.moi('S19');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM cancel_invoice(v_inv, 'thử huỷ');
  e := pg_temp.kiem('S1.9a', d);
  PERFORM pg_temp.ket('S1.9a', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'draft' AND (SELECT invoice_id FROM returns WHERE id = v_ret) IS NULL
      AND pg_temp.no(d.cust) = 0 AND pg_temp.ton(d.p1) = 1000 AND (SELECT revenue_date FROM returns WHERE id = v_ret) IS NULL,
    format('huỷ HĐ: phiếu %s (draft), nợ khách %s (0), tồn P1 %s (1000), revenue_date %s',
      (SELECT status FROM returns WHERE id = v_ret), pg_temp.no(d.cust), pg_temp.ton(d.p1), (SELECT revenue_date FROM returns WHERE id = v_ret)));
  -- phiếu nháp theo đơn: không huỷ / không hoàn thành được ở phiếu
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ket('S1.9b', v_err = 'RETURN_FOLLOWS_ORDER', 'huỷ phiếu nháp theo đơn → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ket('S1.9c', v_err IS NOT NULL, 'hoàn thành phiếu nháp theo đơn chưa có HĐ → ' || COALESCE(v_err, 'KHÔNG CHẶN (nhập khống)'));
  -- xuất lại
  v_inv2 := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  e := pg_temp.kiem('S1.9d', d);
  PERFORM pg_temp.ket('S1.9d', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'submitted' AND (SELECT invoice_id FROM returns WHERE id = v_ret) = v_inv2
      AND (SELECT credit_with_invoice FROM returns WHERE id = v_ret) AND pg_temp.no_hd(v_inv2) = 580000,
    format('xuất lại: phiếu %s bám HĐ mới? %s, nợ %s (580000)', (SELECT status FROM returns WHERE id = v_ret),
      (SELECT invoice_id FROM returns WHERE id = v_ret) = v_inv2, pg_temp.no_hd(v_inv2)));
  -- S1.10 hoàn thành rồi huỷ HĐ → CHẶN LOCKED_RETURN_DONE
  PERFORM complete_return(v_ret, 'sale');
  v_err := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', v_inv2, 'x'));
  PERFORM pg_temp.ket('S1.10', v_err = 'LOCKED_RETURN_DONE', 'huỷ HĐ có phiếu tự sinh đã nhập kho → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
  -- S1.12 sửa HĐ không chọn tra_da_nhap → hỏi
  v_err := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', v_inv2, jsonb_build_object('lines', pg_temp.dong_hd(v_inv2), 'allow_oversell', true)));
  PERFORM pg_temp.ket('S1.12', v_err = 'REISSUE_RETURN_STOCKED', 'sửa HĐ có phiếu đã nhập, không chọn → ' || COALESCE(v_err, 'KHÔNG HỎI'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1.9 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S1.11 sửa HĐ có phiếu tự sinh ĐÃ NHẬP: lam_lai (SL 1→2, kho cũ date) / giu (không đụng kho)
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_line uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S111');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  SELECT id INTO v_line FROM return_lines WHERE return_id = v_ret;
  PERFORM complete_return(v_ret, 'date');
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true, 'tra_da_nhap', 'lam_lai',
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 2))));
  e := pg_temp.kiem('S1.11a', d);
  PERFORM pg_temp.ket('S1.11a', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'completed' AND pg_temp.ton(d.p1, 'date') = 24
      AND pg_temp.no_hd(r.invoice_id) = 460000,
    format('lam_lai: phiếu %s, tồn date %s (24), nợ tờ mới %s (460000)', (SELECT status FROM returns WHERE id = v_ret), pg_temp.ton(d.p1, 'date'), pg_temp.no_hd(r.invoice_id)));
  v_inv := r.invoice_id;
  -- giu: đổi giá bán P2 trên HĐ (20 gói × 6.000) — phiếu giữ nguyên nhập kho
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines',
     (SELECT jsonb_agg(CASE WHEN (x->>'product_id')::uuid = d.p2 THEN x || '{"unit_price": 6000}'::jsonb ELSE x END) FROM jsonb_array_elements(pg_temp.dong_hd(v_inv)) x),
     'allow_oversell', true, 'tra_da_nhap', 'giu'));
  e := pg_temp.kiem('S1.11b', d);
  PERFORM pg_temp.ket('S1.11b', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'completed' AND pg_temp.ton(d.p1, 'date') = 24
      AND (SELECT invoice_id FROM returns WHERE id = v_ret) = r.invoice_id AND pg_temp.no_hd(r.invoice_id) = 720000 - 240000,
    format('giu: tồn date %s (24), nợ tờ mới %s (480000)', pg_temp.ton(d.p1, 'date'), pg_temp.no_hd(r.invoice_id)));
  -- giu + return_edits trên phiếu đã nhập: sửa bị bỏ qua IM LẶNG?
  v_inv := r.invoice_id;
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true, 'tra_da_nhap', 'giu',
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 5))));
  -- Theo thiết kế ("Không — giữ nguyên phiếu nhập, không sửa dòng hàng trả"), nhưng máy chủ BỎ QUA IM LẶNG thay vì báo lỗi.
  PERFORM pg_temp.ket('S1.11c', (SELECT quantity FROM return_lines WHERE id = v_line) = 2,
    format('giu + return_edits SL 2→5: SL sau %s (giữ 2 — sửa bị bỏ qua im lặng, không báo lỗi)', (SELECT quantity FROM return_lines WHERE id = v_line)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1.11 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S1.13 / S6.1 revenue_date: HĐ lùi ngày → phiếu trừ vào ngày HĐ ngay khi Chờ xử lý; hoàn thành hôm nay vẫn ngày HĐ; sửa HĐ đổi ngày → theo
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S113');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d), date '2026-09-20');
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.ket('S6.1a', (SELECT revenue_date FROM returns WHERE id = v_ret) = date '2026-09-20',
    format('tự sinh Chờ xử lý, HĐ ngày 20/09: revenue_date %s', (SELECT revenue_date FROM returns WHERE id = v_ret)));
  PERFORM complete_return(v_ret, 'sale');
  PERFORM pg_temp.ket('S6.1b', (SELECT revenue_date FROM returns WHERE id = v_ret) = date '2026-09-20',
    format('tự sinh hoàn thành hôm nay: revenue_date %s (2026-09-20)', (SELECT revenue_date FROM returns WHERE id = v_ret)));
  PERFORM cancel_return(v_ret, 'x');
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true, 'invoice_date', '2026-09-22'));
  e := pg_temp.kiem('S6.1c', d);
  PERFORM pg_temp.ket('S6.1c', e = 0 AND (SELECT revenue_date FROM returns WHERE id = v_ret) = date '2026-09-22',
    format('sửa HĐ sang 22/09: revenue_date %s', (SELECT revenue_date FROM returns WHERE id = v_ret)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1.13 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 2 — HÀNG ĐỔI (is_exchange)
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int;
BEGIN
  d := pg_temp.moi('S2');
  -- HĐ: 5 thùng P1 + 20 gói P2 + 4 gói P2 hàng đổi giá 0; phiếu: trả 1 thùng P1 (120.000) + thu về 4 gói P2 đổi (5.000/gói, không ghi có)
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d) || jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi',
             'quantity', 4, 'unit_price', 0, 'vat_rate', 0, 'is_exchange', true, 'note', '[Exchange]')),
           pg_temp.tra1(d) || jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi', 'quantity', 4,
             'unit_price', 5000, 'vat_rate', 0, 'is_exchange', true)));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  e := pg_temp.kiem('S2.1a', d);
  PERFORM pg_temp.ket('S2.1a', e = 0 AND (SELECT total FROM sales_invoices WHERE id = v_inv) = 700000
      AND (SELECT credit_note_amount FROM returns WHERE id = v_ret) = 120000 AND pg_temp.no_hd(v_inv) = 580000 AND pg_temp.ton(d.p2) = 476,
    format('đổi hàng lúc xuất: tổng HĐ %s (700000), credit %s (120000 — hàng đổi không ghi có), nợ %s (580000), tồn P2 %s (476 = 500−20−4)',
      (SELECT total FROM sales_invoices WHERE id = v_inv), (SELECT credit_note_amount FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv), pg_temp.ton(d.p2)));
  PERFORM complete_return(v_ret, 'date');
  e := pg_temp.kiem('S2.1b', d);
  PERFORM pg_temp.ket('S2.1b', e = 0 AND pg_temp.ton(d.p2, 'date') = 4 AND pg_temp.ton(d.p1, 'date') = 12 AND pg_temp.no_hd(v_inv) = 580000,
    format('hoàn thành: hàng đổi thu về kho date %s (4), P1 date %s (12), nợ %s', pg_temp.ton(d.p2, 'date'), pg_temp.ton(d.p1, 'date'), pg_temp.no_hd(v_inv)));
  PERFORM cancel_return(v_ret, 'x');
  e := pg_temp.kiem('S2.1c', d);
  PERFORM pg_temp.ket('S2.1c', e = 0 AND pg_temp.ton(d.p2) = 476, format('huỷ nhập: tồn P2 %s (476)', pg_temp.ton(d.p2)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S2 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S2.2 chỉ có hàng đổi: credit 0, nợ đủ
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int;
BEGIN
  d := pg_temp.moi('S22');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi', 'quantity', 4,
             'unit_price', 5000, 'vat_rate', 0, 'is_exchange', true)));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  e := pg_temp.kiem('S2.2', d);
  PERFORM pg_temp.ket('S2.2', e = 0 AND COALESCE((SELECT credit_note_amount FROM returns WHERE id = v_ret), 0) = 0 AND pg_temp.no_hd(v_inv) = 700000,
    format('chỉ hàng đổi: credit %s (0), nợ %s (700000)', (SELECT credit_note_amount FROM returns WHERE id = v_ret), pg_temp.no_hd(v_inv)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S2.2 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 5 — TRẢ VƯỢT HĐ, TRẢ HÀNG NGOÀI HĐ, QUY ĐỔI ĐƠN VỊ
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_cost numeric;
BEGIN
  d := pg_temp.moi('S5');
  -- S5.1 trả 7 thùng (840.000) > HĐ 700.000 → công nợ âm −140.000, 'open'
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d, 7)
           -- S5.2 + trả 5 chai P3 KHÔNG có trên HĐ (8.000/chai)
           || jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 5, 'unit_price', 8000, 'vat_rate', 0))
           -- S5.3 + trả 6 hộp P1 theo đơn vị cơ sở (10.000/hộp)
           || jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', 'hop', 'quantity', 6, 'unit_price', 10000, 'vat_rate', 0)));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  e := pg_temp.kiem('S5.1', d);
  PERFORM pg_temp.ket('S5.1', e = 0 AND pg_temp.no_hd(v_inv) = 700000 - 840000 - 40000 - 60000
      AND (SELECT status FROM receivables WHERE invoice_id = v_inv) = 'open' AND pg_temp.no(d.cust) = -240000,
    format('trả vượt HĐ: nợ HĐ %s (−240000), trạng thái %s (open), nợ khách %s',
      pg_temp.no_hd(v_inv), (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust)));
  PERFORM complete_return(v_ret, 'sale');
  e := pg_temp.kiem('S5.2', d);
  PERFORM pg_temp.ket('S5.2', e = 0 AND pg_temp.ton(d.p3) = 105 AND pg_temp.ton(d.p1) = 1000 - 60 + 84 + 6,
    format('hoàn thành: tồn P3 %s (105), tồn P1 %s (1030 = 1000−60+84+6)', pg_temp.ton(d.p3), pg_temp.ton(d.p1)));
  -- giá vốn dòng nhập lại: theo ĐƠN VỊ CƠ SỞ (800/hộp; P3 không có trên phiếu xuất → lô gần nhất 5.000)
  SELECT max(sel.unit_cost) INTO v_cost FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
   WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret AND sel.product_id = d.p1;
  PERFORM pg_temp.ket('S5.3', v_cost = 800 AND (SELECT max(sel.unit_cost) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
        WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret AND sel.product_id = d.p3) = 5000
      AND (SELECT sum(qty_in_base_uom) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
        WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret AND sel.product_id = d.p1) = 90,
    format('giá vốn nhập lại P1 %s/hộp (800), P3 %s (5000), SL cơ sở P1 %s (90 = 7×12+6)', v_cost,
      (SELECT max(sel.unit_cost) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret AND sel.product_id = d.p3),
      (SELECT sum(qty_in_base_uom) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret AND sel.product_id = d.p1)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S5 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S5.4 sửa đơn vị dòng trả từ HĐ: 1 thùng → 6 hộp: giá 120.000×1/12 = 10.000/hộp → credit 60.000; nhập kho 6 hộp
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_line uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S54');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  SELECT id INTO v_line FROM return_lines WHERE return_id = v_ret;
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true,
     'return_edits', jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 6, 'unit_name', 'hop'))));
  PERFORM complete_return(v_ret, 'sale');
  e := pg_temp.kiem('S5.4', d);
  PERFORM pg_temp.ket('S5.4', e = 0 AND (SELECT credit_note_amount FROM returns WHERE id = v_ret) = 60000 AND pg_temp.no_hd(r.invoice_id) = 640000
      AND pg_temp.ton(d.p1) = 946,
    format('đổi thùng→hộp: credit %s (60000), nợ %s (640000), tồn P1 %s (946)', (SELECT credit_note_amount FROM returns WHERE id = v_ret),
      pg_temp.no_hd(r.invoice_id), pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S5.4 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 3 — PHIẾU TỰ LẬP GẮN HÓA ĐƠN (save_pos_return)
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_err text; v_pt uuid;
BEGIN
  d := pg_temp.moi('S3');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  -- S3.1 lập Nháp: chưa trừ nợ, chưa nhập kho
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  e := pg_temp.kiem('S3.1', d);
  PERFORM pg_temp.ket('S3.1', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'draft' AND pg_temp.no_hd(v_inv) = 700000
      AND NOT COALESCE((SELECT credit_with_invoice FROM returns WHERE id = v_ret), false),
    format('tự lập Nháp: nợ HĐ %s (700000), tồn P1 %s (940)', pg_temp.no_hd(v_inv), pg_temp.ton(d.p1)));
  -- S3.2 hoàn thành: nhập kho + trừ nợ HĐ
  PERFORM complete_return(v_ret, 'sale');
  e := pg_temp.kiem('S3.2', d);
  PERFORM pg_temp.ket('S3.2', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'completed' AND pg_temp.no_hd(v_inv) = 580000
      AND pg_temp.ton(d.p1) = 952 AND (SELECT revenue_date FROM returns WHERE id = v_ret) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    format('hoàn thành: nợ HĐ %s (580000), tồn P1 %s (952), revenue_date %s', pg_temp.no_hd(v_inv), pg_temp.ton(d.p1), (SELECT revenue_date FROM returns WHERE id = v_ret)));
  -- S3.3 sửa phiếu đã hoàn thành: không Ghi nhận → chặn; Ghi nhận SL 2 → đảo + nhập lại, nợ 460.000
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra1(d, 2))));
  PERFORM pg_temp.ket('S3.3a', v_err = 'RETURN_COMPLETED', 'sửa phiếu đã hoàn thành không Ghi nhận → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
  PERFORM save_pos_return(jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra1(d, 2), 'complete', true, 'zone', 'sale'));
  e := pg_temp.kiem('S3.3b', d);
  PERFORM pg_temp.ket('S3.3b', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'completed' AND pg_temp.no_hd(v_inv) = 460000 AND pg_temp.ton(d.p1) = 964,
    format('sửa + Ghi nhận SL 2: nợ HĐ %s (460000), tồn P1 %s (964)', pg_temp.no_hd(v_inv), pg_temp.ton(d.p1)));
  -- S3.4 thu đủ 460.000 rồi huỷ phiếu → nợ tăng lại 240.000
  v_pt := pg_temp.thu_tien(d, v_inv, 460000);
  PERFORM cancel_return(v_ret, 'huỷ sau khi đã thu');
  e := pg_temp.kiem('S3.4', d);
  PERFORM pg_temp.ket('S3.4', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'cancelled' AND pg_temp.no(d.cust) = 240000 AND pg_temp.ton(d.p1) = 940
      AND (SELECT revenue_date FROM returns WHERE id = v_ret) IS NULL,
    format('huỷ phiếu khi HĐ đã thu đủ: nợ khách %s (240000), tồn P1 %s (940), trạng thái công nợ %s', pg_temp.no(d.cust), pg_temp.ton(d.p1),
      (SELECT status FROM receivables WHERE invoice_id = v_inv)));
  -- S3.4b sửa phiếu đã huỷ → chặn
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra1(d, 2))));
  PERFORM pg_temp.ket('S3.4b', v_err = 'RETURN_LOCKED', 'sửa phiếu đã huỷ → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S3.5 HĐ đã thu ĐỦ rồi mới hoàn thành phiếu tự lập gắn HĐ → phần dư có phải trừ vào tổng nợ (luật mig 186)
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_inv2 uuid; v_ret uuid; e int; v_pt uuid; v_err text;
BEGIN
  d := pg_temp.moi('S35');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_pt := pg_temp.thu_tien(d, v_inv, 700000);
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d), 'complete', true, 'zone', 'sale'));
  e := pg_temp.kiem('S3.5a', d);
  PERFORM pg_temp.ket('S3.5a', e = 0 AND pg_temp.no(d.cust) = -120000,
    format('HĐ 700.000 đã thu đủ, trả 120.000: dòng công nợ amount %s paid %s status %s → nợ khách (màn hình) %s, kỳ vọng −120000',
      (SELECT amount FROM receivables WHERE invoice_id = v_inv), (SELECT paid FROM receivables WHERE invoice_id = v_inv),
      (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust)));
  -- dư có ấy có rút được ở phiếu thu HĐ sau không?
  v_inv2 := pg_temp.don2(d);   -- 50.000
  v_err := pg_temp.thu(format('SELECT pg_temp.thu_tien(%L::pg_temp.bo, %L, 50000, 50000)', d, v_inv2));
  e := pg_temp.kiem('S3.5b', d);
  PERFORM pg_temp.ket('S3.5b', v_err IS NULL AND e = 0 AND pg_temp.no(d.cust) = -70000,
    format('rút 50.000 dư có cho HĐ 2: %s; nợ khách %s (−70000)', COALESCE(v_err, 'được'), pg_temp.no(d.cust)));
  -- huỷ phiếu trả sau khi dư có đã dùng → nợ phải là +50.000 (HĐ1 700.000 − thu 700.000 + rút 50.000 ... )
  PERFORM cancel_return(v_ret, 'x');
  e := pg_temp.kiem('S3.5c', d);
  PERFORM pg_temp.ket('S3.5c', e = 0 AND pg_temp.no(d.cust) = 50000,
    format('huỷ phiếu sau khi dư có đã dùng: nợ khách %s (50000)', pg_temp.no(d.cust)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.5 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S3.6 phiếu tự lập của khách A gắn vào hóa đơn của khách B
BEGIN;
DO $t$
DECLARE a pg_temp.bo; b pg_temp.bo; v_inv uuid; v_ret uuid; v_err text; e int;
BEGIN
  a := pg_temp.moi('S36A');
  b := pg_temp.moi('S36B');
  v_inv := pg_temp.xuat(b.ord, pg_temp.dong_don(b));
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', a.cust, 'invoice_id', v_inv, 'reason', 'damaged',
             'lines', pg_temp.tra1(a), 'complete', true, 'zone', 'sale')));
  SELECT id INTO v_ret FROM returns WHERE customer_id = a.cust;
  e := pg_temp.kiem('S3.6', a) + pg_temp.kiem('S3.6', b);
  PERFORM pg_temp.ket('S3.6', v_err IS NOT NULL,
    format('phiếu của KH A gắn HĐ của KH B: %s; nợ HĐ của B %s (700000 nếu chặn), nợ A %s', COALESCE(v_err, 'KHÔNG CHẶN'),
      pg_temp.no_hd(v_inv), pg_temp.no(a.cust)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.6 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S3.7 phiếu tự lập gắn HĐ đã huỷ: hoàn thành bị chặn; phiếu nháp gắn HĐ bị huỷ theo HĐ
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_err text;
BEGIN
  d := pg_temp.moi('S37');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  PERFORM cancel_invoice(v_inv, 'x');
  PERFORM pg_temp.ket('S3.7a', (SELECT status FROM returns WHERE id = v_ret) = 'cancelled',
    format('huỷ HĐ → phiếu tự lập Nháp gắn HĐ: %s (cancelled)', (SELECT status FROM returns WHERE id = v_ret)));
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  v_err := pg_temp.thu(format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ket('S3.7b', v_err = 'INVOICE_NOT_POSTED', 'lập phiếu mới gắn HĐ đã huỷ rồi hoàn thành → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.7 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S3.8 phiếu lập ở màn /returns/new (create_return_with_lines: ghi CẢ invoice_id lẫn order_id, Nháp) rồi sửa / huỷ hóa đơn
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S38');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_ret := create_return_with_lines(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'order_id', d.ord, 'reason', 'damaged',
             'status', 'draft', 'credit_note_amount', 120000),
           jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', 'thung', 'quantity', 1, 'unit_price', 120000, 'line_total', 120000)));
  PERFORM pg_temp.ket('S3.8a', pg_temp.no_hd(v_inv) = 700000, format('Nháp /returns/new: nợ HĐ %s (700000)', pg_temp.no_hd(v_inv)));
  -- người dùng sửa HĐ (không đụng hàng trả)
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true));
  e := pg_temp.kiem('S3.8b', d);
  PERFORM pg_temp.ket('S3.8b', (SELECT status FROM returns WHERE id = v_ret) = 'draft' AND NOT (SELECT credit_with_invoice FROM returns WHERE id = v_ret)
      AND pg_temp.no_hd(r.invoice_id) = 700000,
    format('sau khi sửa HĐ: phiếu tự lập Nháp thành %s, tự sinh=%s, nợ tờ mới %s (kỳ vọng: vẫn Nháp tự lập, nợ 700000)',
      (SELECT status FROM returns WHERE id = v_ret), (SELECT credit_with_invoice FROM returns WHERE id = v_ret), pg_temp.no_hd(r.invoice_id)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.8 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_err text;
BEGIN
  d := pg_temp.moi('S38c');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_ret := create_return_with_lines(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'order_id', d.ord, 'reason', 'damaged',
             'status', 'draft', 'credit_note_amount', 120000),
           jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', 'thung', 'quantity', 1, 'unit_price', 120000, 'line_total', 120000)));
  PERFORM cancel_invoice(v_inv, 'x');
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ket('S3.8c', (SELECT status FROM returns WHERE id = v_ret) = 'cancelled' OR v_err IS NULL,
    format('huỷ HĐ → phiếu /returns/new: %s, invoice %s; người dùng huỷ phiếu → %s (phiếu tự lập của POS thì bị huỷ theo HĐ — S3.7a)',
      (SELECT status FROM returns WHERE id = v_ret), COALESCE((SELECT invoice_id::text FROM returns WHERE id = v_ret), 'NULL'), COALESCE(v_err, 'được')));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.8c nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S3.9 phiếu tự lập gắn HĐ + HĐ bị sửa khi phiếu đã hoàn thành (luôn 'giu')
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; r record;
BEGIN
  d := pg_temp.moi('S39');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d), 'complete', true, 'zone', 'sale'));
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true));
  e := pg_temp.kiem('S3.9', d);
  PERFORM pg_temp.ket('S3.9', e = 0 AND (SELECT invoice_id FROM returns WHERE id = v_ret) = r.invoice_id AND (SELECT status FROM returns WHERE id = v_ret) = 'completed'
      AND NOT (SELECT credit_with_invoice FROM returns WHERE id = v_ret) AND pg_temp.no_hd(r.invoice_id) = 580000,
    format('sửa HĐ có phiếu tự lập đã hoàn thành: phiếu bám tờ mới %s, nợ %s (580000)', (SELECT invoice_id FROM returns WHERE id = v_ret) = r.invoice_id, pg_temp.no_hd(r.invoice_id)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S3.9 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 4 — PHIẾU TỰ LẬP ĐỘC LẬP (không HĐ) → công nợ âm (receivables.return_id)
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_pt uuid; v_err text; v_rc uuid;
BEGIN
  d := pg_temp.moi('S4');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));                       -- nợ 700.000
  -- S4.1 trả 5 chai P3 (40.000), Ghi nhận ngay
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'zone', 'sale',
             'lines', jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 5, 'unit_price', 8000))));
  SELECT id INTO v_rc FROM receivables WHERE return_id = v_ret;
  e := pg_temp.kiem('S4.1', d);
  PERFORM pg_temp.ket('S4.1', e = 0 AND (SELECT amount FROM receivables WHERE id = v_rc) = -40000 AND (SELECT status FROM receivables WHERE id = v_rc) = 'open'
      AND pg_temp.no(d.cust) = 660000 AND pg_temp.ton(d.p3) = 105,
    format('độc lập hoàn thành: dòng âm %s/%s, nợ khách %s (660000), tồn P3 %s (105)', (SELECT amount FROM receivables WHERE id = v_rc),
      (SELECT status FROM receivables WHERE id = v_rc), pg_temp.no(d.cust), pg_temp.ton(d.p3)));
  -- S4.10 cấn trừ phiếu trả kiểu cũ ('credits') → BAD_CREDIT (đã là công nợ âm)
  v_err := pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
     'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = v_inv), 'amount', 700000)),
     'credits', jsonb_build_array(jsonb_build_object('return_id', v_ret)))));
  PERFORM pg_temp.ket('S4.10', v_err = 'BAD_CREDIT', 'cấn trừ phiếu trả kiểu cũ → ' || COALESCE(v_err, 'KHÔNG CHẶN (trừ 2 lần)'));
  -- S4.2 phiếu thu HĐ 700.000, rút dư có 40.000 → tiền mặt 660.000
  v_pt := pg_temp.thu_tien(d, v_inv, 700000, 40000);
  e := pg_temp.kiem('S4.2', d);
  PERFORM pg_temp.ket('S4.2', e = 0 AND pg_temp.no(d.cust) = 0 AND (SELECT paid FROM receivables WHERE id = v_rc) = -40000
      AND (SELECT status FROM receivables WHERE id = v_rc) = 'paid' AND (SELECT submitted_amount FROM cash_receipts WHERE id = v_pt) = 660000,
    format('rút dư có: dòng âm paid %s status %s, tiền mặt %s (660000), nợ khách %s (0)', (SELECT paid FROM receivables WHERE id = v_rc),
      (SELECT status FROM receivables WHERE id = v_rc), (SELECT submitted_amount FROM cash_receipts WHERE id = v_pt), pg_temp.no(d.cust)));
  -- S4.7 đổi khách của phiếu khi dư có đã dùng → chặn
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', (SELECT id FROM customers WHERE id <> d.cust LIMIT 1),
     'complete', true, 'lines', jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 5, 'unit_price', 8000)))));
  PERFORM pg_temp.ket('S4.7', v_err = 'RETURN_CREDIT_USED', 'đổi khách khi dư có đã dùng → ' || COALESCE(v_err, 'KHÔNG CHẶN'));
  -- S4.3 sửa SL 5 → 3 (24.000) sau khi đã dùng 40.000 → khách nợ lại 16.000
  PERFORM save_pos_return(jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'complete', true, 'zone', 'sale',
     'lines', jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 3, 'unit_price', 8000))));
  e := pg_temp.kiem('S4.3', d);
  PERFORM pg_temp.ket('S4.3', e = 0 AND pg_temp.no(d.cust) = 16000 AND pg_temp.ton(d.p3) = 103 AND (SELECT count(*) FROM receivables WHERE return_id = v_ret) = 1,
    format('sửa giảm sau khi dùng dư có: dòng âm %s/%s/%s, nợ khách %s (16000), tồn P3 %s (103)', (SELECT amount FROM receivables WHERE id = v_rc),
      (SELECT paid FROM receivables WHERE id = v_rc), (SELECT status FROM receivables WHERE id = v_rc), pg_temp.no(d.cust), pg_temp.ton(d.p3)));
  -- S4.4 huỷ phiếu → nợ lại đủ 40.000
  PERFORM cancel_return(v_ret, 'x');
  e := pg_temp.kiem('S4.4', d);
  PERFORM pg_temp.ket('S4.4', e = 0 AND pg_temp.no(d.cust) = 40000 AND pg_temp.ton(d.p3) = 100,
    format('huỷ phiếu đã dùng dư có: dòng %s/%s/%s, nợ khách %s (40000), tồn P3 %s (100)', (SELECT amount FROM receivables WHERE id = v_rc),
      (SELECT paid FROM receivables WHERE id = v_rc), (SELECT status FROM receivables WHERE id = v_rc), pg_temp.no(d.cust), pg_temp.ton(d.p3)));
  -- S4.5 huỷ phiếu thu → HĐ nợ lại 700.000, dòng phiếu trả về 0
  PERFORM void_cash_receipt(v_pt, 'x');
  e := pg_temp.kiem('S4.5', d);
  PERFORM pg_temp.ket('S4.5', e = 0 AND pg_temp.no(d.cust) = 700000,
    format('huỷ phiếu thu: dòng phiếu trả %s/%s/%s, nợ khách %s (700000)', (SELECT amount FROM receivables WHERE id = v_rc),
      (SELECT paid FROM receivables WHERE id = v_rc), (SELECT status FROM receivables WHERE id = v_rc), pg_temp.no(d.cust)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S4 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S4.6 thứ tự ngược: huỷ phiếu thu trước rồi mới huỷ phiếu trả; và rút dư có qua HAI phiếu thu rồi huỷ một
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_inv2 uuid; v_ret uuid; e int; v_pt1 uuid; v_pt2 uuid; v_rc uuid;
BEGIN
  d := pg_temp.moi('S46');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));      -- 700.000
  v_inv2 := pg_temp.don2(d);                              -- 50.000
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'zone', 'date',
             'lines', jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 10, 'unit_price', 8000))));  -- 80.000
  SELECT id INTO v_rc FROM receivables WHERE return_id = v_ret;
  v_pt1 := pg_temp.thu_tien(d, v_inv2, 50000, 50000);    -- rút 50.000
  v_pt2 := pg_temp.thu_tien(d, v_inv, 100000, 30000);    -- rút 30.000 + 70.000 tiền mặt
  e := pg_temp.kiem('S4.6a', d);
  PERFORM pg_temp.ket('S4.6a', e = 0 AND pg_temp.no(d.cust) = 600000 AND (SELECT paid FROM receivables WHERE id = v_rc) = -80000,
    format('rút dư có qua 2 phiếu thu: dòng âm paid %s (−80000), nợ khách %s (600000)', (SELECT paid FROM receivables WHERE id = v_rc), pg_temp.no(d.cust)));
  PERFORM void_cash_receipt(v_pt1, 'x');
  e := pg_temp.kiem('S4.6b', d);
  PERFORM pg_temp.ket('S4.6b', e = 0 AND (SELECT paid FROM receivables WHERE id = v_rc) = -30000 AND pg_temp.no(d.cust) = 600000,
    format('huỷ phiếu thu 1: dòng âm paid %s (−30000), nợ khách %s (600000)', (SELECT paid FROM receivables WHERE id = v_rc), pg_temp.no(d.cust)));
  PERFORM void_cash_receipt(v_pt2, 'x');
  PERFORM cancel_return(v_ret, 'x');
  e := pg_temp.kiem('S4.6c', d);
  PERFORM pg_temp.ket('S4.6c', e = 0 AND pg_temp.no(d.cust) = 750000 AND pg_temp.ton(d.p3, 'date') = 0,
    format('huỷ phiếu thu 2 rồi huỷ phiếu trả: nợ khách %s (750000), dòng %s/%s/%s', pg_temp.no(d.cust),
      (SELECT amount FROM receivables WHERE id = v_rc), (SELECT paid FROM receivables WHERE id = v_rc), (SELECT status FROM receivables WHERE id = v_rc)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S4.6 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S4.8 phiếu độc lập đã hoàn thành rồi sửa để GẮN hóa đơn (và ngược lại gỡ HĐ)
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; e int; v_rc uuid;
BEGIN
  d := pg_temp.moi('S48');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'zone', 'sale', 'lines', pg_temp.tra1(d)));
  SELECT id INTO v_rc FROM receivables WHERE return_id = v_ret;
  PERFORM save_pos_return(jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'complete', true, 'zone', 'sale', 'lines', pg_temp.tra1(d)));
  e := pg_temp.kiem('S4.8a', d);
  PERFORM pg_temp.ket('S4.8a', e = 0 AND pg_temp.no_hd(v_inv) = 580000 AND (SELECT amount FROM receivables WHERE id = v_rc) = 0 AND pg_temp.no(d.cust) = 580000,
    format('độc lập → gắn HĐ: nợ HĐ %s (580000), dòng âm cũ %s (0), nợ khách %s (580000)', pg_temp.no_hd(v_inv), (SELECT amount FROM receivables WHERE id = v_rc), pg_temp.no(d.cust)));
  PERFORM save_pos_return(jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', NULL, 'complete', true, 'zone', 'sale', 'lines', pg_temp.tra1(d)));
  e := pg_temp.kiem('S4.8b', d);
  PERFORM pg_temp.ket('S4.8b', e = 0 AND pg_temp.no_hd(v_inv) = 700000 AND (SELECT amount FROM receivables WHERE id = v_rc) = -120000 AND pg_temp.no(d.cust) = 580000,
    format('gắn HĐ → gỡ HĐ: nợ HĐ %s (700000), dòng âm %s (−120000), nợ khách %s (580000)', pg_temp.no_hd(v_inv), (SELECT amount FROM receivables WHERE id = v_rc), pg_temp.no(d.cust)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S4.8 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S4.9 phiếu độc lập Nháp: huỷ được; hoàn thành thẳng từ Nháp (không qua Chờ xử lý)
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_ret2 uuid; e int;
BEGIN
  d := pg_temp.moi('S49');
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  PERFORM cancel_return(v_ret, 'x');
  v_ret2 := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  PERFORM complete_return(v_ret2, 'sale');
  e := pg_temp.kiem('S4.9', d);
  PERFORM pg_temp.ket('S4.9', e = 0 AND (SELECT status FROM returns WHERE id = v_ret) = 'cancelled' AND (SELECT status FROM returns WHERE id = v_ret2) = 'completed'
      AND pg_temp.no(d.cust) = -120000 AND pg_temp.ton(d.p1) = 1012,
    format('Nháp → huỷ: %s; Nháp → hoàn thành: %s, nợ khách %s (−120000), tồn P1 %s (1012)', (SELECT status FROM returns WHERE id = v_ret),
      (SELECT status FROM returns WHERE id = v_ret2), pg_temp.no(d.cust), pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S4.9 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 6 — revenue_date phiếu tự lập
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_ret2 uuid; e int;
BEGIN
  d := pg_temp.moi('S6');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), NULL, date '2026-09-20');
  -- S6.2 phiếu tự lập ngày chứng từ 25/09, Nháp: chưa trừ; hoàn thành → trừ vào 25/09 (mốc chứng từ, mig 188)
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'return_date', '2026-09-25', 'lines', pg_temp.tra1(d)));
  PERFORM pg_temp.ket('S6.2a', (SELECT revenue_date FROM returns WHERE id = v_ret) IS NULL,
    format('tự lập Nháp: revenue_date %s (NULL)', COALESCE((SELECT revenue_date::text FROM returns WHERE id = v_ret), 'NULL')));
  PERFORM complete_return(v_ret, 'sale');
  PERFORM pg_temp.ket('S6.2b', (SELECT revenue_date FROM returns WHERE id = v_ret) = date '2026-09-25',
    format('tự lập hoàn thành (ngày chứng từ 25/09, HĐ 20/09): revenue_date %s (2026-09-25)', (SELECT revenue_date FROM returns WHERE id = v_ret)));
  -- phiếu hôm nay
  v_ret2 := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'lines', pg_temp.tra1(d)));
  PERFORM pg_temp.ket('S6.2c', (SELECT revenue_date FROM returns WHERE id = v_ret2) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    format('tự lập độc lập hoàn thành hôm nay: revenue_date %s', (SELECT revenue_date FROM returns WHERE id = v_ret2)));
  -- S6.3 huỷ → NULL
  PERFORM cancel_return(v_ret, 'x');
  e := pg_temp.kiem('S6.3', d);
  PERFORM pg_temp.ket('S6.3', e = 0 AND (SELECT revenue_date FROM returns WHERE id = v_ret) IS NULL,
    format('huỷ tự lập: revenue_date %s (NULL)', COALESCE((SELECT revenue_date::text FROM returns WHERE id = v_ret), 'NULL')));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S6 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 7 — QUYỀN
-- ====================================================================
BEGIN;
CREATE TEMP TABLE _s7 (k text PRIMARY KEY, v uuid);
GRANT SELECT ON _s7 TO authenticated;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_err text; v_ql uuid;
BEGIN
  d := pg_temp.moi('S7');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  INSERT INTO _s7 VALUES ('cust', d.cust), ('inv', v_inv), ('p1', d.p1), ('auto', (SELECT id FROM returns WHERE invoice_id = v_inv));
  -- phiếu tự lập đã hoàn thành do quản lý lập
  PERFORM pg_temp.la(2);
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'lines', pg_temp.tra1(d), 'complete', true));
  INSERT INTO _s7 VALUES ('done', v_ret);
  -- Nháp độc lập do NVBH thứ hai (…0006, dựng tạm) lập — đứng tên người ấy
  INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-000000000006') ON CONFLICT DO NOTHING;
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'NVBH 2', 'sales')
    ON CONFLICT DO NOTHING;
  PERFORM pg_temp.la(6);
  v_ql := save_pos_return(jsonb_build_object('customer_id', (SELECT id FROM customers WHERE id <> d.cust ORDER BY id LIMIT 1), 'reason', 'damaged', 'lines', pg_temp.tra1(d)));
  INSERT INTO _s7 VALUES ('ql_draft', v_ql);
  -- S7.1 NVBH hoàn thành / huỷ → FORBIDDEN
  PERFORM pg_temp.la(4);
  v_err := pg_temp.thu(format('SELECT complete_return(%L, %L)', (SELECT id FROM returns WHERE invoice_id = v_inv AND credit_with_invoice), 'sale'));
  PERFORM pg_temp.ket('S7.1a', v_err = 'FORBIDDEN', 'NVBH hoàn thành phiếu → ' || COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ket('S7.1b', v_err = 'FORBIDDEN', 'NVBH huỷ phiếu đã hoàn thành → ' || COALESCE(v_err, 'LỌT'));
  -- S7.2 NVBH lập Nháp của mình được; sửa Nháp của quản lý → chặn; tự Ghi nhận → chặn
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'lines', pg_temp.tra1(d))));
  PERFORM pg_temp.ket('S7.2a', v_err IS NULL, 'NVBH lập Nháp → ' || COALESCE(v_err, 'được'));
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ql, 'customer_id', d.cust, 'lines', pg_temp.tra1(d, 9))));
  PERFORM pg_temp.ket('S7.2b', v_err = 'FORBIDDEN', format('NVBH sửa Nháp của người khác (sales_user_id=%s) → %s',
     (SELECT sales_user_id FROM returns WHERE id = v_ql), COALESCE(v_err, 'LỌT')));
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'lines', pg_temp.tra1(d))));
  PERFORM pg_temp.ket('S7.2c', v_err = 'FORBIDDEN', 'NVBH lập + Ghi nhận luôn → ' || COALESCE(v_err, 'LỌT'));
  -- S7.3 kế toán / thủ kho
  PERFORM pg_temp.la(3);
  v_err := pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'lines', pg_temp.tra1(d))));
  PERFORM pg_temp.ket('S7.3a', v_err = 'FORBIDDEN', 'kế toán lập phiếu trả POS → ' || COALESCE(v_err, 'được') || ' (theo thiết kế vai)');
  PERFORM pg_temp.la(5);
  -- Chủ nhà 28/09/2026 "ko, sửa lại" (mig 215): thủ kho ĐƯỢC nhập kho phiếu trả. Thử rồi lùi
  -- lại (phiếu nháp còn dùng ở S7.4b).
  DECLARE v_ok boolean := false;
  BEGIN
    BEGIN
      PERFORM complete_return(v_ql, 'sale');
      v_ok := (SELECT status FROM returns WHERE id = v_ql) = 'completed';
      RAISE EXCEPTION 'THU_LUI';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'THU_LUI' THEN v_err := split_part(SQLERRM, ':', 1); ELSE v_err := NULL; END IF;
    END;
    PERFORM pg_temp.ket('S7.3b', v_ok AND v_err IS NULL, 'thủ kho hoàn thành (nhập kho) phiếu trả → ' || COALESCE(v_err, CASE WHEN v_ok THEN 'được' ELSE '?' END) || ' (mig 215 mở returns.approve)');
  END;
  PERFORM pg_temp.la(1);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S7 nổ: %', SQLERRM;
END $t$;

-- S7.4 ghi thẳng từ trình duyệt (vai authenticated) vào phiếu TỰ LẬP — mọi thay đổi tiền/trạng thái phải qua RPC
SELECT pg_temp.la(4);
SET ROLE authenticated;
DO $t$
DECLARE v_err text; n int; v_cr_truoc numeric; v_cr_sau numeric;
BEGIN
  -- NVBH sửa DÒNG của phiếu tự lập ĐÃ HOÀN THÀNH (không phải của mình)
  SELECT credit_note_amount INTO v_cr_truoc FROM returns WHERE id = (SELECT v FROM _s7 WHERE k = 'done');
  BEGIN
    UPDATE return_lines SET quantity = 10, line_total = 1200000 WHERE return_id = (SELECT v FROM _s7 WHERE k = 'done');
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN n := 0; RAISE NOTICE 'CHẶN S7.4a: % (mig 214)', left(SQLERRM, 90);
  END;
  RESET ROLE;
  SELECT credit_note_amount INTO v_cr_sau FROM returns WHERE id = (SELECT v FROM _s7 WHERE k = 'done');
  PERFORM pg_temp.ket('S7.4a', n = 0,
    format('NVBH (authenticated) UPDATE return_lines của phiếu tự lập đã hoàn thành: %s dòng bị sửa; credit %s → %s; nợ HĐ %s (không tính lại); tồn P1 không đổi',
      n, v_cr_truoc, v_cr_sau, pg_temp.no_hd((SELECT v FROM _s7 WHERE k = 'inv'))));
END $t$;
RESET ROLE;
SELECT pg_temp.la(2);
SET ROLE authenticated;
DO $t$
DECLARE n int; n2 int;
BEGIN
  -- Quản lý đổi thẳng trạng thái Nháp → completed (không qua complete_return: không nhập kho, không trừ nợ)
  BEGIN
    UPDATE returns SET status = 'completed' WHERE id = (SELECT v FROM _s7 WHERE k = 'ql_draft');
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN n := 0; RAISE NOTICE 'CHẶN S7.4b: % (mig 214)', left(SQLERRM, 90);
  END;
  -- và INSERT thẳng một phiếu 'completed' qua create_return_with_lines (SECURITY INVOKER)
  BEGIN
    PERFORM create_return_with_lines(jsonb_build_object('customer_id', (SELECT v FROM _s7 WHERE k = 'cust'), 'reason', 'damaged', 'status', 'completed'),
       jsonb_build_array(jsonb_build_object('product_id', (SELECT v FROM _s7 WHERE k = 'p1'), 'unit_name', 'thung', 'quantity', 1, 'unit_price', 120000, 'line_total', 999999)));
    GET DIAGNOSTICS n2 = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN n2 := 0; RAISE NOTICE 'CHẶN S7.4c: % (mig 214)', left(SQLERRM, 90);
  END;
  RESET ROLE;
  PERFORM pg_temp.ket('S7.4b', n = 0,
    format('Quản lý (authenticated) UPDATE returns.status=completed trên Nháp tự lập: %s dòng — phiếu "hoàn thành" không nhập kho, không có dòng công nợ âm (%s dòng)',
      n, (SELECT count(*) FROM receivables WHERE return_id = (SELECT v FROM _s7 WHERE k = 'ql_draft'))));
  PERFORM pg_temp.ket('S7.4c', NOT EXISTS (SELECT 1 FROM returns WHERE customer_id = (SELECT v FROM _s7 WHERE k = 'cust') AND status = 'completed' AND credit_note_amount = 999999),
    format('create_return_with_lines status=completed, line_total 999.999 ≠ 1×120.000: tạo được %s phiếu completed không qua kho/công nợ, credit %s',
      (SELECT count(*) FROM returns WHERE customer_id = (SELECT v FROM _s7 WHERE k = 'cust') AND status = 'completed' AND credit_note_amount = 999999),
      (SELECT max(credit_note_amount) FROM returns WHERE customer_id = (SELECT v FROM _s7 WHERE k = 'cust') AND credit_note_amount = 999999)));
END $t$;
RESET ROLE;
SELECT pg_temp.la(1);
ROLLBACK;

-- S6.4 doanh thu thuần (finance_pnl) theo revenue_date: HĐ 15/08 700.000 + tự sinh 120.000 (Chờ xử lý) + tự lập 16/08 120.000
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; p15 record; p16 record; p15b record;
BEGIN
  d := pg_temp.moi('S64');
  DELETE FROM returns WHERE revenue_date BETWEEN '2026-08-01' AND '2026-08-31';  -- (DB thử: dọn tháng 8 cho sạch)
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d), date '2026-08-15');
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'reason', 'damaged', 'return_date', '2026-08-16',
             'lines', pg_temp.tra1(d), 'complete', true));
  SELECT * INTO p15 FROM finance_pnl('2026-08-15', '2026-08-15');
  SELECT * INTO p16 FROM finance_pnl('2026-08-16', '2026-08-16');
  PERFORM pg_temp.ket('S6.4a', p15.revenue_gross = 700000 AND p15.returns_value = 120000 AND p15.revenue = 580000 AND p16.returns_value = 120000 AND p16.revenue = -120000,
    format('15/08: gộp %s, trả %s, thuần %s (580000); 16/08: trả %s, thuần %s (−120000)', p15.revenue_gross, p15.returns_value, p15.revenue, p16.returns_value, p16.revenue));
  -- huỷ phiếu tự lập → thôi trừ ngày 16/08
  PERFORM cancel_return(v_ret, 'x');
  SELECT * INTO p16 FROM finance_pnl('2026-08-16', '2026-08-16');
  PERFORM pg_temp.ket('S6.4b', p16.returns_value = 0, format('huỷ tự lập: trả ngày 16/08 còn %s (0)', p16.returns_value));
  -- giá vốn hàng trả: phiếu tự sinh hoàn thành hôm nay → giá vốn giảm vào ngày hoàn thành, doanh thu đã trừ ngày 15/08
  PERFORM complete_return((SELECT id FROM returns WHERE invoice_id = v_inv AND credit_with_invoice), 'sale');
  SELECT * INTO p15b FROM finance_pnl('2026-08-15', '2026-08-15');
  PERFORM pg_temp.ket('S6.4c', true, format('(ghi nhận) tự sinh HĐ 15/08 hoàn thành 28/09: returns_value ngày 15/08 = %s, returns_cogs ngày 15/08 = %s, returns_cogs hôm nay = %s — doanh thu và giá vốn hàng trả lệch kỳ',
      p15b.returns_value, p15b.returns_cogs, (SELECT returns_cogs FROM finance_pnl(current_date, current_date))));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S6.4 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- ====================================================================
-- NHÓM 8 — BIÊN: huỷ phiếu trả khi hàng trả về đã bán hết (tồn âm?)
-- ====================================================================
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_seq int; v_ord uuid; v_l uuid; v_err text;
BEGIN
  d := pg_temp.moi('S8');
  v_ret := save_pos_return(jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'complete', true, 'zone', 'sale',
             'lines', jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 5, 'unit_price', 8000))));
  -- bán hết 105 chai P3
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq, total, payment_terms)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'QDH8-' || v_seq, d.cust, pg_temp.u(4), 'submitted', v_seq, 840000, 'COD') RETURNING id INTO v_ord;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (v_ord, d.p3, 'chai', 105, 8000, 840000, 1, 0) RETURNING id INTO v_l;
  PERFORM pg_temp.xuat(v_ord, jsonb_build_array(jsonb_build_object('order_line_id', v_l, 'product_id', d.p3, 'unit_name', 'chai', 'quantity', 105, 'unit_price', 8000, 'vat_rate', 0)));
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  -- Chủ nhà 28/09/2026 "ok cho": huỷ phiếu trả khi hàng đã bán hết vẫn cho huỷ (tồn âm).
  PERFORM pg_temp.ket('S8.1', v_err IS NULL,
    format('huỷ phiếu trả khi hàng đã bán hết: %s; lô P3 thấp nhất %s', COALESCE(v_err, 'cho huỷ'), (SELECT min(qty_on_hand) FROM batches WHERE product_id = d.p3)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S8 nổ: %', SQLERRM;
END $t$;
ROLLBACK;

-- S1.8b phiếu tự sinh bị bỏ hết dòng: còn lại Nháp rỗng mang cờ tự sinh, invoice NULL — có dọn / huỷ được không?
BEGIN;
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; r record; v_err text;
BEGIN
  d := pg_temp.moi('S18b');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra1(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true,
     'return_edits', (SELECT jsonb_agg(jsonb_build_object('line_id', id, 'quantity', 0)) FROM return_lines WHERE return_id = v_ret)));
  v_err := pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ket('S1.8b', v_err IS NULL,
    format('phiếu rỗng sau khi bỏ hết dòng: %s, tự sinh=%s, đơn %s → huỷ: %s (phiếu kẹt ở danh sách, không huỷ / không sửa được)',
      (SELECT status FROM returns WHERE id = v_ret), (SELECT credit_with_invoice FROM returns WHERE id = v_ret),
      (SELECT status FROM sales_orders WHERE id = d.ord), COALESCE(v_err, 'được')));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'LỖI S1.8b nổ: %', SQLERRM;
END $t$;
ROLLBACK;

\echo '=== HẾT QUÉT PHIẾU TRẢ ==='
