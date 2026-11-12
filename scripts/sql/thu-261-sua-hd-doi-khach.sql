-- KIỂM MIG 261 — Sửa hoá đơn đổi được khách hàng (chủ nhà 12/11/2026: "E sửa phần sửa hoá đơn cho phép đổi khách hàng (cả
-- trên đt và pos)"). psql -f, BEGIN … ROLLBACK. Luồng THẬT: đơn → hoá đơn (kèm hàng trả) → phiếu trả tự lập → Sửa HĐ đổi
-- khách → công nợ / phiếu trả / đơn. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-261-sua-hd-doi-khach.sql
-- Người: chủ e..01 · NVBH Dung e..04 · NV A (sales, phụ trách K1 + K2). Khách: K1, K2 (của A), K3 (của Dung), KX (NPP khác).
\set ON_ERROR_STOP on
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE TEMP TABLE tam (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.t(p_k text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT v FROM tam WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.la(p uuid) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', p::text, true) $f$;
-- Chạy thử một câu: lỗi → mã lỗi (phần trước dấu ':'), được → NULL. Lỗi chỉ huỷ phần của câu ấy.
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;
-- Đơn của NV p_nv cho khách p_kh → hoá đơn (chủ NPP xuất). p_tra: hàng trả kèm đơn (return_adds, phiếu TỰ SINH).
CREATE FUNCTION pg_temp.hd(p_nv uuid, p_kh uuid, p_dong jsonb, p_tra jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_o record; v_lines jsonb; h uuid; v_tong numeric;
BEGIN
  SELECT sum((d->>'line_total')::numeric) INTO v_tong FROM jsonb_array_elements(p_dong) d;
  PERFORM pg_temp.la(p_nv);
  SELECT * INTO v_o FROM create_order_with_lines(jsonb_build_object('client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('customer_id', p_kh, 'status', 'submitted', 'payment_terms', 'NET30',
                                'subtotal', v_tong, 'total', v_tong),
    'lines', p_dong));
  SELECT jsonb_agg(jsonb_build_object('order_line_id', l.id, 'product_id', l.product_id, 'unit_name', l.unit_name,
           'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price, 'vat_rate', 0))
    INTO v_lines FROM sales_order_lines l WHERE l.order_id = v_o.order_id;
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM post_invoice(jsonb_build_object('order_id', v_o.order_id, 'allow_oversell', true,
    'lines', v_lines, 'return_adds', COALESCE(p_tra, '[]'::jsonb)));
  RETURN h;
END $f$;
CREATE FUNCTION pg_temp.dong(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'vat_rate', vat_rate, 'is_exchange', is_exchange))
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;
-- Sửa HĐ (chủ NPP): p_them — khoá thêm vào tải trọng (vd customer_id). Trả id tờ mới.
CREATE FUNCTION pg_temp.sua(p_inv uuid, p_them jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE h uuid;
BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM reissue_invoice(p_inv,
    jsonb_build_object('lines', pg_temp.dong(p_inv), 'allow_oversell', true) || p_them);
  RETURN h;
END $f$;
-- Nợ còn mở của một khách (Σ amount − paid trên khoản chưa xong — luật loadCustomerDebt).
CREATE FUNCTION pg_temp.no(p_kh uuid) RETURNS numeric LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = p_kh AND status <> 'paid'
$f$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set DUNG '''e0000000-0000-0000-0000-000000000004'''
\set A '''e2610000-0000-0000-0000-00000000000a'''
\set P1 '''c0000000-0000-0000-0000-000000000001'''
\set P3 '''c0000000-0000-0000-0000-000000000008'''
\set K1 '''c2610000-0000-0000-0000-000000000001'''
\set K2 '''c2610000-0000-0000-0000-000000000002'''
\set K3 '''c2610000-0000-0000-0000-000000000003'''
\set KX '''c2610000-0000-0000-0000-0000000000ff'''
\set ORGX '''a2610000-0000-0000-0000-0000000000ff'''

-- ===================================== DỰNG SỔ =====================================
INSERT INTO auth.users (id, email) VALUES (:A, 'a261@x.vn');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES
  (:A, :ORG, 'NV A 261', 'sales', true, 100);
INSERT INTO organizations (id, name, slug) VALUES (:ORGX, 'NPP khác 261', 'npp-khac-261');
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
SELECT :ORG, p, 'LO-261-' || right(p::text, 2), current_date + 300, 1000, 1000, 3000, 'sale', now()
  FROM unnest(ARRAY[:P1, :P3]::uuid[]) p;
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  (:K1, :ORG, 'Thử261 K1', 'Một', '0912610001', '1 Thử261', 'GT'),
  (:K2, :ORG, 'Thử261 K2', 'Hai', '0912610002', '2 Thử261', 'GT'),
  (:K3, :ORG, 'Thử261 K3', 'Ba',  '0912610003', '3 Thử261', 'GT'),
  (:KX, :ORGX, 'Thử261 NPP khác', 'X', '0912610099', '9 Thử261', 'GT');
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  (:K1, :A, 'primary', 'active'), (:K2, :A, 'primary', 'active'), (:K3, :DUNG, 'primary', 'active');

-- H1: K1 — 2 thùng Coca. H2: K1 — đã thu một phần. H3: K1 — có phiếu thu (dòng phiếu, chưa ghi paid).
-- H4: K1 — kèm 2 lon trả (phiếu TỰ SINH) + phiếu TỰ LẬP 1 chai dầu gắn tờ, đã hoàn thành. H5: K1 — kiểm quyền.
DO $d$ BEGIN
  INSERT INTO ctx VALUES ('H1', pg_temp.hd('e2610000-0000-0000-0000-00000000000a', 'c2610000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24',
      'conversion_factor', 24, 'quantity', 2, 'unit_price', 228000, 'line_total', 456000))));
  INSERT INTO ctx VALUES ('H2', pg_temp.hd('e2610000-0000-0000-0000-00000000000a', 'c2610000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'conversion_factor', 1, 'quantity', 10, 'unit_price', 10000, 'line_total', 100000))));
  INSERT INTO ctx VALUES ('H3', pg_temp.hd('e2610000-0000-0000-0000-00000000000a', 'c2610000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'conversion_factor', 1, 'quantity', 8, 'unit_price', 10000, 'line_total', 80000))));
  INSERT INTO ctx VALUES ('H4', pg_temp.hd('e2610000-0000-0000-0000-00000000000a', 'c2610000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24',
        'conversion_factor', 24, 'quantity', 1, 'unit_price', 228000, 'line_total', 228000),
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000008', 'unit_name', 'chai',
        'conversion_factor', 1, 'quantity', 3, 'unit_price', 52000, 'line_total', 156000)),
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'quantity', 2, 'unit_price', 10000, 'vat_rate', 0, 'is_exchange', false, 'reason', 'damaged'))));
  INSERT INTO ctx VALUES ('H5', pg_temp.hd('e2610000-0000-0000-0000-00000000000a', 'c2610000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'conversion_factor', 1, 'quantity', 5, 'unit_price', 10000, 'line_total', 50000))));
END $d$;
INSERT INTO ctx SELECT 'D1', order_id FROM sales_invoices WHERE id = pg_temp.c('H1');
INSERT INTO ctx SELECT 'D4', order_id FROM sales_invoices WHERE id = pg_temp.c('H4');
INSERT INTO ctx SELECT 'RS4', id FROM returns WHERE invoice_id = pg_temp.c('H4') AND credit_with_invoice;
-- H2 đã thu 30.000 (như phiếu thu đã ghi vào khoản nợ).
UPDATE receivables SET paid = 30000 WHERE invoice_id = pg_temp.c('H2');
-- H3: phiếu thu còn hiệu lực có dòng trỏ tờ (chưa kịp ghi vào khoản nợ).
DO $d$ DECLARE r uuid; BEGIN
  INSERT INTO cash_receipts (org_id, receipt_code, collected_by, submitted_amount, expected_amount)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'PT-THU261-1', 'e2610000-0000-0000-0000-00000000000a', 50000, 50000)
  RETURNING id INTO r;
  INSERT INTO cash_receipt_lines (receipt_id, invoice_id, amount) VALUES (r, (SELECT v FROM ctx WHERE k = 'H3'), 50000);
  INSERT INTO ctx VALUES ('PT3', r);
END $d$;
-- H4: phiếu trả TỰ LẬP của K1 gắn tờ H4 — 1 chai dầu 52.000, hoàn thành (nhập kho + trừ vào H4).
DO $d$ DECLARE r uuid; BEGIN
  INSERT INTO returns (org_id, customer_id, requested_by, reason, status, sales_user_id, invoice_id)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c2610000-0000-0000-0000-000000000001',
          'e2610000-0000-0000-0000-00000000000a', 'damaged', 'draft', 'e2610000-0000-0000-0000-00000000000a',
          (SELECT v FROM ctx WHERE k = 'H4'))
  RETURNING id INTO r;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange) VALUES
    (r, 'c0000000-0000-0000-0000-000000000008', 'chai', 1, 52000, 0, 52000, false);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  PERFORM complete_return(r, 'sale');
  INSERT INTO ctx VALUES ('RL4', r);
