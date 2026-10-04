-- ====================================================================
-- ĐỘI TEST "BÁO CÁO" — BỘ DỮ LIỆU DÙNG CHUNG (được \ir từ bao-cao.sql, bao-cao-loi.sql,
-- bao-cao-xuat-json.sql). KHÔNG chạy riêng: tệp gọi đã mở BEGIN và sẽ ROLLBACK.
--
-- Mọi chứng từ đi qua RPC thật (post_invoice, reissue_invoice, cancel_invoice, save_pos_return,
-- complete_return, cancel_return, create_cash_receipt) với auth.uid() = chủ NPP.
-- Ngày tính theo giờ VN: T = hôm nay (VN).
--
--   Kỳ TRƯỚC  P = [T-40, T-30]      Kỳ NÀY  K = [T-5, T]
--
--   SP:  P1 = SNP-001 (lon; Thung 24 hệ số 24) bảng giá chung: lon 10.000, Thung 24 228.000
--        P3 = SNP-003 (chai; Thung 24)          bảng giá chung: chai 5.000, Thung 24 108.000
--        P5 = SNP-005 (lon, không đơn vị phụ)   bảng giá chung: lon 14.000
--   Giá vốn (một lô / mặt hàng): P1 7.000/lon · P3 3.000/chai · P5 9.000/lon
--   NV A = user 4 (sales, sẵn có) · NV B = user 6 (sales, tạo thêm)
--   KH1 kênh "Tạp hoá" · KH2 kênh "Siêu thị" · KH3 không kênh ("Khác")
--
--   H1 KH1/A ngày T-35: 2 Thung P1 × 240.000 + 10 lon P1 × 10.500, VAT 0      = 585.000
--   H2 KH2/A ngày T-3 : 30 lon P5 × 15.000, VAT 10%, giảm cả đơn 50.000      = 400.000 + 45.000 = 445.000
--   H3 KH3/B ngày T-2 : 5 Thung P3 × 100.000 + hàng trả kèm 1 Thung P3 × 100.000 (TỰ SINH, Chờ xử lý)
--                       HĐ 500.000, trừ 100.000 → nợ 400.000; revenue_date = T-2
--   H4 KH3/B ngày T-2 : 3 lon P5 × 14.000 rồi HUỶ HĐ → không tính
--   H5 KH1/A ngày T-4 : 10 lon P1 × 10.000 rồi SỬA HĐ còn 8 lon → chỉ tờ mới 80.000
--   H6 KH2/A ngày T-5 : 1 lon P5 × 14.000 (đúng mốc đầu kỳ K)               = 14.000
--   H7 KH2/A ngày T-6 : 1 lon P5 × 14.000 (ngay ngoài kỳ K)                 = 14.000
--   R1 tự lập KH1 gắn H1 (HĐ kỳ trước), hoàn thành HÔM NAY: 1 Thung P1 × 240.000 VAT 10% (=264.000)
--      + 2 lon P1 hàng ĐỔI (không tính tiền) → revenue_date T, trừ vào kỳ K
--   R2 tự lập KH2 không gắn HĐ, để NHÁP: 1 lon P5 × 14.000 → không trừ
--   R3 tự lập KH3 không gắn HĐ, hoàn thành rồi HUỶ: 2 lon P5 × 14.000 → không trừ
--   R4 tự lập KH2 không gắn HĐ, hoàn thành: 5 lon P5 × 14.000 = 70.000 → công nợ âm −70.000
-- ====================================================================

\o /dev/null
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid);
GRANT ALL ON ctx TO authenticated;

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.hn() RETURNS date LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
CREATE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;
CREATE FUNCTION pg_temp.chu() RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true) $f$;

-- Tạo đơn (siêu người dùng). dongs: [{p, u, sl, gia, hs}] → ctx: k (đơn), k#i (dòng), k.kh (khách).
CREATE FUNCTION pg_temp.tao_don(k text, p_kh uuid, p_nv uuid, dongs jsonb) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_don uuid; v_dong uuid; d jsonb; i int := 0; v_tong numeric;
BEGIN
  SELECT COALESCE(sum((x->>'sl')::numeric * (x->>'gia')::numeric), 0) INTO v_tong FROM jsonb_array_elements(dongs) x;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'DH-BC-' || k, p_kh, p_nv, pg_temp.hn() - 45, 'submitted', 'NET30', v_tong, 0, 0, v_tong)
  RETURNING id INTO v_don;
  FOR d IN SELECT * FROM jsonb_array_elements(dongs) LOOP
    i := i + 1;
    INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
    VALUES (v_don, (d->>'p')::uuid, d->>'u', (d->>'sl')::numeric, (d->>'gia')::numeric, 0,
            (d->>'sl')::numeric * (d->>'gia')::numeric, COALESCE((d->>'hs')::numeric, 1))
    RETURNING id INTO v_dong;
    INSERT INTO ctx VALUES (k || '#' || i, v_dong);
  END LOOP;
  INSERT INTO ctx VALUES (k, v_don);
  RETURN v_don;
