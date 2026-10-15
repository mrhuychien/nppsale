-- KIỂM MIG 246 — bàn giao khách giữa nhân viên + "hàng khách đã lấy" (chủ nhà 15/10/2026: "Gán cho toàn bộ khách hàng
-- của nv A cho nv B (làm chung khách hàng) Hoặc là như kiểu bàn giao lại khách hàng … dskh tuyến đó, đã lấy hàng gì,
-- số lượng, hàng cty nào mà nv đó làm"). psql -f, BEGIN … ROLLBACK. Luồng THẬT: đơn → hoá đơn → trả hàng → bàn giao
-- → sửa hoá đơn → tính lại nợ. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-246-ban-giao-khach.sql
-- Người: chủ e..01 · quản lý e..02 · kế toán e..03 · NVBH Dung e..04 · thủ kho e..05 · NV A / B (sales) · NV C (đã
-- khoá, còn phân công cũ) · NV L (nghỉ việc qua cho_nhan_vien_nghi — nợ về NPP).
-- Hàng: P1 Coca (lon; "Thung 24") công ty X · P2 Mì (goi; "Thung 30") công ty Y · P3 Dầu (chai) chưa gán công ty.
-- NV A làm X + Y; NV B chỉ làm X.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE TEMP TABLE ra (k text PRIMARY KEY, j jsonb) ON COMMIT DROP;
GRANT ALL ON ra TO authenticated;

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.j(p_k text) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT j FROM ra WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.ghi(b int, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), COALESCE(g, '')) $f$;
CREATE FUNCTION pg_temp.la(p uuid) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', p::text, true) $f$;
-- Chạy thử một câu: lỗi → mã lỗi (phần trước dấu ':'), được → NULL.
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1); END $f$;
-- Đơn của NV → hoá đơn (chủ NPP xuất). p_doi: dòng hàng ĐỔI thêm vào hoá đơn.
CREATE FUNCTION pg_temp.hd(p_nv uuid, p_kh uuid, p_dong jsonb, p_doi jsonb DEFAULT NULL) RETURNS uuid
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
  IF p_doi IS NOT NULL THEN v_lines := v_lines || p_doi; END IF;
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM post_invoice(jsonb_build_object('order_id', v_o.order_id, 'allow_oversell', true,
    'lines', v_lines));
  RETURN h;
