-- KIỂM MIG 247 — Sửa HĐ giữ hệ số quy đổi của tờ cũ (chủ nhà 16/10/2026: "đổi hệ số quy đổi trong danh mục (vd thùng 24
-- → 20) rồi Sửa một hoá đơn cũ, thì tờ mới lấy hệ số mới chứ không giữ số cũ"). psql -f, BEGIN … ROLLBACK. Luồng THẬT:
-- đơn → hoá đơn → đổi danh mục → Sửa HĐ (hai lần) → hoá đơn mới. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-247-sua-hd-giu-he-so.sql
-- Hàng: P1 Coca (lon; "Thung 24", "Loc 6") · P2 Mì (goi; "Thung 30"). Tải trọng Sửa HĐ cố ý gửi hệ số SAI — máy chủ
-- không được tin (luật mig 174 giữ nguyên).
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid, n numeric) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.so(p_k text) RETURNS numeric LANGUAGE sql STABLE AS $f$ SELECT n FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.ghi(b int, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), COALESCE(g, '')) $f$;
CREATE FUNCTION pg_temp.la(p uuid) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', p::text, true) $f$;
-- Tồn (đơn vị cơ sở) của một mặt hàng, mọi lô.
CREATE FUNCTION pg_temp.ton(p uuid) RETURNS numeric LANGUAGE sql STABLE AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p $f$;
-- Hệ số trên tờ của mặt hàng + đơn vị.
CREATE FUNCTION pg_temp.hs(h uuid, p uuid, u text) RETURNS numeric LANGUAGE sql STABLE AS
  $f$ SELECT conversion_factor FROM sales_invoice_lines WHERE invoice_id = h AND product_id = p AND unit_name = u $f$;
-- Dòng tờ cũ gửi lại khi Sửa HĐ, hệ số trong tải trọng cố ý SAI (p_hs); `p_doi`: đổi đơn vị + SL của một mặt hàng.
CREATE FUNCTION pg_temp.dong_sai(h uuid, p_hs numeric, p_doi jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_agg(jsonb_build_object(
           'order_line_id', ol.id, 'product_id', l.product_id,
           'unit_name', CASE WHEN l.product_id::text = p_doi->>'product_id' AND l.unit_name = p_doi->>'tu' THEN p_doi->>'sang' ELSE l.unit_name END,
           'conversion_factor', p_hs,
           'quantity', CASE WHEN l.product_id::text = p_doi->>'product_id' AND l.unit_name = p_doi->>'tu' THEN (p_doi->>'sl')::numeric ELSE l.quantity END,
           'unit_price', CASE WHEN l.product_id::text = p_doi->>'product_id' AND l.unit_name = p_doi->>'tu' THEN (p_doi->>'gia')::numeric ELSE l.unit_price END,
           'vat_rate', l.vat_rate, 'is_exchange', l.is_exchange) ORDER BY l.sort_order)
    FROM sales_invoice_lines l
    JOIN sales_invoices i ON i.id = l.invoice_id
    -- Tờ đã huỷ nhả con trỏ dòng đơn (mig 162) — tìm lại theo mặt hàng của đơn.
    LEFT JOIN LATERAL (SELECT so.id FROM sales_order_lines so WHERE so.order_id = i.order_id AND so.product_id = l.product_id
                        ORDER BY (so.id = l.order_line_id) DESC, so.id LIMIT 1) ol ON true
   WHERE l.invoice_id = h
$f$;
-- Đơn của NV → hoá đơn (chủ NPP xuất). Hệ số trong tải trọng cố ý SAI (p_hs) — máy chủ tự tra.
CREATE FUNCTION pg_temp.hd(p_nv uuid, p_kh uuid, p_dong jsonb, p_hs numeric) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_o record; v_lines jsonb; h uuid; v_tong numeric;
BEGIN
  SELECT sum((d->>'line_total')::numeric) INTO v_tong FROM jsonb_array_elements(p_dong) d;
  PERFORM pg_temp.la(p_nv);
  SELECT * INTO v_o FROM create_order_with_lines(jsonb_build_object('client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('customer_id', p_kh, 'status', 'submitted', 'payment_terms', 'NET30', 'subtotal', v_tong, 'total', v_tong),
    'lines', p_dong));
  SELECT jsonb_agg(jsonb_build_object('order_line_id', l.id, 'product_id', l.product_id, 'unit_name', l.unit_name,
           'conversion_factor', p_hs, 'quantity', l.quantity, 'unit_price', l.unit_price, 'vat_rate', 0))
    INTO v_lines FROM sales_order_lines l WHERE l.order_id = v_o.order_id;
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM post_invoice(jsonb_build_object('order_id', v_o.order_id, 'allow_oversell', true, 'lines', v_lines));
  RETURN h;
END $f$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set NV '''e2470000-0000-0000-0000-00000000000a'''
\set K '''c2470000-0000-0000-0000-000000000001'''
\set P1 '''c0000000-0000-0000-0000-000000000001'''
\set P2 '''c0000000-0000-0000-0000-000000000006'''

-- ===================================== DỰNG SỔ =====================================
INSERT INTO auth.users (id, email) VALUES (:NV, 'nv247@x.vn');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES (:NV, :ORG, 'NV 247', 'sales', true, 100);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES (:K, :ORG, 'Thử247 Tạp hoá', 'Bảy', '0912470001', '7 Thử247', 'GT');
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
SELECT :ORG, p, 'LO-247-' || right(p::text, 2), current_date + 300, 1000, 1000, 3000, 'sale', now()
  FROM unnest(ARRAY[:P1, :P2]::uuid[]) p;
-- Danh mục lúc bán: thùng Coca 24, thùng Mì 30.
UPDATE product_units SET conversion = 24 WHERE product_id = :P1 AND unit_name = 'Thung 24';
UPDATE product_units SET conversion = 30 WHERE product_id = :P2 AND unit_name = 'Thung 30';

INSERT INTO ctx (k, n) VALUES ('ton0_1', pg_temp.ton(:P1)), ('ton0_2', pg_temp.ton(:P2));
-- H1: 2 thùng Coca + 5 lon Coca + 1 thùng Mì (tải trọng gửi hệ số 1 cho mọi dòng — máy chủ tự tra).
DO $d$ BEGIN
  INSERT INTO ctx (k, v) VALUES ('H1', pg_temp.hd('e2470000-0000-0000-0000-00000000000a', 'c2470000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24', 'conversion_factor', 24,
                         'quantity', 2, 'unit_price', 228000, 'line_total', 456000),
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'conversion_factor', 1,
                         'quantity', 5, 'unit_price', 10000, 'line_total', 50000),
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000006', 'unit_name', 'Thung 30', 'conversion_factor', 30,
                         'quantity', 1, 'unit_price', 128000, 'line_total', 128000)), 1));