END $f$;

-- Dòng tải trọng HĐ lấy từ dòng đơn thứ i (SL, VAT tuỳ chọn).
CREATE FUNCTION pg_temp.dl(k text, i int, sl numeric, vat numeric DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('order_line_id', sol.id, 'product_id', sol.product_id, 'unit_name', sol.unit_name,
         'conversion_factor', sol.conversion_factor, 'quantity', sl, 'unit_price', sol.unit_price, 'vat_rate', vat)
  FROM sales_order_lines sol WHERE sol.id = pg_temp.c(k || '#' || i) $f$;

-- Xuất HĐ (chủ NPP) → ctx k.hd
CREATE FUNCTION pg_temp.xuat(k text, ngay date, dongs jsonb, them jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  PERFORM pg_temp.chu();
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', pg_temp.c(k), 'lines', dongs, 'invoice_date', ngay) || them);
  INSERT INTO ctx VALUES (k || '.hd', r.invoice_id) ON CONFLICT ON CONSTRAINT ctx_pkey DO UPDATE SET v = EXCLUDED.v;
  RETURN r.invoice_id;
END $f$;

-- Phiếu trả tự lập (chủ NPP).
CREATE FUNCTION pg_temp.tra_tu_lap(k text, p_kh uuid, p_inv uuid, dongs jsonb) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  PERFORM pg_temp.chu();
  v := save_pos_return(jsonb_strip_nulls(jsonb_build_object('customer_id', p_kh, 'invoice_id', p_inv, 'reason', 'damaged', 'lines', dongs)));
  INSERT INTO ctx VALUES (k, v);
  RETURN v;
END $f$;

-- ───────────────────────── Dữ liệu nền ─────────────────────────
SELECT pg_temp.chu();
INSERT INTO ctx VALUES
  ('P1', 'c0000000-0000-0000-0000-000000000001'),
  ('P3', 'c0000000-0000-0000-0000-000000000003'),
  ('P5', 'c0000000-0000-0000-0000-000000000005'),
  ('NVA', pg_temp.u(4)),
  ('NVB', pg_temp.u(6));

INSERT INTO auth.users (id, email) VALUES (pg_temp.u(6), 'nvb@doi-bao-cao.vn');
INSERT INTO users (id, org_id, full_name, role) VALUES (pg_temp.u(6), 'a0000000-0000-0000-0000-000000000001', 'NV B đội báo cáo', 'sales');

UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at) VALUES
 ('a0000000-0000-0000-0000-000000000001', pg_temp.c('P1'), 'BC-P1', pg_temp.hn() + 300, 5000, 5000, 7000, 'sale', now() - interval '90 days'),
 ('a0000000-0000-0000-0000-000000000001', pg_temp.c('P3'), 'BC-P3', pg_temp.hn() + 300, 2000, 2000, 3000, 'sale', now() - interval '90 days'),
 ('a0000000-0000-0000-0000-000000000001', pg_temp.c('P5'), 'BC-P5', pg_temp.hn() + 300, 1000, 1000, 9000, 'sale', now() - interval '90 days');

DO $d$ DECLARE v uuid; BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, channel)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'KH1 đội báo cáo', 'Chị Một', '0861000001', 'Đ/c 1', 'Tạp hoá') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('KH1', v);
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, channel)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'KH2 đội báo cáo', 'Anh Hai', '0861000002', 'Đ/c 2', 'Siêu thị') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('KH2', v);
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, channel)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'KH3 đội báo cáo', 'Cô Ba', '0861000003', 'Đ/c 3', NULL) RETURNING id INTO v;
  INSERT INTO ctx VALUES ('KH3', v);
END $d$;

-- ───────────────────────── Đơn ─────────────────────────
SELECT pg_temp.tao_don('H1', pg_temp.c('KH1'), pg_temp.c('NVA'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P1'), 'u', 'Thung 24', 'sl', 2, 'gia', 240000, 'hs', 24),
  jsonb_build_object('p', pg_temp.c('P1'), 'u', 'lon', 'sl', 10, 'gia', 10500)));