END $f$;
CREATE FUNCTION pg_temp.dong(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'vat_rate', vat_rate, 'is_exchange', is_exchange))
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;
-- Một dòng hàng của kết quả hang_khach_da_lay (khách k, hàng p).
CREATE FUNCTION pg_temp.h(p_out jsonb, p_k uuid, p_p uuid) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT e FROM jsonb_array_elements(p_out->'hang') e WHERE (e->>'k')::uuid = p_k AND (e->>'p')::uuid = p_p
$f$;
-- Một khách của kết quả xem trước ban_giao_khach.
CREATE FUNCTION pg_temp.k(p_out jsonb, p_k uuid) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT e FROM jsonb_array_elements(p_out->'khach') e WHERE (e->>'id')::uuid = p_k
$f$;
CREATE FUNCTION pg_temp.vai(p_kh uuid, p_nv uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT role FROM customer_assignments WHERE customer_id = p_kh AND user_id = p_nv AND status = 'active'
$f$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set QL '''e0000000-0000-0000-0000-000000000002'''
\set KT '''e0000000-0000-0000-0000-000000000003'''
\set DUNG '''e0000000-0000-0000-0000-000000000004'''
\set KHO '''e0000000-0000-0000-0000-000000000005'''
\set A '''e2460000-0000-0000-0000-00000000000a'''
\set B '''e2460000-0000-0000-0000-00000000000b'''
\set C '''e2460000-0000-0000-0000-00000000000c'''
\set L '''e2460000-0000-0000-0000-00000000000d'''
\set P1 '''c0000000-0000-0000-0000-000000000001'''
\set P2 '''c0000000-0000-0000-0000-000000000006'''
\set P3 '''c0000000-0000-0000-0000-000000000008'''
\set K1 '''c2460000-0000-0000-0000-000000000001'''
\set K2 '''c2460000-0000-0000-0000-000000000002'''
\set K3 '''c2460000-0000-0000-0000-000000000003'''
\set K4 '''c2460000-0000-0000-0000-000000000004'''
\set K5 '''c2460000-0000-0000-0000-000000000005'''
\set K6 '''c2460000-0000-0000-0000-000000000006'''

-- ===================================== DỰNG SỔ =====================================
INSERT INTO auth.users (id, email) VALUES (:A, 'a246@x.vn'), (:B, 'b246@x.vn'), (:C, 'c246@x.vn'), (:L, 'l246@x.vn');
INSERT INTO users (id, org_id, full_name, role, allow_price_edit, price_edit_max_increase_pct) VALUES
  (:A, :ORG, 'NV A 246', 'sales', true, 100), (:B, :ORG, 'NV B 246', 'sales', true, 100),
  (:C, :ORG, 'NV C 246', 'sales', true, 100), (:L, :ORG, 'NV L 246', 'sales', true, 100);
DO $d$ DECLARE x uuid; y uuid; BEGIN
  INSERT INTO suppliers (org_id, name, code) VALUES ('a0000000-0000-0000-0000-000000000001', 'Công ty X 246', 'X246') RETURNING id INTO x;
  INSERT INTO suppliers (org_id, name, code) VALUES ('a0000000-0000-0000-0000-000000000001', 'Công ty Y 246', 'Y246') RETURNING id INTO y;
  INSERT INTO ctx VALUES ('X', x), ('Y', y);
END $d$;
UPDATE products SET primary_supplier_id = pg_temp.c('X') WHERE id = :P1;
UPDATE products SET primary_supplier_id = pg_temp.c('Y') WHERE id = :P2;
UPDATE products SET primary_supplier_id = NULL WHERE id = :P3;
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
SELECT :ORG, p, 'LO-246-' || right(p::text, 2), current_date + 300, 1000, 1000, 3000, 'sale', now()
  FROM unnest(ARRAY[:P1, :P2, :P3]::uuid[]) p;
INSERT INTO user_suppliers (user_id, supplier_id, org_id) VALUES
  (:A, pg_temp.c('X'), :ORG), (:A, pg_temp.c('Y'), :ORG), (:B, pg_temp.c('X'), :ORG);
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  (:K1, :ORG, 'Thử246 K1', 'Một', '0912460001', '1 Thử246', 'GT'),
  (:K2, :ORG, 'Thử246 K2', 'Hai', '0912460002', '2 Thử246', 'GT'),
  (:K3, :ORG, 'Thử246 K3', 'Ba',  '0912460003', '3 Thử246', 'MT'),
  (:K4, :ORG, 'Thử246 K4', 'Bốn', '0912460004', '4 Thử246', 'GT'),
  (:K5, :ORG, 'Thử246 K5', 'Năm', '0912460005', '5 Thử246', 'MT'),
  (:K6, :ORG, 'Thử246 K6', 'Sáu', '0912460006', '6 Thử246', NULL);
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  (:K1, :A, 'primary', 'active'),
  (:K2, :A, 'primary', 'active'), (:K2, :B, 'secondary', 'active'),
  (:K3, :DUNG, 'primary', 'active'), (:K3, :A, 'secondary', 'active'),
  (:K4, :L, 'primary', 'active'),
  (:K5, :C, 'primary', 'active'),
  (:K6, :A, 'primary', 'active');
-- Lịch đi tuyến (0 = Thứ 2). B đã có K2 thứ 2 ở vị trí 5 (A đi K2 cả thứ 2, thứ 3 — B đã có K2 thì giữ lịch của B).
INSERT INTO pjp_routes (org_id, sales_user_id, day_of_week, customer_id, visit_order) VALUES
  (:ORG, :A, 0, :K1, 1), (:ORG, :A, 0, :K2, 2), (:ORG, :A, 1, :K2, 1), (:ORG, :A, 3, :K1, 1), (:ORG, :A, 2, :K3, 1),
  (:ORG, :A, 4, :K6, 1),
  (:ORG, :B, 0, :K2, 5);

-- Hoá đơn (luồng thật). H1: K1 — 2 thùng Coca + 3 chai dầu + 1 lon Coca hàng ĐỔI (0đ). H2: K6 — 1 thùng mì (công ty Y).
-- H3: K1 — 10 lon Coca, 8 tháng trước, đã thu xong. H4: K4 — NV L, 1 thùng Coca (L nghỉ → nợ về NPP).
-- H5: K3 — NVBH Dung, 5 lon Coca, 8 tháng trước.
DO $d$ BEGIN
  INSERT INTO ctx VALUES ('H1', pg_temp.hd('e2460000-0000-0000-0000-00000000000a', 'c2460000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24', 'conversion_factor', 24,
                         'quantity', 2, 'unit_price', 228000, 'line_total', 456000),
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000008', 'unit_name', 'chai', 'conversion_factor', 1,
                         'quantity', 3, 'unit_price', 52000, 'line_total', 156000)),
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                         'conversion_factor', 1, 'quantity', 1, 'unit_price', 0, 'vat_rate', 0, 'is_exchange', true))));
  INSERT INTO ctx VALUES ('H2', pg_temp.hd('e2460000-0000-0000-0000-00000000000a', 'c2460000-0000-0000-0000-000000000006',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000006', 'unit_name', 'Thung 30',
                         'conversion_factor', 30, 'quantity', 1, 'unit_price', 128000, 'line_total', 128000))));
  INSERT INTO ctx VALUES ('H3', pg_temp.hd('e2460000-0000-0000-0000-00000000000a', 'c2460000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                         'conversion_factor', 1, 'quantity', 10, 'unit_price', 10000, 'line_total', 100000))));
  INSERT INTO ctx VALUES ('H4', pg_temp.hd('e2460000-0000-0000-0000-00000000000d', 'c2460000-0000-0000-0000-000000000004',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24',
                         'conversion_factor', 24, 'quantity', 1, 'unit_price', 228000, 'line_total', 228000))));
  INSERT INTO ctx VALUES ('H5', pg_temp.hd('e0000000-0000-0000-0000-000000000004', 'c2460000-0000-0000-0000-000000000003',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
                         'conversion_factor', 1, 'quantity', 5, 'unit_price', 10000, 'line_total', 50000))));
END $d$;
UPDATE sales_invoices SET invoice_date = public.vn_today() - 240 WHERE id IN (pg_temp.c('H3'), pg_temp.c('H5'));
UPDATE receivables SET paid = amount WHERE invoice_id = pg_temp.c('H3');
-- Danh mục đổi hệ số SAU khi bán (thùng 24 → 20): dòng hoá đơn đã ghi sổ vẫn theo SỐ CHỤP 24 (luật heSoQuyDoi).
UPDATE product_units SET conversion = 20 WHERE product_id = :P1 AND unit_name = 'Thung 24';

