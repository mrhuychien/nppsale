-- KIỂM MIG 230 — chặn giá trần PHIẾU TRẢ ở máy chủ (chủ nhà 04/10/2026: "chặn giá trần cho phiếu trả hàng luôn").
-- Luật như `returnPriceViolation`: giá trả ≤ giá tham chiếu × (1 + % được nâng); hạ giá luôn được; hàng đổi không tính.
--   psql -h /tmp/pgtest -p 55432 -U postgres -d <db> -v ON_ERROR_STOP=1 -f scripts/sql/thu-230-gia-tran-phieu-tra.sql
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v numeric, u uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-0000000000d1'), ('e0000000-0000-0000-0000-0000000000d2');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES
  ('e0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'NVBH không sửa giá', 'sales', false, 0),
  ('e0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-000000000001', 'NVBH nâng 10%', 'sales', true, 10);
INSERT INTO ctx (k, u) SELECT 'kh', id FROM customers WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY id LIMIT 1;
INSERT INTO ctx (k, v) SELECT 'bang', public._gia_bang_don_vi('c0000000-0000-0000-0000-000000000001', 'lon',
  (SELECT group_id FROM customers WHERE id = (SELECT u FROM ctx WHERE k = 'kh')));

CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;
CREATE FUNCTION pg_temp.bang() RETURNS numeric LANGUAGE sql AS $f$ SELECT v FROM ctx WHERE k = 'bang' $f$;
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$;
CREATE FUNCTION pg_temp.tra(gia numeric, doi boolean DEFAULT false) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object(
    'customer_id', (SELECT u FROM ctx WHERE k = 'kh'),
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'quantity', 1, 'unit_price', gia, 'is_exchange', doi)))))
$f$;

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000d1', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tra(pg_temp.bang());
  PERFORM pg_temp.ghi('1a', 'NVBH không quyền: trả đúng giá bảng → lập được', e = 'OK', e);
  e := pg_temp.tra(pg_temp.bang() + 2000);
  PERFORM pg_temp.ghi('1b', 'NVBH không quyền: trả cao hơn giá bảng 2.000 → bị chặn', e LIKE 'RETURN_PRICE_OVER_CEILING%', e);
  e := pg_temp.tra(round(pg_temp.bang() / 2));
  PERFORM pg_temp.ghi('1c', 'hạ giá trả (hàng hư) → luôn được', e = 'OK', e);
  e := pg_temp.tra(pg_temp.bang() * 5, true);
  PERFORM pg_temp.ghi('1d', 'dòng HÀNG ĐỔI giá cao (không tính tiền) → không kiểm', e = 'OK', e);
END $t$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000d2', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tra(round(pg_temp.bang() * 1.1));
  PERFORM pg_temp.ghi('2a', 'NVBH 10%: trả cao đúng 10% → lập được', e = 'OK', e);
  e := pg_temp.tra(round(pg_temp.bang() * 1.3));
  PERFORM pg_temp.ghi('2b', 'NVBH 10%: trả cao 30% → bị chặn', e LIKE 'RETURN_PRICE_OVER_CEILING%', e);
END $t$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tra(pg_temp.bang() * 3);
  PERFORM pg_temp.ghi('3', 'chủ NPP trả giá gấp 3 → lập được (toàn quyền)', e = 'OK', e);
END $t$;

-- 4. Phiếu gắn HĐ: tham chiếu = giá đã bán trên HĐ (chủ NPP bán cao hơn bảng giá → NVBH trả đúng giá đã bán được).
RESET ROLE;
DO $t$ DECLARE v_don uuid; v_inv uuid; v_ret uuid; BEGIN
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_seq, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'DH-THU-230', (SELECT u FROM ctx WHERE k = 'kh'),
          'e0000000-0000-0000-0000-0000000000d1', 990230, 'completed')
  RETURNING id INTO v_don;
  INSERT INTO sales_invoices (org_id, invoice_code, order_id, customer_id, invoice_seq, status, subtotal, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'HD-THU-230', v_don, (SELECT u FROM ctx WHERE k = 'kh'), 990230, 'posted', 0, 0)
  RETURNING id INTO v_inv;
  INSERT INTO sales_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES (v_inv, 'c0000000-0000-0000-0000-000000000001', 'lon', 1, (SELECT v FROM ctx WHERE k = 'bang') * 2, (SELECT v FROM ctx WHERE k = 'bang') * 2);
  INSERT INTO returns (org_id, customer_id, invoice_id, status, reason, requested_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', (SELECT u FROM ctx WHERE k = 'kh'), v_inv, 'draft', 'damaged',
          'e0000000-0000-0000-0000-0000000000d1')
  RETURNING id INTO v_ret;
  INSERT INTO ctx (k, u) VALUES ('phieu', v_ret);
END $t$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000d1', true);
DO $t$ DECLARE e text; v_ret uuid := (SELECT u FROM ctx WHERE k = 'phieu'); BEGIN
  e := pg_temp.thu(format('INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total, is_exchange) VALUES (%L, %L, %L, 1, %s, %s, false)',
    v_ret, 'c0000000-0000-0000-0000-000000000001', 'lon', pg_temp.bang() * 2, pg_temp.bang() * 2));
  PERFORM pg_temp.ghi('4a', 'phiếu gắn HĐ: trả đúng giá đã bán (gấp đôi giá bảng) → được', e = 'OK', e);
  e := pg_temp.thu(format('INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total, is_exchange) VALUES (%L, %L, %L, 1, %s, %s, false)',
    v_ret, 'c0000000-0000-0000-0000-000000000001', 'lon', pg_temp.bang() * 2 + 5000, pg_temp.bang() * 2 + 5000));
  PERFORM pg_temp.ghi('4b', 'phiếu gắn HĐ: trả cao hơn giá đã bán → bị chặn', e LIKE 'RETURN_PRICE_OVER_CEILING%', e);
  e := pg_temp.thu(format('UPDATE return_lines SET quantity = 2, line_total = 2 * unit_price WHERE return_id = %L', v_ret));
  PERFORM pg_temp.ghi('4c', 'sửa SL dòng trả (giá giữ nguyên) → không bị chặn', e = 'OK', e);
END $t$;
RESET ROLE;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, left(ghi, 110) AS ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