END $d$;
INSERT INTO ctx SELECT 'NO4', NULL;  -- chỗ giữ: nợ của H4 trước khi sửa ghi ở bảng dưới
CREATE TEMP TABLE truoc ON COMMIT DROP AS
  SELECT (SELECT amount FROM receivables WHERE invoice_id = pg_temp.c('H4')) AS no_h4,
         (SELECT edit_no FROM sales_orders WHERE id = pg_temp.c('D1')) AS edit_d1,
         (SELECT order_code FROM sales_orders WHERE id = pg_temp.c('D1')) AS ma_d1,
         pg_temp.no(:K1) AS no_k1, pg_temp.no(:K2) AS no_k2;

-- ===================================== CHẠY MIGRATION HAI LẦN =====================================
\o /dev/null
\ir ../../supabase/migrations/261_sua_hd_doi_khach.sql
\ir ../../supabase/migrations/261_sua_hd_doi_khach.sql
\o

INSERT INTO kq SELECT 1, 'Vá reissue_invoice đúng 2 chỗ, chạy lại không vá thêm; hai hàm phụ không gọi thẳng được từ trình duyệt',
  (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.reissue_invoice(uuid, jsonb)'::regprocedure), '\(mig 261\)', 'g')) = 2
    AND NOT has_function_privilege('authenticated', 'public._doi_khach_lap_lai_kiem(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._doi_khach_lap_lai_ap(uuid, uuid[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.reissue_invoice(uuid, jsonb)', 'EXECUTE'),
  '';

-- ===================================== 1. ĐỔI KHÁCH (qua vai authenticated như API thật) =====================================
SELECT pg_temp.la(:CHU);
SET LOCAL ROLE authenticated;
INSERT INTO ctx SELECT 'N1', invoice_id FROM reissue_invoice(pg_temp.c('H1'),
  jsonb_build_object('lines', pg_temp.dong(pg_temp.c('H1')), 'allow_oversell', true,
                     'customer_id', 'c2610000-0000-0000-0000-000000000002'));
RESET ROLE;
INSERT INTO kq SELECT 2, 'Tờ mới của khách mới, tờ cũ huỷ giữ khách cũ; đơn sang khách mới (mã đơn tăng số sửa)',
  n.customer_id = :K2 AND n.status = 'posted' AND o.customer_id = :K1 AND o.status = 'cancelled'
    AND d.customer_id = :K2 AND d.edit_no = t.edit_d1 + 1 AND d.order_code <> t.ma_d1 AND n.replaced_from = o.id,
  'tờ mới ' || n.customer_id || ' · đơn ' || d.order_code || ' (trước ' || t.ma_d1 || ')'
  FROM sales_invoices n, sales_invoices o, sales_orders d, truoc t
 WHERE n.id = pg_temp.c('N1') AND o.id = pg_temp.c('H1') AND d.id = pg_temp.c('D1');
INSERT INTO kq SELECT 3, 'Công nợ theo khách mới: tờ mới 456.000 cho K2; K1 hết khoản của tờ này; NV bán giữ nguyên (NV A)',
  (SELECT customer_id FROM receivables WHERE invoice_id = pg_temp.c('N1')) = :K2
    AND (SELECT amount FROM receivables WHERE invoice_id = pg_temp.c('N1')) = 456000
    AND NOT EXISTS (SELECT 1 FROM receivables WHERE invoice_id = pg_temp.c('H1'))
    AND (SELECT sales_user_id FROM sales_invoices WHERE id = pg_temp.c('N1')) = :A
    AND (SELECT sales_user_id FROM receivables WHERE invoice_id = pg_temp.c('N1')) = :A,
  'K2 nợ ' || pg_temp.no(:K2);
INSERT INTO kq SELECT 4, 'Nhật ký đơn ghi một dòng đổi khách (tên cũ → tên mới, mã tờ cũ, người sửa)',
  count(*) = 1 AND bool_and(changes->'doi_khach'->>'from' = 'Thử261 K1' AND changes->'doi_khach'->>'to' = 'Thử261 K2'
    AND (changes->'customer_id'->>'to')::uuid = :K2 AND actor_id = :CHU AND action = 'edit_after_complete'),
  count(*) || ' dòng'
  FROM order_activity_log WHERE order_id = pg_temp.c('D1') AND changes ? 'doi_khach';

-- ===================================== 2. GỬI ĐÚNG KHÁCH ĐANG CÓ / KHÔNG GỬI = KHÔNG ĐỔI =====================================
INSERT INTO ctx VALUES ('N1b', pg_temp.sua(pg_temp.c('N1'), jsonb_build_object('customer_id', :K2)));
INSERT INTO ctx VALUES ('N1c', pg_temp.sua(pg_temp.c('N1b')));
INSERT INTO kq SELECT 5, 'Gửi lại đúng khách đang có / không gửi khách: sửa HĐ như cũ — không tăng số sửa đơn, không ghi thêm nhật ký',
  (SELECT customer_id FROM sales_invoices WHERE id = pg_temp.c('N1c')) = :K2
    AND (SELECT edit_no FROM sales_orders WHERE id = pg_temp.c('D1')) = (SELECT edit_d1 + 1 FROM truoc)
    AND (SELECT count(*) FROM order_activity_log WHERE order_id = pg_temp.c('D1') AND changes ? 'doi_khach') = 1,
  '';

-- ===================================== 3. ĐÃ THU TIỀN THÌ KHÔNG ĐỔI =====================================
INSERT INTO kq SELECT 6, 'Tờ đã thu tiền (khoản nợ có paid) → REISSUE_DOI_KHACH_DA_THU, không đổi gì',
  pg_temp.thu(format('SELECT pg_temp.sua(%L, %L)', pg_temp.c('H2'), jsonb_build_object('customer_id', :K2))) = 'REISSUE_DOI_KHACH_DA_THU'
    AND (SELECT status FROM sales_invoices WHERE id = pg_temp.c('H2')) = 'posted'
    AND (SELECT so.customer_id FROM sales_orders so JOIN sales_invoices si ON si.order_id = so.id WHERE si.id = pg_temp.c('H2')) = :K1,
  '';
INSERT INTO ctx VALUES ('N2', pg_temp.sua(pg_temp.c('H2')));
INSERT INTO kq SELECT 7, 'Không đổi khách thì tờ đã thu vẫn sửa được như cũ (tiền thu đi theo tờ mới — mig 184)',
  (SELECT customer_id FROM receivables WHERE invoice_id = pg_temp.c('N2')) = :K1
    AND (SELECT paid FROM receivables WHERE invoice_id = pg_temp.c('N2')) = 30000,
  '';
INSERT INTO tam SELECT '8a', pg_temp.thu(format('SELECT pg_temp.sua(%L, %L)', pg_temp.c('H3'), jsonb_build_object('customer_id', :K2)));
INSERT INTO tam SELECT '8b', pg_temp.thu(format('UPDATE cash_receipts SET status = %L WHERE id = %L', 'voided', pg_temp.c('PT3')));
INSERT INTO tam SELECT '8c', pg_temp.thu(format('INSERT INTO ctx SELECT %L, pg_temp.sua(%L, %L)', 'N3', pg_temp.c('H3'),
                                                jsonb_build_object('customer_id', :K2)));
INSERT INTO kq SELECT 8, 'Có dòng phiếu thu còn hiệu lực (chưa ghi paid) → REISSUE_DOI_KHACH_DA_THU; huỷ phiếu thu thì đổi được',
  pg_temp.t('8a') IS NOT DISTINCT FROM 'REISSUE_DOI_KHACH_DA_THU' AND pg_temp.t('8b') IS NULL AND pg_temp.t('8c') IS NULL
    AND (SELECT customer_id FROM sales_invoices WHERE id = pg_temp.c('N3')) = :K2,
  concat_ws(' · ', 'trước huỷ: ' || coalesce(pg_temp.t('8a'), 'được'), 'huỷ phiếu: ' || coalesce(pg_temp.t('8b'), 'được'),
            'sau huỷ: ' || coalesce(pg_temp.t('8c'), 'được'));

-- ===================================== 4. PHIẾU TRẢ ĐI THEO KHÁCH MỚI =====================================
INSERT INTO ctx VALUES ('N4', pg_temp.sua(pg_temp.c('H4'), jsonb_build_object('customer_id', :K2)));
INSERT INTO kq SELECT 9, 'Phiếu trả TỰ SINH (hàng trả kèm đơn) sang khách mới, bám tờ mới',
  r.customer_id = :K2 AND r.invoice_id = pg_temp.c('N4') AND r.status IN ('submitted', 'completed'),
  r.customer_id || ' · ' || r.status
  FROM returns r WHERE r.id = pg_temp.c('RS4');
INSERT INTO kq SELECT 10, 'Phiếu trả TỰ LẬP đã nhập kho gắn tờ: giữ nguyên phiếu nhập, sang khách mới, gắn tờ mới',
  r.customer_id = :K2 AND r.invoice_id = pg_temp.c('N4') AND r.status = 'completed',
  r.customer_id || ' · ' || r.status
  FROM returns r WHERE r.id = pg_temp.c('RL4');
INSERT INTO kq SELECT 11, 'Nợ tờ mới = nợ tờ cũ (hàng trả vẫn trừ), ghi cho K2; K1 không còn khoản nào của tờ / phiếu trả này',
  (SELECT amount FROM receivables WHERE invoice_id = pg_temp.c('N4')) = (SELECT no_h4 FROM truoc)
    AND (SELECT customer_id FROM receivables WHERE invoice_id = pg_temp.c('N4')) = :K2
    AND NOT EXISTS (SELECT 1 FROM receivables WHERE customer_id = :K1
                     AND (invoice_id IN (pg_temp.c('H4'), pg_temp.c('N4')) OR return_id IN (pg_temp.c('RS4'), pg_temp.c('RL4')))),
  'nợ tờ mới ' || (SELECT amount FROM receivables WHERE invoice_id = pg_temp.c('N4')) || ' / trước ' || (SELECT no_h4 FROM truoc);
INSERT INTO kq SELECT 12, 'Tổng nợ hai khách: phần của các tờ đã đổi chuyển từ K1 sang K2, tổng hai khách không đổi',
  pg_temp.no(:K1) + pg_temp.no(:K2) = t.no_k1 + t.no_k2
    AND pg_temp.no(:K2) = t.no_k2 + 456000 + 80000 + t.no_h4,
  'K1 ' || t.no_k1 || ' → ' || pg_temp.no(:K1) || ' · K2 ' || t.no_k2 || ' → ' || pg_temp.no(:K2)
  FROM truoc t;

-- ===================================== 5. KHÁCH MỚI PHẢI HỢP LỆ =====================================
SELECT pg_temp.la(:A) \g /dev/null
INSERT INTO tam SELECT '13a', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :K3)));
INSERT INTO tam SELECT '13b', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :K2)));
INSERT INTO tam SELECT '13c', current_setting('npp.doi_khach_lap_lai', true);
INSERT INTO kq SELECT 13, 'NV A (bán hàng) đổi sang khách KHÔNG phụ trách (K3 của Dung) → REISSUE_KHACH_KHONG_HOP_LE; sang K2 (của A) được',
  pg_temp.t('13a') IS NOT DISTINCT FROM 'REISSUE_KHACH_KHONG_HOP_LE' AND pg_temp.t('13b') IS NULL
    AND pg_temp.t('13c') = 'c2610000-0000-0000-0000-000000000002',
  concat_ws(' · ', 'K3: ' || coalesce(pg_temp.t('13a'), 'được'), 'K2: ' || coalesce(pg_temp.t('13b'), 'được'), 'cờ ' || pg_temp.t('13c'));