-- Phiếu trả TỰ LẬP của K1 (NV A): 4 lốc Coca = 24 lon (trừ 228.000; dòng trả không chụp hệ số → tra danh mục lốc 6)
-- + 1 lon Coca hàng ĐỔI; hoàn thành → nợ âm của A.
-- Phiếu NHÁP của K1: 1 chai dầu — chưa trừ, không được tính.
DO $d$ DECLARE r uuid; BEGIN
  INSERT INTO returns (org_id, customer_id, requested_by, reason, status, sales_user_id)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c2460000-0000-0000-0000-000000000001',
          'e2460000-0000-0000-0000-00000000000a', 'damaged', 'draft', 'e2460000-0000-0000-0000-00000000000a')
  RETURNING id INTO r;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange) VALUES
    (r, 'c0000000-0000-0000-0000-000000000001', 'Loc 6', 4, 57000, 0, 228000, false),
    (r, 'c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000, 0, 10000, true);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  PERFORM complete_return(r, 'sale');
  INSERT INTO ctx VALUES ('R1', r);
  INSERT INTO returns (org_id, customer_id, requested_by, reason, status, sales_user_id)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c2460000-0000-0000-0000-000000000001',
          'e2460000-0000-0000-0000-00000000000a', 'damaged', 'draft', 'e2460000-0000-0000-0000-00000000000a')
  RETURNING id INTO r;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  VALUES (r, 'c0000000-0000-0000-0000-000000000008', 'chai', 1, 52000, 0, 52000, false);
  -- NV L nghỉ việc: khách K4 về NPP, nợ H4 về NPP giữ. NV C bị khoá (không qua RPC) — phân công K5 còn nằm đó.
  PERFORM cho_nhan_vien_nghi('e2460000-0000-0000-0000-00000000000d');
  UPDATE users SET is_active = false, left_at = now() WHERE id = 'e2460000-0000-0000-0000-00000000000c';
END $d$;

INSERT INTO kq SELECT 0, 'Dựng sổ: R1 đã trừ (có ngày trừ doanh số, nợ âm của A), H4 về NPP giữ, K4 không còn ai phụ trách',
  (SELECT revenue_date IS NOT NULL FROM returns WHERE id = pg_temp.c('R1'))
  AND (SELECT sales_user_id = :A AND amount = -228000 FROM receivables WHERE return_id = pg_temp.c('R1'))
  AND (SELECT sales_user_id IS NULL AND ve_npp_luc IS NOT NULL FROM receivables WHERE invoice_id = pg_temp.c('H4'))
  AND NOT EXISTS (SELECT 1 FROM customer_assignments WHERE customer_id = :K4),
  (SELECT string_agg(coalesce(sales_user_id::text, 'NPP') || ' ' || amount, ', ') FROM receivables
    WHERE customer_id IN (:K1, :K4, :K6));

SET LOCAL ROLE authenticated;

-- ===================================== 1. HÀNG KHÁCH ĐÃ LẤY =====================================
DO $t$ BEGIN
  PERFORM pg_temp.la('e2460000-0000-0000-0000-00000000000a');
  INSERT INTO ra VALUES ('A_tat_ca', hang_khach_da_lay());
  INSERT INTO ra VALUES ('A_6t', hang_khach_da_lay(p_tu => public.vn_today() - 180));
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  INSERT INTO ra VALUES ('CHU_nvA', hang_khach_da_lay(p_nv => 'e2460000-0000-0000-0000-00000000000a'));
  INSERT INTO ra VALUES ('CHU_rong', hang_khach_da_lay());
  INSERT INTO ra VALUES ('CHU_K1', hang_khach_da_lay(p_khach => ARRAY['c2460000-0000-0000-0000-000000000001']::uuid[]));
  PERFORM pg_temp.la('e2460000-0000-0000-0000-00000000000b');
  INSERT INTO ra VALUES ('B_truoc', hang_khach_da_lay());
  -- NVBH Dung xin xem khách của NV A → vẫn chỉ ra khách của chính mình.
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000004');
  INSERT INTO ra VALUES ('DUNG_xin_A', hang_khach_da_lay(p_nv => 'e2460000-0000-0000-0000-00000000000a'));
END $t$;

INSERT INTO kq SELECT 1, 'NV A: đủ 4 khách của mình (K1, K2, K3, K6), không ra K4 / K5',
  (SELECT array_agg(e->>'store_name' ORDER BY e->>'store_name') FROM jsonb_array_elements(pg_temp.j('A_tat_ca')->'khach') e)
    = ARRAY['Thử246 K1', 'Thử246 K2', 'Thử246 K3', 'Thử246 K6'],
  (SELECT string_agg(e->>'store_name', ', ') FROM jsonb_array_elements(pg_temp.j('A_tat_ca')->'khach') e);
INSERT INTO kq SELECT 2, 'K1 Coca: đi 2 thùng × 24 (số chụp, danh mục nay 20) + 10 lon = 58 lon, trả 4 lốc × 6 = 24, thuần 34, 2 lần; hàng ĐỔI hai phía không tính',
  (SELECT (e->>'di')::numeric = 58 AND (e->>'tra')::numeric = 24 AND (e->>'sl')::numeric = 34 AND (e->>'lan')::int = 2
          AND (e->>'cuoi')::date = public.vn_today()
     FROM (SELECT pg_temp.h(pg_temp.j('A_tat_ca'), :K1, :P1) e) x),
  pg_temp.h(pg_temp.j('A_tat_ca'), :K1, :P1)::text;
INSERT INTO kq SELECT 3, 'K1 dầu (chưa gán công ty): 3 chai — phiếu trả NHÁP không trừ; K3 Coca 5 lon (HĐ của NV khác); K6 mì 1 thùng = 30 gói',
  (pg_temp.h(pg_temp.j('A_tat_ca'), :K1, :P3)->>'sl')::numeric = 3
  AND (pg_temp.h(pg_temp.j('A_tat_ca'), :K3, :P1)->>'sl')::numeric = 5
  AND (pg_temp.h(pg_temp.j('A_tat_ca'), :K6, :P2)->>'sl')::numeric = 30
  AND jsonb_array_length(pg_temp.j('A_tat_ca')->'hang') = 4,
  (pg_temp.j('A_tat_ca')->'hang')::text;
