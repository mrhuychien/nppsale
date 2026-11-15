-- KIỂM MIG 263 — sàn giá trả (chủ nhà 15/11/2026: "Em xử lý thêm phần hàng trả lại, giá trả không được thấp quá 20% giá
-- niêm yết"). psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-263-san-gia-tra.sql
-- Hàng mẫu Coca (c..01): lon 10.000 bảng chung / 9.500 nhóm b..01 · Thung 24 228.000 · Loc 6 không có dòng bảng giá (= 6 lon
-- = 60.000). Sàn = 80%: lon 8.000 (nhóm 7.600) · thùng 182.400 · lốc 48.000. Dung sai 1 đồng.
-- Người: NVBH A (khách K không nhóm, KG nhóm b..01) · quản lý e..02 · kế toán e..03 · chủ e..01.
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

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set QL '''e0000000-0000-0000-0000-000000000002'''
\set KT '''e0000000-0000-0000-0000-000000000003'''
\set A '''e2630000-0000-0000-0000-00000000000a'''
\set K '''c2630000-0000-0000-0000-000000000001'''
\set KG '''c2630000-0000-0000-0000-000000000002'''
\set P1 '''c0000000-0000-0000-0000-000000000001'''
\set NHOM '''b0000000-0000-0000-0000-000000000001'''

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
-- Chạy câu q dưới phiên của p — p có thì vai authenticated như PostgREST, p NULL = máy chủ (không phiên). 'OK' hoặc câu lỗi.
--   Lỗi thì khối con huỷ → vai + phiên tự về như trước.
CREATE FUNCTION pg_temp.duoi(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    IF p IS NOT NULL THEN PERFORM set_config('role', 'authenticated', true); END IF;
    EXECUTE q;
    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $f$;
-- Ghi thẳng (không qua RPC) dưới phiên của p nhưng vẫn là postgres — chỉ để trigger đọc đúng người; RLS không liên quan.
CREATE FUNCTION pg_temp.thang(p uuid, q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    EXECUTE q;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $f$;
-- Phiếu trả POS (save_pos_return) một dòng Coca: đơn vị, giá, đổi?, gắn hoá đơn?
CREATE FUNCTION pg_temp.tra(p uuid, kh uuid, dv text, gia numeric, doi boolean DEFAULT false, hd uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.duoi(p, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object(
    'customer_id', kh, 'invoice_id', hd, 'reason', 'damaged',
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', dv,
      'quantity', 1, 'unit_price', gia, 'vat_rate', 0, 'is_exchange', doi)))))
$f$;
-- Hoá đơn ghi sổ (dựng thẳng, như thu-230) bán Coca theo các dòng (đơn vị, giá, đổi?) cho khách K.
CREATE FUNCTION pg_temp.hd(p_ma text, p_dong jsonb) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_don uuid; v_inv uuid; d jsonb;
BEGIN
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_seq, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'DH-' || p_ma, 'c2630000-0000-0000-0000-000000000001',
          'e2630000-0000-0000-0000-00000000000a', 990000 + right(p_ma, 2)::int, 'completed')
  RETURNING id INTO v_don;
  INSERT INTO sales_invoices (org_id, invoice_code, order_id, customer_id, invoice_seq, status, subtotal, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'HD-' || p_ma, v_don, 'c2630000-0000-0000-0000-000000000001',
          990000 + right(p_ma, 2)::int, 'posted', 0, 0)
  RETURNING id INTO v_inv;
  FOR d IN SELECT * FROM jsonb_array_elements(p_dong) LOOP
    INSERT INTO sales_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, line_total, is_exchange)
    VALUES (v_inv, 'c0000000-0000-0000-0000-000000000001', d->>'dv', 1, (d->>'gia')::numeric, (d->>'gia')::numeric,
            COALESCE((d->>'doi')::boolean, false));
  END LOOP;
  RETURN v_inv;
END $f$;
-- Nháp trả (dựng thẳng) của khách K để thử ghi thẳng / sửa dòng.
CREATE FUNCTION pg_temp.nhap() RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO returns (org_id, customer_id, status, reason, requested_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c2630000-0000-0000-0000-000000000001', 'draft', 'damaged',
          'e2630000-0000-0000-0000-00000000000a')
  RETURNING id