SELECT pg_temp.la(:CHU) \g /dev/null
INSERT INTO tam SELECT '14a', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :K3)));
INSERT INTO tam SELECT '14b', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :KX)));
INSERT INTO kq SELECT 14, 'Chủ NPP đổi sang khách của NV khác được; khách của NPP KHÁC → REISSUE_KHACH_KHONG_HOP_LE',
  pg_temp.t('14a') IS NULL AND pg_temp.t('14b') IS NOT DISTINCT FROM 'REISSUE_KHACH_KHONG_HOP_LE',
  concat_ws(' · ', 'K3: ' || coalesce(pg_temp.t('14a'), 'được'), 'NPP khác: ' || coalesce(pg_temp.t('14b'), 'được'));
INSERT INTO tam SELECT '15a', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), '{"customer_id": ""}'));
INSERT INTO tam SELECT '15b', current_setting('npp.doi_khach_lap_lai', true);
INSERT INTO tam SELECT '15c', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :K1)));
INSERT INTO tam SELECT '15d', current_setting('npp.doi_khach_lap_lai', true);
INSERT INTO kq SELECT 15, 'customer_id rỗng / trùng khách đang có → không đặt cờ đổi khách',
  pg_temp.t('15a') IS NULL AND pg_temp.t('15b') = '' AND pg_temp.t('15c') IS NULL AND pg_temp.t('15d') = '',
  concat_ws(' · ', pg_temp.t('15a'), pg_temp.t('15b'), pg_temp.t('15c'), pg_temp.t('15d'));