INSERT INTO kq SELECT 4, '6 tháng: bỏ HĐ 8 tháng trước — K1 Coca đi 48 trả 24 thuần 24 (1 lần), K3 không còn dòng',
  (pg_temp.h(pg_temp.j('A_6t'), :K1, :P1)->>'sl')::numeric = 24
  AND (pg_temp.h(pg_temp.j('A_6t'), :K1, :P1)->>'lan')::int = 1
  AND pg_temp.h(pg_temp.j('A_6t'), :K3, :P1) IS NULL
  AND jsonb_array_length(pg_temp.j('A_6t')->'hang') = 3,
  (pg_temp.j('A_6t')->'hang')::text;
INSERT INTO kq SELECT 5, 'Sản phẩm + công ty kèm theo: P1 thuộc X, P3 chưa gán; danh sách công ty có X, Y',
  (SELECT (e->>'ncc')::uuid = pg_temp.c('X') AND e->>'base_unit' = 'lon'
     FROM jsonb_array_elements(pg_temp.j('A_tat_ca')->'sp') e WHERE (e->>'id')::uuid = :P1)
  AND (SELECT e->'ncc' = 'null'::jsonb FROM jsonb_array_elements(pg_temp.j('A_tat_ca')->'sp') e WHERE (e->>'id')::uuid = :P3)
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('A_tat_ca')->'ncc') e
        WHERE (e->>'id')::uuid IN (pg_temp.c('X'), pg_temp.c('Y'))) = 2,
  (pg_temp.j('A_tat_ca')->'ncc')::text;
INSERT INTO kq SELECT 6, 'Chủ NPP xem theo NV A ra đúng như NV A tự xem; không chọn NV / khách thì không đọc cả sổ',
  pg_temp.j('CHU_nvA')->'hang' = pg_temp.j('A_tat_ca')->'hang'
  AND jsonb_array_length(pg_temp.j('CHU_rong')->'khach') = 0,
  '';
INSERT INTO kq SELECT 7, 'Chủ NPP xem một khách (K1): mọi hàng, không giới hạn công ty',
  jsonb_array_length(pg_temp.j('CHU_K1')->'khach') = 1
  AND (pg_temp.h(pg_temp.j('CHU_K1'), :K1, :P1)->>'sl')::numeric = 34
  AND (pg_temp.h(pg_temp.j('CHU_K1'), :K1, :P3)->>'sl')::numeric = 3,
  (pg_temp.j('CHU_K1')->'hang')::text;
INSERT INTO kq SELECT 8, 'NV B trước bàn giao: chỉ K2 (chưa có hàng), công ty của B (X) vẫn hiện',
  (SELECT array_agg(e->>'store_name') FROM jsonb_array_elements(pg_temp.j('B_truoc')->'khach') e) = ARRAY['Thử246 K2']
  AND jsonb_array_length(pg_temp.j('B_truoc')->'hang') = 0
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('B_truoc')->'ncc') e WHERE (e->>'id')::uuid = pg_temp.c('X')) = 1
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('B_truoc')->'ncc') e WHERE (e->>'id')::uuid = pg_temp.c('Y')) = 0,
  (pg_temp.j('B_truoc'))::text;
INSERT INTO kq SELECT 9, 'NVBH xin xem khách NV khác (p_nv) → vẫn chỉ ra khách của mình (K3), không ra K1',
  (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('DUNG_xin_A')->'khach') e WHERE (e->>'id')::uuid = :K3) = 1
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('DUNG_xin_A')->'khach') e WHERE (e->>'id')::uuid = :K1) = 0,
  '';
DO $t$ BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000005');
  PERFORM pg_temp.ghi(10, 'Thủ kho gọi hàng khách đã lấy → KHONG_DU_QUYEN',
    pg_temp.thu('SELECT hang_khach_da_lay(p_khach => ARRAY[''c2460000-0000-0000-0000-000000000001'']::uuid[])') = 'KHONG_DU_QUYEN', NULL);
END $t$;

-- ===================================== 2. XEM TRƯỚC =====================================
DO $t$ BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  INSERT INTO ra VALUES ('xt_chung', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b', p_kieu => 'chung',
    p_nguon => 'nv', p_tu_nv => 'e2460000-0000-0000-0000-00000000000a'));
  INSERT INTO ra VALUES ('xt_chuyen', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b', p_kieu => 'chuyen',
    p_nguon => 'nv', p_tu_nv => 'e2460000-0000-0000-0000-00000000000a'));
  INSERT INTO ra VALUES ('xt_gt', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b',
    p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_tuyen => ARRAY['GT']));
  INSERT INTO ra VALUES ('xt_chua_tuyen', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b',
    p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_tuyen => ARRAY['__chua_co_tuyen']));
  INSERT INTO ra VALUES ('xt_x', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b',
    p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_ncc => ARRAY[pg_temp.c('X')]));
  INSERT INTO ra VALUES ('xt_x_6t', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b',
    p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_ncc => ARRAY[pg_temp.c('X')], p_tu_ngay => public.vn_today() - 180));
  INSERT INTO ra VALUES ('xt_y', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b',
    p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_ncc => ARRAY[pg_temp.c('Y')]));
END $t$;