$f$;
CREATE FUNCTION pg_temp.dong(p_ret uuid, gia numeric, doi boolean DEFAULT false) RETURNS text LANGUAGE sql AS $f$
  SELECT format('INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
                 VALUES (%L, %L, ''lon'', 1, %s, 0, %s, %L)', p_ret, 'c0000000-0000-0000-0000-000000000001', gia, gia, doi)
$f$;
CREATE FUNCTION pg_temp.ok(e text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT e = 'OK' $f$;
CREATE FUNCTION pg_temp.chan(e text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT e LIKE 'RETURN_PRICE_BELOW_FLOOR:%' $f$;

-- ===================================== DỰNG SỔ =====================================
INSERT INTO auth.users (id, email) VALUES (:A, 'a263@x.vn');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES
  (:A, :ORG, 'NV A 263', 'sales', true, 10);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel, group_id) VALUES
  (:K, :ORG, 'Thử263 K', 'Một', '0912630001', '1 Thử263', 'GT', NULL),
  (:KG, :ORG, 'Thử263 KG (nhóm giá)', 'Hai', '0912630002', '2 Thử263', 'GT', :NHOM);
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES (:K, :A, 'primary', 'active'), (:KG, :A, 'primary', 'active');
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
VALUES (:ORG, :P1, 'LO-263', current_date + 300, 1000, 1000, 3000, 'sale', now());

-- ===================================== CHẠY MIGRATION HAI LẦN =====================================
\o /dev/null
\ir ../../supabase/migrations/263_san_gia_tra.sql
\ir ../../supabase/migrations/263_san_gia_tra.sql
\o

INSERT INTO kq SELECT 1, 'Một trigger sàn trên return_lines sau 2 lượt; hàm trigger không gọi thẳng được từ trình duyệt; trần mig 230 còn nguyên',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.return_lines'::regclass AND tgname = 'trg_gia_san_dong_tra') = 1
    AND NOT has_function_privilege('authenticated', 'public._chot_gia_san_dong_tra()', 'EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.return_lines'::regclass AND tgname = 'trg_gia_tran_dong_tra'),
  '';

-- ===================================== 1. NVBH, KHÁCH KHÔNG NHÓM (lon 10.000 → sàn 8.000) =====================================
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a'; k uuid := 'c2630000-0000-0000-0000-000000000001';
  e1 text; e2 text; e3 text; e4 text; e5 text; BEGIN
  e1 := pg_temp.tra(a, k, 'lon', 10000);
  e2 := pg_temp.tra(a, k, 'lon', 8000);
  e3 := pg_temp.tra(a, k, 'lon', 7999);
  e4 := pg_temp.tra(a, k, 'lon', 7998);
  e5 := pg_temp.tra(a, k, 'lon', 0);
  INSERT INTO kq VALUES (2, 'NVBH trả lon: 10.000 · 8.000 (đúng 80%) · 7.999 (dung sai 1đ) được; 7.998 và 0 bị chặn RETURN_PRICE_BELOW_FLOOR',
    pg_temp.ok(e1) AND pg_temp.ok(e2) AND pg_temp.ok(e3) AND pg_temp.chan(e4) AND pg_temp.chan(e5),
    concat_ws(' · ', e1, e2, e3, left(e4, 140), left(e5, 60)));
END $t$;
INSERT INTO kq SELECT 3, 'Câu lỗi nói đủ: giá trả, mức tối thiểu, giá niêm yết (định dạng 8.000)',
  pg_temp.tra(:A, :K, 'lon', 5000)
    = 'RETURN_PRICE_BELOW_FLOOR: Giá trả 5.000 thấp hơn mức tối thiểu 8.000 (giá niêm yết 10.000, không được thấp hơn quá 20%).',
  pg_temp.tra(:A, :K, 'lon', 5000);

-- ===================================== 2. ĐÚNG ĐƠN VỊ =====================================
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a'; k uuid := 'c2630000-0000-0000-0000-000000000001';
  e1 text; e2 text; e3 text; e4 text; BEGIN
  e1 := pg_temp.tra(a, k, 'Thung 24', 182400);
  e2 := pg_temp.tra(a, k, 'Thung 24', 180000);
  e3 := pg_temp.tra(a, k, 'Loc 6', 48000);
  e4 := pg_temp.tra(a, k, 'Loc 6', 45000);
  INSERT INTO kq VALUES (4, 'Sàn theo ĐÚNG đơn vị: thùng 182.400 được / 180.000 chặn; lốc (không dòng bảng giá = 6 lon) 48.000 được / 45.000 chặn',
    pg_temp.ok(e1) AND pg_temp.chan(e2) AND pg_temp.ok(e3) AND pg_temp.chan(e4),
    concat_ws(' · ', e1, left(e2, 90), e3, left(e4, 90)));
END $t$;

-- ===================================== 3. NHÓM GIÁ CỦA KHÁCH + HÀNG ĐỔI =====================================
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a';
  e1 text; e2 text; e3 text; e4 text; BEGIN
  e1 := pg_temp.tra(a, 'c2630000-0000-0000-0000-000000000002', 'lon', 7600);
  e2 := pg_temp.tra(a, 'c2630000-0000-0000-0000-000000000001', 'lon', 7600);
  e3 := pg_temp.tra(a, 'c2630000-0000-0000-0000-000000000002', 'lon', 7500);
  e4 := pg_temp.tra(a, 'c2630000-0000-0000-0000-000000000001', 'lon', 0, true);
  INSERT INTO kq VALUES (5, 'Giá niêm yết theo NHÓM giá của khách: KG (nhóm 9.500) trả 7.600 được, 7.500 chặn; K (bảng chung) trả 7.600 chặn; dòng HÀNG ĐỔI giá 0 được',
    pg_temp.ok(e1) AND pg_temp.chan(e2) AND pg_temp.chan(e3) AND pg_temp.ok(e4),
    concat_ws(' · ', e1, left(e2, 70), left(e3, 70), e4));
END $t$;

-- ===================================== 4. VAI =====================================
INSERT INTO ctx VALUES ('N1', pg_temp.nhap());
DO $t$ DECLARE e1 text; e2 text; e3 text; e4 text; e5 text; BEGIN
  e1 := pg_temp.tra('e0000000-0000-0000-0000-000000000002', 'c2630000-0000-0000-0000-000000000001', 'lon', 5000);
  e2 := pg_temp.tra('e0000000-0000-0000-0000-000000000001', 'c2630000-0000-0000-0000-000000000001', 'lon', 1000);
  e3 := pg_temp.thang('e0000000-0000-0000-0000-000000000003', pg_temp.dong(pg_temp.c('N1'), 1000));
  e4 := pg_temp.thang('e0000000-0000-0000-0000-000000000005', pg_temp.dong(pg_temp.c('N1'), 1000));
  e5 := pg_temp.thang(NULL, pg_temp.dong(pg_temp.c('N1'), 1000));
  INSERT INTO kq VALUES (6, 'Quản lý, thủ kho bị chặn như NVBH; chủ NPP, kế toán (toàn quyền) và máy chủ không phiên thì không',
    pg_temp.chan(e1) AND pg_temp.ok(e2) AND pg_temp.ok(e3) AND pg_temp.chan(e4) AND pg_temp.ok(e5),
    concat_ws(' · ', 'QL ' || left(e1, 50), 'chủ ' || e2, 'KT ' || e3, 'kho ' || left(e4, 50), 'máy chủ ' || e5));
END $t$;

-- ===================================== 5. PHIẾU GẮN HOÁ ĐƠN =====================================
INSERT INTO ctx VALUES
  ('H1', pg_temp.hd('THU-263-01', '[{"dv":"lon","gia":5000}]'::jsonb)),
  ('H2', pg_temp.hd('THU-263-02', '[{"dv":"lon","gia":9500}]'::jsonb)),
  ('H3', pg_temp.hd('THU-263-03', '[{"dv":"lon","gia":0,"doi":true},{"dv":"lon","gia":10000}]'::jsonb));
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a'; k uuid := 'c2630000-0000-0000-0000-000000000001';
  e1 text; e2 text; e3 text; e4 text; e5 text; e6 text; BEGIN
  e1 := pg_temp.tra(a, k, 'lon', 5000, false, pg_temp.c('H1'));
  e2 := pg_temp.tra(a, k, 'lon', 4000, false, pg_temp.c('H1'));
  e3 := pg_temp.tra(a, k, 'lon', 8000, false, pg_temp.c('H2'));
  e4 := pg_temp.tra(a, k, 'lon', 7000, false, pg_temp.c('H2'));
  e5 := pg_temp.tra(a, k, 'lon', 5000, false, pg_temp.c('H3'));
  e6 := pg_temp.tra(a, k, 'Thung 24', 120000, false, pg_temp.c('H1'));
  INSERT INTO kq VALUES (7, 'Gắn HĐ bán RẺ hơn sàn (lon 5.000): trả đúng 5.000 được, 4.000 chặn và nói "giá đã bán trên hoá đơn 5.000"',
    pg_temp.ok(e1) AND e2 = 'RETURN_PRICE_BELOW_FLOOR: Giá trả 4.000 thấp hơn giá đã bán trên hoá đơn 5.000.',
    concat_ws(' · ', e1, e2));
  INSERT INTO kq VALUES (8, 'Gắn HĐ bán trên sàn (9.500) → sàn vẫn 8.000; dòng HÀNG ĐỔI 0đ trên HĐ không kéo sàn xuống; đơn vị khác trên HĐ không tính (thùng vẫn sàn 182.400)',
    pg_temp.ok(e3) AND pg_temp.chan(e4) AND pg_temp.chan(e5) AND pg_temp.chan(e6),
    concat_ws(' · ', e3, left(e4, 70), left(e5, 70), left(e6, 70)));
END $t$;

-- ===================================== 6. SỬA DÒNG =====================================
-- Dòng cũ dưới sàn (lập trước mig — máy chủ không phiên) + dòng đổi 0đ trên nháp N2.
INSERT INTO ctx VALUES ('N2', pg_temp.nhap());
DO $t$ BEGIN
  PERFORM pg_temp.thang(NULL, pg_temp.dong(pg_temp.c('N2'), 3000));
  PERFORM pg_temp.thang(NULL, pg_temp.dong(pg_temp.c('N2'), 0, true));
END $t$;
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a'; n2 uuid := pg_temp.c('N2');
  e1 text; e2 text; e3 text; e4 text; e5 text; BEGIN
  e1 := pg_temp.thang(a, format('UPDATE return_lines SET quantity = 2 WHERE return_id = %L AND NOT is_exchange', n2));
  e2 := pg_temp.thang(a, format('UPDATE return_lines SET unit_price = 2000 WHERE return_id = %L AND NOT is_exchange', n2));
  e3 := pg_temp.thang(a, format('UPDATE return_lines SET unit_price = 4000 WHERE return_id = %L AND NOT is_exchange', n2));
  e4 := pg_temp.thang(a, format('UPDATE return_lines SET is_exchange = false WHERE return_id = %L AND is_exchange', n2));
  e5 := pg_temp.thang(a, format('UPDATE return_lines SET unit_name = ''Thung 24'' WHERE return_id = %L AND NOT is_exchange', n2));
  INSERT INTO kq VALUES (9, 'Dòng cũ dưới sàn: đổi số lượng được, nâng giá được; HẠ giá chặn; dòng ĐỔI 0đ chuyển sang TRẢ chặn; đổi đơn vị là dòng mới → chặn',
    pg_temp.ok(e1) AND pg_temp.chan(e2) AND pg_temp.ok(e3) AND pg_temp.chan(e4) AND pg_temp.chan(e5),
    concat_ws(' · ', e1, left(e2, 60), e3, left(e4, 60), left(e5, 60)));
END $t$;

-- ===================================== 7. ĐƯỜNG THẬT: LẬP ĐƠN KÈM HÀNG TRẢ + XUẤT HÀNG THÊM HÀNG TRẢ =====================================
CREATE FUNCTION pg_temp.don(p uuid, gia_tra numeric) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.duoi(p, format('SELECT create_order_with_lines(%L::jsonb)', jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('customer_id', 'c2630000-0000-0000-0000-000000000001', 'status', 'submitted',
                                'payment_terms', 'NET30', 'subtotal', 10000, 'total', 10000),
    'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                                                  'conversion_factor', 1, 'quantity', 1, 'unit_price', 10000, 'line_total', 10000)),
    'returns', jsonb_build_object('reason', 'damaged'),
    'return_lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                                                         'quantity', 1, 'unit_price', gia_tra, 'line_total', gia_tra)))))
$f$;
DO $t$ DECLARE a uuid := 'e2630000-0000-0000-0000-00000000000a'; e1 text; e2 text; n_truoc int; n_sau int; BEGIN
  SELECT count(*) INTO n_truoc FROM sales_orders WHERE customer_id = 'c2630000-0000-0000-0000-000000000001';
  e1 := pg_temp.don(a, 4000);
  SELECT count(*) INTO n_sau FROM sales_orders WHERE customer_id = 'c2630000-0000-0000-0000-000000000001';
  e2 := pg_temp.don(a, 8000);
  INSERT INTO kq VALUES (10, 'Lập đơn kèm hàng trả (create_order_with_lines): trả 4.000 → chặn, KHÔNG có đơn nào được lập; trả 8.000 → lập được',
    pg_temp.chan(e1) AND n_sau = n_truoc AND pg_temp.ok(e2), concat_ws(' · ', left(e1, 60), e2));
END $t$;
-- Đơn để xuất (NVBH A lập, không kèm hàng trả) → quản lý Xuất hàng có thêm hàng trả (return_adds → _apply_return_adds).
\o /dev/null
SELECT set_config('request.jwt.claim.sub', :A, true);
\o
INSERT INTO ctx SELECT 'D1', order_id FROM create_order_with_lines(jsonb_build_object(
  'client_request_id', gen_random_uuid(),
  'order', jsonb_build_object('customer_id', 'c2630000-0000-0000-0000-000000000001',
                              'status', 'submitted', 'payment_terms', 'NET30', 'subtotal', 20000, 'total', 20000),
  'lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                                                'conversion_factor', 1, 'quantity', 2, 'unit_price', 10000, 'line_total', 20000))));
\o /dev/null
SELECT set_config('request.jwt.claim.sub', '', true);
\o
CREATE FUNCTION pg_temp.xuat(p uuid, gia_tra numeric) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.duoi(p, format('SELECT post_invoice(%L::jsonb)', jsonb_build_object(
    'order_id', pg_temp.c('D1'), 'allow_oversell', true,
    'lines', (SELECT jsonb_agg(jsonb_build_object('order_line_id', l.id, 'product_id', l.product_id, 'unit_name', l.unit_name,
                'conversion_factor', l.conversion_factor, 'quantity', l.quantity, 'unit_price', l.unit_price, 'vat_rate', 0))
                FROM sales_order_lines l WHERE l.order_id = pg_temp.c('D1')),
    'return_adds', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                     'quantity', 1, 'unit_price', gia_tra, 'vat_rate', 0, 'is_exchange', false, 'reason', 'damaged')))))
$f$;
DO $t$ DECLARE ql uuid := 'e0000000-0000-0000-0000-000000000002'; e1 text; e2 text; n_hd int; BEGIN
  e1 := pg_temp.xuat(ql, 3000);
  SELECT count(*) INTO n_hd FROM sales_invoices WHERE order_id = pg_temp.c('D1');
  e2 := pg_temp.xuat(ql, 9000);
  INSERT INTO kq VALUES (11, 'Xuất hàng thêm hàng trả (post_invoice → _apply_return_adds): trả 3.000 → chặn cả lần xuất (không có HĐ); trả 9.000 → xuất được',
    pg_temp.chan(e1) AND n_hd = 0 AND pg_temp.ok(e2), concat_ws(' · ', left(e1, 60), 'HĐ sau lần chặn: ' || n_hd, e2));
END $t$;

INSERT INTO kq SELECT 99, 'Đủ 11 dòng kiểm', count(*) = 11, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