SELECT pg_temp.tao_don('H2', pg_temp.c('KH2'), pg_temp.c('NVA'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P5'), 'u', 'lon', 'sl', 30, 'gia', 15000)));
SELECT pg_temp.tao_don('H3', pg_temp.c('KH3'), pg_temp.c('NVB'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P3'), 'u', 'Thung 24', 'sl', 5, 'gia', 100000, 'hs', 24)));
SELECT pg_temp.tao_don('H4', pg_temp.c('KH3'), pg_temp.c('NVB'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P5'), 'u', 'lon', 'sl', 3, 'gia', 14000)));
SELECT pg_temp.tao_don('H5', pg_temp.c('KH1'), pg_temp.c('NVA'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P1'), 'u', 'lon', 'sl', 10, 'gia', 10000)));
SELECT pg_temp.tao_don('H6', pg_temp.c('KH2'), pg_temp.c('NVA'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P5'), 'u', 'lon', 'sl', 1, 'gia', 14000)));
SELECT pg_temp.tao_don('H7', pg_temp.c('KH2'), pg_temp.c('NVA'), jsonb_build_array(
  jsonb_build_object('p', pg_temp.c('P5'), 'u', 'lon', 'sl', 1, 'gia', 14000)));

-- ───────────────────────── Hoá đơn ─────────────────────────
SELECT pg_temp.xuat('H1', pg_temp.hn() - 35, jsonb_build_array(pg_temp.dl('H1', 1, 2), pg_temp.dl('H1', 2, 10)));
SELECT pg_temp.xuat('H2', pg_temp.hn() - 3, jsonb_build_array(pg_temp.dl('H2', 1, 30, 0.1)), '{"discount": 50000}');
SELECT pg_temp.xuat('H3', pg_temp.hn() - 2, jsonb_build_array(pg_temp.dl('H3', 1, 5)),
  jsonb_build_object('return_adds', jsonb_build_array(jsonb_build_object(
    'product_id', pg_temp.c('P3'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 100000, 'vat_rate', 0))));
SELECT pg_temp.xuat('H4', pg_temp.hn() - 2, jsonb_build_array(pg_temp.dl('H4', 1, 3)));
SELECT pg_temp.xuat('H5', pg_temp.hn() - 4, jsonb_build_array(pg_temp.dl('H5', 1, 10)));
SELECT pg_temp.xuat('H6', pg_temp.hn() - 5, jsonb_build_array(pg_temp.dl('H6', 1, 1)));
SELECT pg_temp.xuat('H7', pg_temp.hn() - 6, jsonb_build_array(pg_temp.dl('H7', 1, 1)));

DO $d$ DECLARE r record; v uuid; BEGIN
  PERFORM pg_temp.chu();
  -- phiếu tự sinh của H3
  SELECT id INTO v FROM returns WHERE invoice_id = pg_temp.c('H3.hd');
  INSERT INTO ctx VALUES ('H3.tra', v);
  -- huỷ H4
  PERFORM cancel_invoice(pg_temp.c('H4.hd'), 'khách huỷ');
  -- sửa H5 còn 8 lon
  INSERT INTO ctx VALUES ('H5.hd0', pg_temp.c('H5.hd'));
  SELECT * INTO r FROM reissue_invoice(pg_temp.c('H5.hd'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('H5', 1, 8))));
  UPDATE ctx SET v = r.invoice_id WHERE k = 'H5.hd';
END $d$;

-- ───────────────────────── Phiếu trả tự lập ─────────────────────────
SELECT pg_temp.tra_tu_lap('R1', pg_temp.c('KH1'), pg_temp.c('H1.hd'), jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.c('P1'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 240000, 'vat_rate', 0.1),
  jsonb_build_object('product_id', pg_temp.c('P1'), 'unit_name', 'lon', 'quantity', 2, 'unit_price', 10000, 'vat_rate', 0, 'is_exchange', true)));
SELECT pg_temp.tra_tu_lap('R2', pg_temp.c('KH2'), NULL, jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.c('P5'), 'unit_name', 'lon', 'quantity', 1, 'unit_price', 14000, 'vat_rate', 0)));
SELECT pg_temp.tra_tu_lap('R3', pg_temp.c('KH3'), NULL, jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.c('P5'), 'unit_name', 'lon', 'quantity', 2, 'unit_price', 14000, 'vat_rate', 0)));
SELECT pg_temp.tra_tu_lap('R4', pg_temp.c('KH2'), NULL, jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.c('P5'), 'unit_name', 'lon', 'quantity', 5, 'unit_price', 14000, 'vat_rate', 0)));
DO $d$ BEGIN
  PERFORM pg_temp.chu();
  PERFORM complete_return(pg_temp.c('R1'), 'sale');
  PERFORM complete_return(pg_temp.c('R3'), 'sale');
  PERFORM cancel_return(pg_temp.c('R3'), 'khách lấy lại');
  PERFORM complete_return(pg_temp.c('R4'), 'sale');
END $d$;
\o