INSERT INTO kq SELECT 11, 'Xem trước làm chung A → B: 4 khách, thêm mới 3, đã có 1 (K2), ai cũng là PHỤ (khách đã có NV chính), lịch 4 lượt',
  (pg_temp.j('xt_chung')->'tong'->>'so_khach')::int = 4
  AND (pg_temp.j('xt_chung')->'tong'->>'them_moi')::int = 3
  AND (pg_temp.j('xt_chung')->'tong'->>'da_co')::int = 1
  AND (pg_temp.j('xt_chung')->'tong'->>'len_chinh')::int = 0
  AND (pg_temp.j('xt_chung')->'tong'->>'lich')::int = 4
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('xt_chung')->'khach') e WHERE e->>'se_la' <> 'secondary'),
  (pg_temp.j('xt_chung')->'tong')::text;
INSERT INTO kq SELECT 12, 'Xem trước chuyển hẳn: B thay vai A (K1, K2, K6 chính; K3 phụ), nợ chưa thu của A: 3 khoản 512.000 (bỏ HĐ đã thu, gồm nợ âm phiếu trả)',
  pg_temp.k(pg_temp.j('xt_chuyen'), :K1)->>'se_la' = 'primary'
  AND pg_temp.k(pg_temp.j('xt_chuyen'), :K2)->>'se_la' = 'primary'
  AND pg_temp.k(pg_temp.j('xt_chuyen'), :K3)->>'se_la' = 'secondary'
  AND pg_temp.k(pg_temp.j('xt_chuyen'), :K6)->>'se_la' = 'primary'
  AND (pg_temp.j('xt_chuyen')->'tong'->>'len_chinh')::int = 3
  AND (pg_temp.j('xt_chuyen')->'tong'->'no_chuyen'->>'so')::int = 3
  AND (pg_temp.j('xt_chuyen')->'tong'->'no_chuyen'->>'tien')::numeric = 512000,
  (pg_temp.j('xt_chuyen')->'tong')::text;
INSERT INTO kq SELECT 13, 'Lọc tuyến GT → K1, K2; "Chưa có tuyến" → K6',
  (SELECT array_agg(e->>'store_name' ORDER BY e->>'store_name') FROM jsonb_array_elements(pg_temp.j('xt_gt')->'khach') e)
    = ARRAY['Thử246 K1', 'Thử246 K2']
  AND (SELECT array_agg(e->>'store_name') FROM jsonb_array_elements(pg_temp.j('xt_chua_tuyen')->'khach') e) = ARRAY['Thử246 K6'],
  '';
INSERT INTO kq SELECT 14, 'Lọc công ty X → khách đã lấy hàng X (K1, K3); X từ 6 tháng → K1; Y → K6',
  (SELECT array_agg(e->>'store_name' ORDER BY e->>'store_name') FROM jsonb_array_elements(pg_temp.j('xt_x')->'khach') e)
    = ARRAY['Thử246 K1', 'Thử246 K3']
  AND (SELECT array_agg(e->>'store_name') FROM jsonb_array_elements(pg_temp.j('xt_x_6t')->'khach') e) = ARRAY['Thử246 K1']
  AND (SELECT array_agg(e->>'store_name') FROM jsonb_array_elements(pg_temp.j('xt_y')->'khach') e) = ARRAY['Thử246 K6'],
  '';
RESET ROLE;
INSERT INTO kq SELECT 15, 'Xem trước không đổi gì: A còn 4 khách, B còn 1, không nhật ký',
  (SELECT count(*) FROM customer_assignments WHERE user_id = :A) = 4
  AND (SELECT count(*) FROM customer_assignments WHERE user_id = :B) = 1
  AND NOT EXISTS (SELECT 1 FROM ban_giao_khach_log WHERE org_id = :ORG),
  '';
SET LOCAL ROLE authenticated;

-- ===================================== 3. CHẶN =====================================
DO $t$ DECLARE q text; BEGIN
  q := 'SELECT ban_giao_khach(p_den_nv => %L, p_kieu => %L, p_nguon => %L, p_tu_nv => %L, p_khach => %L::uuid[], p_thuc_hien => true)';
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.ghi(16, 'NVBH tự bàn giao → KHONG_DU_QUYEN',
    pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'KHONG_DU_QUYEN', NULL);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.ghi(16, 'Kế toán bàn giao → KHONG_DU_QUYEN',
    pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'KHONG_DU_QUYEN', NULL);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.ghi(17, 'Người nhận đã khoá / không phải NVBH → NV_NHAN_KHONG_HOP_LE',
    pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000c', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'NV_NHAN_KHONG_HOP_LE'
    AND pg_temp.thu(format(q, 'e0000000-0000-0000-0000-000000000002', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'NV_NHAN_KHONG_HOP_LE', NULL);
  PERFORM pg_temp.ghi(18, 'Giao cho chính mình / chuyển hẳn khách chưa ai phụ trách / thiếu NV giao / sai kiểu → chặn',
    pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000a', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'CUNG_MOT_NV'
    AND pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'chuyen', 'chua_ai', NULL, NULL)) = 'CHUYEN_CAN_NV_GIAO'
    AND pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'chung', 'nv', NULL, NULL)) = 'CHON_NV_GIAO'
    AND pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'tron', 'nv', 'e2460000-0000-0000-0000-00000000000a', NULL)) = 'KIEU_KHONG_HOP_LE', NULL);
  PERFORM pg_temp.ghi(19, 'Chọn khách không thuộc NV giao (K4) → KHONG_CO_KHACH, không ghi gì',
    pg_temp.thu(format(q, 'e2460000-0000-0000-0000-00000000000b', 'chung', 'nv', 'e2460000-0000-0000-0000-00000000000a',
                       ARRAY['c2460000-0000-0000-0000-000000000004'])) = 'KHONG_CO_KHACH', NULL);
END $t$;