END $d$;
INSERT INTO ctx (k, n) VALUES ('ton1', pg_temp.ton(:P1)), ('ton2', pg_temp.ton(:P2));
INSERT INTO kq SELECT 1, 'HĐ gốc ghi hệ số danh mục lúc bán (24 / 1 / 30), không lấy số 1 của tải trọng; kho trừ 2×24+5 = 53 lon, 30 gói',
  pg_temp.hs(pg_temp.c('H1'), :P1, 'Thung 24') = 24 AND pg_temp.hs(pg_temp.c('H1'), :P1, 'lon') = 1
  AND pg_temp.hs(pg_temp.c('H1'), :P2, 'Thung 30') = 30
  AND pg_temp.so('ton0_1') - pg_temp.so('ton1') = 53 AND pg_temp.so('ton0_2') - pg_temp.so('ton2') = 30,
  format('%s / %s / %s · trừ %s lon, %s gói', pg_temp.hs(pg_temp.c('H1'), :P1, 'Thung 24'), pg_temp.hs(pg_temp.c('H1'), :P1, 'lon'),
    pg_temp.hs(pg_temp.c('H1'), :P2, 'Thung 30'), pg_temp.so('ton0_1') - pg_temp.so('ton1'), pg_temp.so('ton0_2') - pg_temp.so('ton2'));

-- Danh mục ĐỔI sau khi bán: thùng Coca 24 → 20, thùng Mì 30 → 25.
UPDATE product_units SET conversion = 20 WHERE product_id = :P1 AND unit_name = 'Thung 24';
UPDATE product_units SET conversion = 25 WHERE product_id = :P2 AND unit_name = 'Thung 30';

SET LOCAL ROLE authenticated;

