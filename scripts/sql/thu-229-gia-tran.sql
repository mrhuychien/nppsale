-- KIỂM MIG 229 — chặn giá trần ở máy chủ (chủ nhà 04/10/2026: "có").
-- Luật như `priceViolation`: giá TRƯỚC giảm dòng ≤ giá bảng × (1 + % được nâng). NVBH không có quyền sửa giá
-- → đúng giá bảng; NVBH có quyền 10% → tới 110%; chủ NPP toàn quyền; sửa dòng không nâng giá thì cho qua.
--   psql -h /tmp/pgtest -p 55432 -U postgres -d <db> -v ON_ERROR_STOP=1 -f scripts/sql/thu-229-gia-tran.sql
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

INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-0000000000c1'), ('e0000000-0000-0000-0000-0000000000c2');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES
  ('e0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'NVBH không sửa giá', 'sales', false, 0),
  ('e0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001', 'NVBH nâng 10%', 'sales', true, 10);
INSERT INTO ctx (k, u) SELECT 'kh', id FROM customers WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY id LIMIT 1;
INSERT INTO ctx (k, v) SELECT 'bang', public._gia_bang_don_vi('c0000000-0000-0000-0000-000000000001', 'lon',
  (SELECT group_id FROM customers WHERE id = (SELECT u FROM ctx WHERE k = 'kh')));

CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;
CREATE FUNCTION pg_temp.bang() RETURNS numeric LANGUAGE sql AS $f$ SELECT v FROM ctx WHERE k = 'bang' $f$;
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$;
CREATE FUNCTION pg_temp.tao(gia numeric, giam numeric DEFAULT 0) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('order_code', 'TAM', 'customer_id', (SELECT u FROM ctx WHERE k = 'kh'), 'status', 'submitted',
                                'subtotal', 0, 'vat', 0, 'total', 0),
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'quantity', 2, 'unit_price', gia, 'line_discount', giam, 'line_total', 2 * gia - giam, 'conversion_factor', 1)))))
$f$;

SET LOCAL ROLE authenticated;

-- 1. NVBH không có quyền sửa giá
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000c1', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tao(pg_temp.bang());
  PERFORM pg_temp.ghi('1a', 'NVBH không quyền: bán đúng giá bảng → lưu được', e = 'OK', e);
  e := pg_temp.tao(pg_temp.bang() + 1000);
  PERFORM pg_temp.ghi('1b', 'NVBH không quyền: nâng giá 1.000 → bị chặn PRICE_OVER_CEILING', e LIKE 'PRICE_OVER_CEILING%', e);
END $t$;

-- 2. NVBH được nâng 10%
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000c2', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tao(round(pg_temp.bang() * 1.1));
  PERFORM pg_temp.ghi('2a', 'NVBH 10%: nâng đúng 10% → lưu được', e = 'OK', e);
  e := pg_temp.tao(round(pg_temp.bang() * 1.2));
  PERFORM pg_temp.ghi('2b', 'NVBH 10%: nâng 20% → bị chặn', e LIKE 'PRICE_OVER_CEILING%', e);
  -- Giá TRƯỚC giảm 120% rồi giảm dòng về 100%: như `priceViolation` (so giá trước giảm) → vẫn vượt trần.
  e := pg_temp.tao(pg_temp.bang(), round(pg_temp.bang() * 0.2) * 2);
  PERFORM pg_temp.ghi('2c', 'giá trước giảm 120% (giảm dòng kéo về 100%) → vẫn bị chặn như giao diện', e LIKE 'PRICE_OVER_CEILING%', e);
END $t$;

-- 3. Chủ NPP toàn quyền
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.tao(pg_temp.bang() * 3);
  PERFORM pg_temp.ghi('3', 'chủ NPP nâng giá gấp 3 → lưu được (toàn quyền)', e = 'OK', e);
END $t$;

-- 4. Sửa dòng đơn NPP đã nâng giá: NVBH sửa SL không đổi giá → cho qua; nâng thêm → chặn.
DO $t$ DECLARE v_line uuid; e text; BEGIN
  SELECT l.id INTO v_line FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
   WHERE l.unit_price = pg_temp.bang() * 3 ORDER BY o.created_at DESC LIMIT 1;
  INSERT INTO ctx (k, u) VALUES ('dong', v_line);
END $t$;
RESET ROLE;
UPDATE sales_orders SET sales_user_id = 'e0000000-0000-0000-0000-0000000000c2'
 WHERE id = (SELECT order_id FROM sales_order_lines WHERE id = (SELECT u FROM ctx WHERE k = 'dong'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000c2', true);
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 3, line_total = 3 * unit_price WHERE id = %L', (SELECT u FROM ctx WHERE k = 'dong')));
  PERFORM pg_temp.ghi('4a', 'NVBH sửa SL dòng NPP đã nâng giá (giá giữ nguyên) → không bị chặn trần', e NOT LIKE 'PRICE_OVER_CEILING%', e);
  e := pg_temp.thu(format('UPDATE sales_order_lines SET unit_price = unit_price + 5000 WHERE id = %L', (SELECT u FROM ctx WHERE k = 'dong')));
  PERFORM pg_temp.ghi('4b', 'NVBH nâng thêm giá dòng đó → bị chặn', e LIKE 'PRICE_OVER_CEILING%', e);
END $t$;
RESET ROLE;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, left(ghi, 110) AS ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