-- ===================================== 4. LÀM CHUNG (quản lý) =====================================
DO $t$ BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000002');
  INSERT INTO ra VALUES ('e_chung', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b', p_kieu => 'chung',
    p_nguon => 'nv', p_tu_nv => 'e2460000-0000-0000-0000-00000000000a',
    p_khach => ARRAY['c2460000-0000-0000-0000-000000000001', 'c2460000-0000-0000-0000-000000000002',
                     'c2460000-0000-0000-0000-000000000003', 'c2460000-0000-0000-0000-000000000004']::uuid[],
    p_thuc_hien => true));
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 20, 'Làm chung: 3 khách (K4 không thuộc A — bỏ qua 1), thêm mới 2, đã có 1, lịch 3 lượt',
  (pg_temp.j('e_chung')->>'so_khach')::int = 3 AND (pg_temp.j('e_chung')->>'bo_qua')::int = 1
  AND (pg_temp.j('e_chung')->>'them_moi')::int = 2 AND (pg_temp.j('e_chung')->>'da_co')::int = 1
  AND (pg_temp.j('e_chung')->>'lich')::int = 3 AND (pg_temp.j('e_chung')->>'bo_khoi_nv_giao')::int = 0,
  pg_temp.j('e_chung')::text;
INSERT INTO kq SELECT 21, 'Làm chung: B phụ K1, K3; K2 giữ phụ; A vẫn đủ 4 khách, vẫn giữ nợ',
  pg_temp.vai(:K1, :B) = 'secondary' AND pg_temp.vai(:K3, :B) = 'secondary' AND pg_temp.vai(:K2, :B) = 'secondary'
  AND pg_temp.vai(:K6, :B) IS NULL
  AND (SELECT count(*) FROM customer_assignments WHERE user_id = :A AND status = 'active') = 4
  AND pg_temp.vai(:K1, :A) = 'primary'
  AND (SELECT sales_user_id FROM receivables WHERE invoice_id = pg_temp.c('H1')) = :A,
  '';
INSERT INTO kq SELECT 22, 'Làm chung: lịch của A chép sang B cho khách MỚI của B, xếp sau điểm B đã có (thứ 2: 5 + 1 = 6); K2 (B đã có) giữ lịch B; A giữ lịch',
  (SELECT visit_order FROM pjp_routes WHERE sales_user_id = :B AND day_of_week = 0 AND customer_id = :K1) = 6
  AND (SELECT visit_order FROM pjp_routes WHERE sales_user_id = :B AND day_of_week = 3 AND customer_id = :K1) = 1
  AND EXISTS (SELECT 1 FROM pjp_routes WHERE sales_user_id = :B AND day_of_week = 2 AND customer_id = :K3)
  AND (SELECT count(*) FROM pjp_routes WHERE sales_user_id = :B) = 4
  AND NOT EXISTS (SELECT 1 FROM pjp_routes WHERE sales_user_id = :B AND customer_id = :K2 AND day_of_week <> 0)
  AND (SELECT count(*) FROM pjp_routes WHERE sales_user_id = :A) = 6,
  (SELECT string_agg(day_of_week || ':' || visit_order, ', ') FROM pjp_routes WHERE sales_user_id = :B);
INSERT INTO kq SELECT 23, 'Làm chung: nhật ký 1 dòng (người giao = quản lý, 3 khách) + báo cho B',
  (SELECT count(*) = 1 AND bool_and(tao_boi = :QL AND kieu = 'chung' AND cardinality(khach) = 3) FROM ban_giao_khach_log WHERE org_id = :ORG)
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = :B AND title = 'Bạn được giao 3 khách' AND link_url = '/customers/hang-da-lay'),
  (SELECT string_agg(title || ' / ' || coalesce(body, ''), '; ') FROM notifications WHERE user_id = :B);

-- ===================================== 5. CHUYỂN HẲN (chủ NPP) =====================================
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  INSERT INTO ra VALUES ('e_chuyen', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b', p_kieu => 'chuyen',
    p_nguon => 'nv', p_tu_nv => 'e2460000-0000-0000-0000-00000000000a', p_thuc_hien => true));
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 24, 'Chuyển hẳn: 4 khách rời A, nợ chuyển 3 khoản 512.000, lịch mới 1 lượt (K6)',
  (pg_temp.j('e_chuyen')->>'so_khach')::int = 4 AND (pg_temp.j('e_chuyen')->>'bo_khoi_nv_giao')::int = 4
  AND (pg_temp.j('e_chuyen')->'no_chuyen'->>'so')::int = 3 AND (pg_temp.j('e_chuyen')->'no_chuyen'->>'tien')::numeric = 512000
  AND (pg_temp.j('e_chuyen')->>'lich')::int = 1,
  pg_temp.j('e_chuyen')::text;
INSERT INTO kq SELECT 25, 'Chuyển hẳn: B chính K1, K2, K6 (K1/K2 nâng từ phụ), phụ K3; A không còn khách nào trong 4 khách ấy',
  pg_temp.vai(:K1, :B) = 'primary' AND pg_temp.vai(:K2, :B) = 'primary' AND pg_temp.vai(:K6, :B) = 'primary'
  AND pg_temp.vai(:K3, :B) = 'secondary' AND pg_temp.vai(:K3, :DUNG) = 'primary'
  AND NOT EXISTS (SELECT 1 FROM customer_assignments WHERE user_id = :A AND customer_id IN (:K1, :K2, :K3, :K6)),
  '';
INSERT INTO kq SELECT 26, 'Chuyển hẳn: nợ chưa thu (H1, H2, nợ âm phiếu trả) về B kèm dấu giao từ A; HĐ đã thu xong (H3) giữ tên A',
  (SELECT bool_and(sales_user_id = :B AND giao_tu_nv = :A) FROM receivables
    WHERE invoice_id IN (pg_temp.c('H1'), pg_temp.c('H2')) OR return_id = pg_temp.c('R1'))
  AND (SELECT sales_user_id = :A AND giao_tu_nv IS NULL FROM receivables WHERE invoice_id = pg_temp.c('H3')),
  (SELECT string_agg(coalesce(sales_user_id::text, '-') || '/' || coalesce(giao_tu_nv::text, '-'), ', ') FROM receivables
    WHERE customer_id IN (:K1, :K6));