-- ===================================== SỬA HĐ LẦN 1 (giữ nguyên dòng) =====================================
DO $t$ DECLARE h uuid; BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM reissue_invoice(pg_temp.c('H1'),
    jsonb_build_object('lines', pg_temp.dong_sai(pg_temp.c('H1'), 1), 'allow_oversell', true));
  INSERT INTO ctx (k, v) VALUES ('H2', h);
  PERFORM pg_temp.ghi(2, 'Sửa HĐ (danh mục đã đổi, tải trọng gửi hệ số 1): tờ mới GIỮ hệ số tờ cũ — thùng Coca 24, lon 1, thùng Mì 30',
    pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Thung 24') = 24
    AND pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'lon') = 1
    AND pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000006', 'Thung 30') = 30,
    format('%s / %s / %s', pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Thung 24'),
      pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'lon'), pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000006', 'Thung 30')));
  PERFORM pg_temp.ghi(3, 'Kho không lệch: huỷ tờ cũ trả lại đúng bằng tờ mới xuất (Coca, Mì như trước khi sửa)',
    pg_temp.ton('c0000000-0000-0000-0000-000000000001') = pg_temp.so('ton1')
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000006') = pg_temp.so('ton2'),
    format('Coca %s (trước %s) · Mì %s (trước %s)', pg_temp.ton('c0000000-0000-0000-0000-000000000001'), pg_temp.so('ton1'),
      pg_temp.ton('c0000000-0000-0000-0000-000000000006'), pg_temp.so('ton2')));
  PERFORM pg_temp.ghi(4, 'Số đã xuất của dòng đơn "2 thùng" (invoiced_qty, trigger sync_invoiced_qty) vẫn đúng 2 (không thành 2×20/24 = 1,67)',
    (SELECT so.invoiced_qty FROM sales_order_lines so
      JOIN sales_invoices i ON i.order_id = so.order_id AND i.id = h
     WHERE so.product_id = 'c0000000-0000-0000-0000-000000000001' AND so.unit_name = 'Thung 24') = 2,
    (SELECT so.invoiced_qty::text FROM sales_order_lines so
      JOIN sales_invoices i ON i.order_id = so.order_id AND i.id = h
     WHERE so.product_id = 'c0000000-0000-0000-0000-000000000001' AND so.unit_name = 'Thung 24'));
  PERFORM pg_temp.ghi(5, 'Cờ phiên tờ cũ đã gỡ sau khi Sửa HĐ (lời gọi post_invoice sau đó không mang hệ số tờ cũ)',
    COALESCE(current_setting('npp.he_so_tu_hd', true), '') = '', current_setting('npp.he_so_tu_hd', true));
END $t$;

-- ===================================== SỬA HĐ LẦN 2 (đổi đơn vị một dòng) =====================================
DO $t$ DECLARE h uuid; BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM reissue_invoice(pg_temp.c('H2'),
    jsonb_build_object('lines', pg_temp.dong_sai(pg_temp.c('H2'), 99, jsonb_build_object(
      'product_id', 'c0000000-0000-0000-0000-000000000001', 'tu', 'Thung 24', 'sang', 'Loc 6', 'sl', 8, 'gia', 57000)),
      'allow_oversell', true));
  INSERT INTO ctx (k, v) VALUES ('H3', h);
  PERFORM pg_temp.ghi(6, 'Sửa lần 2: dòng ĐỔI sang đơn vị khác (thùng → lốc) tra danh mục (6); dòng giữ đơn vị vẫn giữ số tờ trước (Mì 30); không tin số 99 gửi lên',
    pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Loc 6') = 6
    AND pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'lon') = 1
    AND pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000006', 'Thung 30') = 30
    AND pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Thung 24') IS NULL,
    format('lốc %s · lon %s · Mì %s', pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Loc 6'),
      pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'lon'), pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000006', 'Thung 30')));
  PERFORM pg_temp.ghi(7, 'Kho vẫn không lệch: 8 lốc × 6 + 5 lon = 53 lon như tờ trước',
    pg_temp.ton('c0000000-0000-0000-0000-000000000001') = pg_temp.so('ton1')
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000006') = pg_temp.so('ton2'),
    format('Coca %s (trước %s)', pg_temp.ton('c0000000-0000-0000-0000-000000000001'), pg_temp.so('ton1')));
END $t$;

-- ===================================== HOÁ ĐƠN MỚI vẫn theo danh mục (mig 174) =====================================
DO $t$ DECLARE h uuid; BEGIN
  h := pg_temp.hd('e2470000-0000-0000-0000-00000000000a', 'c2470000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24',
      'conversion_factor', 24, 'quantity', 1, 'unit_price', 228000, 'line_total', 228000)), 99);
  PERFORM pg_temp.ghi(8, 'Hoá đơn MỚI sau khi danh mục đổi: lấy hệ số danh mục hiện tại (20), không lấy 99 gửi lên',
    pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Thung 24') = 20,
    pg_temp.hs(h, 'c0000000-0000-0000-0000-000000000001', 'Thung 24')::text);
END $t$;
RESET ROLE;

INSERT INTO kq SELECT 9, 'Quyền: hàm chuẩn hoá hệ số (bản có tờ cũ) là hàm nội bộ — trình duyệt không gọi được',
  NOT has_function_privilege('authenticated', 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._chuan_he_so_dong_hoa_don(jsonb, uuid)', 'EXECUTE'), '';

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 9 dòng kiểm', count(*) = 9, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