-- Cờ còn treo từ một lần kiểm (K2) → Sửa HĐ KHÔNG gửi khách phải xoá cờ ngay đầu, không "đổi khách" theo cờ cũ.
INSERT INTO tam SELECT '16a', pg_temp.thu(format('SELECT public._doi_khach_lap_lai_kiem(%L, %L)', pg_temp.c('H5'), jsonb_build_object('customer_id', :K2)));
INSERT INTO tam SELECT '16b', current_setting('npp.doi_khach_lap_lai', true);
INSERT INTO ctx VALUES ('N5', pg_temp.sua(pg_temp.c('H5')));
INSERT INTO tam SELECT '16c', pg_temp.thu(format('SELECT pg_temp.sua(%L, %L)', pg_temp.c('N2'), jsonb_build_object('customer_id', :K3)));
INSERT INTO kq SELECT 16, 'Cờ đổi khách không treo sang lần sửa sau: Sửa HĐ không gửi khách giữ khách cũ; tờ đã thu đổi sang K3 vẫn bị chặn',
  pg_temp.t('16a') IS NULL AND pg_temp.t('16b') = 'c2610000-0000-0000-0000-000000000002'
    AND (SELECT customer_id FROM sales_invoices WHERE id = pg_temp.c('N5')) = :K1
    AND (SELECT so.customer_id FROM sales_orders so JOIN sales_invoices si ON si.order_id = so.id WHERE si.id = pg_temp.c('N5')) = :K1
    AND pg_temp.t('16c') IS NOT DISTINCT FROM 'REISSUE_DOI_KHACH_DA_THU',
  concat_ws(' · ', 'cờ ' || pg_temp.t('16b'), 'tờ đã thu: ' || coalesce(pg_temp.t('16c'), 'được'));

INSERT INTO kq SELECT 99, 'Đủ 16 dòng kiểm', count(*) = 16, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