INSERT INTO kq SELECT 27, 'Chuyển hẳn: doanh số không đổi — hoá đơn vẫn ghi NV A',
  (SELECT bool_and(sales_user_id = :A) FROM sales_invoices WHERE id IN (pg_temp.c('H1'), pg_temp.c('H2'), pg_temp.c('H3'))),
  '';
INSERT INTO kq SELECT 28, 'Chuyển hẳn: A mất lịch các khách ấy; B có K6 thứ 5 (vị trí 1); báo cho A',
  NOT EXISTS (SELECT 1 FROM pjp_routes WHERE sales_user_id = :A AND customer_id IN (:K1, :K2, :K3, :K6))
  AND (SELECT visit_order FROM pjp_routes WHERE sales_user_id = :B AND day_of_week = 4 AND customer_id = :K6) = 1
  AND EXISTS (SELECT 1 FROM notifications WHERE user_id = :A AND title = '4 khách của bạn đã chuyển cho NV B 246'),
  (SELECT string_agg(title, '; ') FROM notifications WHERE user_id = :A);

-- ===================================== 6. NỢ ĐÃ GIAO KHÔNG QUAY VỀ =====================================
DO $t$ DECLARE h uuid; BEGIN
  PERFORM public._wf2b_recompute_receivable(pg_temp.c('H1'));
  PERFORM public._cong_no_phieu_tra(pg_temp.c('R1'));
  PERFORM pg_temp.ghi(29, 'Tính lại nợ theo HĐ / phiếu trả (vẫn ghi NV A) → nợ vẫn của B',
    (SELECT sales_user_id = 'e2460000-0000-0000-0000-00000000000b' FROM receivables WHERE invoice_id = pg_temp.c('H1'))
    AND (SELECT sales_user_id = 'e2460000-0000-0000-0000-00000000000b' FROM receivables WHERE return_id = pg_temp.c('R1')), NULL);
  -- Sửa hoá đơn H1 (tờ mới): người giữ nợ + dấu bàn giao đi theo; doanh số vẫn A.
  --   Sửa HĐ chụp lại hệ số theo danh mục LÚC SỬA → trả danh mục về 24 để số của K1 không đổi vì chuyện khác.
  UPDATE product_units SET conversion = 24
   WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND unit_name = 'Thung 24';
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  SELECT invoice_id INTO h FROM reissue_invoice(pg_temp.c('H1'), jsonb_build_object('lines', pg_temp.dong(pg_temp.c('H1')), 'allow_oversell', true));
  INSERT INTO ctx VALUES ('H1n', h);
  PERFORM public._wf2b_recompute_receivable(h);
  PERFORM pg_temp.ghi(30, 'Sửa HĐ H1 → tờ mới: nợ vẫn B, dấu giao từ A còn; HĐ tờ mới vẫn ghi NV A',
    (SELECT sales_user_id = 'e2460000-0000-0000-0000-00000000000b' AND giao_tu_nv = 'e2460000-0000-0000-0000-00000000000a'
       FROM receivables WHERE invoice_id = h)
    AND (SELECT sales_user_id = 'e2460000-0000-0000-0000-00000000000a' FROM sales_invoices WHERE id = h),
    (SELECT coalesce(sales_user_id::text, '-') || '/' || coalesce(giao_tu_nv::text, '-') FROM receivables WHERE invoice_id = h));
  -- Ghi thẳng dấu (không qua RPC) → giữ nguyên; tính lại vẫn B.
  UPDATE receivables SET giao_tu_nv = NULL WHERE invoice_id = h;
  PERFORM public._wf2b_recompute_receivable(h);
  PERFORM pg_temp.ghi(31, 'Xoá thẳng dấu bàn giao (không qua RPC) → bị giữ nguyên, nợ vẫn B',
    (SELECT sales_user_id = 'e2460000-0000-0000-0000-00000000000b' AND giao_tu_nv = 'e2460000-0000-0000-0000-00000000000a'
       FROM receivables WHERE invoice_id = h), NULL);
  -- Sửa người bán của H2 sang Dung → nợ theo HĐ (mig 194), bỏ dấu.
  UPDATE sales_invoices SET sales_user_id = 'e0000000-0000-0000-0000-000000000004' WHERE id = pg_temp.c('H2');
  PERFORM public._wf2b_recompute_receivable(pg_temp.c('H2'));
  PERFORM pg_temp.ghi(32, 'HĐ đổi sang người bán KHÁC (Dung) → nợ theo HĐ, bỏ dấu bàn giao',
    (SELECT sales_user_id = 'e0000000-0000-0000-0000-000000000004' AND giao_tu_nv IS NULL
       FROM receivables WHERE invoice_id = pg_temp.c('H2')), NULL);
  -- Ghi mới kèm dấu (không qua RPC) → dấu bị bỏ.
  INSERT INTO receivables (org_id, customer_id, sales_user_id, amount, opening_balance, giao_tu_nv)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'c2460000-0000-0000-0000-000000000005',
          'e2460000-0000-0000-0000-00000000000b', 1000, true, 'e2460000-0000-0000-0000-00000000000a');
  PERFORM pg_temp.ghi(33, 'Ghi nợ mới kèm dấu (không qua RPC) → dấu bị bỏ',
    (SELECT giao_tu_nv IS NULL FROM receivables WHERE customer_id = 'c2460000-0000-0000-0000-000000000005' AND opening_balance), NULL);
END $t$;

-- ===================================== 7. KHÁCH CHƯA AI PHỤ TRÁCH + NỢ NPP GIỮ =====================================
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  INSERT INTO ra VALUES ('e_chua_ai', ban_giao_khach(p_den_nv => 'e2460000-0000-0000-0000-00000000000b', p_kieu => 'chung',
    p_nguon => 'chua_ai',
    p_khach => ARRAY['c2460000-0000-0000-0000-000000000004', 'c2460000-0000-0000-0000-000000000005',
                     'c2460000-0000-0000-0000-000000000001']::uuid[],
    p_thuc_hien => true));
  INSERT INTO ra VALUES ('e_tat_ca', ban_giao_khach(p_den_nv => 'e0000000-0000-0000-0000-000000000004', p_kieu => 'chung',
    p_nguon => 'tat_ca', p_khach => ARRAY['c2460000-0000-0000-0000-000000000001']::uuid[], p_thuc_hien => true));
END $t$;
RESET ROLE;
DO $t$ BEGIN
  PERFORM public._wf2b_recompute_receivable(pg_temp.c('H4'));
END $t$;
INSERT INTO kq SELECT 34, 'Chưa ai phụ trách: K4 (NV nghỉ), K5 (NV bị khoá) → B làm CHÍNH; K1 đã có B → bỏ qua',
  (pg_temp.j('e_chua_ai')->>'so_khach')::int = 2 AND (pg_temp.j('e_chua_ai')->>'bo_qua')::int = 1
  AND pg_temp.vai(:K4, :B) = 'primary' AND pg_temp.vai(:K5, :B) = 'primary',
  pg_temp.j('e_chua_ai')::text;
INSERT INTO kq SELECT 35, 'Nợ NPP đang giữ của K4 (228.000) giao luôn cho B; tính lại theo HĐ của NV đã nghỉ vẫn B',
  (pg_temp.j('e_chua_ai')->'no_npp'->>'so')::int = 1 AND (pg_temp.j('e_chua_ai')->'no_npp'->>'tien')::numeric = 228000
  AND (SELECT sales_user_id = :B AND ve_npp_luc IS NULL FROM receivables WHERE invoice_id = pg_temp.c('H4')),
  (SELECT coalesce(sales_user_id::text, 'NPP') FROM receivables WHERE invoice_id = pg_temp.c('H4'));
INSERT INTO kq SELECT 36, 'Mọi khách, làm chung cho Dung: K1 đã có B chính → Dung là phụ',
  (pg_temp.j('e_tat_ca')->>'so_khach')::int = 1 AND pg_temp.vai(:K1, :DUNG) = 'secondary',
  pg_temp.j('e_tat_ca')::text;

-- ===================================== 8. NHẬT KÝ + QUYỀN =====================================
SET LOCAL ROLE authenticated;
DO $t$ DECLARE n bigint; BEGIN
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO n FROM ban_giao_khach_log;
  PERFORM pg_temp.ghi(37, 'Nhật ký: quản lý đọc đủ 4 lượt', n = 4, n::text);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000004');
  SELECT count(*) INTO n FROM ban_giao_khach_log;
  PERFORM pg_temp.ghi(37, 'Nhật ký: NVBH không đọc được', n = 0, n::text);
  PERFORM pg_temp.la('e0000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.ghi(37, 'Nhật ký: không ghi thẳng được từ trình duyệt',
    pg_temp.thu('INSERT INTO ban_giao_khach_log (org_id, nguon, kieu) VALUES (''a0000000-0000-0000-0000-000000000001'', ''nv'', ''chung'')') IS NOT NULL, NULL);
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 38, 'Quyền: anon KHÔNG gọi được hai hàm; authenticated gọi được; trigger nội bộ không ai gọi được',
  NOT has_function_privilege('anon', 'public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.hang_khach_da_lay(uuid, uuid[], date, text[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.hang_khach_da_lay(uuid, uuid[], date, text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._cong_no_giu_ve_npp()', 'EXECUTE'),
  '';

-- ===================================== 9. HÀNG KHÁCH ĐÃ LẤY CỦA B SAU BÀN GIAO =====================================
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
  PERFORM pg_temp.la('e2460000-0000-0000-0000-00000000000b');
  INSERT INTO ra VALUES ('B_sau', hang_khach_da_lay());
  INSERT INTO ra VALUES ('B_mt', hang_khach_da_lay(p_tuyen => ARRAY['MT']));
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 39, 'B sau bàn giao: 6 khách; chỉ hàng công ty X + hàng chưa gán (mì công ty Y của K6 ẩn); K1 Coca vẫn 34 sau khi sửa HĐ',
  jsonb_array_length(pg_temp.j('B_sau')->'khach') = 6
  AND (pg_temp.h(pg_temp.j('B_sau'), :K1, :P1)->>'sl')::numeric = 34
  AND (pg_temp.h(pg_temp.j('B_sau'), :K1, :P3)->>'sl')::numeric = 3
  AND (pg_temp.h(pg_temp.j('B_sau'), :K4, :P1)->>'sl')::numeric = 24
  AND pg_temp.h(pg_temp.j('B_sau'), :K6, :P2) IS NULL
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('B_sau')->'sp') e WHERE (e->>'id')::uuid = :P2),
  (pg_temp.j('B_sau')->'hang')::text;
INSERT INTO kq SELECT 40, 'B lọc tuyến MT → K3, K5',
  (SELECT array_agg(e->>'store_name' ORDER BY e->>'store_name') FROM jsonb_array_elements(pg_temp.j('B_mt')->'khach') e)
    = ARRAY['Thử246 K3', 'Thử246 K5'],
  '';

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 44 dòng kiểm', count(*) = 44, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
